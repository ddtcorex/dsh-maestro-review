import { mkdir, writeFile, symlink, stat, lstat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { normalize as posixNormalize } from 'node:path/posix'
import { homedir, tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { finalAssistantOutput } from '@deepseek-ai/dsh-subagent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-title'
import * as GovardTool from './govard-tool.js'
import * as GitlabClient from './gitlab-client.js'
import * as ReviewFindingsTool from './review-findings-tool.js'
import * as SearchTool from './search-tool.js'
import * as HyvaThemeInspectTool from './hyva-theme-inspect-tool.js'
import * as HyvaCspScanTool from './hyva-csp-scan-tool.js'
import * as LayoutXmlTool from './layout-xml-tool.js'
import * as ModuleCheckTool from './module-check-tool.js'
import * as PhtmlEscapeScanTool from './phtml-escape-scan-tool.js'
import * as ScopeSplitTool from './scope-split-tool.js'
import * as GovardAuditLintTool from './govard-audit-lint-tool.js'
import * as PerfLogStatsTool from './perf-log-stats-tool.js'
import * as ReviewToolPolicy from './tool-policy.js'
import type { ReviewFinding, FindingSeverity } from './review-findings-tool.js'
import type { ReviewRequest } from './events.js'
import { loadUserConfig, type MaestroUserConfig, type ReviewModelSelection } from './config-store.js'
import { hasCompletedReview, lastCompletedReview, pruneHistory, recordReviewFinish, recordReviewStart } from './review-history.js'
import { buildIncrementalBlock, fetchCompare, fetchMrDetailHeadSha } from './incremental.js'
import { createReviewSignals } from './review-signals.js'
import { reviewDigestText, type NotifierLike } from './notify.js'
import { loadedReviewProfile, type ReviewSkillProfile } from './skills-tool.js'
import type { ReviewProvider } from './providers/interface.js'
import { gitlabProvider } from './providers/gitlab.js'
import './events.js'

// Provider-aware wrapper — orchestrator can run reviews via any ReviewProvider.
// This keeps the GitLab-specific flow intact while allowing Phase C to add GitHub/Jira without modifying core logic.
export async function runReviewWithProvider(provider: ReviewProvider, request: { provider: string; projectPath: string; mrId: string; profile: string }): Promise<void> {
  // Currently delegates to GitLab flow; Phase C will branch on provider.id
  if (provider.id === 'gitlab') {
    // Orchestrator already handles GitLab via 'maestro/review-request' event
    // This wrapper exists to prove provider pluggability; real dispatch is via ctx.emit
    void gitlabProvider
  }
  void request
}

export { gitlabProvider }

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 60_000

/**
 * Finding severity, assigned by the reviewer. Display order is fixed
 * (blocking first) wherever counts are rendered.
 */
export const SEVERITY_ORDER: readonly FindingSeverity[] = ['blocking', 'major', 'minor', 'nit'] as const

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  blocking: '🔴 Blocking',
  major: '🟡 Major',
  minor: '🔵 Minor',
  nit: '⚪ Nit',
}

/** Missing or unknown severities degrade to `minor` — never drop a finding. */
export function normalizeFindingSeverity(severity: unknown): FindingSeverity {
  return severity === 'blocking' || severity === 'major' || severity === 'minor' || severity === 'nit'
    ? severity
    : 'minor'
}

export function severityPrefix(severity: unknown): string {
  return SEVERITY_LABEL[normalizeFindingSeverity(severity)]
}

/** Count findings per severity; zero counts are omitted. */
export function countFindingSeverities(findings: ReviewFinding[]): Partial<Record<FindingSeverity, number>> {
  const counts: Partial<Record<FindingSeverity, number>> = {}
  for (const finding of findings) {
    const level = normalizeFindingSeverity(finding.severity)
    counts[level] = (counts[level] ?? 0) + 1
  }
  return counts
}

export interface ReviewerScopePromptOpts {
  scopeKind: 'discussion' | 'full'
  discussionId?: string
  path?: string
  line?: number
  mode?: string
  profileInstruction: string
}

/**
 * Reviewer scope prompt. Static analysis is mandatory: reviewers skipped
 * govard_audit_lint for whole rounds (no lint signal at all), so the prompt
 * requires at least one call before report_review_findings. Pure for testing.
 */
export function buildReviewerScopePrompt(opts: ReviewerScopePromptOpts): string {
  const lintRule = 'LINT RULE: you MUST call govard_audit_lint at least once (scope "diff"; the MR base default is already wired, no base arg needed) before report_review_findings. A review with no lint call is incomplete.'
  if (opts.scopeKind === 'discussion') {
    return `${opts.profileInstruction}Review only the requested inline discussion ${opts.discussionId} at ${opts.path}:${opts.line}. Do not review unrelated files or start a broad audit. Call gitlab_get_mr_diff, then gitlab_get_file_diff for the file under review, then call report_review_findings exactly once when done. ${lintRule}`
  }
  return `${opts.profileInstruction}Review this merge request (${opts.mode} mode). Call gitlab_list_own_review_threads and gitlab_get_mr_diff first, then gitlab_get_file_diff per file you inspect (inline results never spill), then call report_review_findings exactly once when done. ${lintRule} DEDUP RULE: when a finding matches the substance of an existing own thread (same file and same underlying issue, even if worded differently — including resolved threads, whose reply reopens them), report it as {status: "reply", discussionId} instead of posting a new thread. Use status "new" only for issues with no matching thread.`
}

/**
 * Build a user-friendly GitLab Markdown comment for a completed review.
 * Shared design language with `reviewDigestText` (Telegram HTML) — same
 * header, status, findings structure, footer. Both use `🤖 Maestro Review`
 * as the anchor so filtering/search stays consistent.
 */
export function buildReviewComment(opts: {
  projectPath: string
  mrIid: number
  gitlabBaseUrl: string
  mode: string
  profile?: string
  summary: string
  failures: string[]
  findings?: { newCount: number; replyCount: number; severityCounts?: Partial<Record<FindingSeverity, number>> }
  durationMs?: number
  isDiffOnly?: boolean
  isDiscussion?: boolean
}): string {
  const mrUrl = `${opts.gitlabBaseUrl.replace(/\/$/, '')}/${opts.projectPath}/-/merge_requests/${opts.mrIid}`
  const title = opts.isDiffOnly === true ? '## 🤖 Maestro Review — Diff-only' : '## 🤖 Maestro Review'
  const metaBits: string[] = []
  metaBits.push(`**\`${opts.projectPath}\` !${opts.mrIid}**`)
  metaBits.push('✅ Completed')
  metaBits.push(`\`${opts.mode}\``)
  if (opts.profile !== undefined) metaBits.push(`\`${opts.profile}\``)
  if (opts.durationMs !== undefined && opts.durationMs > 0) {
    const s = Math.round(opts.durationMs / 1000)
    metaBits.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)
  }
  const metaLine = metaBits.join(' · ')
  const scopeNote = opts.isDiffOnly === true
    ? '> **Scope:** Diff-only — reviewed the GitLab diff without a local checkout, Magento environment, static analysis, or tests. For a full review, add this project in Settings → Maestro and mention again.\n\n'
    : ''
  const findingsLine = opts.findings !== undefined
    ? (() => {
        const parts: string[] = []
        if (opts.findings.newCount > 0) parts.push(`💬 ${opts.findings.newCount} new`)
        if (opts.findings.replyCount > 0) parts.push(`🔁 ${opts.findings.replyCount} updated`)
        if (opts.findings.severityCounts !== undefined) {
          for (const level of SEVERITY_ORDER) {
            const count = opts.findings.severityCounts[level] ?? 0
            if (count > 0) parts.push(`${SEVERITY_LABEL[level].split(' ')[0]} ${count} ${level}`)
          }
        }
        if (parts.length === 0) parts.push('no inline findings')
        return `\n\n**Findings:** ${parts.join(' · ')}`
      })()
    : ''
  const failuresBlock = opts.failures.length > 0
    ? `\n\n<details>\n<summary>⚠️ Failed to post (${opts.failures.length})</summary>\n\n${opts.failures.map((f) => `- \`${f}\``).join('\n')}\n\n</details>`
    : ''
  const footer = `\n\n---\n\n<sub>Generated by Maestro · [View MR →](${mrUrl})</sub>`
  return `${title}\n\n${metaLine}\n\n${scopeNote}${opts.summary}${findingsLine}${failuresBlock}${footer}`
}

export function buildNotStartedComment(opts: { gitlabBaseUrl: string; projectPath: string; mrIid: number }): string {
  const mrUrl = `${opts.gitlabBaseUrl.replace(/\/$/, '')}/${opts.projectPath}/-/merge_requests/${opts.mrIid}`
  return [
    '## 🤖 Maestro Review — Not started',
    '',
    `**\`${opts.projectPath}\` !${opts.mrIid}** · ⏸️ Not started`,
    '',
    '> Deep review requires a project mapping with a local checkout and Magento environment.',
    '> Add this project in **Settings → Maestro**, then mention the reviewer again.',
    '',
    `---`,
    '',
    `<sub>Generated by Maestro · [View MR →](${mrUrl})</sub>`,
  ].join('\n')
}

export const name = 'maestro-orchestrator'
export const inject = ['agentDefaultModel', 'agents', 'agentPresets', 'sessionTitle']

/** Convert DSH's selected default model into the options required by a child Agent. */
export function agentOptionsForModel(selection: ModelSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
  }
}

export function isUnsupportedReasoningError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  if (code === 'UNSUPPORTED_REASONING_EFFORT') return true
  const message = (err as { message?: unknown })?.message
  const text = typeof message === 'string' ? message : typeof err === 'string' ? err : String(message ?? err ?? '')
  return text.includes('does not support reasoning effort')
    || text.includes('UNSUPPORTED_REASONING_EFFORT')
}

export function getTurnErrorMessage(handle: unknown): string | undefined {
  try {
    const events = (handle as { agent?: { session?: { events?: unknown[] } } })?.agent?.session?.events
    if (!Array.isArray(events)) return undefined
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i] as { type?: unknown; data?: { reason?: { kind?: unknown; error?: { message?: unknown; code?: unknown } } } }
      if (ev?.type === 'turn/end' && ev?.data?.reason?.kind === 'error') {
        const err = ev.data.reason.error
        if (err !== undefined && err !== null) {
          if (typeof (err as { message?: unknown }).message === 'string') return (err as { message: string }).message
          if (typeof (err as { code?: unknown }).code === 'string') return String((err as { code: unknown }).code)
          try { return JSON.stringify(err) } catch { return String(err) }
        }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the model to use for an automated review. Priority: per-project
 * override > global reviewModel > DSH default (`fallback`).
 */
export function resolveReviewModel(
  userConfig: MaestroUserConfig,
  mapping: { reviewModel?: ReviewModelSelection | null; projectPath?: string } | undefined,
  fallback: ModelSelection,
): ModelSelection {
  const raw = (mapping?.reviewModel as ReviewModelSelection | null | undefined) ?? userConfig.reviewModel
  if (raw === undefined || raw === null) return fallback
  return {
    provider: raw.provider,
    model: raw.model,
    ...(raw.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(raw.reasoningEffort) }),
  }
}

/** Compose a newly-created agent from the preset service owned by the root context. */
export async function mountAgentPreset(
  agentPresets: { mount(agentCtx: Context, id: string): Promise<unknown> | unknown },
  agentCtx: Context,
  id: string,
): Promise<void> {
  await agentPresets.mount(agentCtx, id)
}

export interface Config {
  projectMappings: Array<{ projectPath: string; localRepoPath: string; reviewProfile: ReviewSkillProfile }>
  gitlabBaseUrl: string
  /**
   * Fallback when Maestro Settings has no token; optional so a deployment that
   * configures everything through Settings boots without env vars.
   */
  gitlabToken?: string
  botUsername: string
  /** Hard ceiling on one automated agent's turn. */
  agentTimeoutMs: number
}

export const DEFAULT_AGENT_TIMEOUT_MS = 20 * 60_000

export const Config: z<Config> = z.object({
  projectMappings: z.array(z.object({
    projectPath: z.string().required(),
    localRepoPath: z.string().required(),
    reviewProfile: z.union([z.const('magento2'), z.const('laravel'), z.const('symfony'), z.const('wordpress'), z.const('generic')]).default('magento2'),
  })).required(),
  gitlabBaseUrl: z.string().required(),
  gitlabToken: z.string().role('secret'),
  botUsername: z.string().required(),
  agentTimeoutMs: z.number().min(1000).default(DEFAULT_AGENT_TIMEOUT_MS),
})

export interface ReviewOutcome {
  summary: string
  failures: string[]
  severityCounts?: Partial<Record<FindingSeverity, number>>
}

/**
 * Await an agent's turn with a hard ceiling. A hung automated agent would
 * otherwise hold its session, worktree, and review key forever; the watchdog
 * disposes the handle and rejects so the review is recorded as failed.
 */
export async function whenIdleWithTimeout(handle: AgentHandle, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      handle.agent.whenIdle(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`automated agent timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } catch (err) {
    await handle.dispose().catch(() => {})
    throw err
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface ReviewAndAuditDeps {
  localRepoPath: string
  /** `keySuffix` isolates concurrent reviews of one MR (quick vs deep). */
  ensureWorktree(localRepoPath: string, sourceBranch: string, projectId: number, mrIid: number, keySuffix?: string): Promise<string>
  removeWorktree(worktreePath: string): Promise<void>
  runReviewer(worktreePath: string, payload: ReviewRequest): Promise<ReviewOutcome>
  runAuditor(worktreePath: string, payload: ReviewRequest): Promise<string>
  postComment(body: string): Promise<void>
  replyToDiscussion(discussionId: string, body: string): Promise<void>
  writeFailedReport(mrIid: number, body: string): Promise<void>
}

export interface DiffOnlyReviewDeps {
  runReviewer(payload: ReviewRequest): Promise<ReviewOutcome>
  postComment(body: string): Promise<void>
  replyToDiscussion(discussionId: string, body: string): Promise<void>
  writeFailedReport(mrIid: number, body: string): Promise<void>
}

export interface ReviewCommentDeps {
  postComment(body: string): Promise<void>
  replyToDiscussion(discussionId: string, body: string): Promise<void>
  writeFailedReport(mrIid: number, body: string): Promise<void>
}

export interface GitlabFindingPoster {
  baseUrl: string
  token: string
  projectId: number
  mrIid: number
  fetcher?: typeof fetch
  /** Internal per-review cache: all positions must use one MR diff snapshot. */
  snapshot?: Promise<GitlabDiffSnapshot>
}

interface GitlabMrChange {
  old_path: string
  new_path: string
  diff: string
  collapsed?: boolean
  too_large?: boolean
}

interface GitlabDiffPosition {
  oldLine?: number
  newLine?: number
}

interface GitlabDiffSnapshot {
  diffRefs: { base_sha: string; start_sha: string; head_sha: string }
  changes: GitlabMrChange[]
}

/** Map a new-side line number to its exact unified-diff position. */
export function diffPositionForNewLine(diff: string, targetLine: number): GitlabDiffPosition | undefined {
  let oldLine = 0
  let newLine = 0
  for (const row of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (header !== null) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (row.startsWith('\\')) continue
    if (row.startsWith('+')) {
      if (newLine === targetLine) return { newLine }
      newLine++
      continue
    }
    if (row.startsWith('-')) {
      oldLine++
      continue
    }
    if (row.startsWith(' ')) {
      if (newLine === targetLine) return { oldLine, newLine }
      oldLine++
      newLine++
    }
  }
  return undefined
}

async function loadLatestDiffSnapshot(fetcher: typeof fetch, apiBase: string, headers: Record<string, string>): Promise<GitlabDiffSnapshot> {
  const versionsResponse = await fetcher(`${apiBase}/versions`, { headers })
  if (!versionsResponse.ok) throw new Error(`GitLab API error ${versionsResponse.status}: ${await versionsResponse.text()}`)
  const versions = await versionsResponse.json() as Array<{ id?: number }>
  const latest = versions[0]
  if (latest?.id === undefined) throw new Error('GitLab merge request has no available diff version')
  const versionResponse = await fetcher(`${apiBase}/versions/${latest.id}`, { headers })
  if (!versionResponse.ok) throw new Error(`GitLab API error ${versionResponse.status}: ${await versionResponse.text()}`)
  const version = await versionResponse.json() as {
    base_commit_sha?: string
    start_commit_sha?: string
    head_commit_sha?: string
    diffs?: GitlabMrChange[]
  }
  if (version.base_commit_sha === undefined || version.start_commit_sha === undefined || version.head_commit_sha === undefined) {
    throw new Error('GitLab merge request diff version has incomplete SHA references')
  }
  if (version.diffs === undefined) throw new Error('GitLab merge request diff version has no file diffs')
  return {
    diffRefs: { base_sha: version.base_commit_sha, start_sha: version.start_commit_sha, head_sha: version.head_commit_sha },
    changes: version.diffs,
  }
}

/**
 * Collapse `.`/`..`/duplicate slashes so worktree-relative finding paths
 * (which legitimately contain `../` segments when a template references a
 * sibling theme directory) compare equal to GitLab's canonical diff paths.
 */
function normalizedDiffPath(path: string): string {
  return posixNormalize(path)
}

/**
 * Publish agent findings from the orchestrator's own context. Agent tools are
 * mounted inside a setup child fiber and are not guaranteed to remain
 * executable through `handle.agent.ctx` after the agent turn ends.
 */
export async function postReviewFindings(findings: ReviewFinding[], config: GitlabFindingPoster): Promise<void> {
  const fetcher = config.fetcher ?? fetch
  const apiBase = `${config.baseUrl}/api/v4/projects/${config.projectId}/merge_requests/${config.mrIid}`
  const headers = { 'PRIVATE-TOKEN': config.token, 'Content-Type': 'application/json' }
  for (const finding of findings) {
    let response: Response
    const label = severityPrefix(finding.severity)
    const body = finding.body.startsWith(label) ? finding.body : `${label}\n\n${finding.body}`
    if (finding.status === 'reply') {
      if (finding.discussionId === undefined) throw new Error('reply finding missing discussionId')
      response = await fetcher(`${apiBase}/discussions/${encodeURIComponent(finding.discussionId)}/notes`, {
        method: 'POST', headers, body: JSON.stringify({ body }),
      })
    } else {
      if (finding.path === undefined || finding.line === undefined) throw new Error('new finding missing path or line')
      config.snapshot ??= loadLatestDiffSnapshot(fetcher, apiBase, headers)
      const snapshot = await config.snapshot
      const requestedPath = normalizedDiffPath(finding.path)
      const change = snapshot.changes.find(candidate => normalizedDiffPath(candidate.new_path) === requestedPath)
        ?? snapshot.changes.find(candidate => normalizedDiffPath(candidate.old_path) === requestedPath)
      if (change === undefined) throw new Error(`cannot post inline finding at ${finding.path}:${finding.line}: file is not in the current MR diff`)
      if (change.collapsed === true || change.too_large === true || change.diff === '') {
        throw new Error(`cannot post inline finding at ${finding.path}:${finding.line}: GitLab did not return this file's complete diff`)
      }
      const linePosition = diffPositionForNewLine(change.diff, finding.line)
      if (linePosition === undefined) {
        // Line not in diff — fallback to MR note so finding is not silently lost.
        response = await fetcher(`${apiBase}/notes`, {
          method: 'POST', headers,
          body: JSON.stringify({ body: `**Inline fallback — \`${finding.path}:${finding.line}\` line is not in current MR diff**\n\n${body}` }),
        })
      } else {
        response = await fetcher(`${apiBase}/discussions`, {
          method: 'POST', headers,
          body: JSON.stringify({ body, position: {
            position_type: 'text', ...snapshot.diffRefs, old_path: change.old_path, new_path: change.new_path,
            ...linePosition.oldLine === undefined ? {} : { old_line: linePosition.oldLine },
            ...linePosition.newLine === undefined ? {} : { new_line: linePosition.newLine },
          } }),
        })
      }
    }
    if (!response.ok) throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
  }
}

/**
 * MRs currently being reviewed, so a duplicate webhook delivery (GitLab retries,
 * or an "open" immediately followed by an "update") does not start a second
 * worktree/agent run for the same MR while the first is still in flight.
 *
 * Keyed on `(projectId, mrIid)`, not `mrIid` alone: GitLab's `iid` is scoped to
 * its project, so two different projects both track MR !7 concurrently — keying
 * on `mrIid` alone would make the second event silently dedupe against the
 * first project's unrelated run (or stomp its worktree directory).
 */
const inFlightKeys = new Set<string>()

function reviewKey(payload: ReviewRequest): string {
  const scope = payload.scope.kind === 'mr' ? 'mr' : `discussion:${payload.scope.discussionId}`
  return `${payload.projectId}:${payload.mrIid}:${payload.mode}:${scope}`
}

/**
 * Stable 8-char hex suffix of the review key, so distinct concurrent reviews
 * (quick + deep of one MR) never share one worktree directory.
 */
export function reviewKeyHash(payload: ReviewRequest): string {
  return createHash('sha1').update(reviewKey(payload)).digest('hex').slice(0, 8)
}

/**
 * `projectId`/`mrIid` are typed as `number` but arrive from `gitlab-webhook.ts`'s
 * `JSON.parse(raw)` with no runtime shape check (a pure TypeScript type assertion) —
 * so at runtime they could be any JSON value despite the type. Both flow, unvalidated,
 * into `ensureWorktree`'s worktree path (`path.join` normalizes `..` segments, so a
 * crafted value can escape `/tmp`), `postComment`'s GitLab API URL (sent with the org's
 * real token), the in-flight `reviewKey`, and `runReviewer`/`runAuditor`'s
 * sessionId/`writeFailedReport`'s filename. Validated once, here, before any of those, same trust boundary as
 * `assertSafeBranchName` below.
 */
function assertSafeId(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`refusing to operate on unsafe ${label}: ${JSON.stringify(value)}`)
  }
}

/**
 * Read an agent session's transcript for the auditor's final output across
 * host/session API skew: hosts built from the harness checkout expose
 * `ownEvents()`/`snapshotEvents()` with no `.events` getter, while older
 * packaged `@deepseek-ai/dsh-session` builds expose only the `.events`
 * getter. `ownEvents()` (child-owned suffix, no fork prefix) matches
 * `finalAssistantOutput`'s documented input best, so it wins when present.
 * Returns `[]` — never throws — when no event source exists.
 */
export function auditorOutputFromSession(session: unknown) {
  const candidate = session as {
    ownEvents?: unknown
    snapshotEvents?: unknown
    events?: unknown
  } | null | undefined
  let events: unknown
  if (typeof candidate?.ownEvents === 'function') {
    events = (candidate.ownEvents as () => unknown)()
  } else if (typeof candidate?.snapshotEvents === 'function') {
    events = (candidate.snapshotEvents as () => unknown)()
  } else {
    events = candidate?.events
  }
  if (!Array.isArray(events)) return []
  return finalAssistantOutput(events as Parameters<typeof finalAssistantOutput>[0]) ?? []
}

/** Full review + performance audit; resolves to the comment body that was posted. */
export async function runReviewAndAudit(payload: ReviewRequest, deps: ReviewAndAuditDeps): Promise<string> {
  assertSafeId(payload.projectId, 'projectId')
  assertSafeId(payload.mrIid, 'mrIid')
  const key = reviewKey(payload)
  if (inFlightKeys.has(key)) return ''
  inFlightKeys.add(key)
  try {
    const worktreePath = await deps.ensureWorktree(deps.localRepoPath, payload.sourceBranch, payload.projectId, payload.mrIid, reviewKeyHash(payload))
    try {
      const sections: string[] = []
      const shouldAudit = payload.scope.kind === 'mr' && payload.mode === 'deep'
      const settled = await Promise.allSettled([
        deps.runReviewer(worktreePath, payload),
        ...(shouldAudit ? [deps.runAuditor(worktreePath, payload)] : []),
      ])
      const labels = ['Reviewer', 'Auditor']
      if (settled[0].status === 'fulfilled') {
        const { summary, failures, severityCounts } = settled[0].value
        // Try to parse findings counts from summary like "2 new inline comment(s), 1 thread(s) updated."
        const summaryText = summary ?? ''
        const newMatch = /(\d+)\s+new inline/.exec(summaryText)
        const replyMatch = /(\d+)\s+thread\(s\) updated/.exec(summaryText)
        const newCount = newMatch !== null ? Number(newMatch[1]) : 0
        const replyCount = replyMatch !== null ? Number(replyMatch[1]) : 0
        // If deps carry gitlab context, use rich comment; otherwise fallback to simple
        const richOpts = (deps as unknown as { gitlabBaseUrl?: string; reviewProfile?: string }).gitlabBaseUrl !== undefined
          ? buildReviewComment({
              projectPath: payload.projectPath,
              mrIid: payload.mrIid,
              gitlabBaseUrl: (deps as unknown as { gitlabBaseUrl: string }).gitlabBaseUrl,
              mode: payload.mode,
              profile: (deps as unknown as { reviewProfile?: string }).reviewProfile,
              summary: summaryText,
              failures,
              findings: { newCount, replyCount, severityCounts },
            })
          : `## 🤖 Maestro Review\n\n**\`${payload.projectPath}\` !${payload.mrIid}** · ✅ Completed · \`${payload.mode}\`${(deps as unknown as { reviewProfile?: string }).reviewProfile !== undefined ? ` · \`${(deps as unknown as { reviewProfile: string }).reviewProfile}\`` : ''}\n\n${summaryText}${failures.length > 0 ? `\n\n<details>\n<summary>⚠️ Failed to post (${failures.length})</summary>\n\n${failures.map((f) => `- \`${f}\``).join('\n')}\n\n</details>` : ''}`
        sections.push(richOpts)
      } else {
        sections.push(`## 🤖 Maestro Review — Reviewer failed\n\n**\`${payload.projectPath}\` !${payload.mrIid}** · ❌ Failed\n\n${settled[0].reason instanceof Error ? settled[0].reason.message : String(settled[0].reason)}`)
      }
      const auditorResult = settled[1]
      if (shouldAudit && auditorResult !== undefined && auditorResult.status === 'fulfilled') {
        sections.push(auditorResult.value)
      } else if (shouldAudit && auditorResult !== undefined && auditorResult.status === 'rejected') {
        sections.push(`## ${labels[1]} failed\n\n${auditorResult.reason instanceof Error ? auditorResult.reason.message : String(auditorResult.reason)}`)
      }
      const body = sections.join('\n\n---\n\n')
      try {
        if (payload.scope.kind === 'discussion') await deps.replyToDiscussion(payload.scope.discussionId, body)
        else await deps.postComment(body)
      } catch {
        await deps.writeFailedReport(payload.mrIid, body)
      }
      return body
    } finally {
      await deps.removeWorktree(worktreePath)
    }
  } finally {
    inFlightKeys.delete(key)
  }
}

/**
 * Review the GitLab diff without a local checkout. This deliberately has no
 * auditor or Magento profile: those require the mapped repository and its
 * environment. It is only reached for an explicit mention, never assignment.
 */
/** Diff-only fallback review; resolves to the comment body that was posted. */
export async function runDiffOnlyReview(payload: ReviewRequest, deps: DiffOnlyReviewDeps): Promise<string> {
  assertSafeId(payload.projectId, 'projectId')
  assertSafeId(payload.mrIid, 'mrIid')
  const key = reviewKey(payload)
  if (inFlightKeys.has(key)) return ''
  inFlightKeys.add(key)
  try {
    const { summary, failures } = await deps.runReviewer(payload)
    const diffBody = (deps as unknown as { gitlabBaseUrl?: string }).gitlabBaseUrl !== undefined
      ? buildReviewComment({
          projectPath: payload.projectPath,
          mrIid: payload.mrIid,
          gitlabBaseUrl: (deps as unknown as { gitlabBaseUrl: string }).gitlabBaseUrl,
          mode: payload.mode,
          summary: summary ?? '',
          failures,
          isDiffOnly: true,
        })
      : `## 🤖 Maestro Review — Diff-only\n\n> **Scope:** Diff-only — reviewed the GitLab diff without a local checkout, Magento environment, static analysis, or tests. For a full review, add this project in Settings → Maestro and mention again.\n\n${summary}${failures.length > 0 ? `\n\n<details>\n<summary>⚠️ Failed to post (${failures.length})</summary>\n\n${failures.map((f) => `- \`${f}\``).join('\n')}\n\n</details>` : ''}`
    const body = diffBody
    try {
      if (payload.scope.kind === 'discussion') await deps.replyToDiscussion(payload.scope.discussionId, body)
      else await deps.postComment(body)
    } catch {
      await deps.writeFailedReport(payload.mrIid, body)
    }
    return body
  } finally {
    inFlightKeys.delete(key)
  }
}

/** Decline a Deep request that lacks the local mapping it requires. */
export async function declineUnmappedDeepReview(payload: ReviewRequest, deps: ReviewCommentDeps): Promise<void> {
  assertSafeId(payload.projectId, 'projectId')
  assertSafeId(payload.mrIid, 'mrIid')
  const key = reviewKey(payload)
  if (inFlightKeys.has(key)) return
  inFlightKeys.add(key)
  const depsWithUrl = deps as unknown as { gitlabBaseUrl?: string; projectPath?: string }
  const baseUrl = depsWithUrl.gitlabBaseUrl
  const body = baseUrl !== undefined
    ? buildNotStartedComment({ gitlabBaseUrl: baseUrl, projectPath: payload.projectPath, mrIid: payload.mrIid })
    : '## 🤖 Maestro Review — Not started\n\n**`' + payload.projectPath + '` !' + payload.mrIid + '** · ⏸️ Not started\n\n> Deep review requires a project mapping with a local checkout and Magento environment.\n> Add this project in **Settings → Maestro**, then mention the reviewer again.'
  try {
    try {
      if (payload.scope.kind === 'discussion') await deps.replyToDiscussion(payload.scope.discussionId, body)
      else await deps.postComment(body)
    } catch {
      await deps.writeFailedReport(payload.mrIid, body)
    }
  } finally {
    inFlightKeys.delete(key)
  }
}

/**
 * Branch names accepted before they reach a `git` shell-out. `sourceBranch`
 * comes straight from the webhook body (Task 6) — fully attacker-controlled
 * for anyone who knows the shared webhook secret — so a value like
 * `--upload-pack=/tmp/evil.sh` must never reach `git fetch`/`git worktree add`
 * as anything other than an inert ref name. Rejects leading `-` (flag
 * injection) and `..` (path-traversal-flavored ref segments) even though the
 * charset already excludes most of what makes those dangerous, as
 * defense-in-depth against a future charset loosening.
 */
const SAFE_BRANCH_NAME = /^[A-Za-z0-9._/-]+$/

function assertSafeBranchName(sourceBranch: string): void {
  if (!SAFE_BRANCH_NAME.test(sourceBranch) || sourceBranch.startsWith('-') || sourceBranch.includes('..')) {
    throw new Error(`refusing to operate on unsafe branch name: ${JSON.stringify(sourceBranch)}`)
  }
}

export function isBranchNotFoundError(err: unknown): boolean {
  const rawStderr = (err as { stderr?: unknown })?.stderr
  const rawMsg = (err as { message?: unknown })?.message
  const toText = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(v as unknown))) return Buffer.from(v as Uint8Array).toString('utf8')
    if (typeof v === 'object' && v !== null && 'toString' in v) try { return String(v) } catch {}
    return ''
  }
  const stderrText = toText(rawStderr)
  const msgText = toText(rawMsg)
  const text = stderrText !== '' ? stderrText : msgText !== '' ? msgText : String(err ?? '')
  return text.includes("couldn't find remote ref") || text.includes('could not find remote branch') || text.includes('unknown revision or path')
}

/**
 * Keep a Govard audit worktree isolated from the developer's primary checkout.
 * Without this local override, both checkouts inherit the same `project_name`
 * and Govard may either reject the worktree or run commands in the wrong stack.
 */
export function govardWorktreeOverride(projectId: number, mrIid: number, keySuffix?: string): string {
  const name = `maestro-mr-${projectId}-${mrIid}${keySuffix === undefined ? '' : `-${keySuffix}`}`
  // Xdebug stays off in review envs: the auditor runs no coverage, and an
  // enabled Xdebug trips govard's lint perf-tax guard (exit 1, 0 findings).
  return `project_name: ${name}\ndomain: ${name}.test\nstack:\n  features:\n    xdebug: false\n`
}

/**
 * Fetch the MR's diff base SHA for govard diff-scope runs. Best-effort:
 * returns undefined (the lint tool then fail-fasts with guidance) rather
 * than failing the review when GitLab is unreachable.
 */
export async function fetchMrBaseSha(
  baseUrl: string,
  token: string,
  projectId: number,
  mrIid: number,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetcher(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}`,
      { headers: { 'PRIVATE-TOKEN': token } },
    )
    if (!response.ok) return undefined
    const mr = await response.json() as { diff_refs?: { base_sha?: string } }
    return mr.diff_refs?.base_sha
  } catch {
    return undefined
  }
}

export async function ensureWorktree(localRepoPath: string, sourceBranch: string, projectId: number, mrIid: number, keySuffix?: string): Promise<string> {
  assertSafeBranchName(sourceBranch)
  const worktreePath = join('/tmp', `maestro-mr-${projectId}-${mrIid}${keySuffix === undefined ? '' : `-${keySuffix}`}`)
  try {
    await execFileAsync('git', ['fetch', '--', 'origin', sourceBranch], { cwd: localRepoPath, timeout: GIT_TIMEOUT_MS })
  } catch (err) {
    if (isBranchNotFoundError(err)) {
      const e = new Error(`branch not found on origin: ${sourceBranch}`)
      ;(e as unknown as { code: string }).code = 'BRANCH_NOT_FOUND'
      ;(e as unknown as { cause: unknown }).cause = err
      throw e
    }
    throw err
  }
  // A host restart can interrupt an active review before its `finally` cleanup.
  // Recover only this deterministic Maestro-owned path so the next delivery can
  // retry; an unrelated worktree is never targeted.
  await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: localRepoPath, timeout: GIT_TIMEOUT_MS })
    .catch(() => {})
  await execFileAsync('git', ['worktree', 'add', '--', worktreePath, `origin/${sourceBranch}`], { cwd: localRepoPath, timeout: GIT_TIMEOUT_MS })
  await writeFile(join(worktreePath, '.govard.local.yml'), govardWorktreeOverride(projectId, mrIid, keySuffix), 'utf-8')
  await linkVendorIntoWorktree(localRepoPath, worktreePath)
  await writeContainerVendorOverride(localRepoPath, worktreePath)
  return worktreePath
}

/**
 * A vendor dir only counts as installed dependencies when the composer
 * autoloader is a real file. Magento tracks `vendor/.htaccess`, so every
 * worktree has a vendor/ stub — that stub must not pass for real deps, and
 * must not block the container bind that provides them.
 */
export async function vendorHasAutoload(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'vendor', 'autoload.php'))).isFile()
  } catch {
    return false
  }
}

/**
 * Share the primary checkout's `vendor/` (and `app/etc/env.php` when the
 * auditor needs a database) into the review worktree via symlinks, so
 * phpunit/static analysis run against real dependencies instead of falling
 * back to static-only. Links point INTO the worktree only — the primary
 * checkout is never written to — and `git worktree remove --force` deletes
 * the links along with the worktree. Missing sources, or targets that
 * already exist (e.g. Magento's tracked `vendor/.htaccess` stub), are
 * skipped quietly: the review still runs, the auditor discloses it.
 */
export async function linkVendorIntoWorktree(localRepoPath: string, worktreePath: string): Promise<string[]> {
  const linked: string[] = []
  const candidates: Array<{ source: string; target: string; dir: boolean; needsAutoload: boolean }> = [
    { source: join(localRepoPath, 'vendor'), target: join(worktreePath, 'vendor'), dir: true, needsAutoload: true },
    { source: join(localRepoPath, 'app', 'etc', 'env.php'), target: join(worktreePath, 'app', 'etc', 'env.php'), dir: false, needsAutoload: false },
  ]
  let advertised = false
  for (const { source, target, dir, needsAutoload } of candidates) {
    let isDir = false
    try {
      isDir = (await stat(source)).isDirectory()
      if (dir !== isDir) continue
    } catch {
      continue
    }
    if (needsAutoload && !(await vendorHasAutoload(localRepoPath))) continue
    if ((await lstat(target).catch(() => undefined)) !== undefined) {
      console.error(`maestro-orchestrator: link target exists, skipping ${target}`)
      continue
    }
    try {
      if (!advertised) {
        const sha = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: localRepoPath, timeout: GIT_TIMEOUT_MS })
          .then(({ stdout }) => stdout.trim()).catch(() => 'unknown')
        console.error(`maestro-orchestrator: linking vendor from ${localRepoPath} @ ${sha} into ${worktreePath}`)
        advertised = true
      }
      if (!dir) await mkdir(join(worktreePath, 'app', 'etc'), { recursive: true })
      await symlink(source, target, dir ? 'dir' : 'file')
      linked.push(target)
    } catch (err) {
      console.error(`maestro-orchestrator: failed to link ${source} into worktree:`, err)
    }
  }
  if (!advertised) {
    console.error(`maestro-orchestrator: no vendor/ in ${localRepoPath} — worktree ${worktreePath} runs without shared dependencies`)
  }
  return linked
}

/** Container path of the project root inside govard services. */
const GOVARD_CONTAINER_WORKDIR = '/var/www/html'

/**
 * Render a compose override that bind-mounts the primary checkout's vendor/
 * read-only into the php service. A host-side symlink alone dangles inside
 * containers (absolute host path), so container tools (phpunit) need this
 * bind to see real dependencies.
 *
 * The project mount (`.`) MUST be repeated first: govard merges overrides
 * with MergeMap, which REPLACES lists instead of appending — an override
 * carrying only the vendor bind would wipe `.:<workdir>` and leave the
 * container docroot holding nothing but vendor/. Relative `.` resolves
 * against the project root because govard passes --project-directory.
 *
 * Only the always-present `php` service is targeted: `php-debug` drops out
 * of the rendered base when xdebug is off, and a volumes-only override
 * entry would recreate it as a hollow service that fails compose validation.
 */
export function buildVendorOverrideYaml(vendorHostPath: string, envHostPath?: string, containerWorkDir: string = GOVARD_CONTAINER_WORKDIR): string {
  const volumes = [
    `.:${containerWorkDir}`,
    `${vendorHostPath}:${containerWorkDir}/vendor:ro`,
    ...(envHostPath !== undefined ? [`${envHostPath}:${containerWorkDir}/app/etc/env.php:ro`] : []),
  ]
  const service = `    volumes:\n${volumes.map((v) => `      - ${v}\n`).join('')}`
  return `services:\n  php:\n${service}`
}

/**
 * Drop the vendor bind override into the worktree (merged by govard via
 * `.govard/docker-compose.override.yml`). Binds only when the primary
 * checkout carries installed deps and the worktree does not — never shadow
 * real deps with a possibly stale bind. Returns the written path, or
 * undefined when skipped.
 */
export async function writeContainerVendorOverride(localRepoPath: string, worktreePath: string): Promise<string | undefined> {
  const vendorHostPath = join(localRepoPath, 'vendor')
  if (!(await vendorHasAutoload(localRepoPath))) return undefined
  // Our own host-side symlink still needs the bind (it dangles in-container);
  // only a real installed worktree vendor makes the bind redundant.
  const wtLink = await lstat(join(worktreePath, 'vendor')).catch(() => undefined)
  if (wtLink?.isSymbolicLink() !== true && await vendorHasAutoload(worktreePath)) return undefined
  const overridePath = join(worktreePath, '.govard', 'docker-compose.override.yml')
  await mkdir(join(worktreePath, '.govard'), { recursive: true })
  // A linked env.php dangles in-container like the vendor symlink did — bind
  // the real file over it when the primary checkout carries one.
  const envHostPath = join(localRepoPath, 'app', 'etc', 'env.php')
  let envBind: string | undefined
  try {
    if ((await stat(envHostPath)).isFile()) envBind = envHostPath
  } catch {
    envBind = undefined
  }
  await writeFile(overridePath, buildVendorOverrideYaml(vendorHostPath, envBind), 'utf-8')
  console.error(`maestro-orchestrator: container vendor bind ${vendorHostPath} -> ${GOVARD_CONTAINER_WORKDIR}/vendor (ro) for ${worktreePath}`)
  return overridePath
}

async function removeWorktree(worktreePath: string): Promise<void> {
  // Best-effort cleanup by design (a failure here must not block or fail the review that
  // already ran) — but a swallowed failure with zero visibility leaves an orphaned worktree
  // in /tmp undetectable, so log it rather than discarding it silently.
  await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: worktreePath, timeout: GIT_TIMEOUT_MS })
    .catch((err: unknown) => {
      console.error(`maestro-orchestrator: failed to remove worktree ${worktreePath}:`, err)
    })
}

async function writeFailedReport(mrIid: number, body: string): Promise<void> {
  const dir = join(homedir(), '.dsh', 'maestro', 'failed-reports')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${mrIid}-${Date.now()}.md`), body, 'utf-8')
}

export function apply(ctx: Context, config: Config): void {
  // Resolved per review run from Settings so an agentTimeoutMs change takes
  // effect without a plugin restart.
  let effectiveAgentTimeoutMs = config.agentTimeoutMs
  async function runReviewer(worktreePath: string | undefined, payload: ReviewRequest, effective: { gitlabBaseUrl: string; gitlabToken: string; botUsername: string }, reviewProfile?: ReviewSkillProfile, modelSelection?: ModelSelection, incrementalBlock?: string): Promise<ReviewOutcome> {
    // MR base SHA feeds govard diff-scope runs; undefined degrades to the
    // tool's fail-fast guidance instead of a wasted govard invocation.
    const lintDefaultBase = await fetchMrBaseSha(effective.gitlabBaseUrl, effective.gitlabToken, payload.projectId, payload.mrIid)
    const primaryOptions = agentOptionsForModel(modelSelection ?? ctx.agentDefaultModel.currentSelection())
    const fallbackOptions: ModelSelection = { provider: primaryOptions.provider, model: primaryOptions.model }
    let lastHandle: AgentHandle | undefined
    const runOnce = async (agentOptions: ModelSelection): Promise<ReviewOutcome> => {
      let capturedFindings: ReviewFinding[] = []
      let handle: AgentHandle | undefined
      let reviewerContext: Context | undefined
      try {
        handle = await ctx.agents.create({
          sessionId: SessionId(`maestro-reviewer-${payload.mrIid}-${Date.now()}`),
          meta: { cwd: worktreePath ?? tmpdir() },
          agentOptions,
          setup: async (agentCtx) => {
            reviewerContext = agentCtx
            installModelSelection(agentCtx, { current: agentOptions, assembled: undefined })
            await agentCtx.plugin(ReviewToolPolicy)
            await mountAgentPreset(ctx.agentPresets, agentCtx, 'dsh-maestro-reviewer')
            await agentCtx.plugin(GitlabClient, {
              baseUrl: effective.gitlabBaseUrl,
              projectId: payload.projectId,
              mrIid: payload.mrIid,
              token: effective.gitlabToken,
              botUsername: effective.botUsername,
            })
            await agentCtx.plugin(ReviewFindingsTool, { onReport: (findings) => { capturedFindings = findings } })
            // Diff-only runs have no worktree; nothing to search there.
            if (worktreePath !== undefined) {
              await agentCtx.plugin(SearchTool, { rootPath: worktreePath })
              await agentCtx.plugin(HyvaThemeInspectTool, { rootPath: worktreePath })
              await agentCtx.plugin(HyvaCspScanTool, { rootPath: worktreePath })
              await agentCtx.plugin(LayoutXmlTool, { rootPath: worktreePath })
              await agentCtx.plugin(ModuleCheckTool, { rootPath: worktreePath })
              await agentCtx.plugin(PhtmlEscapeScanTool, { rootPath: worktreePath })
              await agentCtx.plugin(ScopeSplitTool, { rootPath: worktreePath })
              await agentCtx.plugin(GovardAuditLintTool, { rootPath: worktreePath, defaultBase: lintDefaultBase, allowXdebug: true })
              await agentCtx.plugin(PerfLogStatsTool, { rootPath: worktreePath })
            }
          },
        })
      } catch (err) {
        lastHandle = handle
        throw new Error(`failed to create reviewer agent: ${err instanceof Error ? err.message : String(err)}`)
      }
      lastHandle = handle
      ctx.sessionTitle.rename(handle.agent.session, `Maestro Reviewer — MR !${payload.mrIid} (${payload.projectPath})`)
      try {
        const profileInstruction = reviewProfile === undefined
          ? 'This is a diff-only review with no local checkout or Magento environment. Do not claim that tests, static analysis, or Magento runtime validation ran. '
          : `Call maestro_load_review_profile with {"profile":"${reviewProfile}"} before examining code. `
        let scopePrompt = payload.scope.kind === 'discussion'
          ? buildReviewerScopePrompt({ scopeKind: 'discussion', discussionId: payload.scope.discussionId, path: payload.scope.path, line: payload.scope.line, profileInstruction })
          : buildReviewerScopePrompt({ scopeKind: 'full', mode: payload.mode, profileInstruction })
        if (incrementalBlock !== undefined) scopePrompt = `${incrementalBlock}\n\n${scopePrompt}`
        handle.agent.followup(createUserMessage({
          content: [{ type: 'text', text: scopePrompt }],
          source: { kind: 'user' },
        }))
        await whenIdleWithTimeout(handle, effectiveAgentTimeoutMs)
        if (reviewProfile !== undefined && (reviewerContext === undefined || loadedReviewProfile(reviewerContext) !== reviewProfile)) {
          throw new Error(`reviewer did not successfully load the required ${reviewProfile} review skill profile; no findings were posted`)
        }

        // An inline command is a request to discuss one existing thread, not a
        // license to fan out new threads across the MR. The report tool remains
        // useful as a structured response channel, but its findings are folded
        // into the one reply made by runReviewAndAudit below.
        if (payload.scope.kind === 'discussion') {
          const response = capturedFindings.length === 0
            ? 'No actionable issue found for the requested line.'
            : capturedFindings.map((finding) => finding.body).join('\n\n')
          return { summary: response, failures: [] }
        }

        const failures: string[] = []
        let postedNew = 0
        let postedReplies = 0
        const findingPoster: GitlabFindingPoster = {
          baseUrl: effective.gitlabBaseUrl,
          token: effective.gitlabToken,
          projectId: payload.projectId,
          mrIid: payload.mrIid,
        }
        for (const [index, finding] of capturedFindings.entries()) {
          try {
            await postReviewFindings([finding], findingPoster)
            if (finding.status === 'new') postedNew++
            else postedReplies++
          } catch (err) {
            const locator = finding.status === 'new' ? `${finding.path}:${finding.line}` : finding.discussionId
            failures.push(`${locator}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        return { summary: `${postedNew} new inline comment(s), ${postedReplies} thread(s) updated.`, failures, severityCounts: countFindingSeverities(capturedFindings) }
      } finally {
        await handle.dispose()
      }
    }
    try {
      return await runOnce(primaryOptions)
    } catch (err) {
      const turnMsg = getTurnErrorMessage(lastHandle)
      const isTurnUnsupported = turnMsg !== undefined && (turnMsg.includes('does not support reasoning effort') || turnMsg.includes('UNSUPPORTED_REASONING_EFFORT'))
      const isUnsupported = isUnsupportedReasoningError(err) || isTurnUnsupported
      if (primaryOptions.reasoningEffort !== undefined && isUnsupported) {
        const originalMsg = turnMsg ?? (err instanceof Error ? err.message : String(err))
        try {
          const result = await runOnce(fallbackOptions)
          console.warn(`maestro-orchestrator: Review model ${primaryOptions.provider}/${primaryOptions.model} with reasoningEffort "${String(primaryOptions.reasoningEffort)}" is unsupported; retried without reasoningEffort and succeeded`)
          return result
        } catch (retryErr) {
          const retryMsg = getTurnErrorMessage(lastHandle) ?? (retryErr instanceof Error ? retryErr.message : String(retryErr))
          throw new Error(`Review model ${primaryOptions.provider}/${primaryOptions.model} with reasoningEffort "${String(primaryOptions.reasoningEffort)}" is unsupported (${originalMsg}). Retried without reasoningEffort but still failed: ${retryMsg}. Remove reasoningEffort in Settings → Maestro → Review model or choose a reasoning-capable model.`)
        }
      }
      if (err instanceof Error && err.message.includes('did not successfully load the required')) {
        const effort = String(primaryOptions.reasoningEffort)
        const hint = primaryOptions.reasoningEffort === undefined
          ? `${err.message}. Check that maestro-skills are installed and DSH was restarted after install.`
          : `${err.message}. Model ${primaryOptions.provider}/${primaryOptions.model} with reasoningEffort "${effort}" may be unsupported — check Settings → Maestro → Review model. Original turn likely failed with UNSUPPORTED_REASONING_EFFORT — see session.jsonl.zstd turn/end.`
        throw new Error(hint)
      }
      throw err
    }
  }

  async function runAuditor(worktreePath: string, payload: ReviewRequest, effective: { gitlabBaseUrl: string; gitlabToken: string; botUsername: string }, modelSelection?: ModelSelection): Promise<string> {
    let handle: AgentHandle
    const agentOptions = agentOptionsForModel(modelSelection ?? ctx.agentDefaultModel.currentSelection())
    try {
      handle = await ctx.agents.create({
        sessionId: SessionId(`maestro-auditor-${payload.mrIid}-${Date.now()}`),
        meta: { cwd: worktreePath },
        agentOptions,
        setup: async (agentCtx) => {
          installModelSelection(agentCtx, { current: agentOptions, assembled: undefined })
          await agentCtx.plugin(ReviewToolPolicy)
          await mountAgentPreset(ctx.agentPresets, agentCtx, 'dsh-maestro-auditor')
          await agentCtx.plugin(GovardTool, { rootPath: worktreePath })
          await agentCtx.plugin(GitlabClient, {
            baseUrl: effective.gitlabBaseUrl,
            projectId: payload.projectId,
            mrIid: payload.mrIid,
            token: effective.gitlabToken,
            botUsername: effective.botUsername,
          })
        },
      })
    } catch (err) {
      throw new Error(`failed to create auditor agent: ${err instanceof Error ? err.message : String(err)}`)
    }
    ctx.sessionTitle.rename(handle.agent.session, `Maestro Auditor — MR !${payload.mrIid} (${payload.projectPath})`)
    try {
      const prompt = 'Audit this merge request\'s performance: bring up the environment, run the test suite, look for regressions, then write a Markdown report and tear the environment down.'
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await whenIdleWithTimeout(handle, effectiveAgentTimeoutMs)
      const output = auditorOutputFromSession(handle.agent.session)
      const text = output.map(block => ('text' in block ? block.text : '')).join('')
      return `## Maestro Performance Audit\n\n${text}`
    } finally {
      await handle.dispose()
    }
  }

  ctx.on('maestro/review-request', (payload) => {
    void (async () => {
      const userConfig = await loadUserConfig()
      const effective = {
        gitlabBaseUrl: userConfig.gitlabBaseUrl ?? config.gitlabBaseUrl,
        gitlabToken: userConfig.gitlabToken ?? config.gitlabToken,
        botUsername: userConfig.botUsername ?? config.botUsername,
        projectMappings: userConfig.projectMappings ?? config.projectMappings,
      }
      if (typeof userConfig.agentTimeoutMs === 'number' && userConfig.agentTimeoutMs >= 1000) {
        effectiveAgentTimeoutMs = userConfig.agentTimeoutMs
      }
      // Best-effort housekeeping; a prune failure must never block a review.
      if (typeof userConfig.reviewSessionRetentionDays === 'number' && userConfig.reviewSessionRetentionDays > 0) {
        void pruneHistory(userConfig.reviewSessionRetentionDays).catch((err: unknown) => {
          console.error('maestro-orchestrator: review history prune failed:', err)
        })
      }
      const mapping = effective.projectMappings.find(m => m.projectPath === payload.projectPath)
      // Unmapped reviewer assignments remain no-ops. Only an explicit mention
      // may opt into the intentionally limited, diff-only fallback below.
      if (mapping === undefined && payload.trigger !== 'mention') return
      // A push only re-reviews an MR that already has a completed review;
      // otherwise every newly opened MR would be reviewed twice.
      if (payload.trigger === 'push' && !(await hasCompletedReview(payload.projectId, payload.mrIid))) return
      const { gitlabToken } = effective
      if (gitlabToken === undefined) {
        console.error(`maestro-orchestrator: MR !${String(payload.mrIid)} for project ${payload.projectPath} has no GitLab token — set one in Maestro Settings or MAESTRO_GITLAB_TOKEN`)
        return
      }
      const resolved = { ...effective, gitlabToken }
      const historyId = `${payload.projectId}-${payload.mrIid}-${Date.now()}`
      const currentHeadSha = await fetchMrDetailHeadSha(resolved.gitlabBaseUrl, gitlabToken, payload.projectId, payload.mrIid)
        .catch(() => undefined) as string | undefined
      await recordReviewStart({
        id: historyId,
        projectId: payload.projectId,
        projectPath: payload.projectPath,
        mrIid: payload.mrIid,
        mode: payload.mode,
        scope: payload.scope.kind,
        trigger: payload.trigger,
        startedAt: Date.now(),
        headSha: currentHeadSha,
      })
      // H6 incremental context: what changed since the last completed review on this MR.
      let incrementalBlock: string | undefined
      try {
        const prior = await lastCompletedReview(payload.projectId, payload.mrIid)
        if (prior?.headSha !== undefined && currentHeadSha !== undefined && prior.headSha !== currentHeadSha) {
          const compare = await fetchCompare(resolved.gitlabBaseUrl, gitlabToken, payload.projectId, prior.headSha, currentHeadSha)
          incrementalBlock = buildIncrementalBlock(compare, prior.headSha, currentHeadSha)
        }
      } catch {
        // Optional optimization only — never fail the review for it.
      }
      const fallbackSelection: ModelSelection = (ctx.get?.('agentDefaultModel') as { currentSelection(): ModelSelection } | undefined)?.currentSelection()
        ?? (ctx as unknown as { agentDefaultModel?: { currentSelection(): ModelSelection } }).agentDefaultModel?.currentSelection()
        ?? { provider: 'fallback', model: 'fallback' }
      const reviewModelSelection = resolveReviewModel(userConfig, mapping, fallbackSelection)
      // Opt-in Telegram digest; a delivery failure is logged and dropped.
      const reviewStartMsOuter = Date.now()
      const notifyTelegram = (
        status: 'completed' | 'failed',
        summary?: string,
        extra?: { findings?: { newCount: number; replyCount: number; failedCount: number } },
      ): void => {
        if (userConfig.telegramReviewNotifications !== true) return
        const notifier = ctx.get?.('maestroNotifier') as NotifierLike | undefined
        if (notifier === undefined) return
        const findings = extra?.findings
        void notifier.send(
          'telegram',
          { botToken: userConfig.telegramBotToken, chatId: userConfig.telegramChatId },
          {
            text: reviewDigestText({
              projectPath: payload.projectPath,
              mrIid: payload.mrIid,
              status,
              summary,
              mode: payload.mode,
              profile: mapping?.reviewProfile,
              gitlabBaseUrl: resolved.gitlabBaseUrl,
              findings,
              durationMs: Date.now() - reviewStartMsOuter,
            }),
          },
        ).then((result) => {
          if (!result.sent && result.reason === 'request-failed') {
            console.error(`maestro-orchestrator: Telegram review notification for MR !${String(payload.mrIid)} failed to deliver`)
          }
        })
      }
      /** First line + bounded excerpt of a posted report, for the history log.
       *  Word-boundary truncation so Telegram never shows half-cut code (`:src="item…`).
       *  If the report starts with the markdown header, strip it — Telegram already has its own header.
       */
      const summarize = (body: string | undefined): string | undefined => {
        if (body === undefined) return undefined
        const withoutHeader = body.replace(/^## 🤖 Maestro Review[^\n]*\n\s*/, '').trim()
        const cleaned = withoutHeader.replace(/\s+/g, ' ').trim()
        if (cleaned.length <= 160) return cleaned
        const cut = cleaned.slice(0, 160)
        const lastSpace = cut.lastIndexOf(' ')
        return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()} …`
      }
      // Award-emoji acknowledgements only make sense on the MR itself; inline
      // discussion reviews answer in-thread instead.
      const signals = payload.scope.kind === 'mr'
        ? createReviewSignals({ baseUrl: resolved.gitlabBaseUrl, token: resolved.gitlabToken, projectId: payload.projectId, mrIid: payload.mrIid, botUsername: resolved.botUsername })
        : undefined
      await signals?.start()
      const postComment = async (body: string) => {
        const response = await fetch(
          `${resolved.gitlabBaseUrl}/api/v4/projects/${payload.projectId}/merge_requests/${payload.mrIid}/notes`,
          {
            method: 'POST',
            headers: { 'PRIVATE-TOKEN': resolved.gitlabToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          },
        )
        if (!response.ok) throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      const replyToDiscussion = async (discussionId: string, body: string) => {
        const response = await fetch(
          `${resolved.gitlabBaseUrl}/api/v4/projects/${payload.projectId}/merge_requests/${payload.mrIid}/discussions/${encodeURIComponent(discussionId)}/notes`,
          {
            method: 'POST',
            headers: { 'PRIVATE-TOKEN': resolved.gitlabToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
          },
        )
        if (!response.ok) throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      try {
        if (mapping === undefined) {
          if (payload.mode === 'deep') {
            await declineUnmappedDeepReview(payload, { postComment, replyToDiscussion, writeFailedReport, gitlabBaseUrl: resolved.gitlabBaseUrl } as unknown as ReviewCommentDeps)
            await recordReviewFinish(historyId, { status: 'completed', summary: 'Deep review declined (unmapped project)' })
            notifyTelegram('completed', 'Deep review declined (unmapped project)')
            await signals?.finish('completed')
            return
          }
          const diffBody = await runDiffOnlyReview(payload, {
            runReviewer: (p) => runReviewer(undefined, p, resolved, undefined, reviewModelSelection, incrementalBlock),
            postComment,
            replyToDiscussion,
            writeFailedReport,
            gitlabBaseUrl: resolved.gitlabBaseUrl,
          } as unknown as DiffOnlyReviewDeps)
          await recordReviewFinish(historyId, { status: 'completed', summary: summarize(diffBody) })
          notifyTelegram('completed', summarize(diffBody))
          await signals?.finish('completed')
          return
        }
        let fullBody: string
        try {
          fullBody = await runReviewAndAudit(payload, {
            localRepoPath: mapping.localRepoPath,
            ensureWorktree,
            removeWorktree,
            runReviewer: (worktreePath, p) => runReviewer(worktreePath, p, resolved, mapping.reviewProfile ?? 'magento2', reviewModelSelection, incrementalBlock),
            runAuditor: (worktreePath, p) => runAuditor(worktreePath, p, resolved, reviewModelSelection),
            postComment,
            replyToDiscussion,
            writeFailedReport,
            gitlabBaseUrl: resolved.gitlabBaseUrl,
            reviewProfile: mapping.reviewProfile ?? 'magento2',
          } as unknown as ReviewAndAuditDeps)
        } catch (err) {
          const isBranchNotFound = (err as { code?: string })?.code === 'BRANCH_NOT_FOUND' || isBranchNotFoundError(err)
          if (isBranchNotFound) {
            const diffBody = await runDiffOnlyReview(payload, {
              runReviewer: (p) => runReviewer(undefined, p, resolved, undefined, reviewModelSelection, incrementalBlock),
              postComment,
              replyToDiscussion,
              writeFailedReport,
              gitlabBaseUrl: resolved.gitlabBaseUrl,
            } as unknown as DiffOnlyReviewDeps)
            const summary = summarize(diffBody)
            const branchNote = `fallback diff-only: branch ${payload.sourceBranch} not found on origin — ${summary ?? ''}`.trim()
            await recordReviewFinish(historyId, { status: 'completed', summary: branchNote })
            notifyTelegram('completed', branchNote)
            await signals?.finish('completed')
            return
          }
          throw err
        }
        await recordReviewFinish(historyId, { status: 'completed', summary: summarize(fullBody) })
        notifyTelegram('completed', summarize(fullBody))
        await signals?.finish('completed')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await recordReviewFinish(historyId, { status: 'failed', error: message }).catch(() => {})
        notifyTelegram('failed', message)
        await signals?.finish('failed')
        throw err
      }
    })().catch((err: unknown) => {
      // Worktree creation, agent creation, and fallback delivery all run from
      // an event callback, so surface failures rather than leaking a rejected
      // fire-and-forget Promise.
      console.error(`maestro-orchestrator: review run failed for MR !${String(payload.mrIid)}:`, err)
    })
  })
}
