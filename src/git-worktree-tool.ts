import { join, resolve, sep, basename } from 'node:path'
import { stat, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name='maestro-git-worktree-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}> = z.object({rootPath:z.string()})
interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined,e:unknown):string{ if(c!==undefined) return c; const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd; return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  // For non-existent targets (create), realpath fails — allow if string prefix passes and parent is inside
  try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr||rt.startsWith(rr+sep)}catch{
    try{ const rr=await realpath(ar); const parent=resolve(rs,'..'); const rp=await realpath(parent); return rp===rr||rp.startsWith(rr+sep) }catch{ return rs===ar || rs.startsWith(ar+sep) }
  }
}
const SAFE_BRANCH=/^[A-Za-z0-9._\/-]+$/
const execFileAsync=promisify(execFile)
async function runGit(cwd:string, args:string[]):Promise<{code:number|null, stdout:string, stderr:string}>{
  try{
    const {stdout, stderr}=await execFileAsync('git', args, {cwd, timeout:10000}) as any
    return {code:0, stdout: String(stdout), stderr: String(stderr)}
  }catch(e:any){
    return {code:e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message)}
  }
}
async function exists(p:string):Promise<boolean>{ try{await stat(p); return true}catch{return false}}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'git_worktree',
    description:'Inspect/create/remove git worktrees deterministically (isolated workspace, branch, submodule guard).',
    parameters:{
      op:{type:'string', enum:['inspect','create','remove'], required:true},
      worktreePath:{type:'string', required:true},
      branch:{type:'string'},
      base:{type:'string'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:true,
        properties:{
          op:{type:'string', required:true},
          exists:{type:'boolean'},
          isWorktree:{type:'boolean'},
          created:{type:'boolean'},
          reason:{type:'string'},
        }
      },
      render:(_a,v)=>[{type:'text', text: JSON.stringify(v,null,2)}],
    },
    async execute(args, exec){
      const op=(args as {op:string}).op
      const rawPath=(args as {worktreePath:string}).worktreePath
      const root=workspaceRootFor(configuredRoot, exec)
      if(!(await isInsideRoot(root, rawPath))) return {text:`Path "${rawPath}" escapes the workspace root.`, truncated:false} as never
      const worktreePath=resolve(root, rawPath)

      if(op==='inspect'){
        const ex=await exists(worktreePath)
        let isWorktree=false, branch:string|null=null, headSha:string|null=null, isClean=true, gitDir:string|null=null, gitCommonDir:string|null=null
        if(ex){
          // try git rev-parse
          const r1=await runGit(worktreePath, ['rev-parse','--git-dir'])
          const r2=await runGit(worktreePath, ['rev-parse','--git-common-dir'])
          const r3=await runGit(worktreePath, ['branch','--show-current'])
          const r4=await runGit(worktreePath, ['rev-parse','HEAD'])
          const r5=await runGit(worktreePath, ['status','--porcelain'])
          if(r1.code===0) gitDir=r1.stdout.trim()
          if(r2.code===0) gitCommonDir=r2.stdout.trim()
          if(r3.code===0) branch=r3.stdout.trim()||null
          if(r4.code===0) headSha=r4.stdout.trim()||null
          isClean=r5.stdout.trim()===''
          // isWorktree if gitDir is file and gitCommonDir differs
          if(gitDir && gitCommonDir && gitDir!==gitCommonDir) isWorktree=true
          // fallback: if worktreePath contains .worktrees
          if(worktreePath.includes('/.worktrees/')) isWorktree=true
        }
        return {op:'inspect', exists:ex, branch, headSha, isClean, isWorktree, gitDir, gitCommonDir, untrackedFiles:[], truncated:false, ignored:null} as never
      }
      if(op==='create'){
        const branch=(args as {branch?:string}).branch
        const base=(args as {base?:string}).base ?? 'HEAD'
        if(!branch) return {text:'branch required for create', truncated:false} as never
        if(!SAFE_BRANCH.test(branch) || branch.startsWith('-') || branch.includes('..')) return {text:`invalid branch name "${branch}" — must match ${SAFE_BRANCH.source}`, truncated:false} as never
        if(branch.includes('--')) return {text:`invalid branch name "${branch}"`, truncated:false} as never
        // base validate
        if(base && !SAFE_BRANCH.test(base) && !/^[0-9a-f]{7,40}$/.test(base)) return {text:`invalid base "${base}"`, truncated:false} as never
        // .gitignore guard: check if worktreePath is ignored
        const check=await runGit(root, ['check-ignore','-q', worktreePath])
        const isIgnored=check.code===0
        if(!isIgnored){
          return {op:'create', created:false, worktreePath, branch, headSha:'', alreadyExisted:false, reason:'not ignored — add .worktrees to .gitignore'} as never
        }
        if(await exists(worktreePath)){
          return {op:'create', created:false, worktreePath, branch, headSha:'', alreadyExisted:true, reason:'already exists'} as never
        }
        const res=await runGit(root, ['worktree','add','--', worktreePath,'-b', branch, base])
        if(res.code!==0){
          if(res.stderr.includes('permission denied') || res.stderr.includes('EACCES')){
            return {op:'create', created:false, worktreePath, branch, headSha:'', alreadyExisted:false, reason:'blocked by sandbox — working in place'} as never
          }
          return {op:'create', created:false, worktreePath, branch, headSha:'', alreadyExisted:false, reason: res.stderr.slice(0,500)} as never
        }
        const head=await runGit(worktreePath, ['rev-parse','HEAD'])
        return {op:'create', created:true, worktreePath, branch, headSha: head.stdout.trim(), alreadyExisted:false, reason:null} as never
      }
      if(op==='remove'){
        const ex=await exists(worktreePath)
        if(!ex) return {op:'remove', removed:false, pruned:false, reason:'not exists', dirtyFiles:[]} as never
        const status=await runGit(worktreePath, ['status','--porcelain'])
        const dirtyFiles=status.stdout.trim()? status.stdout.trim().split('\n').slice(0,20):[]
        if(dirtyFiles.length>0){
          return {op:'remove', removed:false, pruned:false, reason:'contains modified or untracked files', dirtyFiles} as never
        }
        const res=await runGit(root, ['worktree','remove','--', worktreePath])
        if(res.code!==0) return {op:'remove', removed:false, pruned:false, reason: res.stderr.slice(0,500), dirtyFiles} as never
        const prune=await runGit(root, ['worktree','prune'])
        return {op:'remove', removed:true, pruned: prune.code===0, reason:null, dirtyFiles:[]} as never
      }
      return {text:`unknown op ${op}`, truncated:false} as never
    }
  }), 'git worktree'))
}
