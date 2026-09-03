import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ReviewRequest, ReviewResult } from '../events.js'

export const name = 'maestro-review-ci-trigger'
export const inject = ['reviewRunner'] as const

export interface CiEnvConfig {
  gitlabBaseUrl: string
  gitlabToken: string
  sourceProjectId: number
  mrIid: number
  mode: 'quick' | 'deep'
  dryRun: boolean
}

export const CiEnvConfig: z<CiEnvConfig> = z.object({
  gitlabBaseUrl: z.string().required(),
  gitlabToken: z.string().role('secret').required(),
  sourceProjectId: z.number().required(),
  mrIid: z.number().required(),
  mode: z.union([z.const('quick'), z.const('deep')]).default('quick'),
  dryRun: z.boolean().default(false),
})

/**
 * Reads the CI contract env vars (spec §5.2) — not Cordis-supplied config, since these are
 * per-run values a static profile config cannot hold. schemastery's `.required()` only rejects
 * `undefined`, not an empty string, so GITLAB_HOST/MAESTRO_GITLAB_TOKEN presence is checked here
 * before defaulting to `''` — otherwise a missing env var would silently pass validation.
 */
export function parseCiEnvConfig(env: Record<string, string | undefined>): CiEnvConfig {
  if (env.GITLAB_HOST === undefined) throw new Error('missing GITLAB_HOST')
  if (env.MAESTRO_GITLAB_TOKEN === undefined) throw new Error('missing MAESTRO_GITLAB_TOKEN')
  return CiEnvConfig({
    gitlabBaseUrl: `https://${env.GITLAB_HOST}`,
    gitlabToken: env.MAESTRO_GITLAB_TOKEN,
    sourceProjectId: Number(env.SOURCE_PROJECT_ID),
    mrIid: Number(env.MR_IID),
    mode: env.REVIEW_MODE === 'deep' ? 'deep' : 'quick',
    dryRun: env.REVIEW_DRY_RUN === '1',
  })
}

/** The one field a webhook payload carries that env vars don't — orchestrator fetches the diff itself. */
export async function fetchMrSourceBranch(config: CiEnvConfig, fetcher: typeof fetch = fetch): Promise<string> {
  const url = `${config.gitlabBaseUrl}/api/v4/projects/${config.sourceProjectId}/merge_requests/${config.mrIid}`
  const res = await fetcher(url, { headers: { 'PRIVATE-TOKEN': config.gitlabToken } })
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
  const body = await res.json() as { source_branch?: string }
  if (typeof body.source_branch !== 'string') throw new Error('GitLab merge request response is missing source_branch')
  return body.source_branch
}

export async function runCiTrigger(
  ctx: Context,
  config: CiEnvConfig,
  deps: { fetcher?: typeof fetch; writeFile?: typeof import('node:fs/promises').writeFile } = {},
): Promise<ReviewResult> {
  const sourceBranch = await fetchMrSourceBranch(config, deps.fetcher)
  // projectPath is synthetic (no webhook payload to read it from) — harmless: the
  // reviewer-ci profile's own projectMappings is always [], so orchestrator's
  // mapping lookup on projectPath never matches regardless of its exact value
  // (same precedent as the PR #52 runner it replaces).
  const request: ReviewRequest = {
    projectPath: `project/${config.sourceProjectId}`,
    projectId: config.sourceProjectId,
    mrIid: config.mrIid,
    sourceBranch,
    trigger: 'mention',
    mode: config.mode,
    scope: { kind: 'mr' },
  }
  const result = await ctx.reviewRunner(request)
  const { writeFile } = deps.writeFile !== undefined ? { writeFile: deps.writeFile } : await import('node:fs/promises')
  const report = { ...result, projectId: config.sourceProjectId, mrIid: config.mrIid, mode: config.mode, generatedAt: new Date().toISOString() }
  await writeFile('review-report.json', JSON.stringify(report, null, 2), 'utf-8')
  const md = `# Review Report\n\n**Project:** ${config.sourceProjectId} !${config.mrIid}\n**Mode:** ${config.mode}\n**Duration:** ${result.durationMs}ms\n\n${result.summary ?? '(no summary)'}\n${result.failures.length > 0 ? `\nFailures:\n${result.failures.map(f => `- ${f}`).join('\n')}\n` : ''}`
  await writeFile('review-report.md', md, 'utf-8')
  return result
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    void (async () => {
      try {
        const config = parseCiEnvConfig(process.env)
        console.log(`[review] ci-trigger starting: project ${config.sourceProjectId} !${config.mrIid} mode=${config.mode} dryRun=${config.dryRun}`)
        const result = config.dryRun
          ? { ok: true, summary: '[dry-run] config valid, skipping review', failures: [], durationMs: 0 }
          : await runCiTrigger(ctx, config)
        console.log(`[review] ci-trigger finished: ok=${result.ok} summary=${JSON.stringify(result.summary)} failures=${result.failures.length}`)
        const exit = ctx.get('appExit')
        if (exit === undefined) {
          console.error('[review] ctx.get(\'appExit\') is undefined — the launcher did not provide it, process cannot signal its real exit code')
        } else {
          exit(result.ok ? 0 : 1)
        }
      } catch (err) {
        console.error('maestro-review-ci-trigger:', err instanceof Error ? err.message : String(err))
        ctx.get('appExit')?.(1)
      }
    })()
    return () => {}
  }, 'maestro-review-ci-trigger run')
}
