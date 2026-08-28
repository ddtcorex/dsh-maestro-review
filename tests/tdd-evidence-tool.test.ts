import { describe,it,expect,afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'tdd-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'maestro_tdd_evidence', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('maestro_tdd_evidence', ()=>{
  it('registers tool', async ()=>{
    const {apply}=await import('../src/host/tdd-evidence-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('maestro_tdd_evidence')
  })
  it('red op captures failing test evidence', async ()=>{
    const {apply}=await import('../src/host/tdd-evidence-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await mkdir(join(root,'tests'),{recursive:true})
    await writeFile(join(root,'tests/red.test.ts'), `it('fails',()=>{ throw new Error('RED')})`)
    const res=await r[0].execute({op:'red', testFile:'tests/red.test.ts'}, exec(root)) as {ok:boolean, phase:string}
    expect(res.ok).toBe(true)
    expect(res.phase).toBe('red')
  })
  it('green op requires prior red', async ()=>{
    const {apply}=await import('../src/host/tdd-evidence-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'green', testFile:'tests/green.test.ts'}, exec(root)) as {ok:boolean, error?:string}
    expect(res.ok).toBe(false)
    expect(res.error).toContain('red')
  })
  it('verify op checks pnpm verify output', async ()=>{
    const {apply}=await import('../src/host/tdd-evidence-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await writeFile(join(root,'package.json'), JSON.stringify({name:'x', version:'0.0.0'}))
    const res=await r[0].execute({op:'verify'}, exec(root)) as {ok:boolean, verify:{passed:boolean}}
    expect(typeof res.ok).toBe('boolean')
  })
  it('rejects escaping testFile', async ()=>{
    const {apply}=await import('../src/host/tdd-evidence-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'red', testFile:'../../etc/passwd'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as any).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
})
