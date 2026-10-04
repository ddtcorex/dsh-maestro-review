import { describe, expect, it } from 'vitest'
import { detectGovardLint } from '../src/host/govard-lint-detection.js'

describe('detectGovardLint', () => {
  it('is true when the registry resolves govard_audit_lint for the scope', () => {
    const ctx = {
      get: (n: string) => (n === 'tools' ? { get: (name: string) => (name === 'govard_audit_lint' ? {} : undefined) } : undefined),
    }
    expect(detectGovardLint(ctx, { agent: 'a1' })).toBe(true)
  })

  it('is false when the tool is absent', () => {
    const ctx = { get: () => ({ get: () => undefined }) }
    expect(detectGovardLint(ctx, { agent: 'a1' })).toBe(false)
  })

  it('is false when the tools service is missing entirely (a review-only install)', () => {
    expect(detectGovardLint({ get: () => undefined }, { agent: 'a1' })).toBe(false)
  })

  it('is false, never a throw, when the registry cannot be read', () => {
    const ctx = { get: () => ({ get: () => { throw new Error('registry gone') } }) }
    expect(detectGovardLint(ctx, { agent: 'a1' })).toBe(false)
  })

  it('is false when the service object exists but has no get', () => {
    expect(detectGovardLint({ get: () => ({}) }, { agent: 'a1' })).toBe(false)
  })

  it('is false when ctx has no get at all', () => {
    expect(detectGovardLint({}, { agent: 'a1' })).toBe(false)
  })
})