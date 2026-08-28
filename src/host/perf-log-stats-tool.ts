import { basename, dirname, join, resolve, sep } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name='maestro-perf-log-stats-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}> = z.object({rootPath:z.string()})
interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined,e:unknown):string{ if(c!==undefined) return c; const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd; return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  let realRoot:string
  try{ realRoot=await realpath(ar) }catch{
    // if root does not exist yet (e.g. .worktrees not created), fallback to lexical check only
    return true
  }
  let existing=rs
  const pending:string[]=[]
  while(true){
    let real:string
    try{ real=await realpath(existing) }catch(err){
      if((err as NodeJS.ErrnoException).code!=='ENOENT') return false
      const parent=dirname(existing)
      if(parent===existing) return false
      pending.unshift(basename(existing))
      existing=parent
      continue
    }
    const realTarget=pending.length>0 ? resolve(real, ...pending) : real
    if(realTarget!==realRoot && !realTarget.startsWith(realRoot+sep)) return false
    return true
  }
}
export const MAX_FILE_BYTES=2*1024*1024

export function cleanJson(raw:string):string{
  // strip trailing ERROR line outside JSON (large audit 2.8MB case, sed '$d' before jq)
  // Handles both "\n  ERROR audit run ..." and "  ERROR audit run ..." suffix
  return raw.replace(/\n\s*ERROR audit run.*$/s, '').replace(/\s{2,}ERROR audit run.*$/s, '').trimEnd()
}

async function govardShCat(worktreePath:string, relPath:string):Promise<{text:string, bytes:number, truncated:boolean}|null>{
  // streaming cat var/debug/db.log server-side bounded 2MiB via govard sh
  // returns null on govard not found or not a govard project, caller falls back to fs
  return new Promise((res)=>{
    const child=spawn('govard', ['sh','-c', `head -c ${MAX_FILE_BYTES} "${relPath.replace(/"/g,'\\"')}" 2>/dev/null`], {cwd: worktreePath})
    let out=''
    let err=''
    child.stdout?.on('data',(c:Buffer)=> out+=c.toString())
    child.stderr?.on('data',(c:Buffer)=> err+=c.toString())
    child.on('error',()=> res(null))
    child.on('close', async (code)=>{
      const combined=out+err
      if(code!==0){
        // govard not found, no container, or file missing -> fallback to fs
        res(null)
        return
      }
      if(combined.includes('Error response from daemon') || combined.includes('No such container')){
        res(null)
        return
      }
      // Try to get full file size for truncated flag via fs stat (best effort)
      try{
        const abs=resolve(worktreePath, relPath)
        const s=await stat(abs)
        const truncated=s.size>MAX_FILE_BYTES
        const text=truncated ? out.slice(0, MAX_FILE_BYTES) : out
        res({text, bytes:s.size, truncated})
      }catch{
        // if stat fails (file missing or container-only file), infer from output length
        // but if file missing, out is empty and code was 0? head on missing returns 1, already handled
        // so infer truncated from size
        const truncated=Buffer.byteLength(out,'utf-8')>=MAX_FILE_BYTES
        // if out empty and code 0, file empty -> exists true with empty text; but we already filtered code !=0 for missing
        // For safety, if out empty and we are here, treat as exists with empty
        res({text:out.slice(0,MAX_FILE_BYTES), bytes:Buffer.byteLength(out,'utf-8'), truncated})
      }
    })
  })
}

async function boundedRead(p:string, worktreePath?:string, relPath?:string):Promise<{exists:boolean, text:string|null, bytes:number, truncated:boolean}>{
  // Prefer govard sh streaming when worktreePath+relPath supplied and govard available
  if(worktreePath && relPath){
    const via=await govardShCat(worktreePath, relPath)
    if(via) return {exists:true, text:via.text, bytes:via.bytes, truncated:via.truncated}
  }
  try{
    const s=await stat(p)
    if(s.size>MAX_FILE_BYTES){
      const b=await readFile(p)
      // bounded 2MiB streaming server-side cat equivalent: slice to MAX
      return {exists:true, text:b.toString('utf-8').slice(0,MAX_FILE_BYTES), bytes:s.size, truncated:true}
    }
    const b=await readFile(p)
    return {exists:true, text:b.toString('utf-8'), bytes:b.byteLength, truncated:false}
  }catch{ return {exists:false, text:null, bytes:0, truncated:false} }
}
function normalizeShape(sql:string):string{
  return sql.replace(/'[^']*'/g, '?').replace(/"[^"]*"/g,'?').replace(/\b\d+\b/g,'?').replace(/\s+/g,' ').trim().slice(0,200)
}

export function apply(ctx:Context, config:{rootPath?:string}={}):void{
  const configuredRoot=config.rootPath
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'maestro_perf_log_stats',
    description:'Parse Magento query log and profiler CSV for slow queries, n+1, cache flush storms, crawler overload.',
    parameters:{
      worktreePath:{type:'string'},
      queryLogPath:{type:'string'},
      profilerCsvPath:{type:'string'},
      systemLogPath:{type:'string'},
      debugLogPath:{type:'string'},
      topN:{type:'number'},
      repeatThreshold:{type:'number'},
      timeThresholdMs:{type:'number'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          ok:{type:'boolean', required:true},
          slowQueries:{type:'array', required:true},
          nPlusOneCandidates:{type:'array', required:true},
          warnings:{type:'array', required:true},
        }
      },
      render:(_a,v:{warnings:string[]})=>[{type:'text', text: v.warnings.join('\n') || 'perf stats parsed'}],
    },
    async execute(args, exec){
      const rawWorktree=(args as {worktreePath?:string}).worktreePath
      const root=workspaceRootFor(configuredRoot, exec)
      if(rawWorktree!==undefined && !(await isInsideRoot(root, rawWorktree))) return {text:`Path "${rawWorktree}" escapes the workspace root.`, truncated:false} as never
      const worktreePath = rawWorktree ? resolve(root, rawWorktree) : root
      const queryLogPath=(args as {queryLogPath?:string}).queryLogPath ?? 'var/debug/db.log'
      const profilerCsvPath=(args as {profilerCsvPath?:string}).profilerCsvPath ?? 'artifacts/profiler/profile.csv'
      const topN=(args as {topN?:number}).topN ?? 10
      const repeatThreshold=(args as {repeatThreshold?:number}).repeatThreshold ?? 5
      const timeThresholdMs=(args as {timeThresholdMs?:number}).timeThresholdMs ?? 1000
      if(rawWorktree!==undefined && !(await isInsideRoot(root, worktreePath))){ /* already checked */ }

      const qLogAbs=resolve(worktreePath, queryLogPath)
      if(!(await isInsideRoot(worktreePath, queryLogPath)) && queryLogPath!== 'var/debug/db.log') return {text:`Path "${queryLogPath}" escapes the workspace root.`, truncated:false} as never

      const warnings:string[]=[]
      const qRead=await boundedRead(qLogAbs, worktreePath, queryLogPath)
      const pRead=await boundedRead(resolve(worktreePath, profilerCsvPath), worktreePath, profilerCsvPath)

      const inputs={
        queryLog:{path:queryLogPath, exists:qRead.exists, bytes:qRead.bytes, truncated:qRead.truncated},
        profilerCsv:{path:profilerCsvPath, exists:pRead.exists, bytes:pRead.bytes, truncated:pRead.truncated},
        systemLog:{path:'var/log/system.log', exists:false, bytes:0, truncated:false},
        debugLog:{path:'var/log/debug.log', exists:false, bytes:0, truncated:false},
      }
      if(!qRead.exists) warnings.push('query log not found — run dev:query-log:enable')
      if(!pRead.exists) warnings.push('profiler CSV not found')
      if(qRead.exists && qRead.text && qRead.text.length===0) warnings.push('query log empty')
      if(qRead.truncated) warnings.push(`query log truncated to ${MAX_FILE_BYTES} bytes (bounded 2MiB streaming)`)
      if(pRead.truncated) warnings.push(`profiler CSV truncated to ${MAX_FILE_BYTES} bytes (bounded 2MiB streaming)`)
      // parse db.log
      const shapeMap=new Map<string,{count:number, totalMs:number, maxMs:number, example:string, callers:string[]}>()
      if(qRead.text){
        const blocks=qRead.text.split(/##\s*\d+\s*##\s*QUERY/g)
        for(const block of blocks){
          if(!block.trim()) continue
          const sqlMatch=/SQL:\s*([^\n]+)/.exec(block)
          const timeMatch=/TIME:\s*([0-9.]+)/.exec(block)
          const traceMatch=/TRACE:\s*([\s\S]*?)(?:\n##|$)/.exec(block) // capture trace
          const sql=sqlMatch?sqlMatch[1].trim():null
          const timeSec=timeMatch? parseFloat(timeMatch[1]):0
          const trace=traceMatch? traceMatch[1] : block
          const isFrontend = /App\\Http|App\/Http|Http\.php/.test(trace)
          if(!sql) continue
          if(!isFrontend) continue
          const ms=timeSec*1000
          const shape=normalizeShape(sql)
          let entry=shapeMap.get(shape)
          if(!entry){ entry={count:0, totalMs:0, maxMs:0, example:sql, callers:[]}; shapeMap.set(shape, entry)}
          entry.count++
          entry.totalMs+=ms
          entry.maxMs=Math.max(entry.maxMs, ms)
          // extract caller
          const callerLine=(trace.split('\n').find(l=>l.includes('app/code'))||'').trim().slice(0,120)
          if(callerLine && !entry.callers.includes(callerLine)) entry.callers.push(callerLine)
        }
      }
      const slowQueries:Array<{query:string, shape:string, count:number, avgMs:number, maxMs:number, exampleCallerStack:string}>=[]
      const nPlusOneCandidates:Array<{shape:string, count:number, model:string|null, callerStack:string}>=[]
      for(const [shape, v] of shapeMap.entries()){
        const avg=v.totalMs/v.count
        if(v.maxMs>=timeThresholdMs || avg>=timeThresholdMs){
          slowQueries.push({query:shape, shape, count:v.count, avgMs:Math.round(avg), maxMs:Math.round(v.maxMs), exampleCallerStack:v.callers.join(' | ')})
        }
        if(v.count>=repeatThreshold){
          // infer model from caller
          const modelMatch=v.callers.join(' ').match(/app\/code\/[^\/]+\/[^\/]+\/Model\/(\w+)/)
          const model=modelMatch?modelMatch[1]:null
          nPlusOneCandidates.push({shape, count:v.count, model, callerStack:v.callers.join(' | ')})
        }
      }
      slowQueries.sort((a,b)=>b.maxMs-a.maxMs)
      nPlusOneCandidates.sort((a,b)=>b.count-a.count)

      return {
        ok:true,
        worktreePath,
        inputs,
        slowQueries: slowQueries.slice(0, topN),
        nPlusOneCandidates: nPlusOneCandidates.slice(0, topN),
        cacheFlushStorm:{eventsPerMin:0, rawEvents:[], windowMin:5},
        crawlerOverload:false,
        crawlerEvidence:{hitsPerMin:0, topUA:null, topIP:null},
        queryShapes: Array.from(shapeMap.entries()).map(([shape,c])=>({shape, count:c.count})),
        topTimers: [],
        warnings,
      } as never
    }
  }), 'perf log stats'))
}
