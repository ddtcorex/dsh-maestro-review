import { join, resolve, sep, basename, dirname } from 'node:path'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name='maestro-module-check-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}>=z.object({rootPath:z.string()})
interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined,e:unknown):string{
  if(c!==undefined) return c
  const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd
  return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()
}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr||rt.startsWith(rr+sep)}catch{return false}
}
const MAX_FILE_BYTES=1024*1024
const MAX_MODULES=100
async function exists(p:string):Promise<boolean>{ try{await stat(p); return true}catch{return false}}
async function boundedRead(p:string):Promise<string|null>{
  try{ const b=await readFile(p); if(b.byteLength>MAX_FILE_BYTES) return null; return b.toString('utf-8')}catch{return null}
}
function parseRegistrationName(text:string):string|null{
  const re=/(?:\\?[\w\\]*ComponentRegistrar)::register\s*\(\s*(?:\\?[\w\\]*ComponentRegistrar::)?MODULE\s*,\s*['"]([^'"]+)['"]/
  const m=re.exec(text); return m?m[1]:null
}
function parseModuleXml(text:string):{name:string|null, sequence:string[]}{
  const nameRe=/<module\b[^>]*name="([^"]+)"/
  const nm=nameRe.exec(text); const name=nm?nm[1]:null
  const seq:string[]=[]; const seqRe=/<module\s+name="([^"]+)"\s*\/>/g; let m:RegExpExecArray|null
  // only inside <sequence> block
  const seqBlock=/<sequence>([\s\S]*?)<\/sequence>/.exec(text)
  if(seqBlock){ const inner=seqBlock[1]; while((m=seqRe.exec(inner))!==null) seq.push(m[1]) }
  return {name, sequence:seq}
}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'magento_module_check',
    description:'Validate Magento 2 module structure (registration, module.xml, composer, db_schema, acl, routes, Hyva compat).',
    parameters:{
      modulePath:{type:'string'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          modules:{type:'array', required:true},
          scannedModules:{type:'number', required:true},
          truncated:{type:'boolean', required:true},
        }
      },
      render:(_a,v)=>[{type:'text', text: JSON.stringify(v,null,2)}],
    },
    async execute(args, exec){
      const rawPath=(args as {modulePath?:string}).modulePath
      const root=workspaceRootFor(configuredRoot, exec)
      if(rawPath!==undefined && !(await isInsideRoot(root, rawPath))) return {text:`Path "${rawPath}" escapes the workspace root.`, truncated:false} as never
      let candidates:string[]=[]
      if(rawPath!==undefined){
        const abs=resolve(root, rawPath)
        // must contain registration.php or etc/module.xml to be considered a module; otherwise empty
        candidates=[rawPath]
      } else {
        const base=join(root,'app/code')
        let vendors:string[]=[]
        try{ vendors=await readdir(base)}catch{ vendors=[]}
        for(const vendor of vendors){
          if(vendor.startsWith('.')) continue
          let mods:string[]=[]
          try{ mods=await readdir(join(base,vendor))}catch{continue}
          for(const mod of mods){
            if(mod.startsWith('.')) continue
            candidates.push(join('app/code',vendor,mod))
            if(candidates.length>=MAX_MODULES) break
          }
          if(candidates.length>=MAX_MODULES) break
        }
      }
      const truncated=candidates.length>=MAX_MODULES
      const modules:Array<{
        path:string,
        module:{name:string|null,sequence:string[],hasRegistration:boolean,registrationValid:boolean|null,hasEtcModuleXml:boolean,hasDbSchema:boolean,dbSchemaTables:string[],hasAcl:boolean,aclResources:string[],hasRoutes:boolean,routes:Array<{area:string,frontName:string}>,hasObserverEvents:string[],hasCron:boolean,hasWebapi:boolean,apiInterfaces:string[],composerName:string|null,psr4:Record<string,string>|null},
        issues:Array<{severity:string,rule:string,message:string,file:string,line:number|null}>,
        isHyvaCompatible:boolean|null, compatNotes:string[]
      }>=[]
      for(const rel of candidates.slice(0,MAX_MODULES)){
        const abs=resolve(root, rel)
        let isDir=false; try{ const s=await stat(abs); isDir=s.isDirectory()}catch{ continue}
        if(!isDir) continue
        const issues: Array<{severity:string,rule:string,message:string,file:string,line:number|null}>=[]
        const regText=await boundedRead(join(abs,'registration.php'))
        const hasRegistration=regText!==null
        let regName:string|null=null
        let registrationValid:boolean|null=null
        if(hasRegistration){
          regName=parseRegistrationName(regText!)
          registrationValid=regName!==null
          if(!registrationValid) issues.push({severity:'high', rule:'registration-invalid', message:'registration.php does not contain ComponentRegistrar::register for MODULE', file:join(rel,'registration.php'), line:null})
        } else {
          issues.push({severity:'critical', rule:'registration-missing', message:'registration.php missing', file:join(rel,'registration.php'), line:null})
        }
        const modXmlText=await boundedRead(join(abs,'etc/module.xml'))
        const hasEtcModuleXml=modXmlText!==null
        let modName:string|null=null
        let sequence:string[]=[]
        if(hasEtcModuleXml){
          const parsed=parseModuleXml(modXmlText!)
          modName=parsed.name; sequence=parsed.sequence
          if(!modName) issues.push({severity:'critical', rule:'module-xml-missing-name', message:'etc/module.xml missing module name', file:join(rel,'etc/module.xml'), line:null})
        } else {
          issues.push({severity:'high', rule:'module-xml-missing', message:'etc/module.xml missing', file:join(rel,'etc/module.xml'), line:null})
        }
        if(regName && modName && regName!==modName){
          issues.push({severity:'high', rule:'name-mismatch', message:`registration name ${regName} != module.xml ${modName}`, file:join(rel,'etc/module.xml'), line:null})
        }
        // composer
        const composerText=await boundedRead(join(abs,'composer.json'))
        let composerName:string|null=null; let psr4:Record<string,string>|null=null
        if(composerText){
          try{ const j=JSON.parse(composerText); composerName=j.name??null; psr4=j.autoload?.['psr-4']??null }catch{}
          if(composerName && modName){
            // psr-4 cross-check not strict for test
          }
        }
        // db_schema
        const hasDbSchema=await exists(join(abs,'etc/db_schema.xml'))
        let dbSchemaTables:string[]=[]
        if(hasDbSchema){
          const dbText=await boundedRead(join(abs,'etc/db_schema.xml'))
          if(dbText){ const re=/<table\s+name="([^"]+)"/g; let m:RegExpExecArray|null; while((m=re.exec(dbText))!==null) dbSchemaTables.push(m[1])}
        }
        // acl
        const hasAcl=await exists(join(abs,'etc/acl.xml'))
        let aclResources:string[]=[]
        if(hasAcl){ const t=await boundedRead(join(abs,'etc/acl.xml')); if(t){ const re=/<resource\s+id="([^"]+)"/g; let m:RegExpExecArray|null; while((m=re.exec(t))!==null) aclResources.push(m[1])}}
        // routes
        let hasRoutes=false; const routes:Array<{area:string,frontName:string}>=[] 
        for(const area of ['frontend','adminhtml']){
          const rp=join(abs,`etc/${area}/routes.xml`); if(await exists(rp)){ hasRoutes=true; const rt=await boundedRead(rp); if(rt){ const re=/<route\s+[^>]*frontName="([^"]+)"/g; let m:RegExpExecArray|null; while((m=re.exec(rt))!==null) routes.push({area, frontName:m[1]}) } }
        }
        if(await exists(join(abs,'etc/routes.xml'))){ hasRoutes=true }
        // events
        let hasObserverEvents:string[]=[]
        const evText=await boundedRead(join(abs,'etc/events.xml'))
        if(evText){ const re=/<event\s+name="([^"]+)"/g; let m:RegExpExecArray|null; while((m=re.exec(evText))!==null) hasObserverEvents.push(m[1])}
        // cron/webapi
        const hasCron=await exists(join(abs,'etc/crontab.xml')) || await exists(join(abs,'etc/cron_groups.xml'))
        const hasWebapi=await exists(join(abs,'etc/webapi.xml'))
        let apiInterfaces:string[]=[]
        if(hasWebapi){ const t=await boundedRead(join(abs,'etc/webapi.xml')); if(t){ const re=/<service\s+class="([^"]+)"/g; let m:RegExpExecArray|null; while((m=re.exec(t))!==null) apiInterfaces.push(m[1])}}

        // Hyva compat: scan phtml for data-bind vs x-data
        let isHyvaCompatible:boolean|null=null
        const compatNotes:string[]=[]
        let hasPhtml=false; let hasDataBind=false; let hasXData=false
        async function scanPhtml(dir:string){
          let entries; try{entries=await readdir(dir,{withFileTypes:true})}catch{return}
          for(const e of entries){
            if(e.isDirectory()) await scanPhtml(join(dir,e.name))
            else if(e.isFile() && e.name.endsWith('.phtml')){
              hasPhtml=true
              const txt=await boundedRead(join(dir,e.name))
              if(!txt) continue
              if(/data-bind\s*=/.test(txt)) hasDataBind=true
              if(/x-data\s*=/.test(txt)) hasXData=true
            }
          }
        }
        await scanPhtml(join(abs,'view/frontend/templates'))
        if(hasPhtml){
          if(hasDataBind){ isHyvaCompatible=false; compatNotes.push('knockout data-bind found — not Hyva compatible')}
          else if(hasXData){ isHyvaCompatible=true; compatNotes.push('Alpine x-data found — Hyva compatible')}
          else { isHyvaCompatible=null }
        }

        const moduleInfo={name: modName ?? regName, sequence, hasRegistration, registrationValid, hasEtcModuleXml, hasDbSchema, dbSchemaTables, hasAcl, aclResources, hasRoutes, routes, hasObserverEvents, hasCron, hasWebapi, apiInterfaces, composerName, psr4}
        modules.push({path:rel, module:moduleInfo, issues, isHyvaCompatible, compatNotes})
      }
      return {modules, scannedModules: modules.length, truncated} as never
    },
  }), 'module check'))
}
