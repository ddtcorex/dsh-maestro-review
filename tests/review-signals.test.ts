import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReviewSignals } from '../src/host/review-signals.js'

describe('review-signals', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('logs when clearing the running marker fails, instead of swallowing it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const signals = createReviewSignals({
      baseUrl: 'https://gitlab.example.com',
      token: 'tok',
      projectId: 1,
      mrIid: 2,
      botUsername: 'maestro-bot',
    })
    await signals.start()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('review-signals'), expect.anything())
  })

  it('logs when awarding the final marker fails, instead of swallowing it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      // unawardOwn's GET listing succeeds with no matching awards
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      // the award POST itself fails
      .mockRejectedValueOnce(new Error('timeout'))
    vi.stubGlobal('fetch', fetchMock)

    const signals = createReviewSignals({
      baseUrl: 'https://gitlab.example.com',
      token: 'tok',
      projectId: 1,
      mrIid: 2,
      botUsername: 'maestro-bot',
    })
    await signals.finish('completed')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('review-signals'), expect.anything())
  })

  it('does not log anything when both calls succeed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    const signals = createReviewSignals({
      baseUrl: 'https://gitlab.example.com',
      token: 'tok',
      projectId: 1,
      mrIid: 2,
      botUsername: 'maestro-bot',
    })
    await signals.start()
    await signals.finish('failed')

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
