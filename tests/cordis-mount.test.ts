import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const patch = readFileSync(join(REPO_ROOT, 'cordis.patch.yml'), 'utf-8')
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
  name: string
  main: string
}

describe('cordis patch mounting', () => {
  it('mounts the plugin root so apply() actually runs on install', () => {
    // Without this row the provider registration in src/host/index.ts is never
    // executed: `dsh plugin add <pkg>` applies only the rows in this file, and a
    // row naming a submodule path never reaches lib/index.js's apply().
    // (The meta bundle happens to mount the bare name, which is why the gap
    // stayed invisible — a direct install got a silent no-op.)
    const rows = patch.split('\n').filter(line => line.includes('name:'))
    const bareName = rows.find(line => line.includes(`'${pkg.name}'`))
    expect(bareName, 'no row mounts the package root').toBeDefined()
  })

  it('declares the services apply() reads on the mounting row', () => {
    // Row-level inject (not module-level) is what populates ctx.get('skills').
    const block = patch.slice(patch.indexOf(`'${pkg.name}'`))
    const rowInject = block.slice(0, block.indexOf('insert:'))
    expect(patch).toMatch(/inject:[\s\S]*?'skills'/)
    expect(rowInject.length).toBeGreaterThan(0)
  })

  it('keeps the existing submodule rows', () => {
    for (const required of ['providers/gitlab.js', 'orchestrator.js', 'settings-rpc.js'])
      expect(patch, required).toContain(required)
  })
})
