import { describe, it, expect } from 'vitest'
import { describeDrop, routeGitlabReviewRequest } from '../src/host/review-intake.js'

function pushBody(oldrev: string) {
  return {
    object_kind: 'merge_request',
    project: { id: 1345, path_with_namespace: 'app/example-group/example-project' },
    object_attributes: {
      iid: 30, action: 'update', source_branch: 'maestro/e2e-push-gate-mtm6b71c', oldrev,
    },
  }
}

describe('D2 drop visibility', () => {
  it('push with gate OFF routes to undefined and names push-gate-off', () => {
    expect(routeGitlabReviewRequest(pushBody('abc'), 'maestro', { pushEnabled: false })).toBeUndefined()
    expect(describeDrop(pushBody('abc'), 'maestro', { pushEnabled: false })).toBe('push-gate-off')
  })
  it('push without new commits is not a gate-off (no oldrev, nothing to re-review)', () => {
    expect(routeGitlabReviewRequest(pushBody(''), 'maestro', { pushEnabled: true })).toBeUndefined()
    expect(describeDrop(pushBody(''), 'maestro', { pushEnabled: true })).toBeUndefined()
  })
  it('routable push has no drop reason', () => {
    const req = routeGitlabReviewRequest(pushBody('abc'), 'maestro', { pushEnabled: true })
    expect(req?.trigger).toBe('push')
    expect(describeDrop(pushBody('abc'), 'maestro', { pushEnabled: true })).toBeUndefined()
  })
  it('body without MR identity names invalid-identity', () => {
    expect(describeDrop({ object_kind: 'merge_request' }, 'maestro', {})).toBe('invalid-identity')
  })
})
