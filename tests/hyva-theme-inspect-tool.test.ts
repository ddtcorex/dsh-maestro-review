import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type RegisteredDef = { name: string; description: string; parameters: Record<string, unknown>; execute: (args: unknown, exec: unknown) => Promise<unknown> }

const cleanup: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hyva-inspect-'))
  cleanup.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function captureRegistered(): { registered: RegisteredDef[]; ctx: unknown } {
  const registered: RegisteredDef[] = []
  const ctx: unknown = {
    tools: { register: (def: RegisteredDef) => registered.push(def) },
    effect(fn: () => void) { fn() },
  }
  return { registered, ctx }
}
function execFromSessionCwd(cwd: string): unknown {
  return { callId: 'c', name: 'hyva_theme_inspect', arguments: {}, signal: new AbortController().signal, agent: { session: { header: { cwd } } } }
}

describe('hyva_theme_inspect', () => {
  it('discovers Hyva vs CSP theme and tailwind v4 via package.json + sources', async () => {
    const { apply } = await import('../src/hyva-theme-inspect-tool.js')
    const { registered, ctx } = captureRegistered()
    apply(ctx as never, {})
    expect(registered.length).toBe(1)
    expect(registered[0].name).toBe('hyva_theme_inspect')

    const root = await tempDir()
    const themeRoot = join(root, 'app/design/frontend/Acme/hyva')
    await mkdir(join(themeRoot, 'web/tailwind'), { recursive: true })
    await writeFile(join(themeRoot, 'theme.xml'), '<theme><parent>Hyva/default</parent></theme>')
    await writeFile(join(themeRoot, 'web/tailwind/package.json'), JSON.stringify({ dependencies: { tailwindcss: '^4.1.3' } }))
    await writeFile(join(themeRoot, 'web/tailwind/tailwind-source.css'), '@source "../templates/**/*.phtml";\n@source inline("bg-primary");\n')
    await writeFile(join(themeRoot, 'hyva.config.json'), JSON.stringify({ tailwind: { include: ['app/code/**/*.phtml'] } }))
    await writeFile(join(root, 'composer.lock'), JSON.stringify({ packages: [{ name: 'hyva-themes/magento2-default-theme', version: '1.5.7' }] }))

    const result = await registered[0].execute({}, execFromSessionCwd(root)) as { themes: Array<{ isHyva: boolean; isCspBuild: boolean }>; tailwind: { major: string | null; sources: string[] | null; hasHyvaConfigJson: boolean }; hyvaPackages: Array<{ name: string }>; notes: string[] }
    expect(result.themes[0].isHyva).toBe(true)
    expect(result.themes[0].isCspBuild).toBe(false)
    expect(result.tailwind.major).toBe('v4')
    expect(result.tailwind.sources).toBeDefined()
    expect(result.hyvaPackages[0].name).toBe('hyva-themes/magento2-default-theme')
  })

  it('parses v3 extend/safelist/content via tailwind.config.js regex', async () => {
    const { apply } = await import('../src/hyva-theme-inspect-tool.js')
    const { registered, ctx } = captureRegistered()
    apply(ctx as never, {})
    const root = await tempDir()
    const themeRoot = join(root, 'app/design/frontend/Acme/legacy')
    await mkdir(join(themeRoot, 'web/tailwind'), { recursive: true })
    await writeFile(join(themeRoot, 'theme.xml'), '<theme><parent>Magento/luma</parent></theme>')
    await writeFile(join(themeRoot, 'web/tailwind/package.json'), JSON.stringify({ devDependencies: { tailwindcss: '3.4.17' } }))
    await writeFile(join(themeRoot, 'tailwind.config.js'), `module.exports={ content:['./src/**/*.{js,phtml}'], theme:{ extend:{ colors:{primary:'#f00'}}}, safelist:['bg-primary'] }`)
    const result = await registered[0].execute({}, execFromSessionCwd(root)) as { tailwind: { major: string | null; extendKeys: string[] | null; safelist: string[] | null } }
    expect(result.tailwind.major).toBe('v3')
    expect(result.tailwind.extendKeys).toContain('colors')
    expect(result.tailwind.safelist).toContain('bg-primary')
  })

  it('degrades to null fields with notes on worktree without vendor/ or built CSS', async () => {
    const { apply } = await import('../src/hyva-theme-inspect-tool.js')
    const { registered, ctx } = captureRegistered()
    apply(ctx as never, {})
    const root = await tempDir()
    // no theme.xml, no package.json
    const result = await registered[0].execute({ classes: ['w-18'] }, execFromSessionCwd(root)) as { themes: unknown[]; tailwind: { major: string | null; classProbe: unknown }; notes: string[] }
    expect(result.themes.length).toBe(0)
    expect(result.tailwind.major).toBe(null)
    expect(result.notes.length).toBeGreaterThan(0)
  })

  it('rejects path escaping workspace root', async () => {
    const { apply } = await import('../src/hyva-theme-inspect-tool.js')
    const { registered, ctx } = captureRegistered()
    apply(ctx as never, {})
    const root = await tempDir()
    const result = await registered[0].execute({ root: '../../etc' }, execFromSessionCwd(root)) as { isError?: boolean; text?: string }
    // defineTool may return isError shape or string error — assert escape is signaled
    const text = typeof result === 'string' ? result : (result as { text?: string }).text ?? JSON.stringify(result)
    expect(text.toLowerCase()).toContain('escapes')
  })
})
