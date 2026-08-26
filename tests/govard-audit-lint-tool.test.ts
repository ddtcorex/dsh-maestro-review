import { describe,it,expect,afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'review-audit-')); cleanup.push(d); return d}
afterEach(async()=>{ await Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))); vi.restoreAllMocks() })
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'govard_audit_lint', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('govard_audit_lint alias', ()=>{
  it('registers govard_audit_lint', async ()=>{
    const {apply}=await import('../src/govard-audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('govard_audit_lint')
  })
  it('rejects escaping worktreePath', async ()=>{
    const {apply}=await import('../src/govard-audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
})
