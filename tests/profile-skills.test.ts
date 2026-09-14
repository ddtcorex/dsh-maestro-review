import { describe, it, expect } from 'vitest'
import { REVIEW_PROFILE_SKILLS, MAESTRO_SKILLS_INSTALL_COMMAND, loadedReviewProfile } from '../src/host/skills-tool.js'

describe('loadedReviewProfile', () => {
  // Root-caused 2026-09-14 in two passes against a real MR review:
  // (1) `ctx.agent` (Cordis DI) threw "cannot get property agent without
  // inject" — Cordis's Context proxy throws synchronously on any property
  // nobody registered/injected, crashing the whole review. (2) after
  // guarding that read, every profile-configured review still reported
  // "did not successfully load the required profile" even when the tool
  // had just loaded it correctly — `ctx.agent` is not an actual injectable
  // service anywhere in this composition, so the guarded read always
  // returned undefined. The fix drops Cordis entirely: this now takes the
  // plain Agent object (`handle.agent` / the tool's own `exec.agent` —
  // `ToolExecutionInput.agent`, "set by the agent loop", the same object
  // both sides see), which was reliable the whole time.
  it('returns undefined for a fresh agent with no profile loaded yet', () => {
    expect(loadedReviewProfile({})).toBeUndefined()
  })

  it('returns undefined when there is no agent at all', () => {
    expect(loadedReviewProfile(undefined)).toBeUndefined()
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
