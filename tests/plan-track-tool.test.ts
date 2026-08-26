import { describe,it,expect,afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'plan-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'maestro_plan_track', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('maestro_plan_track', ()=>{
  it('registers tool', async ()=>{
    const {apply}=await import('../src/plan-track-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('maestro_plan_track')
  })
  it('init returns nextTask and dtodoPayload', async ()=>{
    const {apply}=await import('../src/plan-track-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const planPath=join(root,'docs/plans/2026-08-27-demo.md')
    await mkdir(join(root,'docs/plans'),{recursive:true})
    await writeFile(planPath, `### Task 1: Setup\n- [ ] do A\n### Task 2: Build\n- [ ] do B\n`)
    const res=await r[0].execute({op:'init', planPath:'docs/plans/2026-08-27-demo.md'}, exec(root)) as {ok:boolean, plan:{nextTask:{id:string}, dtodoPayload:any[]}}
    expect(res.ok).toBe(true)
    expect(res.plan.nextTask.id).toBe('Task 1')
    expect(res.plan.dtodoPayload.length).toBe(2)
  })
  it('update flips to in_progress and writes file', async ()=>{
    const {apply}=await import('../src/plan-track-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const planPath=join(root,'docs/plans/2026-08-27-demo.md')
    await mkdir(join(root,'docs/plans'),{recursive:true})
    await writeFile(planPath, `### Task 1: Setup\n- [ ] do A\n`)
    await r[0].execute({op:'update', planPath:'docs/plans/2026-08-27-demo.md', taskId:'Task 1', status:'in_progress'}, exec(root))
    const txt=await readFile(planPath,'utf-8')
    expect(txt).toContain('in_progress')
  })
  it('rejects escaping planPath', async ()=>{
    const {apply}=await import('../src/plan-track-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'init', planPath:'../../etc/passwd'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as any).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
  it('oneTaskOneCommit violation when second in_progress', async ()=>{
    const {apply}=await import('../src/plan-track-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const planPath=join(root,'docs/plans/2026-08-27-demo.md')
    await mkdir(join(root,'docs/plans'),{recursive:true})
    await writeFile(planPath, `### Task 1: Setup\n- [ ] do A\n### Task 2: Build\n- [ ] do B\n`)
    await r[0].execute({op:'update', planPath:'docs/plans/2026-08-27-demo.md', taskId:'Task 1', status:'in_progress'}, exec(root))
    const res=await r[0].execute({op:'update', planPath:'docs/plans/2026-08-27-demo.md', taskId:'Task 2', status:'in_progress'}, exec(root)) as {ok:boolean, discipline:{violation:string|null}}
    expect(res.ok).toBe(false)
    expect(res.discipline.violation).toContain('oneTaskOneCommit')
  })
})
