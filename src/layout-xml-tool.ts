import { join, resolve, sep, basename, dirname } from 'node:path'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-layout-xml-tool'
export const inject = ['tools']
export const Config: z<{ rootPath?: string }> = z.object({ rootPath: z.string() })

interface SessionCwdSource { agent?: { session?: { header?: { cwd?: string } } } }
function workspaceRootFor(c:string|undefined, exec:unknown):string{
  if(c!==undefined) return c
  const cwd=(exec as SessionCwdSource|undefined)?.agent?.session?.header?.cwd
  return typeof cwd==='string' && cwd!=='' ? cwd : process.cwd()
}
async function isInsideRoot(root:string, target:string):Promise<boolean>{
  const ar=resolve(root); const rs=resolve(ar,target)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr || rt.startsWith(rr+sep)}catch{return false}
}
const MAX_FILE_BYTES=1024*1024
const MAX_FILES=2000
const SKIP_DIRS=new Set(['.git','node_modules','vendor','pub/static'])
const LAYOUT_RE = /\/layout\//

// tiny helpers
function parseAttrs(s:string):Record<string,string>{
  const out:Record<string,string>={}
  let m:RegExpExecArray|null
  const re=/(\w+)="([^"]*)"/g
  while((m=re.exec(s))!==null) out[m[1]]=m[2]
  return out
}
async function exists(p:string):Promise<boolean>{ try{await stat(p); return true}catch{return false}}
async function* walkLayout(dir:string, root:string, budget:{files:number}):AsyncGenerator<string>{
  if(budget.files<=0) return
  let entries
  try{ entries=await readdir(dir,{withFileTypes:true})}catch{return}
  for(const e of entries){
    if(budget.files<=0) return
    if(e.isDirectory()){
      if(SKIP_DIRS.has(e.name)) continue
      yield* walkLayout(join(dir,e.name), root, budget)
      continue
    }
    if(!e.isFile()) continue
    if(!e.name.endsWith('.xml')) continue
    if(!join(dir,e.name).includes('/layout/')) continue
    budget.files-=1
    yield join(dir,e.name)
  }
}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'layout_xml_extract',
    description:'Extract Magento layout handles/blocks/moves/head from layout XML under workspace. Use before claiming layout is correct.',
    parameters:{
      root:{type:'string'},
      changedFiles:{type:'array', items:{type:'string'}},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          handles:{type:'array', required:true},
          handleCount:{type:'number', required:true},
          blockCount:{type:'number', required:true},
          scannedFiles:{type:'number', required:true},
          truncated:{type:'boolean', required:true},
        }
      },
      render:(_args,v)=>[{type:'text', text: JSON.stringify(v,null,2)}],
    },
    async execute(args, exec){
      const rawRoot=(args as {root?:string}).root ?? ''
      const root=workspaceRootFor(configuredRoot, exec)
      if(rawRoot!=='' && !(await isInsideRoot(root, rawRoot))) return {text:`Path "${rawRoot}" escapes the workspace root.`, truncated:false} as never
      const effectiveRoot = rawRoot==='' ? root : resolve(root, rawRoot)
      const changedFiles=(args as {changedFiles?:string[]}).changedFiles
      if(changedFiles){
        for(const p of changedFiles){
          if(!(await isInsideRoot(effectiveRoot, p))) return {text:`Path "${p}" escapes the workspace root.`, truncated:false} as never
        }
      }
      // collect files
      const budget={files:MAX_FILES}
      const all:string[]=[]
      for await(const f of walkLayout(effectiveRoot, effectiveRoot, budget)){
        const rel=f.startsWith(effectiveRoot+sep)? f.slice(effectiveRoot.length+1): basename(f)
        all.push(rel)
      }
      let files=all
      if(changedFiles && changedFiles.length>0){
        const set=new Set(changedFiles.map(p=>p.endsWith('.xml')?p:p))
        files=all.filter(p=> set.has(p) || changedFiles.some(cf=> p.endsWith(basename(cf))))
        // also if allow-list contains files not discovered via walk (e.g., outside layout but still layout), include them if they exist and are layout
        for(const cf of changedFiles){
          if(!files.includes(cf)){
            const abs=resolve(effectiveRoot, cf)
            if(await exists(abs) && cf.includes('/layout/') && cf.endsWith('.xml') && !(all.includes(cf))) files.push(cf)
          }
        }
      }
      const truncated = budget.files<=0
      const handles:Array<{file:string,handle:string,layoutType:string,blocks:Array<{name:string|null,type:string,class:string|null,template:string|null,templateExists:boolean|null,as:string|null,cacheable:boolean|null,remove:boolean,refs:string[]}>,moves:Array<{element:string,destination:string|null,as:string|null,before:string|null,after:string|null}>,references:Array<{kind:string,name:string,attrs:Record<string,string>}>,head:{scripts:Array<{src:string}>,css:Array<{src:string}>,metas:Array<Record<string,string>>,removes:Array<string>},parseError:string|null}>=[]
      let blockCount=0
      for(const rel of files){
        const abs=resolve(effectiveRoot, rel)
        let text:string
        try{
          const buf=await readFile(abs)
          if(buf.byteLength>MAX_FILE_BYTES) continue
          text=buf.toString('utf-8')
        }catch{continue}
        const handle=basename(rel,'.xml')
        const layoutType=/<page\b/.test(text)?'page':'generic'
        // quick parseError heuristic: mismatched < vs > or unclosed tag
        let parseError:string|null=null
        const openCount=(text.match(/</g)||[]).length
        const closeCount=(text.match(/>/g)||[]).length
        if(openCount!==closeCount) parseError=`mismatched < (${openCount}) vs > (${closeCount})`
        // also detect block tag without closing >
        if(/<block[^>]*$/m.test(text) || /<block[^>]*<\/body/.test(text)) parseError=parseError ?? 'malformed block tag'
        if(parseError){
          handles.push({file:rel,handle,layoutType,blocks:[],moves:[],references:[],head:{scripts:[],css:[],metas:[],removes:[]},parseError})
          continue
        }
        const blocks:Array<{name:string|null,type:string,class:string|null,template:string|null,templateExists:boolean|null,as:string|null,cacheable:boolean|null,remove:boolean,refs:string[]}>=[]
        const moves:Array<{element:string,destination:string|null,as:string|null,before:string|null,after:string|null}>=[]
        const references:Array<{kind:string,name:string,attrs:Record<string,string>}>=[]
        const head={scripts:[] as Array<{src:string}>, css:[] as Array<{src:string}>, metas:[] as Array<Record<string,string>>, removes:[] as string[]}
        // blocks/containers (only concrete)
        const tagRe=/<(block|container)\b([^>]*?)(?:\/>|>)/g
        let m:RegExpExecArray|null
        while((m=tagRe.exec(text))!==null){
          const type=m[1]; const attrStr=m[2]; const attrs=parseAttrs(attrStr)
          const name=attrs.name ?? null
          const klass=attrs.class ?? null
          const template=attrs.template ?? null
          let templateExists:boolean|null=null
          if(template!==null){
            if(template.includes('::')){
              const [modPart, filePart]=template.split('::')
              const [vendor, mod]=modPart.split('_')
              if(vendor && mod && filePart){
                const cand=join(effectiveRoot, `app/code/${vendor}/${mod}/view/frontend/templates/${filePart}`)
                templateExists=await exists(cand)
                if(!templateExists){
                  templateExists=false
                }
              } else templateExists=false
            } else {
              templateExists=await exists(join(effectiveRoot, template))
            }
          }
          const as=attrs.as ?? null
          const cacheable=attrs.cacheable ? attrs.cacheable==='true' : null
          const remove=attrs.remove==='true'
          blocks.push({name, type, class:klass, template, templateExists, as, cacheable, remove, refs:[]})
        }
        // references
        const refRe=/(<(referenceBlock|referenceContainer)\b([^>]*?)(?:\/>|>))/g
        while((m=refRe.exec(text))!==null){
          const type=m[2]; const attrs=parseAttrs(m[3])
          references.push({kind:type, name: attrs.name ?? '', attrs})
        }
        // moves
        const moveRe=/<move\b([^>]*?)\/>/g
        while((m=moveRe.exec(text))!==null){
          const attrs=parseAttrs(m[1])
          moves.push({element:attrs.element ?? '', destination:attrs.destination ?? null, as:attrs.as ?? null, before:attrs.before ?? null, after:attrs.after ?? null})
        }
        // head css/scripts
        const cssRe=/<css\b([^>]*?)\/>/g
        while((m=cssRe.exec(text))!==null){ const a=parseAttrs(m[1]); if(a.src) head.css.push({src:a.src}) }
        const scriptRe=/<script\b([^>]*?)\/>/g
        while((m=scriptRe.exec(text))!==null){ const a=parseAttrs(m[1]); if(a.src) head.scripts.push({src:a.src}) }
        // also <remove src=>
        const removeRe=/<remove\b([^>]*?)\/>/g
        while((m=removeRe.exec(text))!==null){ const a=parseAttrs(m[1]); if(a.src) head.removes.push(a.src) }

        blockCount+=blocks.length
        handles.push({file:rel,handle,layoutType,blocks,moves,references,head,parseError:null})
      }
      return {handles, handleCount:handles.length, blockCount, scannedFiles:files.length, truncated} as never
    },
  }), 'layout xml'))
}
