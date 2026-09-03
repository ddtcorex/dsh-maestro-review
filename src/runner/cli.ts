export type RunnerConfig = {
  gitlabHost: string; gitlabToken: string; sourceProjectId: number;
  mrIid: number; gitlabBaseUrl: string; mode: 'quick'|'deep'; dryRun: boolean;
}
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
  return { gitlabHost, gitlabToken: token, sourceProjectId, mrIid, gitlabBaseUrl: base, mode, dryRun }
}
