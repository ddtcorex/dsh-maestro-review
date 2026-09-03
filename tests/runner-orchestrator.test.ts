import { describe, it, expect, vi } from 'vitest'
import { runOnce } from '../src/runner/runner-orchestrator.js'
describe('runOnce dry-run', () => {
  it('does not POST comment when dryRun is true, but returns summary', async () => {
    const cfg = { gitlabBaseUrl:'https://h', gitlabToken:'tok', sourceProjectId:1, mrIid:2, mode:'quick', dryRun:true } as any
    const postComment = vi.fn(async () => {})
    const fetcher = vi.fn(async (url:string) => {
      if (url.includes('/merge_requests/2')) return new Response(JSON.stringify({ title:'T', sha:'abc', source_branch:'b', diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'} }), { status:200 })
      if (url.includes('/changes')) return new Response(JSON.stringify({ diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'}, changes:[] }), { status:200 })
      return new Response('[]', { status:200 })
    }) as any
    const createAgent = vi.fn(async () => ({ summary:'ok', failures:[] }))
    const result = await runOnce(cfg, { fetcher, createAgent: createAgent as any, postComment })
    expect(postComment).not.toHaveBeenCalled()
    expect(result.summary).toBeDefined()
  })
})
