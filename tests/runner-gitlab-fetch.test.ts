import { describe, it, expect, vi } from 'vitest'
import { fetchMrDetail } from '../src/runner/gitlab-fetch.js'
describe('fetchMrDetail', () => {
  it('calls /merge_requests/:iid with PRIVATE-TOKEN and parses head_sha', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ title:'T', sha:'abc', source_branch:'feat/x' }), { status:200 }))
    // minimal mock — real impl checks sha fields
    const cfg = { gitlabBaseUrl:'https://h', gitlabToken:'tok', sourceProjectId:1, mrIid:2 } as any
    // will fail until implemented
    await expect(fetchMrDetail(cfg, fetcher)).resolves.toBeDefined()
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/v4/projects/1/merge_requests/2'), expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN':'tok' }) }))
  })
  it('throws on non-200', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status:404 }))
    const cfg = { gitlabBaseUrl:'https://h', gitlabToken:'tok', sourceProjectId:1, mrIid:2 } as any
    await expect(fetchMrDetail(cfg, fetcher)).rejects.toThrow(/GitLab API error 404/)
  })
})
