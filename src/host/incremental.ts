export interface CompareCommit {
  short_id?: string
  title?: string
}

export interface CompareDiff {
  new_path?: string
}

/** Shape of GitLab's `GET /repository/compare?from=&to=` response (reduced). */
export interface CompareResult {
  commits?: CompareCommit[]
  diffs?: CompareDiff[]
}

const COMMIT_LIST_CAP = 20

/**
 * Build the incremental-review context block for a re-review: everything that
 * changed since the last completed Maestro pass on this MR. Returns undefined
 * when there is nothing new to say (no prior sha, same sha, or empty compare)
 * so callers can skip the API round-trip cost of the block.
 */
export function buildIncrementalBlock(
  compare: CompareResult | undefined,
  sinceSha: string | undefined,
  nowSha: string | undefined,
): string | undefined {
  if (sinceSha === undefined || nowSha === undefined || sinceSha === nowSha) return undefined
  if (compare === undefined) return undefined
  const commits = compare.commits ?? []
  const diffs = compare.diffs ?? []
  if (commits.length === 0 && diffs.length === 0) return undefined

  const lines: string[] = [
    `This MR was reviewed before (at ${sinceSha.slice(0, 12)}). The following is what changed since then — focus your review on these files and commits, and re-check only open threads whose location falls inside them:`,
  ]
  const shown = commits.slice(0, COMMIT_LIST_CAP)
  for (const commit of shown) {
    const title = commit.title?.replace(/\s+/g, ' ').trim() ?? ''
    lines.push(`- ${commit.short_id ? `${commit.short_id.slice(0, 8)} ` : ''}${title}`)
  }
  const hidden = commits.length - shown.length
  if (hidden > 0) lines.push(`- and ${hidden} more commit(s)`)
  lines.push(`Changed files since last review: ${diffs.length}`)
  return lines.join('\n')
}

/**
 * Cheap head-sha probe: `GET /merge_requests/:iid` returns diff_refs.head_sha
 * without pulling any diff bodies. Degrades to undefined (no incrementality)
 * on any error — re-reviews must never fail because of this optional lookup.
 */
export async function fetchMrDetailHeadSha(
  baseUrl: string, token: string, projectId: number, mrIid: number,
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}`,
      { headers: { 'PRIVATE-TOKEN': token } },
    )
    if (!response.ok) return undefined
    const body = await response.json() as { diff_refs?: { head_sha?: string } }
    return body.diff_refs?.head_sha
  } catch {
    return undefined
  }
}

/** Diff between two MR states, reduced to the fields the prompt block needs. */
export async function fetchCompare(
  baseUrl: string, token: string, projectId: number, from: string, to: string,
): Promise<CompareResult | undefined> {
  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { 'PRIVATE-TOKEN': token } },
    )
    if (!response.ok) return undefined
    return await response.json() as CompareResult
  } catch {
    return undefined
  }
}
