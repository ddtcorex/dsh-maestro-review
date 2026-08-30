import { describe,it,expect,afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'gw-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'git_worktree', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}
async function withIsolatedGitEnv<T>(fn:()=>Promise<T>):Promise<T>{
  const prevGlobal=process.env.GIT_CONFIG_GLOBAL, prevSystem=process.env.GIT_CONFIG_SYSTEM
  process.env.GIT_CONFIG_GLOBAL='/dev/null'
  process.env.GIT_CONFIG_SYSTEM='/dev/null'
  try{ return await fn() }
  finally{
    if(prevGlobal===undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL=prevGlobal
    if(prevSystem===undefined) delete process.env.GIT_CONFIG_SYSTEM; else process.env.GIT_CONFIG_SYSTEM=prevSystem
  }
}

describe('git_worktree', ()=>{
  it('registers git_worktree with op discriminator', async ()=>{
    const {apply}=await import('../src/host/git-worktree-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('git_worktree')
  })
  it('inspect non-worktree returns exists false and isWorktree false', async ()=>{
    const {apply}=await import('../src/host/git-worktree-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'inspect', worktreePath: root}, exec(root)) as {op:string, exists:boolean, isWorktree:boolean}
    expect(res.op).toBe('inspect')
    expect(res.exists).toBe(true)
    expect(res.isWorktree).toBe(false)
  })
  it('create rejects branch injection', async ()=>{
    const {apply}=await import('../src/host/git-worktree-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'create', worktreePath: join(root,'.worktrees/a'), branch:'--upload-pack=touch /tmp/pwn'}, exec(root)) as {text?:string, isError?:boolean}
    const txt=typeof res==='string'?res: (res as any).text ?? JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('branch')
  })
  it('create rejects when .worktrees not ignored', async ()=>{
    await withIsolatedGitEnv(async ()=>{
      const {apply}=await import('../src/host/git-worktree-tool.js')
      const {r,ctx}=cap(); apply(ctx as never,{})
      const root=await tempDir()
      // init git repo without .gitignore — isolated from any machine-level
      // global/system excludesFile so the assertion holds on every machine.
      const {execFile} = await import('node:child_process')
      const {promisify}=await import('node:util')
      const pExec=promisify(execFile)
      await pExec('git', ['init'], {cwd: root})
      await writeFile(join(root,'.gitignore'),'node_modules\n')
      const res=await r[0].execute({op:'create', worktreePath: join(root,'.worktrees/a'), branch:'feat/test'}, exec(root)) as {created:boolean, reason?:string}
      expect(res.created).toBe(false)
      expect(res.reason).toContain('ignored')
    })
  })
  it('create succeeds and produces a real worktree when .worktrees is ignored', async ()=>{
    await withIsolatedGitEnv(async ()=>{
      const {apply}=await import('../src/host/git-worktree-tool.js')
      const {r,ctx}=cap(); apply(ctx as never,{})
      const root=await tempDir()
      const {execFile} = await import('node:child_process')
      const {promisify}=await import('node:util')
      const pExec=promisify(execFile)
      await pExec('git', ['init'], {cwd: root})
      await pExec('git', ['config','user.email','a@a.com'], {cwd: root})
      await pExec('git', ['config','user.name','a'], {cwd: root})
      await writeFile(join(root,'.gitignore'),'.worktrees\n')
      await writeFile(join(root,'f.txt'),'x\n')
      await pExec('git', ['add','.'], {cwd: root})
      await pExec('git', ['commit','-m','init'], {cwd: root})
      const res=await r[0].execute({op:'create', worktreePath: join(root,'.worktrees/a'), branch:'feat/test'}, exec(root)) as {created:boolean, reason?:string|null, headSha?:string}
      expect(res.reason).toBeFalsy()
      expect(res.created).toBe(true)
      expect(res.headSha).toBeTruthy()
    })
  })
  it('remove rejects escaping worktreePath', async ()=>{
    const {apply}=await import('../src/host/git-worktree-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({op:'remove', worktreePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as any).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
})
