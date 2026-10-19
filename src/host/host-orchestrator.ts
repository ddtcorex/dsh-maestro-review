import { mkdir, writeFile, symlink, stat, lstat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { ReviewRequest, ReviewResult } from '@ddtcorex/maestro-reviewer/lib/events.js'
import type { ReviewSkillProfile } from '@ddtcorex/maestro-reviewer/lib/skills-tool.js'
import { govardOnPath } from '@ddtcorex/maestro-reviewer/lib/govard-lint-detection.js'
import { hasCompletedReview, pruneHistory, recordReviewFinish, recordReviewStart } from '@ddtcorex/maestro-reviewer/lib/review-history.js'
import { gitlabForge } from '@ddtcorex/maestro-reviewer/lib/forge/gitlab/index.js'
import { assertSafeBranchName, declineUnmappedDeepReview, isBranchNotFoundError, type ReviewCommentDeps } from '@ddtcorex/maestro-reviewer/lib/orchestrator.js'
import { DEDUPED_SUMMARY, removeWorktree, writeFailedReport, type CodeAccess, type EngineGitlab } from '@ddtcorex/maestro-reviewer/lib/engine.js'
import { loadUserConfig, type MaestroUserConfig, type ProjectMapping, type ReviewModelSelection } from './config-store.js'
import { reviewDigestText, type NotifierLike } from './notify.js'
import './events.js'

/**
 * Row `maestro-review-host-orchestrator`: the DSH host side of a review. It
 * listens for `maestro/review-request` (webhook intake), resolves user
 * settings and project mappings, applies the trigger gates, prepares worktrees
 * (vendor and govard environment linking) and calls the engine.
 */
export const name = 'maestro-review-host-orchestrator'
export const inject = ['reviewEngine', 'agentDefaultModel']

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 60_000

/**
 * Resolve the model to use for an automated review. Priority: per-project
 * override > global reviewModel (Maestro Settings) > row-config reviewModel
 * (lets a headless profile such as reviewer-ci pin a model from env vars,
 * where there is no Settings UI) > DSH default (`fallback`).
 */
export function resolveReviewModel(
  userConfig: MaestroUserConfig,
  mapping: { reviewModel?: ReviewModelSelection | null; projectPath?: string } | undefined,
  fallback: ModelSelection,
  rowSelection?: ReviewModelSelection | null,
): ModelSelection {
  const raw = (mapping?.reviewModel as ReviewModelSelection | null | undefined) ?? userConfig.reviewModel ?? rowSelection
  if (raw === undefined || raw === null) return fallback
  return {
    provider: raw.provider,
    model: raw.model,
    ...(raw.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(raw.reasoningEffort) }),
  }
}

/** Effective auto-trigger flags: per-project row overrides global, unset inherits (design §4). */
export function resolveReviewTriggers(
  userConfig: MaestroUserConfig,
  mapping?: ProjectMapping,
): { onPush: boolean; onAssign: boolean } {
  return {
    onPush: mapping?.rereviewOnPush ?? userConfig.autoRereviewOnPush ?? false,
    onAssign: mapping?.reviewOnAssign ?? userConfig.autoReviewOnAssign ?? true,
  }
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
  /**
   * Deployment-level model pin, below Maestro Settings in precedence. Lets a
   * headless profile (reviewer-ci) select the review model from env vars —
   * e.g. REVIEW_MODEL_PROVIDER/REVIEW_MODEL — where no Settings UI exists.
   *
   * Deliberately absent from the zod schema below: schemastery object schemas
   * always descend into inner fields (probed — even `.required(false)` still
   * throws on undefined), so declaring it would fail every boot without the
   * vars. Unknown keys pass validation through (same precedent as mapping-level
   * reviewModel, which the projectMappings schema doesn't declare either),
   * and resolveReviewModel reads it at review time.
   */
  reviewModel?: ReviewModelSelection | null
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

/** Upper bound for the best-effort `govard env down -v` run by the orchestrator. */
export const GOVARD_TEARDOWN_TIMEOUT_MS = 120_000

type TeardownRun = (file: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<unknown>

/**
 * Tear down the review worktree's govard environment (`govard env down -v`,
 * cwd = the worktree, whose `.govard.local.yml` names the per-MR project).
 * Never throws: it runs in cleanup paths where a failure must not mask the
 * review result, so a failure is logged as a warning instead.
 */
export async function teardownGovardEnvironment(worktreePath: string, run: TeardownRun = execFileAsync): Promise<void> {
  try {
    await run('govard', ['env', 'down', '-v'], { cwd: worktreePath, timeout: GOVARD_TEARDOWN_TIMEOUT_MS })
  } catch (err) {
    console.warn(`maestro-orchestrator: govard env down -v failed in ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`)
  }
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


async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
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
  // retry; an unrelated worktree is never targeted. An interrupted deep audit
  // may also have left its govard containers up, so the stale worktree's
  // environment goes down first (only when it carries the per-MR override that
  // names the project, and best effort).
  if (govardOnPath() && await pathExists(join(worktreePath, '.govard.local.yml'))) await teardownGovardEnvironment(worktreePath)
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

export function apply(ctx: Context, config: Config): void {
  async function runReview(payload: ReviewRequest): Promise<ReviewResult> {
    const t0 = Date.now()
    try {
      const userConfig = await loadUserConfig()
      const effective = {
        gitlabBaseUrl: userConfig.gitlabBaseUrl ?? config.gitlabBaseUrl,
        gitlabToken: userConfig.gitlabToken ?? config.gitlabToken,
        botUsername: userConfig.botUsername ?? config.botUsername,
        projectMappings: userConfig.projectMappings ?? config.projectMappings,
      }
      // Resolved per review run from Settings so an agentTimeoutMs change takes
      // effect without a plugin restart.
      const agentTimeoutMs = typeof userConfig.agentTimeoutMs === 'number' && userConfig.agentTimeoutMs >= 1000
        ? userConfig.agentTimeoutMs
        : config.agentTimeoutMs
      // Best-effort housekeeping; a prune failure must never block a review.
      if (typeof userConfig.reviewSessionRetentionDays === 'number' && userConfig.reviewSessionRetentionDays > 0) {
        void pruneHistory(userConfig.reviewSessionRetentionDays).catch((err: unknown) => {
          console.error('maestro-orchestrator: review history prune failed:', err)
        })
      }
      const mapping = effective.projectMappings.find(m => m.projectPath === payload.projectPath)
      // Unmapped reviewer assignments remain no-ops. Only an explicit mention
      // may opt into the intentionally limited, diff-only fallback below.
      if (mapping === undefined && payload.trigger !== 'mention') {
        console.error(`maestro-orchestrator: drop unmapped project=${payload.projectPath} mr=!${payload.mrIid} trigger=${payload.trigger}`)
        return { ok: true, failures: [], durationMs: Date.now() - t0 }
      }
      const triggers = resolveReviewTriggers(userConfig, mapping)
      // Gated-off auto-triggers stay fully silent: no history, no signals, no comment (host log only).
      if (payload.trigger === 'reviewer-assignment' && !triggers.onAssign) {
        console.error(`maestro-orchestrator: drop assign-gate-off project=${payload.projectPath} mr=!${payload.mrIid} trigger=${payload.trigger}`)
        return { ok: true, failures: [], durationMs: Date.now() - t0 }
      }
      if (payload.trigger === 'push' && !triggers.onPush) {
        console.error(`maestro-orchestrator: drop push-gate-off project=${payload.projectPath} mr=!${payload.mrIid} trigger=${payload.trigger}`)
        return { ok: true, failures: [], durationMs: Date.now() - t0 }
      }
      // A push only re-reviews an MR that already has a completed review;
      // otherwise every newly opened MR would be reviewed twice.
      if (payload.trigger === 'push' && !(await hasCompletedReview(payload.projectId, payload.mrIid))) {
        console.error(`maestro-orchestrator: drop push-no-completed-history project=${payload.projectPath} mr=!${payload.mrIid} trigger=${payload.trigger}`)
        return { ok: true, failures: [], durationMs: Date.now() - t0 }
      }
      const { gitlabToken } = effective
      if (gitlabToken === undefined) {
        const message = `MR !${String(payload.mrIid)} for project ${payload.projectPath} has no GitLab token — set one in Maestro Settings or MAESTRO_GITLAB_TOKEN`
        console.error(`maestro-orchestrator: drop missing-token project=${payload.projectPath} mr=!${String(payload.mrIid)} trigger=${payload.trigger} — ${message}`)
        return { ok: false, failures: [message], durationMs: Date.now() - t0 }
      }
      const gitlab = { baseUrl: effective.gitlabBaseUrl, token: gitlabToken, botUsername: effective.botUsername }
      const fallbackSelection: ModelSelection = (ctx.get?.('agentDefaultModel') as { currentSelection(): ModelSelection } | undefined)?.currentSelection()
        ?? (ctx as unknown as { agentDefaultModel?: { currentSelection(): ModelSelection } }).agentDefaultModel?.currentSelection()
        ?? { provider: 'fallback', model: 'fallback' }
      const model = resolveReviewModel(userConfig, mapping, fallbackSelection, config.reviewModel)
      // Opt-in Telegram digest; a delivery failure is logged and dropped.
      const reviewStartMsOuter = Date.now()
      const notifyTelegram = (status: 'completed' | 'failed', summary?: string): void => {
        if (userConfig.telegramReviewNotifications !== true) return
        const notifier = ctx.get?.('maestroNotifier') as NotifierLike | undefined
        if (notifier === undefined) return
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
              gitlabBaseUrl: gitlab.baseUrl,
              durationMs: Date.now() - reviewStartMsOuter,
            }),
          },
        ).then((result) => {
          if (!result.sent && result.reason === 'request-failed') {
            console.error(`maestro-orchestrator: Telegram review notification for MR !${String(payload.mrIid)} failed to deliver`)
          }
        }).catch((err) => {
          // Delivery is fire-and-forget: a rejection must not escape into the
          // host's unhandled-rejection path, which exits the whole process.
          console.error(
            `maestro-orchestrator: Telegram review notification for MR !${String(payload.mrIid)} threw:`,
            err instanceof Error ? err.message : err,
          )
        })
      }
      if (mapping === undefined && payload.mode === 'deep') {
        return await declineUnmappedDeep(payload, gitlab, notifyTelegram, t0)
      }
      let access: CodeAccess
      let reviewProfile: ReviewSkillProfile | undefined
      if (mapping !== undefined) {
        access = {
          kind: 'workspace',
          localRepoPath: mapping.localRepoPath,
          ensureWorktree,
          removeWorktree,
          ...(govardOnPath() ? { teardownEnvironment: teardownGovardEnvironment } : {}),
          auditor: 'runtime',
        }
        reviewProfile = mapping.reviewProfile
      } else {
        access = { kind: 'diff' }
      }
      return await ctx.reviewEngine.run(payload, { gitlab, access, reviewProfile, model, agentTimeoutMs, notify: notifyTelegram })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`maestro-orchestrator: review run failed for MR !${String(payload.mrIid)}:`, err)
      return { ok: false, summary: undefined, failures: [message], durationMs: Date.now() - t0 }
    }
  }

  ctx.on('maestro/review-request', (payload) => { void runReview(payload) })
  ctx.provide('reviewRunner', runReview)
}

/** Host-only: a deep request on an unmapped project gets a "not started" note, recorded like a run. */
async function declineUnmappedDeep(
  payload: ReviewRequest,
  gitlab: EngineGitlab,
  notify: (status: 'completed' | 'failed', summary?: string) => void,
  t0: number,
): Promise<ReviewResult> {
  const historyId = `${payload.projectId}-${payload.mrIid}-${Date.now()}`
  const forge = gitlabForge(gitlab, payload)
  const currentHeadSha = await forge.mrHeadSha().catch(() => undefined)
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
  const signals = payload.scope.kind === 'mr' ? forge.signals() : undefined
  await signals?.start()
  const postComment = (body: string) => forge.postNote(body)
  const replyToDiscussion = (discussionId: string, body: string) => forge.replyToDiscussion(discussionId, body)
  try {
    const declined = await declineUnmappedDeepReview(payload, { postComment, replyToDiscussion, writeFailedReport, gitlabBaseUrl: gitlab.baseUrl } as unknown as ReviewCommentDeps)
    if (!declined) {
      console.error(`maestro-orchestrator: deduped duplicate in-flight review project=${payload.projectPath} mr=!${payload.mrIid} trigger=${payload.trigger}`)
      await recordReviewFinish(historyId, { status: 'completed', summary: DEDUPED_SUMMARY })
      await signals?.finish('completed')
      return { ok: true, summary: DEDUPED_SUMMARY, failures: [], durationMs: Date.now() - t0 }
    }
    const summary = 'Deep review declined (unmapped project)'
    await recordReviewFinish(historyId, { status: 'completed', summary })
    notify('completed', summary)
    await signals?.finish('completed')
    return { ok: true, summary, failures: [], durationMs: Date.now() - t0 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordReviewFinish(historyId, { status: 'failed', error: message }).catch(() => {})
    notify('failed', message)
    await signals?.finish('failed')
    return { ok: false, summary: undefined, failures: [message], durationMs: Date.now() - t0 }
  }
}
