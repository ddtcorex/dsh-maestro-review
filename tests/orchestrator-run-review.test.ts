import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/host/config-store.js', () => ({ loadUserConfig: vi.fn(async () => ({})) }))
// Hermetic: the repository settings read never reaches the network.
vi.mock('@ddtcorex/maestro-reviewer/lib/ci-repo-settings.js', () => ({ loadRepoSettings: vi.fn(async () => ({ file: {}, warnings: [] })) }))
// Hermetic: no GitLab request and no report written under the real home.
vi.mock('@ddtcorex/maestro-reviewer/lib/engine.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/engine.js')>()
  return { ...mod, writeFailedReport: vi.fn(async () => {}) }
})
const forge = {
  mrHeadSha: vi.fn(async () => undefined), mrBaseSha: vi.fn(async () => undefined), compare: vi.fn(async () => undefined),
  postNote: vi.fn(async () => {}), replyToDiscussion: vi.fn(async () => {}), postFindings: vi.fn(async () => {}),
  signals: vi.fn(() => ({ start: async () => {}, finish: async () => {} })), mountAgentTools: vi.fn(async () => {}),
}
vi.mock('@ddtcorex/maestro-reviewer/lib/forge/gitlab/index.js', () => ({ gitlabForge: vi.fn(() => forge) }))
vi.mock('../src/host/notify.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/host/notify.js')>()
  return { ...mod, reviewDigestText: vi.fn(() => 'digest') }
})
vi.mock('@ddtcorex/maestro-reviewer/lib/ci-clone.js', () => ({
  cloneSourceRepo: vi.fn(async (opts: any) => opts.dir),
  defaultRun: vi.fn(async () => {}),
  redactCloneUrl: (u: string) => u,
}))
// runReview writes history to disk — stub the store so tests stay hermetic
// (existing tests in this file return before reaching it).
vi.mock('@ddtcorex/maestro-reviewer/lib/review-history.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/review-history.js')>()
  return {
    ...mod,
    recordReviewStart: vi.fn(async () => {}),
    recordReviewFinish: vi.fn(async () => {}),
    lastCompletedReview: vi.fn(async () => undefined),
  }
})

describe('orchestrator.apply — reviewRunner wiring', () => {
  it('registers the maestro/review-request event handler and provides reviewRunner', async () => {
    const { apply } = await import('../src/host/host-orchestrator.js')
    const onCalls: string[] = []
    const provideCalls: string[] = []
    const fakeCtx = {
      on: (event: string, _handler: unknown) => { onCalls.push(event) },
      provide: (name: string, _value: unknown) => { provideCalls.push(name) },
    }
    apply(fakeCtx as any, {
      projectMappings: [],
      gitlabBaseUrl: 'https://gitlab.example.com',
      botUsername: 'maestro-bot',
      agentTimeoutMs: 1000,
    })
    expect(onCalls).toContain('maestro/review-request')
    expect(provideCalls).toContain('reviewRunner')
  })

  it('runReview resolves { ok: true, failures: [] } without touching agents for an unmapped, non-mention trigger', async () => {
    const { apply } = await import('../src/host/host-orchestrator.js')
    let runReview: ((payload: any) => Promise<any>) | undefined
    const fakeCtx = {
      on: () => {},
      provide: (name: string, fn: any) => { if (name === 'reviewRunner') runReview = fn },
    }
    apply(fakeCtx as any, { projectMappings: [], gitlabBaseUrl: 'https://gitlab.example.com', botUsername: 'maestro-bot', agentTimeoutMs: 1000 })
    const result = await runReview!({
      projectPath: 'group/proj', projectId: 1, mrIid: 2, sourceBranch: 'feat/x',
      trigger: 'reviewer-assignment', mode: 'quick', scope: { kind: 'mr' },
    })
    expect(result).toEqual({ ok: true, failures: [], durationMs: expect.any(Number) })
  })

  it('runReview resolves { ok: false } with a failure message when no GitLab token is configured', async () => {    const { apply } = await import('../src/host/host-orchestrator.js')
    let runReview: ((payload: any) => Promise<any>) | undefined
    const fakeCtx = {
      on: () => {},
      provide: (name: string, fn: any) => { if (name === 'reviewRunner') runReview = fn },
    }
    apply(fakeCtx as any, { projectMappings: [], gitlabBaseUrl: 'https://gitlab.example.com', botUsername: 'maestro-bot', agentTimeoutMs: 1000 })
    const result = await runReview!({
      projectPath: 'group/proj', projectId: 1, mrIid: 2, sourceBranch: 'feat/x',
      trigger: 'mention', mode: 'quick', scope: { kind: 'mr' },
    })
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/no GitLab token/)
  })
})

describe('host access decision', () => {
  function host(mappings: unknown[] = []) {
    const run = vi.fn(async () => ({ ok: true, summary: 'done', failures: [], durationMs: 1 }))
    let runReview: ((payload: any) => Promise<any>) | undefined
    return import('../src/host/host-orchestrator.js').then(({ apply }) => {
      apply({ on: () => {}, provide: (name: string, fn: any) => { if (name === 'reviewRunner') runReview = fn }, reviewEngine: { run } } as any,
        { projectMappings: mappings as any, gitlabBaseUrl: 'https://gitlab.example.com', botUsername: 'b', agentTimeoutMs: 1000, gitlabToken: 't' })
      return { run, runReview: (p: any) => runReview!(p) }
    })
  }
  const mr = (o: Record<string, unknown> = {}) => ({ projectPath: 'group/proj', projectId: 1, mrIid: 2, sourceBranch: 'feat/x', headSha: 'abc123', trigger: 'mention', mode: 'quick', scope: { kind: 'mr' }, ...o })

  it('an unmapped mention reviews the diff, and CI variables in the environment change nothing', async () => {
    const CI_ENV = { SOURCE_PROJECT_ID: '1', MR_IID: '2', GITLAB_HOST: 'gitlab.example.com' }
    Object.assign(process.env, CI_ENV)
    try {
      const { run, runReview } = await host()
      await runReview(mr({ reviewProfile: 'magento2' }))
      expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({ access: { kind: 'diff' }, gitlab: { baseUrl: 'https://gitlab.example.com', token: 't', botUsername: 'b' } })
    } finally { for (const k of Object.keys(CI_ENV)) delete process.env[k] }
  })

  it('a mapped project reviews a prepared worktree with the runtime auditor and its own profile', async () => {
    const { run, runReview } = await host([{ projectPath: 'group/proj', localRepoPath: '/repo', reviewProfile: 'laravel' }])
    await runReview(mr({ mode: 'deep' }))
    const opts = (run.mock.calls[0] as unknown[])[1] as any
    expect(opts.access).toMatchObject({ kind: 'workspace', localRepoPath: '/repo', auditor: 'runtime' })
    expect(typeof opts.access.ensureWorktree).toBe('function')
    expect(opts.reviewProfile).toBe('laravel')
  })

  it('an unmapped deep request is declined without running the engine', async () => {
    const { writeFailedReport } = await import('@ddtcorex/maestro-reviewer/lib/engine.js')
    vi.mocked(writeFailedReport).mockClear(); forge.postNote.mockClear()
    const { run, runReview } = await host()
    const r = await runReview(mr({ mode: 'deep', mrIid: 77 }))
    expect(run).not.toHaveBeenCalled()
    expect(r.summary).toMatch(/declined/)
    expect(forge.postNote).toHaveBeenCalledTimes(1)
    expect(String(forge.postNote.mock.calls[0][0])).toMatch(/Not started/)
    expect(writeFailedReport).not.toHaveBeenCalled()
  })

  it('the Telegram digest carries the duration the engine measured', async () => {
    const { loadUserConfig } = await import('../src/host/config-store.js')
    const { reviewDigestText } = await import('../src/host/notify.js')
    vi.mocked(loadUserConfig).mockResolvedValueOnce({ telegramReviewNotifications: true } as any)
    const send = vi.fn(async () => ({ sent: true }))
    const run = vi.fn(async (_p: unknown, opts: any) => { opts.notify('completed', 'ok', 1234); return { ok: true, summary: 'ok', failures: [], durationMs: 1 } })
    let runReview: ((payload: any) => Promise<any>) | undefined
    const { apply } = await import('../src/host/host-orchestrator.js')
    apply({ on: () => {}, provide: (n: string, fn: any) => { if (n === 'reviewRunner') runReview = fn }, reviewEngine: { run }, get: (n: string) => n === 'maestroNotifier' ? { send } : undefined } as any,
      { projectMappings: [], gitlabBaseUrl: 'https://gitlab.example.com', botUsername: 'b', agentTimeoutMs: 1000, gitlabToken: 't' })
    await runReview!(mr())
    expect(send).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reviewDigestText).mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed', summary: 'ok', durationMs: 1234 })
  })
})

describe('resolveReviewModel — row-config reviewModel', () => {  it('uses the row selection when mapping and user config are absent (CI profile case)', async () => {
    const { resolveReviewModel } = await import('../src/host/host-orchestrator.js')
    expect(resolveReviewModel({}, undefined,
      { provider: 'fallback', model: 'fallback' },
      { provider: 'opencode-go', model: 'muse-spark-1.3-contributor' }),
    ).toEqual({ provider: 'opencode-go', model: 'muse-spark-1.3-contributor' })
  })

  it('prefers user config over the row selection', async () => {
    const { resolveReviewModel } = await import('../src/host/host-orchestrator.js')
    expect(resolveReviewModel({ reviewModel: { provider: 'u', model: 'um' } }, undefined,
      { provider: 'fallback', model: 'fallback' },
      { provider: 'row', model: 'rowm' }),
    ).toEqual({ provider: 'u', model: 'um' })
  })

  it('prefers mapping override over the row selection', async () => {
    const { resolveReviewModel } = await import('../src/host/host-orchestrator.js')
    expect(resolveReviewModel({}, { reviewModel: { provider: 'm', model: 'mm' } },
      { provider: 'fallback', model: 'fallback' },
      { provider: 'row', model: 'rowm' }),
    ).toEqual({ provider: 'm', model: 'mm' })
  })

  it('falls back to the host default when all three are absent', async () => {
    const { resolveReviewModel } = await import('../src/host/host-orchestrator.js')
    expect(resolveReviewModel({}, undefined,
      { provider: 'fallback', model: 'fallback' }, undefined),
    ).toEqual({ provider: 'fallback', model: 'fallback' })
  })
})

describe('Config — boot contract', () => {
  // Regression: a declared-but-optional object schema still descends in
  // schemastery, so the row reviewModel must stay undeclared (passthrough)
  // or every boot without REVIEW_MODEL_* fails. Caught by container E2E.
  it('validates without reviewModel (CI boots with no REVIEW_MODEL_*)', async () => {
    const { Config } = await import('../src/host/host-orchestrator.js')
    expect(() => Config({
      projectMappings: [], gitlabBaseUrl: 'https://gitlab.example.com',
      botUsername: 'maestro-bot', agentTimeoutMs: 1000,
    })).not.toThrow()
  })
})
