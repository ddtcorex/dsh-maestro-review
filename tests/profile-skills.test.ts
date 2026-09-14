import { describe, it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { REVIEW_PROFILE_SKILLS, MAESTRO_SKILLS_INSTALL_COMMAND, loadedReviewProfile } from '../src/host/skills-tool.js'

describe('loadedReviewProfile', () => {
  // Root-caused 2026-09-14: a real MR review failed with "cannot get
  // property agent without inject" — Cordis's Context proxy throws
  // synchronously on any property nobody registered/injected, so a plain
  // `ctx.agent === undefined` check re-throws instead of ever reaching the
  // `=== undefined` comparison. Reproduced directly against real Cordis
  // (not a mock): a nested plugin context lacking an `agent` service always
  // throws on `.agent`, matching whatever mounted the reviewer's agent
  // preset when the framework's own `agent` service wasn't registered yet.
  it('returns undefined instead of throwing when the context has no injected agent service', async () => {
    const root = new Context()
    let result: ReturnType<typeof loadedReviewProfile> | 'threw' = 'threw'
    await root.plugin((ctx) => {
      result = loadedReviewProfile(ctx)
    })
    expect(result).toBeUndefined()
  })
})

describe('magento2 review skill profile', () => {
  it('loads the frontend/hyva skills alongside the backend passes', () => {
    const profile = REVIEW_PROFILE_SKILLS.magento2
    expect(profile).toContain('magento2-frontend-dev')
    expect(profile).toContain('magento2-hyva-dev')
    // Dependency order: dev-core must come before the skills that depend on it.
    expect(profile.indexOf('magento2-dev-core')).toBeLessThan(profile.indexOf('magento2-frontend-dev'))
    expect(profile.indexOf('magento2-dev-core')).toBeLessThan(profile.indexOf('magento2-hyva-dev'))
  })

  it('installer command provisions the same frontend skills', () => {
    expect(MAESTRO_SKILLS_INSTALL_COMMAND).toContain('magento2-frontend-dev')
    expect(MAESTRO_SKILLS_INSTALL_COMMAND).toContain('magento2-hyva-dev')
  })
})
