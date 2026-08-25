import { describe, it, expect } from 'vitest'
import type { ReviewProvider } from '../src/providers/interface.js'

describe('ReviewProvider', () => {
  it('gitlab provider implements interface', async () => {
    const mod = await import('../src/providers/gitlab.js')
    const p: ReviewProvider = mod.gitlabProvider
    expect(p.id).toBe('gitlab')
    expect(typeof p.intake).toBe('function')
    expect(typeof p.postFindings).toBe('function')
  })
  it('github stub exists', async () => {
    const mod = await import('../src/providers/github.stub.js')
    expect(mod.githubProvider.id).toBe('github')
    expect(typeof mod.githubProvider.intake).toBe('function')
  })
  it('interface shapes are correct', async () => {
    const { gitlabProvider } = await import('../src/providers/gitlab.js')
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
    const { githubProvider } = await import('../src/providers/github.stub.js')
    await expect(githubProvider.intake(new Request('http://localhost'))).rejects.toThrow('github not implemented')
    await expect(githubProvider.postFindings([])).rejects.toThrow('not implemented')
  })
})
