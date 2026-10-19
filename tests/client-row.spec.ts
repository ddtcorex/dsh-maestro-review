import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// DSH's client-module registry serves a package's dsh.client bundle only when a
// loader row names the bare package (exactPackageSpecifier); rows naming
// subpaths such as `<pkg>/lib/x.js` never register the client, and the
// Settings section silently disappears (found on a dry boot, 2026-10-19).
describe('client bundle row', () => {
  it('mounts the package root under its exact name', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { name: string }
    const rows = (parse(readFileSync('cordis.patch.yml', 'utf-8')) as Array<{ insert?: Array<{ id: string; name: string }> }>)
      .flatMap(e => e.insert ?? [])
    expect(rows.find(r => r.name === pkg.name)?.id).toBe('maestro-review-plugin')
  })
})
