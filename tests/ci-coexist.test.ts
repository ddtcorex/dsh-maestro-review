import { describe, it, expect, vi } from 'vitest'
import { hasCompletedReviewForSha, hasRunningEyes } from '../src/host/ci-coexist.js'

const notes = (bodies: string[]) => vi.fn(async () => new Response(JSON.stringify(bodies.map((body, i) => ({ id: i, body }))), { status: 200 }))

describe('ci-coexist', () => {
  it('finds a completed marker for the same SHA', async () => {
    const f = notes(['x <!-- maestro-review sha=abc123 flow=webhook status=completed --> y'])
    await expect(hasCompletedReviewForSha(f as unknown as typeof fetch, 'https://h', 't', 1, 2, 'abc123')).resolves.toBe(true)
    expect(f).toHaveBeenCalledWith('https://h/api/v4/projects/1/merge_requests/2/notes?per_page=100&sort=desc&order_by=created_at', expect.anything())
  })
  it('ignores markers for other SHAs', async () => {
    const f = notes(['<!-- maestro-review sha=deadbee flow=webhook status=completed -->'])
    await expect(hasCompletedReviewForSha(f as unknown as typeof fetch, 'https://h', 't', 1, 2, 'abc123')).resolves.toBe(false)
  })
  it('returns false when notes fetch fails (fail open toward running)', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(hasCompletedReviewForSha(f as unknown as typeof fetch, 'https://h', 't', 1, 2, 'abc123')).resolves.toBe(false)
  })
  it('detects an eyes running marker', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ id: 1, name: 'eyes', user: { username: 'bot' } }]), { status: 200 }))
    await expect(hasRunningEyes(f as unknown as typeof fetch, 'https://h', 't', 1, 2)).resolves.toBe(true)
  })
  it('ignores non-eyes awards', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ id: 1, name: 'white_check_mark', user: { username: 'bot' } }]), { status: 200 }))
    await expect(hasRunningEyes(f as unknown as typeof fetch, 'https://h', 't', 1, 2)).resolves.toBe(false)
  })
})
