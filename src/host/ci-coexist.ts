import { gitlabAuthHeaders } from './gitlab-auth.js'
import { parseReviewMarker } from './review-marker.js'

/**
 * Coexistence checks (spec §4): the CI flow yields to any completed review of
 * the same head SHA (whatever flow posted it) and to an in-flight review
 * (eyes running-marker). Fetch failures fail open toward running — a missing
 * signal must never block a review, only a present one skips it.
 */
export async function hasCompletedReviewForSha(
  fetcher: typeof fetch, baseUrl: string, token: string, projectId: number, mrIid: number, sha: string,
): Promise<boolean> {
  try {
    const res = await fetcher(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes?per_page=100&sort=desc&order_by=created_at`,
      { headers: gitlabAuthHeaders(token) },
    )
    if (!res.ok) return false
    const notes = (await res.json()) as Array<{ body?: string }>
    return notes.some((n) => {
      const m = typeof n.body === 'string' ? parseReviewMarker(n.body) : undefined
      return m?.sha.toLowerCase() === sha.toLowerCase() && m?.status === 'completed'
    })
  } catch {
    return false
  }
}

export async function hasRunningEyes(
  fetcher: typeof fetch, baseUrl: string, token: string, projectId: number, mrIid: number,
): Promise<boolean> {
  try {
    const res = await fetcher(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji`,
      { headers: gitlabAuthHeaders(token) },
    )
    if (!res.ok) return false
    const awards = (await res.json()) as Array<{ name?: string }>
    return awards.some((a) => a.name === 'eyes')
  } catch {
    return false
  }
}
