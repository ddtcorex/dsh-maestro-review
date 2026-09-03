import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildVendorOverrideYaml, writeContainerVendorOverride } from '../src/host/orchestrator.js'

describe('buildVendorOverrideYaml', () => {
  it('binds the host vendor dir read-only into php services', () => {
    const yaml = buildVendorOverrideYaml('/home/kai/Work/htdocs/bebe9/vendor')
    expect(yaml).toContain('php:')
    expect(yaml).toContain('php-debug:')
    expect(yaml).toContain('/home/kai/Work/htdocs/bebe9/vendor:/var/www/html/vendor:ro')
  })
})

describe('writeContainerVendorOverride', () => {
  function primary(withVendor: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'orch-ovr-src-'))
    if (withVendor) {
      mkdirSync(join(dir, 'vendor', 'bin'), { recursive: true })
      writeFileSync(join(dir, 'vendor', 'autoload.php'), '<?php // fixture')
    }
    return dir
  }
  function worktree(withRealVendor: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'orch-ovr-wt-'))
    if (withRealVendor) {
      mkdirSync(join(dir, 'vendor'), { recursive: true })
      writeFileSync(join(dir, 'vendor', 'autoload.php'), '<?php // own')
    }
    return dir
  }
  function cleanup(...dirs: string[]): void {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  }

  it('writes the override file pointing at the primary vendor dir', async () => {
    const src = primary(true), wt = worktree(false)
    try {
      const out = await writeContainerVendorOverride(src, wt)
      expect(out).toBe(join(wt, '.govard', 'docker-compose.override.yml'))
      const text = readFileSync(out as string, 'utf8')
      expect(text).toContain(join(src, 'vendor') + ':/var/www/html/vendor:ro')
    } finally {
      cleanup(src, wt)
    }
  })

  it('returns undefined when the primary checkout has no vendor/', async () => {
    const src = primary(false), wt = worktree(false)
    try {
      expect(await writeContainerVendorOverride(src, wt)).toBeUndefined()
      expect(existsSync(join(wt, '.govard', 'docker-compose.override.yml'))).toBe(false)
    } finally {
      cleanup(src, wt)
    }
  })

  it('skips the bind when the worktree already carries its own real vendor/', async () => {
    const src = primary(true), wt = worktree(true)
    try {
      expect(await writeContainerVendorOverride(src, wt)).toBeUndefined()
    } finally {
      cleanup(src, wt)
    }
  })
})
