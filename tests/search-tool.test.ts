import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/search-tool.js'

interface RegisteredDef {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<{ text: string; truncated: boolean }>
}

function captureRegistered(): { registered: RegisteredDef[]; ctx: never } {
  const registered: RegisteredDef[] = []
  const ctx = {
    tools: { register: (def: RegisteredDef) => { registered.push(def) } },
    effect(fn: () => void) { fn() },
  }
  return { registered, ctx: ctx as never }
}

function execFromSessionCwd(cwd: string): unknown {
  return {
    callId: 'call_test', name: 'maestro_search_files', arguments: {},
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  }
}

const cleanup: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'maestro-search-tool-'))
  cleanup.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('maestro_search_files', () => {
  it('finds pattern matches with relative paths and line numbers', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'theme.phtml'), 'first\n<span class="bg-orange-vl">x</span>\nlast')
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'sub', 'other.css'), '.bg-orange-vl { color: red }')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const result = await search.execute({ pattern: 'bg-orange-vl' }, execFromSessionCwd(root))
    expect(result.text).toContain('theme.phtml:2:')
    expect(result.text).toContain(join('sub', 'other.css') + ':1:')
    expect(result.truncated).toBe(false)
  })

  it('applies glob filename filters', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'a.phtml'), 'needle')
    await writeFile(join(root, 'b.css'), 'needle')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const result = await search.execute({ pattern: 'needle', glob: '*.phtml' }, execFromSessionCwd(root))
    expect(result.text).toContain('a.phtml:1:')
    expect(result.text).not.toContain('b.css')
  })

  it('scopes to a subdirectory and rejects escapes outside the workspace root', async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(join(root, 'app'), { recursive: true })
    await writeFile(join(root, 'app', 'in.php'), 'target')
    await writeFile(join(outside, 'out.php'), 'target')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const scoped = await search.execute({ pattern: 'target', path: 'app' }, execFromSessionCwd(root))
    expect(scoped.text).toContain(join('app', 'in.php'))
    const denied = await search.execute({ pattern: 'target', path: '../' }, execFromSessionCwd(root))
    expect(denied.text).toContain('escapes the workspace root')
  })

  it('truncates at the match cap and flags it', async () => {
    const root = await tempDir()
    const lines = Array.from({ length: 80 }, (_, i) => `hit ${i}`).join('\n')
    await writeFile(join(root, 'big.txt'), lines)
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const result = await search.execute({ pattern: 'hit' }, execFromSessionCwd(root))
    expect(result.text.split('\n')).toHaveLength(51) // header + 50 matches
    expect(result.truncated).toBe(true)
  })

  it('skips node_modules directories', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'unique-needles-here')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const result = await search.execute({ pattern: 'unique-needles-here' }, execFromSessionCwd(root))
    expect(result.text).toContain('No matches')
  })

  it('rejects invalid regular expressions with a usable message', async () => {
    const root = await tempDir()
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const search = registered.find((def) => def.name === 'maestro_search_files')!
    const result = await search.execute({ pattern: '([unclosed' }, execFromSessionCwd(root))
    expect(result.text).toContain('Invalid regular expression')
  })
})
