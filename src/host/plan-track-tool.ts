import { join, resolve, sep } from 'node:path'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name='maestro-plan-track-tool'
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

type Task={id:string, title:string, status:'pending'|'in_progress'|'done'|'blocked', line:number}
function parseTasks(md:string):Task[]{
  const lines=md.split('\n')
  const tasks:Task[]=[]
  for(let i=0;i<lines.length;i++){
    const m=/^###\s+(Task\s*\d+):?\s*(.*)/.exec(lines[i].trim())
    if(!m) continue
    const id=m[1].trim()
    let title=m[2].trim()
    let status:Task['status']='pending'
    if(title.includes('in_progress')) status='in_progress'
    else if(title.toLowerCase().includes('done') || title.includes('✅')) status='done'
    else if(title.toLowerCase().includes('blocked')) status='blocked'
    for(let j=i+1;j<Math.min(i+4, lines.length);j++){
      if(lines[j].toLowerCase().includes('in_progress')) status='in_progress'
      if(lines[j].toLowerCase().includes('status: done')) status='done'
    }
    tasks.push({id, title, status, line:i})
  }
  return tasks
}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'maestro_plan_track',
    description:'Track cross-repo plan: init/update/complete tasks with dtodo sync and oneTaskOneCommit guard.',
    parameters:{
      op:{type:'string', enum:['init','update','complete'], required:true},
      planPath:{type:'string', required:true},
      taskId:{type:'string'},
      status:{type:'string', enum:['pending','in_progress','done','blocked']},
      note:{type:'string'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:true,
        properties:{
          ok:{type:'boolean', required:true},
          plan:{type:'object', required:true, additionalProperties:true},
          discipline:{type:'object', additionalProperties:true},
        }
      },
      render:(_a,v:{ok:boolean})=>[{type:'text', text: v.ok? 'ok' : 'violation'}],
    },
    async execute(args, exec){
      const op=(args as {op:string}).op
      const rawPath=(args as {planPath:string}).planPath
      const root=workspaceRootFor(configuredRoot, exec)
      if(!(await isInsideRoot(root, rawPath))) return {text:`Path "${rawPath}" escapes the workspace root.`, truncated:false} as never
      const planPath=resolve(root, rawPath)
      let md=''
      try{ md=await readFile(planPath,'utf-8') }catch{
        if(op==='init') return {text:`plan not found ${rawPath}`, truncated:false} as never
        md=''
      }
      const tasks=parseTasks(md)
      const lines=md.split('\n')

      if(op==='init'){
        const nextTask=tasks.find(t=>t.status==='pending' || t.status==='in_progress') || tasks[0] || null
        const dtodoPayload=tasks.map(t=>({content:`${t.id}: ${t.title}`, status: t.status}))
        return {ok:true, plan:{path: rawPath, tasks, nextTask, dtodoPayload}, discipline:{violation:null}} as never
      }
      if(op==='update'){
        const taskId=(args as {taskId?:string}).taskId
        const status=(args as {status?:string}).status as Task['status'] | undefined
        if(!taskId) return {text:'taskId required', truncated:false} as never
        const idx=tasks.findIndex(t=>t.id===taskId)
        if(idx<0) return {text:`task ${taskId} not found`, truncated:false} as never
        if(status==='in_progress'){
          const other=tasks.find(t=>t.id!==taskId && t.status==='in_progress')
          if(other){
            return {ok:false, plan:{path: rawPath, tasks, nextTask: tasks.find(t=>t.status==='in_progress')||null, dtodoPayload:[]}, discipline:{violation:'oneTaskOneCommit: only one task may be in_progress at a time'}} as never
          }
        }
        const lineIdx=tasks[idx].line
        if(status){
          const orig=lines[lineIdx]
          if(orig.includes('—')) lines[lineIdx]=orig.replace(/—.*$/, `— ${status}`)
          else lines[lineIdx]=`${orig} — ${status}`
          await mkdir(join(planPath,'..'),{recursive:true})
          await writeFile(planPath, lines.join('\n'), 'utf-8')
          tasks[idx].status=status
        }
        const nextTask=tasks.find(t=>t.status==='in_progress') || tasks.find(t=>t.status==='pending') || null
        return {ok:true, plan:{path: rawPath, tasks, nextTask, dtodoPayload: tasks.map(t=>({content:`${t.id}: ${t.title}`, status:t.status}))}, discipline:{violation:null}} as never
      }
      if(op==='complete'){
        const pending=tasks.filter(t=>t.status!=='done')
        if(pending.length>0){
          return {ok:false, plan:{path: rawPath, tasks, nextTask: pending[0], dtodoPayload:[]}, discipline:{violation:`pending tasks remain: ${pending.map(p=>p.id).join(',')}`}} as never
        }
        return {ok:true, plan:{path: rawPath, tasks, nextTask:null, dtodoPayload:[]}, discipline:{violation:null}} as never
      }
      return {text:`unknown op ${op}`, truncated:false} as never
    }
  }), 'plan track'))
}
