import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('templates', () => {
  it('reviewer template has Protected+Masked hint, no CLI args, and artifacts', () => {
    const yml = readFileSync('templates/reviewer-project.gitlab-ci.yml', 'utf-8')
    expect(yml).toMatch(/MAESTRO_GITLAB_TOKEN/)
    expect(yml).toMatch(/review-report\.json/)
    expect(yml).toMatch(/GIT_STRATEGY: none/)
    expect(yml).toMatch(/script:\s*\n\s*- \/entrypoint\.sh\s*$/m)
    expect(yml).toMatch(/REVIEW_MODEL_PROVIDER/)
    expect(yml).toMatch(/REVIEW_MODEL:/)
    expect(yml).toMatch(/REVIEW_PROFILE/)
  })

  it('source template uses trigger: project and no secrets', () => {
    const yml = readFileSync('templates/source-project.gitlab-ci.yml', 'utf-8')
    expect(yml).toMatch(/trigger:/)
    expect(yml).toMatch(/SOURCE_PROJECT_ID/)
    expect(yml).not.toMatch(/MAESTRO_GITLAB_TOKEN/)
    expect(yml).not.toMatch(/DEEPSEEK_API_KEY/)
  })
})
