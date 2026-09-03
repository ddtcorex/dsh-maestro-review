import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildVendorOverrideYaml, writeContainerVendorOverride } from '../src/host/orchestrator.js'

describe('buildVendorOverrideYaml', () => {
  it('keeps the project mount first, then the read-only vendor bind (govard MergeMap replaces lists)', () => {
    const yaml = buildVendorOverrideYaml('/srv/example-shop/vendor')
    expect(yaml).toContain('php:')
    expect(yaml).toContain('.:/var/www/html')
    expect(yaml).toContain('/srv/example-shop/vendor:/var/www/html/vendor:ro')
    expect(yaml.indexOf('.:/var/www/html')).toBeLessThan(yaml.indexOf('/srv/example-shop/vendor'))
  })
  it('targets only the php service (php-debug vanishes from base when xdebug is off)', () => {
    const yaml = buildVendorOverrideYaml('/srv/example-shop/vendor')
    expect(yaml).not.toContain('php-debug')
  })
  it('honors a custom container workdir', () => {
    const yaml = buildVendorOverrideYaml('/v/vendor', undefined, '/app')
    expect(yaml).toContain('.:/app')
    expect(yaml).toContain('/v/vendor:/app/vendor:ro')
  })
  it('binds a linked env.php file when given (host symlinks dangle in-container)', () => {
    const yaml = buildVendorOverrideYaml('/v/vendor', '/c/app/etc/env.php')
    expect(yaml).toContain('/c/app/etc/env.php:/var/www/html/app/etc/env.php:ro')
  })
  it('omits the env bind when no env file is linked', () => {
    const yaml = buildVendorOverrideYaml('/v/vendor')
    expect(yaml).not.toContain('env.php')
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

  it('still binds when the worktree vendor/ holds only a tracked .htaccess stub', async () => {
    const src = primary(true), wt = worktree(false)
    mkdirSync(join(wt, 'vendor'), { recursive: true })
    writeFileSync(join(wt, 'vendor', '.htaccess'), 'stub')
    try {
      const out = await writeContainerVendorOverride(src, wt)
      expect(out).toBe(join(wt, '.govard', 'docker-compose.override.yml'))
    } finally {
      cleanup(src, wt)
    }
  })

  it('skips the bind when the primary vendor/ has no installed autoload.php', async () => {
    const src = primary(false), wt = worktree(false)
    mkdirSync(join(src, 'vendor'), { recursive: true })
    try {
      expect(await writeContainerVendorOverride(src, wt)).toBeUndefined()
    } finally {
      cleanup(src, wt)
    }
  })
})
