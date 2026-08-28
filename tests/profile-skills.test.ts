import { describe, it, expect } from 'vitest'
import { REVIEW_PROFILE_SKILLS, MAESTRO_SKILLS_INSTALL_COMMAND } from '../src/host/skills-tool.js'

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
