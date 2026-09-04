import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitlabAuthHeaders } from './gitlab-auth.js'

/**
 * Source checkout for CI deep reviews (spec §3): clone the source project at
 * the MR head SHA with the PAT over oauth2. The token lives only in the clone
 * URL passed to git — errors rethrown here are redacted, and the clone dir is
 * ephemeral (fresh container per job; the orchestrator removes it in `finally`).
 */

export type RunFn = (cmd: string, args: string[], cwd?: string) => Promise<void>

const execFileAsync = promisify(execFile)

/** Production runner (execFile — no shell, argv cannot leak into shell history). */
export const defaultRun: RunFn = async (cmd, args, cwd) => {
  await execFileAsync(cmd, args, { cwd, timeout: 120_000 })
}

export function redactCloneUrl(url: string): string {
  return url.replace(/oauth2:[^@]+@/, 'oauth2:***@')
}

async function repoHttpUrl(fetcher: typeof fetch, host: string, projectId: number, token: string): Promise<string> {
  const res = await fetcher(`https://${host}/api/v4/projects/${projectId}`, { headers: gitlabAuthHeaders(token) })
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { http_url_to_repo?: string }
  if (!body.http_url_to_repo) throw new Error('project has no http_url_to_repo')
  return body.http_url_to_repo
}

export async function cloneSourceRepo(opts: {
  fetcher: typeof fetch
  run: RunFn
  host: string
  projectId: number
  sourceBranch: string
  headSha: string
  token: string
  dir: string
}): Promise<string> {
  const httpUrl = await repoHttpUrl(opts.fetcher, opts.host, opts.projectId, opts.token)
  const authed = httpUrl.replace('https://', `https://oauth2:${opts.token}@`)
  try {
    await opts.run('git', ['clone', '--depth', '50', '--branch', opts.sourceBranch, '--', authed, opts.dir])
    await opts.run('git', ['fetch', '--depth', '50', 'origin', opts.headSha], opts.dir)
    await opts.run('git', ['checkout', '--detach', opts.headSha], opts.dir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(redactCloneUrl(message))
  }
  return opts.dir
}
