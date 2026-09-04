import { describe, it, expect } from 'vitest'
import type { ReviewProvider } from '../src/host/providers/interface.js'
import { describeDrop, routeGitlabReviewRequest } from '../src/host/review-intake.js'

describe('ReviewProvider', () => {
  it('gitlab provider implements interface', async () => {
    const mod = await import('../src/host/providers/gitlab.js')
    const p: ReviewProvider = mod.gitlabProvider
    expect(p.id).toBe('gitlab')
    expect(typeof p.intake).toBe('function')
    expect(typeof p.postFindings).toBe('function')
  })
  it('github stub exists', async () => {
    const mod = await import('../src/host/providers/github.stub.js')
    expect(mod.githubProvider.id).toBe('github')
    expect(typeof mod.githubProvider.intake).toBe('function')
  })
  it('interface shapes are correct', async () => {
    const { gitlabProvider } = await import('../src/host/providers/gitlab.js')
    const req = new Request('http://localhost/hooks/gitlab-mr', {
      method: 'POST',
      body: JSON.stringify({ project: { id: 1, path_with_namespace: 'group/proj' }, object_attributes: { iid: 7, source_branch: 'feat/x' }, object_kind: 'merge_request' }),
    })
    const result = await gitlabProvider.intake(req)
    expect(result.provider).toBe('gitlab')
    expect(typeof result.projectPath).toBe('string')
    expect(typeof result.mrId).toBe('string')
  })
  it('github stub throws not implemented', async () => {
    const { githubProvider } = await import('../src/host/providers/github.stub.js')
    await expect(githubProvider.intake(new Request('http://localhost'))).rejects.toThrow('github not implemented')
    await expect(githubProvider.postFindings([])).rejects.toThrow('not implemented')
  })
})

function pushBody(oldrev: string) {
  return {
    object_kind: 'merge_request',
    project: { id: 1345, path_with_namespace: 'app/onlylyon/visiterlyon' },
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
