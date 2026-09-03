import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ensureWorktree } from '../src/host/orchestrator.js'

function initRepo(withVendor: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'orch-vendor-'))
  execFileSync('git', ['init', '-b', 'master'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', dir], { cwd: dir })
  if (withVendor) {
    mkdirSync(join(dir, 'vendor'), { recursive: true })
    writeFileSync(join(dir, 'vendor', 'autoload.php'), '<?php // vendor-fixture')
    mkdirSync(join(dir, 'app', 'etc'), { recursive: true })
    writeFileSync(join(dir, 'app', 'etc', 'env.php'), '<?php // env-fixture')
  }
  return dir
}

function cleanup(dir: string, worktreePath: string): void {
  try { execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: dir }) } catch {}
  rmSync(worktreePath, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
}

describe('ensureWorktree vendor symlink', () => {
  it('links vendor/ and app/etc/env.php from the primary checkout into the worktree', async () => {
    const dir = initRepo(true)
    const suffix = `vendorlink${Date.now().toString(16)}`
    const worktreePath = join(tmpdir(), `maestro-mr-1-2-${suffix}`)
    try {
      const wt = await ensureWorktree(dir, 'master', 1, 2, suffix)
      expect(wt).toBe(worktreePath)
      expect(readFileSync(join(wt, 'vendor', 'autoload.php'), 'utf8')).toContain('vendor-fixture')
      expect(readFileSync(join(wt, 'app', 'etc', 'env.php'), 'utf8')).toContain('env-fixture')
    } finally {
      cleanup(dir, worktreePath)
    }
  })

  it('succeeds without links when the primary checkout has no vendor/', async () => {
    const dir = initRepo(false)
    const suffix = `novendor${Date.now().toString(16)}`
    const worktreePath = join(tmpdir(), `maestro-mr-1-2-${suffix}`)
    try {
      const wt = await ensureWorktree(dir, 'master', 1, 2, suffix)
      expect(wt).toBe(worktreePath)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(wt, 'vendor'))).toBe(false)
    } finally {
      cleanup(dir, worktreePath)
    }
  })
})
