import { describe, it, expect } from 'vitest'
import { ensureWorktree } from '../src/host/host-orchestrator.js'

describe('ensureWorktree branch-not-found fallback', () => {
  it('throws BRANCH_NOT_FOUND when git fetch reports missing remote ref', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const remote = mkdtempSync(join(tmpdir(), 'orch-remote-'))
    const dir = mkdtempSync(join(tmpdir(), 'orch-test-'))
    execFileSync('git', ['init', '--bare'], { cwd: remote })
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
    // Remote exists but has no branch test-branch → git fetch reports couldn't find remote ref
    await expect(ensureWorktree(dir, 'test-branch', 9991, 9991)).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' })
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  })
})
