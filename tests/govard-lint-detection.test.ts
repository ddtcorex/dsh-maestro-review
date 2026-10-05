import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectGovardLint, govardOnPath } from '../src/host/govard-lint-detection.js'

const toolsCtx = (names: string[]) => ({
  get: (n: string) => (n === 'tools' ? { get: (name: string) => (names.includes(name) ? {} : undefined) } : undefined),
})

let dir: string
let withGovard: NodeJS.ProcessEnv
let withoutGovard: NodeJS.ProcessEnv

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'govard-path-'))
  const bin = join(dir, 'govard')
  writeFileSync(bin, '#!/bin/sh\nexit 0\n')
  chmodSync(bin, 0o755)
  withGovard = { PATH: `/nonexistent:${dir}` }
  withoutGovard = { PATH: '/nonexistent' }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('govardOnPath', () => {
  it('finds an executable govard on PATH', () => {
    expect(govardOnPath(withGovard)).toBe(true)
  })
  it('is false when no PATH entry holds govard', () => {
    expect(govardOnPath(withoutGovard)).toBe(false)
  })
  it('is false when PATH is unset', () => {
    expect(govardOnPath({})).toBe(false)
  })
  it('ignores a govard file that is not executable', () => {
    chmodSync(join(dir, 'govard'), 0o644)
    expect(govardOnPath(withGovard)).toBe(false)
  })
})

describe('detectGovardLint', () => {
  it('is true when the bash tool resolves for the scope and govard is on PATH', () => {
    expect(detectGovardLint(toolsCtx(['bash']), { agent: 'a1' }, withGovard)).toBe(true)
  })

  it('is false when the bash tool is absent', () => {
    expect(detectGovardLint(toolsCtx(['search']), { agent: 'a1' }, withGovard)).toBe(false)
  })

  it('is false when govard is not on PATH, even with the bash tool', () => {
    expect(detectGovardLint(toolsCtx(['bash']), { agent: 'a1' }, withoutGovard)).toBe(false)
  })

  it('is false when the tools service is missing entirely', () => {
    expect(detectGovardLint({ get: () => undefined }, { agent: 'a1' }, withGovard)).toBe(false)
  })

  it('is false, never a throw, when the registry cannot be read', () => {
    const ctx = { get: () => ({ get: () => { throw new Error('registry gone') } }) }
    expect(detectGovardLint(ctx, { agent: 'a1' }, withGovard)).toBe(false)
  })

  it('is false when the service object exists but has no get', () => {
    expect(detectGovardLint({ get: () => ({}) }, { agent: 'a1' }, withGovard)).toBe(false)
  })

  it('is false when ctx has no get at all', () => {
    expect(detectGovardLint({}, { agent: 'a1' }, withGovard)).toBe(false)
  })
})
