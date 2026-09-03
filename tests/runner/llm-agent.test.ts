import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReviewAgent } from '../../src/runner/llm-agent.js'

const mockFetch = vi.fn()
const mockChanges = [
  {
    old_path: 'hero-banner.phtml',
    new_path: 'hero-banner.phtml',
    diff: '@@ -10,7 +10,7 @@\n-<img src="old">\n+<img :src="item.displayImage">',
  },
]

describe('createReviewAgent', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('parses JSON findings array from OpenCode-go response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { file: 'hero-banner.phtml', line: 12, message: 'Lazy-load <img> for LCP. Use loading="lazy".', severity: 'perf' },
                ]),
              },
            },
          ],
        }),
      text: () => Promise.resolve(''),
    } as any)

    const cfg = { provider: 'opencode-go', apiKey: 'sk', baseUrl: 'https://api.openode.ai/v1', model: 'muse-spark-1.3-contributor', mode: 'quick' as const }
    const result = await createReviewAgent(cfg, mockChanges, mockFetch)

    expect(result.findings.length).toBe(1)
    expect(result.findings[0]).toMatchObject({ path: 'hero-banner.phtml', message: /Lazy-load/ })
  })

  it('falls back to summary when LLM returns non-JSON / prose', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Some prose review without JSON.' } }] }),
      text: () => Promise.resolve(''),
    } as any)

    const cfg = { provider: 'opencode-go', apiKey: 'sk', baseUrl: 'https://api.openode.ai/v1', model: 'muse-spark-1.3-contributor', mode: 'quick' as const }
    const result = await createReviewAgent(cfg, mockChanges, mockFetch)

    expect(result.findings.length).toBe(0)
    expect(result.summary).toMatch(/no findings/)
  })

  it('returns graceful summary on API errors (no crash)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') } as any)

    const cfg = { provider: 'opencode-go', apiKey: 'bad', baseUrl: 'https://api.openode.ai/v1', model: 'muse-spark-1.3-contributor', mode: 'quick' as const }
    const result = await createReviewAgent(cfg, mockChanges, mockFetch)

    expect(result.findings.length).toBe(0)
    expect(result.summary).toMatch(/failed/i)
  })
})
