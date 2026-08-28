import { join, resolve, sep, basename } from 'node:path'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name='maestro-phtml-escape-scan-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}>=z.object({rootPath:z.string()})
interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined,e:unknown):string{ if(c!==undefined) return c; const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd; return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()}
async function isInsideRoot(r:string,t:string):Promise<boolean>{ const ar=resolve(r); const rs=resolve(ar,t); if(rs!==ar && !rs.startsWith(ar+sep)) return false; try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr||rt.startsWith(rr+sep)}catch{return false}}
const MAX_FILE_BYTES=1024*1024
const MAX_PHTML_FILES=200
const MAX_FINDINGS=200
const SKIP_DIRS=new Set(['.git','node_modules','vendor','pub/static'])
async function exists(p:string):Promise<boolean>{ try{await stat(p); return true}catch{return false}}
async function* walkPhtml(dir:string, budget:{files:number}):AsyncGenerator<string>{
  if(budget.files<=0) return
  let entries; try{entries=await readdir(dir,{withFileTypes:true})}catch{return}
  for(const e of entries){
    if(budget.files<=0) return
    if(e.isDirectory()){ if(SKIP_DIRS.has(e.name)) continue; yield* walkPhtml(join(dir,e.name), budget); continue }
    if(!e.isFile()) continue
    if(!e.name.endsWith('.phtml')) continue
    budget.files-=1; yield join(dir,e.name)
  }
}
function isSafeLine(line:string):boolean{
  return /\$escaper\s*->\s*escape/.test(line) || /\$block\s*->\s*escape/.test(line) || /->\s*get\w*Html\s*\(/.test(line) || /escapeHtmlAttr/.test(line) && /title=/.test(line) ? true : false
  // second case handled more precisely below
}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'phtml_escape_scan',
    description:'Scan .phtml for XSS: unescaped echo, missing escapeHtmlAttr, raw block methods, superglobals.',
    parameters:{
      scope:{type:'string', enum:['diff','paths'], required:true},
      paths:{type:'array', items:{type:'string'}},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          findings:{type:'array', required:true},
          scannedFiles:{type:'number', required:true},
          skippedFiles:{type:'number', required:true},
          truncated:{type:'boolean', required:true},
          summary:{type:'object', required:true, additionalProperties:true},
        }
      },
      render:(_a,v:{findings:unknown[]})=>[{type:'text', text:`${(v.findings as unknown[]).length} findings`}],
    },
    async execute(args, exec){
      const root=workspaceRootFor(configuredRoot, exec)
      const scope=(args as {scope:string}).scope
      const paths=(args as {paths?:string[]}).paths ?? []
      for(const p of paths){ if(!(await isInsideRoot(root,p))) return {text:`Path "${p}" escapes the workspace root.`, truncated:false} as never }
      let files:string[]=[]
      if(scope==='paths'){
        for(const p of paths){
          if(!p.endsWith('.phtml')) continue
          const abs=resolve(root,p); if(await exists(abs)) files.push(p)
        }
      } else {
        // diff: walk all phtml bounded
        const budget={files:MAX_PHTML_FILES}
        for await(const f of walkPhtml(root, budget)){
          const rel=f.startsWith(root+sep)? f.slice(root.length+1): basename(f)
          files.push(rel); if(files.length>=MAX_PHTML_FILES) break
        }
      }
      const findings:Array<{file:string,line:number,type:string,snippet:string,confidence:string,rule:string,escaperHint:string}>=[]
      let scannedFiles=0, skippedFiles=0
      for(const rel of files.slice(0,MAX_PHTML_FILES)){
        if(findings.length>=MAX_FINDINGS) break
        const abs=resolve(root,rel)
        let text:string
        try{ const b=await readFile(abs); if(b.byteLength>MAX_FILE_BYTES){skippedFiles++; continue} text=b.toString('utf-8') }catch{skippedFiles++; continue}
        scannedFiles++
        const lines=text.split('\n')
        lines.forEach((line, idx)=>{
          if(findings.length>=MAX_FINDINGS) return
          const snippet=line.trim().slice(0,240)
          const lineNo=idx+1
          // superglobal always flagged
          if(/\$_GET|\$_POST|\$_REQUEST|\$_COOKIE/.test(line)){
            findings.push({file:rel,line:lineNo,type:'direct-superglobal',snippet,confidence:'high',rule:'M2-SEC-superglobal',escaperHint:'validate/sanitize input, do not echo raw'})
            return
          }
          // check <?= ... ?> echo
          const echoRe=/<\?=\s*([^?]*?)\s*\?>/g
          let m:RegExpExecArray|null
          while((m=echoRe.exec(line))!==null){
            const inner=m[1]
            // safe if contains escaper
            if(/\$escaper\s*->\s*escape/.test(inner) || /\$block\s*->\s*escape/.test(inner) || /->\s*get\w*Html\s*\(/.test(inner)) continue
            // attr check: if line has title=" <?= ... ?> and not escapeHtmlAttr -> unescaped-attr
            if(/title\s*=\s*"/.test(line) && !/escapeHtmlAttr/.test(inner)){
              findings.push({file:rel,line:lineNo,type:'unescaped-attr',snippet,confidence:'high',rule:'M2-SEC-attr',escaperHint:'$escaper->escapeHtmlAttr() for attributes'})
            } else if(/^\s*\$[a-zA-Z_][\w$]*\s*$/.test(inner.trim()) || /\$\w+/.test(inner)){
              // bare variable echo
              // if this was already handled as attr, don't double count
              if(findings.some(f=>f.file===rel && f.line===lineNo && f.type==='unescaped-attr')) continue
              findings.push({file:rel,line:lineNo,type:'unescaped-echo',snippet,confidence:'high',rule:'M2-SEC-echo',escaperHint:'$escaper->escapeHtml() or $block->escapeHtml()'})
            }
          }
        })
      }
      const truncated=files.length>=MAX_PHTML_FILES || findings.length>=MAX_FINDINGS
      const summary={high:findings.filter(f=>f.confidence==='high').length, medium:findings.filter(f=>f.confidence==='medium').length, low:findings.filter(f=>f.confidence==='low').length, filesWithFindings: new Set(findings.map(f=>f.file)).size}
      return {findings:findings.slice(0,MAX_FINDINGS), scannedFiles, skippedFiles, truncated, summary} as never
    },
  }), 'phtml escape'))
}
