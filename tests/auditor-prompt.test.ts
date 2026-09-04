import { describe, it, expect } from 'vitest'
import { buildAuditorPrompt } from '../src/host/orchestrator.js'

describe('buildAuditorPrompt', () => {
  it('full prompt keeps the environment + test-suite workflow (mapped flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: false })
    expect(prompt).toMatch(/bring up the environment/)
    expect(prompt).toMatch(/run the test suite/)
  })

  it('static prompt drops env/test-suite and tells the auditor to omit that section (CI flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: true })
    expect(prompt).not.toMatch(/bring up the environment/)
    expect(prompt).toMatch(/do not run the test suite/)
    expect(prompt).toMatch(/static/i)
    expect(prompt).toMatch(/omit.*environment.*test suite/i)
  })
})
