import type { RunnerConfig } from './cli.js'
export async function fetchMrDetail(cfg: RunnerConfig, fetcher: typeof fetch = fetch) {
  const url = `${cfg.gitlabBaseUrl}/api/v4/projects/${cfg.sourceProjectId}/merge_requests/${cfg.mrIid}`
  const res = await fetcher(url, { headers: { 'PRIVATE-TOKEN': cfg.gitlabToken } })
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
  const j = await res.json() as any
  return { title: j.title, description: j.description, headSha: j.sha ?? j.diff_refs?.head_sha, sourceBranch: j.source_branch }
}
export async function fetchMrChanges(cfg: RunnerConfig, fetcher: typeof fetch = fetch) {
  const base = `${cfg.gitlabBaseUrl}/api/v4/projects/${cfg.sourceProjectId}/merge_requests/${cfg.mrIid}`
  // reuse orchestrator's versioned snapshot logic if available; otherwise simple /changes
  const res = await fetcher(`${base}/changes`, { headers: { 'PRIVATE-TOKEN': cfg.gitlabToken } })
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
  const j = await res.json() as any
  return { diffRefs: j.diff_refs, changes: j.changes }
}
export async function fetchExistingDiscussions(cfg: RunnerConfig, fetcher: typeof fetch = fetch) {
  const url = `${cfg.gitlabBaseUrl}/api/v4/projects/${cfg.sourceProjectId}/merge_requests/${cfg.mrIid}/discussions`
  const res = await fetcher(url, { headers: { 'PRIVATE-TOKEN': cfg.gitlabToken } })
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
  return await res.json() as unknown[]
}
