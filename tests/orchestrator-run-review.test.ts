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
