import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/host/config-store.js', () => ({ loadUserConfig: async () => ({}) }))

describe('orchestrator.apply — reviewRunner wiring', () => {
  it('registers the maestro/review-request event handler and provides reviewRunner', async () => {
    const { apply } = await import('../src/host/orchestrator.js')
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
    const { apply } = await import('../src/host/orchestrator.js')
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

  it('runReview resolves { ok: false } with a failure message when no GitLab token is configured', async () => {
    const { apply } = await import('../src/host/orchestrator.js')
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

describe('resolveReviewModel — row-config reviewModel', () => {  it('uses the row selection when mapping and user config are absent (CI profile case)', async () => {
    const { resolveReviewModel } = await import('../src/host/orchestrator.js')
    expect(resolveReviewModel({}, undefined,
      { provider: 'fallback', model: 'fallback' },
      { provider: 'opencode-go', model: 'muse-spark-1.3-contributor' }),
    ).toEqual({ provider: 'opencode-go', model: 'muse-spark-1.3-contributor' })
  })

  it('prefers user config over the row selection', async () => {
    const { resolveReviewModel } = await import('../src/host/orchestrator.js')
    expect(resolveReviewModel({ reviewModel: { provider: 'u', model: 'um' } }, undefined,
      { provider: 'fallback', model: 'fallback' },
      { provider: 'row', model: 'rowm' }),
    ).toEqual({ provider: 'u', model: 'um' })
  })

  it('prefers mapping override over the row selection', async () => {
    const { resolveReviewModel } = await import('../src/host/orchestrator.js')
    expect(resolveReviewModel({}, { reviewModel: { provider: 'm', model: 'mm' } },
      { provider: 'fallback', model: 'fallback' },
      { provider: 'row', model: 'rowm' }),
    ).toEqual({ provider: 'm', model: 'mm' })
  })

  it('falls back to the host default when all three are absent', async () => {
    const { resolveReviewModel } = await import('../src/host/orchestrator.js')
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
    const { Config } = await import('../src/host/orchestrator.js')
    expect(() => Config({
      projectMappings: [], gitlabBaseUrl: 'https://gitlab.example.com',
      botUsername: 'maestro-bot', agentTimeoutMs: 1000,
    })).not.toThrow()
  })
})
