import { describe, expect, it } from 'vitest'
import { generateWebhookSecret, gitlabWebhookUrl } from '../src/host/webhook-secret.js'

describe('webhook secret', () => {
  it('produces a 32-character base64url secret', () => {
    const secret = generateWebhookSecret()
    expect(secret).toHaveLength(32)
    expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('maps every byte value into the alphabet, so no character can escape it', () => {
    // Every byte value 0..255 must map into the base64url alphabet. This is the
    // property that makes a plain `%`, `+`, `/` or `=` impossible, which is
    // what GitLab's token comparison and a URL path segment both need. The
    // double fills only the 32 bytes the caller asked for, with the values
    // that are most likely to break the mapping.
    const hostile = [0, 255, 62, 63, 64, 191, 192, 128, 43, 47, 61, 13, 10, 32, 37, 92]
    const pattern = Array.from({ length: 32 }, (_, i) => hostile[i % hostile.length])
    const secret = generateWebhookSecret(() => new Uint8Array(pattern))
    expect(secret).toHaveLength(32)
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
    // 0x3f -> '_' and 0xfc -> '8' under the & 0b00111111 mapping: the low six
    // bits decide, so a high bit can never smuggle a punctuation character in.
    // 0x3e ('>') and 0x3d ('=') — the two characters a naive base64 encoder
    // would emit here — both land inside the alphabet.
    expect(secret).toBe('A_-_A_AArv9NKglcA_-_A_AArv9NKglc')
  })

  it('is not constant: two calls differ', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
  })

  it('reads the injected source of randomness', () => {
    let called = 0
    generateWebhookSecret(() => {
      called++
      return new Uint8Array(32)
    })
    expect(called).toBe(1)
  })
})

describe('gitlab webhook url', () => {
  it('builds the hook path from the configured hostname', () => {
    expect(gitlabWebhookUrl('tunnel.example.invalid')).toBe('https://tunnel.example.invalid/hooks/gitlab-mr')
  })

  it('strips a scheme a user pasted into the field', () => {
    expect(gitlabWebhookUrl('https://tunnel.example.invalid')).toBe('https://tunnel.example.invalid/hooks/gitlab-mr')
    expect(gitlabWebhookUrl('http://tunnel.example.invalid')).toBe('https://tunnel.example.invalid/hooks/gitlab-mr')
  })

  it('strips trailing slashes and surrounding whitespace', () => {
    expect(gitlabWebhookUrl('  tunnel.example.invalid///  ')).toBe('https://tunnel.example.invalid/hooks/gitlab-mr')
  })

  it('names the missing value instead of building a broken url', () => {
    expect(gitlabWebhookUrl()).toBe('https://<your-hostname>/hooks/gitlab-mr')
    expect(gitlabWebhookUrl('   ')).toBe('https://<your-hostname>/hooks/gitlab-mr')
  })
})