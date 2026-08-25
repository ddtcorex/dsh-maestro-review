/**
 * MR award-emoji acknowledgements: the MR shows "eyes" while a review runs and
 * a final marker when it completes or fails. Signalling is best-effort — any
 * GitLab error is swallowed so it can never fail the review itself.
 */

export interface ReviewSignals {
  start(): Promise<void>
  finish(outcome: 'completed' | 'failed'): Promise<void>
}

async function award(baseUrl: string, token: string, projectId: number, mrIid: number, name: string): Promise<void> {
  await fetch(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** Remove only this bot's stale running markers; other users' awards stay untouched. */
async function unawardOwn(baseUrl: string, token: string, projectId: number, mrIid: number, botUsername: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji`, {
    headers: { 'PRIVATE-TOKEN': token },
  })
  if (!response.ok) return
  const awards = (await response.json()) as Array<{ id?: number; name?: string; user?: { username?: string } }>
  for (const awardItem of Array.isArray(awards) ? awards : []) {
    if (awardItem.name !== 'eyes' || awardItem.user?.username !== botUsername || typeof awardItem.id !== 'number') continue
    await fetch(`${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/award_emoji/${awardItem.id}`, {
      method: 'DELETE',
      headers: { 'PRIVATE-TOKEN': token },
    }).catch(() => {})
  }
}

export function createReviewSignals(options: { baseUrl: string; token: string; projectId: number; mrIid: number; botUsername: string }): ReviewSignals {
  const { baseUrl, token, projectId, mrIid, botUsername } = options
  return {
    async start() {
      try {
        await unawardOwn(baseUrl, token, projectId, mrIid, botUsername)
        await award(baseUrl, token, projectId, mrIid, 'eyes')
      } catch { /* signalling must never break the review */ }
    },
    async finish(outcome) {
      try {
        await unawardOwn(baseUrl, token, projectId, mrIid, botUsername)
        await award(baseUrl, token, projectId, mrIid, outcome === 'completed' ? 'white_check_mark' : 'warning')
      } catch { /* signalling must never break the review */ }
    },
  }
}
