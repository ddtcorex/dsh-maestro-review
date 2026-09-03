import { spawn } from 'node:child_process'
import { basename, dirname, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name='maestro-govard-audit-lint-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string, timeoutMs?:number, defaultBase?:string, allowXdebug?:boolean}> = z.object({rootPath:z.string(), timeoutMs:z.number(), defaultBase:z.string(), allowXdebug:z.boolean()})

export interface AuditLintOptions {
  checks?: string[]
  mode?: string
  scope?: string
  base?: string
  phpVersions?: string[]
  noLintResultCache?: boolean
  timeout?: string
  lintProvider?: string
  allowXdebug?: boolean
}

/** Explicit call base wins, then the review-wired default (MR base_sha). */
export function resolveLintBase(argsBase: string | undefined, defaultBase: string | undefined): string | undefined {
  return argsBase ?? defaultBase
}

export function buildAuditCliArgs(a: AuditLintOptions): string[] {
  const checks = a.checks && a.checks.length ? a.checks.join(',') : 'lint'
  const mode = a.mode ?? 'auto'
  const timeout = a.timeout ?? 'auto'
  const lintProvider = a.lintProvider ?? 'govard'
  const cliArgs=['audit','run','--checks',checks,'--format','json','--mode',mode,'--timeout',timeout,'--lint-provider',lintProvider]
  if(a.scope) cliArgs.push('--scope', a.scope)
  const base = resolveLintBase(a.base, undefined)
  if(base) cliArgs.push('--base', base)
  if(a.phpVersions && a.phpVersions.length) cliArgs.push('--php', a.phpVersions.join(','))
  if(a.noLintResultCache) cliArgs.push('--no-lint-result-cache')
  if(a.allowXdebug) cliArgs.push('--allow-xdebug')
  return cliArgs
}

interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined, e:unknown):string{
  if(c!==undefined) return c
  const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd
  return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()
}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  let realRoot:string
  try{ realRoot=await realpath(ar)}catch{ return true }
  let existing=rs
  const pending:string[]=[]
  while(true){
    let real:string
    try{ real=await realpath(existing)}catch(err){
      if((err as NodeJS.ErrnoException).code!=='ENOENT') return false
      const parent=dirname(existing)
      if(parent===existing) return false
      pending.unshift(basename(existing))
      existing=parent
      continue
    }
    const realTarget=pending.length>0? resolve(real,...pending):real
    if(realTarget!==realRoot && !realTarget.startsWith(realRoot+sep)) return false
    return true
  }
}
export function cleanJson(raw:string):string{
  return raw.replace(/\n\s*ERROR audit run.*$/s, '').replace(/\s{2,}ERROR audit run.*$/s, '').trimEnd()
}

interface LintViolationLike { path?: string; line?: number; rule?: string; message?: string }

interface LintResultLike {
  ok: boolean
  exitCode?: number
  lint?: {
    phpcs?: { violations?: LintViolationLike[] }
    phpstan?: { errors?: LintViolationLike[] }
    pubMediaGuard?: { violations?: LintViolationLike[] }
  }
  summary?: { findingCount?: number }
  diagnostics?: string
}

/**
 * One-line-plus render for the agent: a bare "audit lint failed" hides the
 * violations the reviewer needs, so carry counts plus the top findings.
 */
export interface CollectedLintFindings {
  phpcsViolations: Array<{ path?: string; line?: number; column?: number; rule?: string; message?: string; severity?: string }>
  phpstanErrors: Array<{ path?: string; line?: number; message?: string }>
  pubMediaViolations: unknown[]
  compat: Array<{ tool?: string; path?: string; line?: number; rule?: string; message?: string }>
  total: number
}

/**
 * Collect findings across govard audit JSON shapes. The live envelope nests
 * them at results[].evidence.php_results[].findings (older callers used a
 * top-level findings array or evidence.php_results) — and non-phpcs/phpstan
 * tools (e.g. M2-LINT-COMPAT internal errors) go to the compat bucket
 * instead of being silently dropped from counts.
 */
export function collectLintFindings(parsed: unknown): CollectedLintFindings {
  const p = (parsed ?? {}) as Record<string, any>
  const lists: unknown[][] = []
  if (Array.isArray(p.findings)) lists.push(p.findings)
  const ev = p.evidence as Record<string, any> | undefined
  if (Array.isArray(ev?.php_results)) lists.push(...ev.php_results.map((r: any) => r?.findings).filter(Array.isArray))
  if (Array.isArray(p.php_results)) lists.push(...p.php_results.map((r: any) => r?.findings).filter(Array.isArray))
  if (Array.isArray(p.results)) {
    for (const r of p.results as Array<Record<string, any>>) {
      const e = r?.evidence as Record<string, any> | undefined
      const pr = e?.php_results ?? r?.php_results
      if (Array.isArray(pr)) lists.push(...pr.map((x: any) => x?.findings).filter(Array.isArray))
      if (Array.isArray(r?.findings)) lists.push(r.findings)
    }
  }
  const out: CollectedLintFindings = { phpcsViolations: [], phpstanErrors: [], pubMediaViolations: [], compat: [], total: 0 }
  for (const list of lists) {
    for (const f of list as Array<Record<string, any>>) {
      if (f?.tool === 'phpstan') out.phpstanErrors.push({ path: f.path, line: f.line, message: f.message })
      else if (f?.tool === 'phpcs') {
        if (f.path?.includes('pub/media') || f.rule?.includes('PubMedia')) out.pubMediaViolations.push(f)
        else out.phpcsViolations.push({ path: f.path, line: f.line, column: f.column, rule: f.rule, message: f.message, severity: f.severity })
      } else if (f && typeof f === 'object') {
        out.compat.push({ tool: f.tool, path: f.path, line: f.line, rule: f.rule, message: f.message })
      }
    }
  }
  out.total = out.phpcsViolations.length + out.phpstanErrors.length + out.pubMediaViolations.length + out.compat.length
  return out
}

export function lintResultText(v: LintResultLike): string {
  if (v.ok) return 'audit lint passed'
  const phpcs = v.lint?.phpcs?.violations ?? []
  const phpstan = v.lint?.phpstan?.errors ?? []
  const pubMedia = v.lint?.pubMediaGuard?.violations ?? []
  const compat = (v.lint as Record<string, any> | undefined)?.compat?.findings ?? []
  const total = v.summary?.findingCount ?? phpcs.length + phpstan.length + pubMedia.length + compat.length
  const bits: string[] = [`audit lint failed — ${total} finding(s) (phpcs ${phpcs.length}, phpstan ${phpstan.length}, pubMedia ${pubMedia.length}, compat ${compat.length})`]
  const top = [...phpcs.map(x => ({ ...x, tool: 'phpcs' })), ...phpstan.map(x => ({ ...x, tool: 'phpstan' })), ...pubMedia.map(x => ({ ...x, tool: 'pubMedia' })), ...compat.map((x: Record<string, any>) => ({ ...x, tool: x.tool ?? 'compat' }))].slice(0, 5)
  for (const f of top) bits.push(`- [${f.tool}] ${f.path ?? (f.message ?? '?').toString().slice(0, 120)}${f.path !== undefined ? `:${f.line ?? '?'}` : ''}${f.rule !== undefined ? ` ${f.rule}` : ''}`)
  if (v.exitCode !== undefined) bits.push(`exit ${v.exitCode}`)
  const diag = (v.diagnostics ?? '').split('\n')[0]?.trim()
  if (total === 0 && diag !== '' && diag !== undefined) bits.push(diag.slice(0, 200))
  return bits.join('\n')
}
// Govard 1.67 auto timeout: 90s-30m framework-aware (15m floor for wordpress/magento2 → 22.5m auto)
// Keep kill timeout above the largest auto value so the outer watchdog doesn't cancel a valid auto run.
const DEFAULT_TIMEOUT=900_000

function run(cmd:string, args:string[], cwd:string, timeoutMs:number):Promise<{code:number|null, stdout:string, stderr:string, timedOut:boolean}>{
  return new Promise((resolvePromise)=>{
    const child=spawn(cmd, args, {cwd})
    let stdout='', stderr=''
    let timedOut=false
    const timer=setTimeout(()=>{ timedOut=true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout?.on('data',(c:Buffer)=> stdout+=c.toString())
    child.stderr?.on('data',(c:Buffer)=> stderr+=c.toString())
    child.on('error',(err:Error)=>{ clearTimeout(timer); resolvePromise({code:null, stdout, stderr: err.message, timedOut:false}) })
    child.on('close',(code)=>{ clearTimeout(timer); resolvePromise({code, stdout, stderr, timedOut}) })
  })
}

export function apply(ctx:Context, config:{rootPath?:string, timeoutMs?:number, defaultBase?:string, allowXdebug?:boolean}={}):void{
  const configuredRoot=config.rootPath
  const defaultTimeout=config.timeoutMs ?? DEFAULT_TIMEOUT
  const defaultBase=config.defaultBase
  // Review worktrees disable xdebug via .govard.local.yml, but govard's lint
  // guard probes the base .govard.yml only — so the mount opts out explicitly.
  const allowXdebug=config.allowXdebug ?? false
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'govard_audit_lint',
    description:'Run govard audit --checks lint --format json and return structured phpcs/phpstan results. Use before hand-parsing text. Govard 1.67+ uses --timeout auto (framework-aware 90s-30m, 22.5m for wordpress/magento2) by default. scope "diff" requires a base ref: pass base, or rely on the wired defaultBase (MR base_sha) when present.',
    parameters:{
      worktreePath:{type:'string'},
      checks:{type:'array', items:{type:'string'}},
      mode:{type:'string', enum:['auto','project','module_in_project','standalone']},
      phpVersions:{type:'array', items:{type:'string'}},
      noLintResultCache:{type:'boolean'},
      timeoutMs:{type:'number'},
      // New in 1.67/2.7: framework-aware timeout and native lint provider
      timeout:{type:'string', description:'Govard --timeout (e.g. auto, 300s, 15m, 0 for no timeout). Default auto.'},
      lintProvider:{type:'string', description:'--lint-provider (govard or external). Default govard.'},
      scope:{type:'string', enum:['project','diff']},
      base:{type:'string', description:'--base ref for diff scope'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          ok:{type:'boolean', required:true},
          exitCode:{type:'number', required:true},
          timedOut:{type:'boolean', required:true},
          worktreePath:{type:'string', required:true},
          lint:{type:'object', required:true, additionalProperties:true},
          summary:{type:'object', required:true, additionalProperties:true},
          rawJson:{type:'object', required:true, additionalProperties:true},
          errors:{type:'array', items:{type:'object', additionalProperties:true}},
          diagnostics:{type:'string'},
          sessionId:{type:'string'},
          runId:{type:'string'},
        }
      },
      render:(_a,v:LintResultLike)=>[{type:'text', text: lintResultText(v)}],
    },
    async execute(args, exec){
      const rawPath=(args as {worktreePath?:string}).worktreePath
      const root=workspaceRootFor(configuredRoot, exec)
      const worktreePath= rawPath ? resolve(root, rawPath) : root
      const checkPath= rawPath ?? ''
      if(checkPath!=='' && !(await isInsideRoot(root, checkPath))) return {text:`Path "${checkPath}" escapes the workspace root.`, truncated:false} as never
      const timeoutMs=(args as {timeoutMs?:number}).timeoutMs ?? defaultTimeout
      if(timeoutMs<5000 || timeoutMs>1_800_000) return {text:'timeoutMs out of range 5000-1800000 (5s-30m). Use --timeout auto for framework-aware estimation.', truncated:false} as never

      const a = args as {checks?:string[]; mode?:string; scope?:string; base?:string; phpVersions?:string[]; noLintResultCache?:boolean; timeout?:string; lintProvider?:string; allowXdebug?:boolean}
      const scope = a.scope
      const base = resolveLintBase(a.base, defaultBase)
      if (scope === 'diff' && base === undefined) {
        return {text:'scope "diff" requires a base ref (govard --base): pass base explicitly (e.g. origin/master or the MR base_sha) or mount this tool with defaultBase.', truncated:false} as never
      }
      const cliArgs = buildAuditCliArgs({ ...a, base, allowXdebug: a.allowXdebug ?? allowXdebug })
      const result=await run('govard', cliArgs, worktreePath, timeoutMs)
      if(result.timedOut){
        return {ok:false, exitCode: result.code ?? 124, timedOut:true, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'timeout', message:`timed out after ${timeoutMs}ms` }], diagnostics:result.stderr.slice(0,4000)} as never
      }
      if(result.code===null && result.stderr.includes('ENOENT')){
        return {ok:false, exitCode:127, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'govard_not_found', message:'govard binary not found'}], diagnostics:result.stderr.slice(0,4000)} as never
      }
      const cleaned=cleanJson(result.stdout)
      let parsed:any=null
      try{ parsed=JSON.parse(cleaned) }catch{ parsed=null }
      if(!parsed){
        const fallback=cleaned.split('\n').slice(0,-1).join('\n').trimEnd()
        try{ parsed=JSON.parse(fallback)}catch{}
        if(!parsed){
          const tryStderr=cleanJson(result.stdout+result.stderr)
          try{ parsed=JSON.parse(tryStderr)}catch{}
        }
      }
      if(!parsed){
        return {ok:false, exitCode: result.code ?? 1, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'parse_error', message:'stdout not JSON'}], diagnostics:(cleaned+result.stderr).slice(0,4000)} as never
      }
      const collected = collectLintFindings(parsed)
      const phpcsViolations = collected.phpcsViolations
      const phpstanErrors = collected.phpstanErrors
      const pubMediaViolations = collected.pubMediaViolations
      const status=parsed.status ?? (result.code===0?'passed':'failed')
      const phpVersions=parsed.php_versions ?? parsed.phpVersions ?? []
      const findingCount=collected.total
      const sessionId = parsed.session_id ?? parsed.sessionId ?? undefined
      const runId = parsed.run_id ?? parsed.runId ?? undefined
      return {
        ok: result.code===0,
        exitCode: result.code ?? 0,
        timedOut:false,
        worktreePath,
        ...(sessionId ? { sessionId: String(sessionId) } : {}),
        ...(runId ? { runId: String(runId) } : {}),
        rawJson: parsed as Record<string, unknown>,
        summary:{status, phpVersions, matrixComplete:true, findingCount, truncated: findingCount>100},
        lint:{phpcs:{violations:phpcsViolations}, phpstan:{errors:phpstanErrors}, pubMediaGuard:{violations:pubMediaViolations}, compat:{findings:collected.compat}},
        errors:[],
        diagnostics: result.stderr.slice(0,4000),
      } as never
    }
  })))
}
