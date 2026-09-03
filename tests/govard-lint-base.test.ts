import { describe, it, expect } from 'vitest'
import { resolveLintBase, buildAuditCliArgs } from '../src/host/govard-audit-lint-tool.js'
import { fetchMrBaseSha } from '../src/host/orchestrator.js'

describe('resolveLintBase', () => {
  it('prefers the explicit args base', () => {
    expect(resolveLintBase('origin/master', 'abc123')).toBe('origin/master')
  })
  it('falls back to the configured defaultBase', () => {
    expect(resolveLintBase(undefined, 'abc123')).toBe('abc123')
  })
  it('returns undefined when neither is given', () => {
    expect(resolveLintBase(undefined, undefined)).toBeUndefined()
  })
})

describe('buildAuditCliArgs', () => {
  it('passes --allow-xdebug only when configured (review envs disable xdebug via worktree override)', () => {
    expect(buildAuditCliArgs({ allowXdebug: true })).toContain('--allow-xdebug')
    expect(buildAuditCliArgs({})).not.toContain('--allow-xdebug')
    expect(buildAuditCliArgs({ allowXdebug: false })).not.toContain('--allow-xdebug')
  })
  it('includes --scope diff --base when diffing', () => {
    const args = buildAuditCliArgs({ checks: ['lint'], mode: 'auto', timeout: 'auto', lintProvider: 'govard', scope: 'diff', base: 'abc123' })
    expect(args).toContain('--scope')
    expect(args).toContain('diff')
    expect(args).toContain('--base')
    expect(args).toContain('abc123')
  })
  it('omits --scope/--base for project scope', () => {
    const args = buildAuditCliArgs({ checks: ['lint'], mode: 'auto', timeout: 'auto', lintProvider: 'govard' })
    expect(args).not.toContain('--scope')
    expect(args).not.toContain('--base')
  })
})

describe('fetchMrBaseSha', () => {
  const stub = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body, text: async () => 'err' })) as never
  it('returns diff_refs.base_sha', async () => {
    const sha = await fetchMrBaseSha('https://git.example', 't', 1, 9, stub({ diff_refs: { base_sha: 'abc123', start_sha: 's', head_sha: 'h' } }) as never)
    expect(sha).toBe('abc123')
  })
  it('returns undefined on API failure instead of throwing', async () => {
    await expect(fetchMrBaseSha('https://git.example', 't', 1, 9, stub({}, false) as never)).resolves.toBeUndefined()
  })
  it('returns undefined when diff_refs are missing', async () => {
    await expect(fetchMrBaseSha('https://git.example', 't', 1, 9, stub({}) as never)).resolves.toBeUndefined()
  })
})
