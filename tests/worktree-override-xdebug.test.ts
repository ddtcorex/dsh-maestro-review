import { describe, it, expect } from 'vitest'
import { govardWorktreeOverride } from '../src/host/orchestrator.js'

describe('govardWorktreeOverride', () => {
  it('isolates project name and domain', () => {
    const yml = govardWorktreeOverride(1137, 3786)
    expect(yml).toContain('project_name: maestro-mr-1137-3786')
    expect(yml).toContain('domain: maestro-mr-1137-3786.test')
  })
  it('disables xdebug so lint does not die on the perf-tax guard', () => {
    const yml = govardWorktreeOverride(1137, 3786)
    expect(yml).toContain('xdebug: false')
  })
})
