import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveReviewTriggers, apply } from '../src/host/host-orchestrator.js'
import { loadUserConfig } from '../src/host/config-store.ts'
import { hasCompletedReview, recordReviewStart } from '@ddtcorex/maestro-reviewer/lib/review-history.js'

vi.mock('../src/host/config-store.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/host/config-store.ts')>()
  return { ...orig, loadUserConfig: vi.fn() }
})
vi.mock('@ddtcorex/maestro-reviewer/lib/review-history.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/review-history.js')>()
  return {
    ...orig,
    hasCompletedReview: vi.fn(),
    lastCompletedReview: vi.fn(),
    recordReviewStart: vi.fn(),
    recordReviewFinish: vi.fn(),
    pruneHistory: vi.fn(),
  }
})

describe('resolveReviewTriggers', () => {
  it('defaults to assign-ON push-OFF', () => {
    expect(resolveReviewTriggers({})).toEqual({ onPush: false, onAssign: true })
  })
  it('global flags apply without a mapping', () => {
    expect(resolveReviewTriggers({ autoRereviewOnPush: true, autoReviewOnAssign: false }))
      .toEqual({ onPush: true, onAssign: false })
  })
  it('row overrides beat globals', () => {
    expect(resolveReviewTriggers(
      { autoRereviewOnPush: true, autoReviewOnAssign: true },
      { projectPath: 'g', localRepoPath: '/x', rereviewOnPush: false, reviewOnAssign: false },
    )).toEqual({ onPush: false, onAssign: false })
  })
  it('unset row inherits globals', () => {
    expect(resolveReviewTriggers(
      { autoRereviewOnPush: true },
      { projectPath: 'g', localRepoPath: '/x' },
    )).toEqual({ onPush: true, onAssign: true })
  })
})

describe('runReview trigger gates (silent skip)', () => {
  const handlers: Record<string, (p: any) => void> = {}
  // A real engine stand-in: without it a gate that fails open would throw
  // inside runReview and the silence assertions would pass vacuously.
  const run = vi.fn(async () => ({ ok: true, summary: 'done', failures: [], durationMs: 1 }))
  const ctx = {
    on: (ev: string, fn: (p: any) => void): void => { handlers[ev] = fn },
    provide: (): void => {},
    reviewEngine: { run },
  }
  const flush = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 50))
  }
  const base = { projectPath: 'g/p', projectId: 1, mrIid: 2, sourceBranch: 'b', mode: 'quick', scope: { kind: 'mr' } } as const

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasCompletedReview).mockResolvedValue(true)
    apply(ctx as any, { agentTimeoutMs: 60000 } as any)
  })

  it('assignment with onAssign=false stays silent (no history, no fetch)', async () => {
    vi.mocked(loadUserConfig).mockResolvedValue({
      gitlabBaseUrl: 'https://g', gitlabToken: 't', botUsername: 'b',
      projectMappings: [{ projectPath: 'g/p', localRepoPath: '/x', reviewOnAssign: false }],
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'))
    handlers['maestro/review-request']({ ...base, trigger: 'reviewer-assignment' })
    await flush()
    expect(recordReviewStart).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('push with onPush=false stays silent (no history, no fetch)', async () => {
    vi.mocked(loadUserConfig).mockResolvedValue({
      gitlabBaseUrl: 'https://g', gitlabToken: 't', botUsername: 'b',
      projectMappings: [{ projectPath: 'g/p', localRepoPath: '/x', rereviewOnPush: false }],
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'))
    handlers['maestro/review-request']({ ...base, trigger: 'push' })
    await flush()
    expect(recordReviewStart).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('push with onPush=true but no completed review in history stays silent', async () => {
    vi.mocked(hasCompletedReview).mockResolvedValue(false)
    vi.mocked(loadUserConfig).mockResolvedValue({
      gitlabBaseUrl: 'https://g', gitlabToken: 't', botUsername: 'b',
      projectMappings: [{ projectPath: 'g/p', localRepoPath: '/x', rereviewOnPush: true }],
    })
    handlers['maestro/review-request']({ ...base, trigger: 'push' })
    await flush()
    expect(hasCompletedReview).toHaveBeenCalledWith(1, 2)
    expect(run).not.toHaveBeenCalled()
  })

  it('the same requests run the engine once their gate is open (the silence above is real)', async () => {
    vi.mocked(loadUserConfig).mockResolvedValue({
      gitlabBaseUrl: 'https://g', gitlabToken: 't', botUsername: 'b',
      projectMappings: [{ projectPath: 'g/p', localRepoPath: '/x', reviewOnAssign: true, rereviewOnPush: true }],
    })
    handlers['maestro/review-request']({ ...base, trigger: 'reviewer-assignment' })
    handlers['maestro/review-request']({ ...base, trigger: 'push' })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
