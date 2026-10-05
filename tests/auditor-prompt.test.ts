import { describe, it, expect } from 'vitest'
import { buildAuditorPrompt } from '../src/host/orchestrator.js'

describe('buildAuditorPrompt', () => {
  it('full prompt is a report-only diff review with no environment or test-suite steps (mapped flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: false })
    expect(prompt).not.toMatch(/bring up/i)
    expect(prompt).not.toMatch(/tear/i)
    expect(prompt).not.toMatch(/run the test suite/i)
    expect(prompt).toMatch(/diff/i)
    expect(prompt).toMatch(/Markdown report/)
  })

  it('static prompt drops env/test-suite and tells the auditor to omit that section (CI flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: true })
    expect(prompt).not.toMatch(/bring up the environment/)
    expect(prompt).toMatch(/do not run the test suite/)
    expect(prompt).toMatch(/static/i)
    expect(prompt).toMatch(/omit.*environment.*test suite/i)
  })
})
