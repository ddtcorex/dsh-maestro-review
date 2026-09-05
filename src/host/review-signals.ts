/**
 * MR award-emoji acknowledgements: the MR shows "eyes" while a review runs and
 * a final marker when it completes or fails. Signalling is best-effort — any
 * GitLab error is swallowed so it can never fail the review itself.
 */

import { gitlabAuthHeaders } from './gitlab-auth.js'
import { fetchWithTimeout } from './gitlab-client.js'

export interface ReviewSignals {
  start(): Promise<void>
  finish(outcome: 'completed' | 'failed'): Promise<void>
}

async function award(baseUrl: string, token: string, projectId: number, mrIid: number, name: string): Promise<void> {
  const response = await fetchWithTimeout(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji`, {
    method: 'POST',
    headers: { ...gitlabAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  // fetchWithTimeout only throws on a network/abort failure; a non-2xx status
  // (expired token, missing scope, rate-limited) resolves normally and must
  // be checked explicitly, or the caller's failure logging never fires.
  if (!response.ok) throw new Error(`GitLab API error ${response.status} awarding "${name}": ${await response.text()}`)
}

/** Remove only this bot's stale running markers; other users' awards stay untouched. */
async function unawardOwn(baseUrl: string, token: string, projectId: number, mrIid: number, botUsername: string): Promise<void> {
  const response = await fetchWithTimeout(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji`, {
    headers: gitlabAuthHeaders(token),
  })
  if (!response.ok) throw new Error(`GitLab API error ${response.status} listing award emoji: ${await response.text()}`)
  const awards = (await response.json()) as Array<{ id?: number; name?: string; user?: { username?: string } }>
  for (const awardItem of Array.isArray(awards) ? awards : []) {
    if (awardItem.name !== 'eyes' || awardItem.user?.username !== botUsername || typeof awardItem.id !== 'number') continue
    const deleteResponse = await fetchWithTimeout(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji/${awardItem.id}`, {
      method: 'DELETE',
      headers: gitlabAuthHeaders(token),
    }).catch((err: unknown) => {
      console.error(`review-signals: failed to delete stale eyes marker ${awardItem.id} on MR !${mrIid}`, err)
      return undefined
    })
    if (deleteResponse !== undefined && !deleteResponse.ok) {
      console.error(`review-signals: GitLab API error ${deleteResponse.status} deleting stale eyes marker ${awardItem.id} on MR !${mrIid}`)
    }
  }
}

export function createReviewSignals(options: { baseUrl: string; token: string; projectId: number; mrIid: number; botUsername: string }): ReviewSignals {
  const { baseUrl, token, projectId, mrIid, botUsername } = options
  return {
    async start() {
      try {
        await unawardOwn(baseUrl, token, projectId, mrIid, botUsername)
        await award(baseUrl, token, projectId, mrIid, 'eyes')
      } catch (err) {
        // Signalling must never break the review, but a swallowed failure
        // here is exactly what leaves a stale "eyes" marker stuck on the MR
        // forever (blocking the push-gate's 👀-running check for both the
        // webhook and CI flows) with zero trace of why — log it.
        console.error(`review-signals: failed to set the running marker on MR !${mrIid}`, err)
      }
    },
    async finish(outcome) {
      try {
        await unawardOwn(baseUrl, token, projectId, mrIid, botUsername)
        await award(baseUrl, token, projectId, mrIid, outcome === 'completed' ? 'white_check_mark' : 'warning')
      } catch (err) {
        console.error(`review-signals: failed to clear the running marker / award the final marker on MR !${mrIid}`, err)
      }
    },
  }
}
