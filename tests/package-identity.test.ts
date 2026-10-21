import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const manifest = JSON.parse(readFileSync('package.json', 'utf-8')) as Record<string, any>

describe('package identity', () => {
  it('is the DSH host plugin for Maestro review, starting above the last published 0.12.1', () => {
    expect(manifest.name).toBe('@ddtcorex/dsh-maestro-review')
    // Never a literal: a release-alignment test that pins a version breaks on the next tag.
    const [maj, min, pat] = String(manifest.version).split('.').map(Number)
    expect(maj > 0 || min > 12 || (min === 12 && pat > 1)).toBe(true)
    expect(manifest.private).toBe(false)
    expect(manifest.repository.url).toBe('git+https://github.com/ddtcorex/dsh-maestro-review.git')
  })

  it('depends on the review engine through the sibling workspace checkout', () => {
    expect(manifest.dependencies['@ddtcorex/maestro-reviewer']).toBe('workspace:^')
    const ws = parse(readFileSync('pnpm-workspace.yaml', 'utf-8')) as { packages: string[]; allowBuilds?: Record<string, boolean> }
    expect(ws.packages).toEqual(['.', '../../maestro-reviewer'])
    expect(ws.allowBuilds?.esbuild).toBe(true)
  })

  it('emits a flat lib/index.js from src/host', () => {
    const ts = JSON.parse(readFileSync('tsconfig.json', 'utf-8')) as { compilerOptions: { rootDir: string; outDir: string } }
    expect(ts.compilerOptions.rootDir).toBe('src/host')
    expect(ts.compilerOptions.outDir).toBe('lib')
    expect(manifest.main).toBe('./lib/index.js')
  })

  it('declares the normalized DSH peer range for its client dependencies', () => {
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-connection']).toBe('^0.1.0-rc.6 || >=0.1.1-rc.0 <0.3.0-0')
  })
})
