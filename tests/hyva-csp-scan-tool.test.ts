import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type RegisteredDef = { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }
const cleanup: string[] = []
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'hyva-csp-'))
  cleanup.push(d)
  return d
}
afterEach(async () => Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true }))))
function capture() { const r: RegisteredDef[] = []; return { r, ctx: { tools: { register: (d: RegisteredDef) => r.push(d) }, effect(fn: () => void) { fn() } } as unknown } }
function exec(cwd: string): unknown { return { callId: 'c', name: 'hyva_csp_scan', arguments: {}, signal: new AbortController().signal, agent: { session: { header: { cwd } } } } }

describe('hyva_csp_scan', () => {
  it('flags unregistered inline script without $hyvaCsp->registerInlineScript', async () => {
    const { apply } = await import('../src/host/hyva-csp-scan-tool.js')
    const { r, ctx } = capture()
    apply(ctx as never, {})
    expect(r[0].name).toBe('hyva_csp_scan')
    const root = await tempDir()
    await writeFile(join(root, 'a.phtml'), '<div>hi</div>\n<script>alert(1)</script>\n')
    const res = await r[0].execute({ scope: 'dir' }, exec(root)) as { issues: Array<{ type: string }>; clean: boolean }
    expect(res.issues.some((i) => i.type === 'unregistered-inline-script')).toBe(true)
    expect(res.clean).toBe(false)
  })
  it('passes when file contains $hyvaCsp->registerInlineScript', async () => {
    const { apply } = await import('../src/host/hyva-csp-scan-tool.js')
    const { r, ctx } = capture()
    apply(ctx as never, {})
    const root = await tempDir()
    await writeFile(join(root, 'b.phtml'), '<?php /** @var Hyva\\Theme\\ViewModel\\HyvaCsp $hyvaCsp */ ?>\n<script>console.log(1)</script>\n<?php $hyvaCsp->registerInlineScript(1) ?>\n')
    const res = await r[0].execute({ scope: 'dir' }, exec(root)) as { issues: Array<{ type: string }>; clean: boolean }
    expect(res.issues.filter((i) => i.type === 'unregistered-inline-script').length).toBe(0)
  })
  it('flags x-model on CSP build as warn (x-model-on-csp-build) but clean remains true if only that', async () => {
    const { apply } = await import('../src/host/hyva-csp-scan-tool.js')
    const { r, ctx } = capture()
    apply(ctx as never, {})
    const root = await tempDir()
    await mkdir(join(root, 'app/design/frontend/Acme/csp'), { recursive: true })
    await writeFile(join(root, 'app/design/frontend/Acme/csp/theme.xml'), '<theme><parent>Hyva/default-csp</parent></theme>')
    await writeFile(join(root, 'c.phtml'), '<div x-model="foo"></div>\n')
    const res = await r[0].execute({ scope: 'dir', cspBuild: true }, exec(root)) as { issues: Array<{ type: string }>; clean: boolean }
    expect(res.issues.some((i) => i.type === 'x-model-on-csp-build')).toBe(true)
    // clean is true when only x-model warn? per spec clean = issues.filter(type!='x-model-on-csp-build').length===0
    expect(res.clean).toBe(true)
  })
  it('flags Alpine expression with operators as expression-in-directive', async () => {
    const { apply } = await import('../src/host/hyva-csp-scan-tool.js')
    const { r, ctx } = capture()
    apply(ctx as never, {})
    const root = await tempDir()
    await writeFile(join(root, 'd.phtml'), '<button @click="count++">click</button>\n')
    const res = await r[0].execute({ scope: 'dir' }, exec(root)) as { issues: Array<{ directive: string | null }> }
    expect(res.issues.some((i) => i.directive === '@click')).toBe(true)
  })
})
