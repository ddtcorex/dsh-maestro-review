#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export type RunnerConfig = {
  gitlabHost: string; gitlabToken: string; sourceProjectId: number;
  mrIid: number; gitlabBaseUrl: string; mode: 'quick'|'deep'; dryRun: boolean; llmProvider?: string;
}
export type ValidRunnerConfig = RunnerConfig

function assertSafeId(n: number, label: string) {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`refusing to operate on unsafe ${label}: ${JSON.stringify(n)}`)
}
export function parseRunnerConfig(env: Record<string,string|undefined>, argv: string[]): RunnerConfig {
  const gitlabHost = env.GITLAB_HOST ?? env.CI_SERVER_HOST ?? ''
  const token = env.MAESTRO_GITLAB_TOKEN ?? env.GITLAB_TOKEN ?? ''
  if (!token) throw new Error('missing MAESTRO_GITLAB_TOKEN')
  if (!gitlabHost) throw new Error('missing GITLAB_HOST')
  const rawPid = env.SOURCE_PROJECT_ID ?? ''
  const rawIid = env.MR_IID ?? env.CI_MERGE_REQUEST_IID ?? ''
  const sourceProjectId = Number(rawPid); const mrIid = Number(rawIid)
  assertSafeId(sourceProjectId, 'projectId'); assertSafeId(mrIid, 'mrIid')
  const mode = (env.REVIEW_MODE === 'deep' ? 'deep' : 'quick') as RunnerConfig['mode']
  const dryRun = env.REVIEW_DRY_RUN === '1' || argv.includes('--dry-run')
  const base = gitlabHost.startsWith('http') ? gitlabHost : `https://${gitlabHost}`
  const llmProvider = env.LLM_PROVIDER ?? undefined
  return { gitlabHost, gitlabToken: token, sourceProjectId, mrIid, gitlabBaseUrl: base, mode, dryRun, llmProvider }
}

export function validateRunnerConfig(cfg: RunnerConfig): asserts cfg is ValidRunnerConfig {
  if (!cfg.gitlabToken) throw new Error('missing MAESTRO_GITLAB_TOKEN')
  if (!cfg.gitlabHost) throw new Error('missing GITLAB_HOST')
  assertSafeId(cfg.sourceProjectId, 'projectId')
  assertSafeId(cfg.mrIid, 'mrIid')
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string|undefined> = process.env as Record<string, string|undefined>): Promise<void> {
  const cfg = parseRunnerConfig(env, argv)
  validateRunnerConfig(cfg)
  if (cfg.dryRun) console.log('[dry-run] runner config valid', { gitlabHost: cfg.gitlabHost, sourceProjectId: cfg.sourceProjectId, mrIid: cfg.mrIid, mode: cfg.mode })
  const { runOnce } = await import('./runner-orchestrator.js')
  const { buildReportJson } = await import('./report.js')
  const postComment = async (body: string) => {
    const res = await fetch(`${cfg.gitlabBaseUrl}/api/v4/projects/${cfg.sourceProjectId}/merge_requests/${cfg.mrIid}/notes`, {
      method: 'POST', headers: { 'PRIVATE-TOKEN': cfg.gitlabToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ body })
    })
    if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
  }
  const result = await runOnce(cfg, { postComment } as any)
  const headSha = (result as any).headSha ?? 'unknown'
  const report = buildReportJson(cfg, result, headSha) as Record<string, unknown>
  const cwd = process.cwd()
  await writeFile(join(cwd, 'review-report.json'), JSON.stringify(report, null, 2), 'utf-8')
  const md = `# Review Report\n\n**Project:** ${cfg.sourceProjectId} !${cfg.mrIid}\n**Mode:** ${cfg.mode}\n**Head:** ${headSha}\n**Duration:** ${result.durationMs}ms\n\n${result.summary}\n${result.failures.length > 0 ? `\nFailures:\n${result.failures.map((f) => `- ${f}`).join('\n')}\n` : ''}`
  await writeFile(join(cwd, 'review-report.md'), md, 'utf-8')
}

// CLI entry — only runs when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
