/**
 * Machine-readable review comment identity (spec: coexistence §4-5).
 *
 * Every posted review comment (webhook + CI, quick + deep) ends with an
 * invisible marker so the CI flow can detect "this head SHA already has a
 * completed review" without access to the webhook's history store.
 */

export type ReviewFlow = 'ci-quick' | 'ci-deep' | 'webhook'

export function reviewMarker(sha: string, flow: ReviewFlow): string {
  return `<!-- maestro-review sha=${sha} flow=${flow} status=completed -->`
}

export function parseReviewMarker(body: string): { sha: string; flow: string; status: string } | undefined {
  const m = /<!-- maestro-review sha=([0-9a-fA-F]+) flow=([a-z-]+) status=([a-z]+) -->/.exec(body)
  if (!m) return undefined
  return { sha: m[1], flow: m[2], status: m[3] }
}

/** CI detection is env-based (established pattern): the reviewer job always sets these. */
export function resolveFlow(mode: 'quick' | 'deep'): ReviewFlow {
  if (process.env.SOURCE_PROJECT_ID === undefined) return 'webhook'
  return mode === 'deep' ? 'ci-deep' : 'ci-quick'
}
