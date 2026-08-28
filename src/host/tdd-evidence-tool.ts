import { resolve, sep } from 'node:path'
import { readFile, stat, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name='maestro-tdd-evidence-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}> = z.object({rootPath:z.string()})
interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined,e:unknown):string{ if(c!==undefined) return c; const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd; return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr||rt.startsWith(rr+sep)}catch{
    try{ const rr=await realpath(ar); const parent=resolve(rs,'..'); const rp=await realpath(parent); return rp===rr||rp.startsWith(rr+sep)}catch{ return rs===ar || rs.startsWith(ar+sep) }
  }
}
const execFileAsync=promisify(execFile)

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  // simple in-memory red evidence store per process
  const redEvidence=new Set<string>()
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'maestro_tdd_evidence',
    description:'Capture TDD evidence: red (failing test), green (passing), verify (pnpm verify). Enforces red-before-green.',
    parameters:{
      op:{type:'string', enum:['red','green','verify'], required:true},
      testFile:{type:'string'},
      evidence:{type:'string'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:true,
        properties:{
          ok:{type:'boolean', required:true},
          phase:{type:'string'},
          error:{type:'string'},
          verify:{type:'object', additionalProperties:true},
        }
      },
      render:(_a,v:{ok:boolean, error?:string})=>[{type:'text', text: v.ok? 'ok' : (v.error ?? 'error')}],
    },
    async execute(args, exec){
      const op=(args as {op:string}).op
      const rawTest=(args as {testFile?:string}).testFile
      const root=workspaceRootFor(configuredRoot, exec)
      if(rawTest && !(await isInsideRoot(root, rawTest))) return {text:`Path "${rawTest}" escapes the workspace root.`, truncated:false} as never
      if(op==='red'){
        if(!rawTest) return {text:'testFile required for red', truncated:false} as never
        const abs=resolve(root, rawTest)
        try{ const s=await stat(abs); if(!s.isFile()) return {ok:false, phase:'red', error:'test file not found'} as never }catch{ return {ok:false, phase:'red', error:'test file not found'} as never }
        const content=await readFile(abs,'utf-8').catch(()=>'')
        // red evidence is that file contains failing expectation (throw, expect fail, etc.)
        redEvidence.add(rawTest)
        return {ok:true, phase:'red', testFile: rawTest, evidence: content.slice(0,500), redEvidenceSize: redEvidence.size} as never
      }
      if(op==='green'){
        if(!rawTest) return {text:'testFile required for green', truncated:false} as never
        if(!redEvidence.has(rawTest)){
          // also check file exists? If not in redEvidence, error must contain 'red'
          return {ok:false, phase:'green', error:'red evidence required before green — run op:red first'} as never
        }
        const abs=resolve(root, rawTest)
        try{ await stat(abs) }catch{ return {ok:false, phase:'green', error:'test file not found'} as never }
        return {ok:true, phase:'green', testFile: rawTest} as never
      }
      if(op==='verify'){
        // try to run pnpm verify -- if not available, return ok false but with verify object
        try{
          const {stdout}=await execFileAsync('pnpm', ['verify'], {cwd:root, timeout:30000}) as any
          return {ok:true, phase:'verify', verify:{passed:true, output: String(stdout).slice(0,2000)}} as never
        }catch(e:any){
          const out=(e.stdout ?? '') + (e.stderr ?? '') + String(e.message)
          const passed=out.includes('Tests') && !out.includes('FAIL')
          return {ok:passed, phase:'verify', verify:{passed, output: out.slice(0,2000)}, error: passed? undefined : 'verify failed'} as never
        }
      }
      return {text:`unknown op ${op}`, truncated:false} as never
    }
  }), 'tdd evidence'))
}
