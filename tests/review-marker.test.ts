import { describe, it, expect } from 'vitest'
import { reviewMarker, parseReviewMarker, resolveFlow } from '../src/host/review-marker.js'

describe('review-marker', () => {
  it('round-trips sha/flow/status', () => {
    const m = reviewMarker('abc123', 'ci-deep')
    expect(m).toBe('<!-- maestro-review sha=abc123 flow=ci-deep status=completed -->')
    expect(parseReviewMarker(`## hi\n\n${m}\n`)).toEqual({ sha: 'abc123', flow: 'ci-deep', status: 'completed' })
  })
  it('returns undefined for bodies without a marker', () => {
    expect(parseReviewMarker('## 🤖 Maestro Review\nno marker')).toBeUndefined()
  })
  it('returns undefined for a malformed marker', () => {
    expect(parseReviewMarker('<!-- maestro-review sha= flow=ci-deep status=completed -->')).toBeUndefined()
  })
  it('resolves webhook outside CI', () => {
    delete process.env.SOURCE_PROJECT_ID
    expect(resolveFlow('deep')).toBe('webhook')
  })
  it('resolves ci-deep inside CI', () => {
    process.env.SOURCE_PROJECT_ID = '1345'
    expect(resolveFlow('deep')).toBe('ci-deep')
    expect(resolveFlow('quick')).toBe('ci-quick')
    delete process.env.SOURCE_PROJECT_ID
  })
})
