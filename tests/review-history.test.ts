import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { listReviews, pruneHistory, recordReviewFinish, recordReviewStart } from '../src/host/review-history.js'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'hist-'))
}

function entry(id: string, startedAt: number) {
  return {
    id, projectId: 1345, projectPath: 'app/example-group/example-project', mrIid: 30,
    mode: 'quick' as const, scope: 'mr' as const, trigger: 'push' as const, startedAt,
  }
}

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

afterEach(() => {
  vi.useRealTimers()
})

describe('D3 prune race', () => {
  it('prune keeps a fresh running entry even with sub-hour retention', async () => {
    const h = home()
    // 1h old: younger than the 2h stale threshold (stays running), older than
    // a 0.01-day (~14min) retention cutoff — current code drops it while live.
    await recordReviewStart(entry('live-running', Date.now() - HOUR_MS), h)
    await pruneHistory(0.01, h)
    const kept = (await listReviews(20, h)).find((e) => e.id === 'live-running')
    expect(kept).toBeDefined()
    expect(kept!.status).toBe('running')
  })

  it('concurrent start + prune never loses the running entry', async () => {
    const h = home()
    await Promise.all([
      recordReviewStart(entry('racer', Date.now()), h),
      pruneHistory(7, h),
    ])
    expect((await listReviews(20, h)).map((e) => e.id)).toContain('racer')
  })

  it('prune still drops old finished entries', async () => {
    const h = home()
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() - 30 * DAY_MS)
    await recordReviewStart(entry('old-done', Date.now()), h)
    await recordReviewFinish('old-done', { status: 'completed', summary: 'x' }, h)
    vi.useRealTimers()
    await pruneHistory(7, h)
    expect((await listReviews(20, h)).map((e) => e.id)).not.toContain('old-done')
  })
})
