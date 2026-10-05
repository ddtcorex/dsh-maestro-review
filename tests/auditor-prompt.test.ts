import { describe, it, expect } from 'vitest'
import { buildAuditorPrompt } from '../src/host/orchestrator.js'

describe('buildAuditorPrompt', () => {
  it('full prompt drives the environment through govard CLI commands in the shell tool (mapped flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: false })
    expect(prompt).toMatch(/bash tool/)
    expect(prompt).toContain('govard env up')
    expect(prompt).toContain('govard shell -c')
    expect(prompt).toContain('govard env down -v')
    expect(prompt).toMatch(/run the test suite/)
    expect(prompt).not.toMatch(/govard_[a-z_]+/)
  })

  it('full prompt falls back to a report-only diff review when the CLI cannot run', () => {
    const prompt = buildAuditorPrompt({ staticOnly: false })
    expect(prompt).toMatch(/govard CLI is unavailable|cannot start/)
    expect(prompt).toMatch(/report-only/)
    expect(prompt).toMatch(/no tests were run/)
  })

  it('without the CLI the full prompt is a report-only diff review with no environment steps', () => {
    const prompt = buildAuditorPrompt({ staticOnly: false, cliAvailable: false })
    expect(prompt).not.toContain('govard')
    expect(prompt).not.toMatch(/bring up/i)
    expect(prompt).not.toMatch(/tear/i)
    expect(prompt).not.toMatch(/run the test suite/i)
    expect(prompt).toMatch(/diff/i)
    expect(prompt).toMatch(/report-only/)
    expect(prompt).toMatch(/Markdown report/)
  })

  it('static prompt drops env/test-suite and tells the auditor to omit that section (CI flow)', () => {
    const prompt = buildAuditorPrompt({ staticOnly: true })
    expect(prompt).not.toMatch(/bring up the environment/)
    expect(prompt).not.toContain('govard env up')
    expect(prompt).toMatch(/do not run the test suite/)
    expect(prompt).toMatch(/static/i)
    expect(prompt).toMatch(/omit.*environment.*test suite/i)
  })
})
