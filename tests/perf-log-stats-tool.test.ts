import { describe,it,expect,afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'perflog-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'maestro_perf_log_stats', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('maestro_perf_log_stats', ()=>{
  it('registers tool', async ()=>{
    const {apply}=await import('../src/perf-log-stats-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('maestro_perf_log_stats')
  })
  it('empty logs returns ok true with warnings', async ()=>{
    const {apply}=await import('../src/perf-log-stats-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({}, exec(root)) as {ok:boolean, warnings:string[], slowQueries:unknown[]}
    expect(res.ok).toBe(true)
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.slowQueries.length).toBe(0)
  })
  it('parses db.log slowQueries and nPlusOne', async ()=>{
    const {apply}=await import('../src/perf-log-stats-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await mkdir(join(root,'var/debug'),{recursive:true})
    const dbLog = `## 1 ## QUERY\nSQL: SELECT * FROM catalog_product_entity WHERE entity_id = 1\nTIME: 1.500\nTRACE: #0 /var/www/html/app/code/Acme/Demo/Model/Product.php(10): foo\n#1 /var/www/html/vendor/magento/framework/App/Http.php(50): bar\n## 2 ## QUERY\nSQL: SELECT * FROM catalog_product_entity WHERE entity_id = 2\nTIME: 1.600\nTRACE: #0 /var/www/html/app/code/Acme/Demo/Model/Product.php(10): foo\n#1 /var/www/html/vendor/magento/framework/App/Http.php(50): bar\n## 3 ## QUERY\nSQL: SELECT * FROM sales_order WHERE entity_id = 1\nTIME: 0.010\nTRACE: #0 /var/www/html/app/code/Other/Mod.php(5): x\n`
    await writeFile(join(root,'var/debug/db.log'), dbLog)
    const res=await r[0].execute({timeThresholdMs:1000, repeatThreshold:2}, exec(root)) as {slowQueries:Array<{query:string,count:number}>, nPlusOneCandidates:Array<{shape:string,count:number}>}
    expect(res.slowQueries.length).toBeGreaterThan(0)
    expect(res.nPlusOneCandidates.some(c=>c.count>=2)).toBe(true)
  })
  it('ignores non-frontend entries (no App\\Http)', async ()=>{
    const {apply}=await import('../src/perf-log-stats-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await mkdir(join(root,'var/debug'),{recursive:true})
    await writeFile(join(root,'var/debug/db.log'), `## 1 ## QUERY\nSQL: SELECT 1\nTIME: 2.000\nTRACE: #0 /var/www/html/app/code/Cron/Job.php(10): run\n`)
    const res=await r[0].execute({timeThresholdMs:1000}, exec(root)) as {slowQueries:unknown[]}
    expect(res.slowQueries.length).toBe(0)
  })
  it('rejects escaping worktreePath', async ()=>{
    const {apply}=await import('../src/perf-log-stats-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
})
