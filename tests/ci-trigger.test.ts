import { describe, it, expect, vi } from 'vitest'
import { parseCiEnvConfig, fetchMrSourceBranch, runCiTrigger } from '../src/host/providers/ci-trigger.js'

describe('parseCiEnvConfig', () => {
  it('parses required env vars and defaults mode/dryRun', () => {
    const cfg = parseCiEnvConfig({
      GITLAB_HOST: 'gitlab.example.com', MAESTRO_GITLAB_TOKEN: 'glpat-xxx',
      SOURCE_PROJECT_ID: '123', MR_IID: '456',
    })
    expect(cfg).toEqual({
      gitlabBaseUrl: 'https://gitlab.example.com', gitlabToken: 'glpat-xxx',
      sourceProjectId: 123, mrIid: 456, mode: 'quick', dryRun: false,
    })
  })

  it('throws on missing token', () => {
    expect(() => parseCiEnvConfig({ GITLAB_HOST: 'h', SOURCE_PROJECT_ID: '1', MR_IID: '2' })).toThrow()
  })

  it('parses REVIEW_MODE=deep and REVIEW_DRY_RUN=1', () => {
    const cfg = parseCiEnvConfig({
      GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 't', SOURCE_PROJECT_ID: '1', MR_IID: '2',
      REVIEW_MODE: 'deep', REVIEW_DRY_RUN: '1',
    })
    expect(cfg.mode).toBe('deep')
    expect(cfg.dryRun).toBe(true)
  })
})

describe('fetchMrSourceBranch', () => {
  it('calls /merge_requests/:iid with PRIVATE-TOKEN and returns source_branch', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ source_branch: 'feat/x' }), { status: 200 }))
    const cfg = parseCiEnvConfig({ GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 'tok', SOURCE_PROJECT_ID: '1', MR_IID: '2' })
    const branch = await fetchMrSourceBranch(cfg, fetcher as unknown as typeof fetch)
    expect(branch).toBe('feat/x')
    expect(fetcher).toHaveBeenCalledWith('https://h/api/v4/projects/1/merge_requests/2', { headers: { 'PRIVATE-TOKEN': 'tok' } })
  })

  it('throws on non-200', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 }))
    const cfg = parseCiEnvConfig({ GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 'tok', SOURCE_PROJECT_ID: '1', MR_IID: '2' })
    await expect(fetchMrSourceBranch(cfg, fetcher as unknown as typeof fetch)).rejects.toThrow(/GitLab API error 404/)
  })
})

describe('runCiTrigger', () => {
  it('builds a ReviewRequest with trigger "mention" and calls ctx.reviewRunner, then writes report files', async () => {
    const cfg = parseCiEnvConfig({ GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 'tok', SOURCE_PROJECT_ID: '1', MR_IID: '2' })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ source_branch: 'feat/x' }), { status: 200 }))
    let capturedRequest: unknown
    const fakeCtx = { reviewRunner: vi.fn(async (req: unknown) => { capturedRequest = req; return { ok: true, summary: 'done', failures: [], durationMs: 5 } }) }
    const writes: Array<[string, string]> = []
    const fakeWriteFile = (async (path: string, data: string) => { writes.push([path, data]) }) as unknown as typeof import('node:fs/promises').writeFile
    const result = await runCiTrigger(fakeCtx as any, cfg, { fetcher: fetcher as unknown as typeof fetch, writeFile: fakeWriteFile })
    expect(capturedRequest).toEqual({
      projectPath: 'project/1', projectId: 1, mrIid: 2, sourceBranch: 'feat/x',
      trigger: 'mention', mode: 'quick', scope: { kind: 'mr' },
    })
    expect(result.ok).toBe(true)
    expect(writes.map(w => w[0])).toEqual(['review-report.json', 'review-report.md'])
    expect(writes[0][1]).toContain('"summary": "done"')
  })

  it('prefixes report paths with REVIEW_REPORT_DIR when set (entrypoint cds away)', async () => {
    const cfg = parseCiEnvConfig({ GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 'tok', SOURCE_PROJECT_ID: '1', MR_IID: '2' })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ source_branch: 'feat/x' }), { status: 200 }))
    const fakeCtx = { reviewRunner: vi.fn(async () => ({ ok: true, summary: 'done', failures: [], durationMs: 5 })) }
    const writes: Array<[string, string]> = []
    const fakeWriteFile = (async (path: string, data: string) => { writes.push([path, data]) }) as unknown as typeof import('node:fs/promises').writeFile
    process.env.REVIEW_REPORT_DIR = '/out'
    try {
      await runCiTrigger(fakeCtx as any, cfg, { fetcher: fetcher as unknown as typeof fetch, writeFile: fakeWriteFile })
    } finally {
      delete process.env.REVIEW_REPORT_DIR
    }
    expect(writes.map(w => w[0])).toEqual(['/out/review-report.json', '/out/review-report.md'])
  })
})
