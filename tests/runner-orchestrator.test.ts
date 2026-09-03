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
  it('includes LLM findings in posted comment body when findings exist', async () => {
    const cfg = { gitlabBaseUrl:'https://h', gitlabToken:'tok', sourceProjectId:1, mrIid:2, mode:'quick', dryRun:false } as any
    const postComment = vi.fn(async () => {})
    const fetcher = vi.fn(async (url:string) => {
      if (url.includes('/merge_requests/2')) return new Response(JSON.stringify({ title:'T', sha:'abc', source_branch:'b', diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'} }), { status:200 })
      if (url.includes('/changes')) return new Response(JSON.stringify({ diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'}, changes:[{old_path:'a.php',new_path:'a.php',diff:'+x'}] }), { status:200 })
      return new Response('[]', { status:200 })
    }) as any
    const createAgent = vi.fn(async () => ({
      findings: [{ path:'a.php', line:3, message:'Unescaped output — potential XSS', severity:'security' }],
      summary: 'Reviewed 1 file(s).',
    }))
    const result = await runOnce(cfg, { fetcher, createAgent: createAgent as any, postComment })
    // agent called with the changes array
    expect(createAgent).toHaveBeenCalled()
    expect(createAgent.mock.calls[0][1]).toBeDefined()
    // postComment received a body string
    expect(postComment).toHaveBeenCalledTimes(1)
    const body = postComment.mock.calls[0][0] as string
    expect(typeof body).toBe('string')
    expect(body).toContain('Findings')
    expect(body).toContain('a.php')
    expect(body).toContain('XSS')
    expect(result.summary).toContain('Reviewed 1 file')
  })

  it('POSTs comment when dryRun is false', async () => {
    const cfg = { gitlabBaseUrl:'https://h', gitlabToken:'tok', sourceProjectId:1, mrIid:2, mode:'quick', dryRun:false } as any
    const postComment = vi.fn(async () => {})
    const fetcher = vi.fn(async (url:string) => {
      if (url.includes('/merge_requests/2')) return new Response(JSON.stringify({ title:'T', sha:'abc', source_branch:'b', diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'} }), { status:200 })
      if (url.includes('/changes')) return new Response(JSON.stringify({ diff_refs:{base_sha:'b',start_sha:'s',head_sha:'h'}, changes:[] }), { status:200 })
      return new Response('[]', { status:200 })
    }) as any
    const createAgent = vi.fn(async () => ({ findings:[], summary:'ok' }))
    const result = await runOnce(cfg, { fetcher, createAgent: createAgent as any, postComment })
    expect(postComment).toHaveBeenCalled()
    expect(result.summary).toBe('ok')
    expect((result as any).headSha).toBeDefined()
  })
})
