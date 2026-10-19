import { describe, expect, it, vi } from 'vitest'
import { teardownGovardEnvironment, GOVARD_TEARDOWN_TIMEOUT_MS } from '../src/host/host-orchestrator.js'

describe('teardownGovardEnvironment', () => {
  it('runs govard env down -v in the worktree with a bounded timeout', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }))
    await teardownGovardEnvironment('/tmp/wt', run)
    expect(run).toHaveBeenCalledWith('govard', ['env', 'down', '-v'], { cwd: '/tmp/wt', timeout: GOVARD_TEARDOWN_TIMEOUT_MS })
    expect(GOVARD_TEARDOWN_TIMEOUT_MS).toBeGreaterThan(0)
    expect(GOVARD_TEARDOWN_TIMEOUT_MS).toBeLessThanOrEqual(300_000)
  })

  it('never throws and logs a warning when the command fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(teardownGovardEnvironment('/tmp/wt', async () => { throw new Error('boom') })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
