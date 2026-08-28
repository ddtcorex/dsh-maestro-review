import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type RegDef = { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }
const cleanup: string[] = []
async function tempDir() { const d = await mkdtemp(join(tmpdir(), 'layout-')); cleanup.push(d); return d }
afterEach(async () => Promise.all(cleanup.splice(0).map(d => rm(d,{recursive:true,force:true}))))
function cap(){ const r: RegDef[]=[]; return { r, ctx:{ tools:{register:(d:RegDef)=>r.push(d)}, effect(fn:()=>void){fn()} } as unknown } }
function exec(cwd:string):unknown{ return { callId:'c', name:'layout_xml_extract', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}} } }

describe('layout_xml_extract', ()=>{
  it('extracts handle, blocks, moves, head from layout XML', async ()=>{
    const { apply } = await import('../src/host/layout-xml-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    expect(r[0].name).toBe('layout_xml_extract')
    const root = await tempDir()
    const f = join(root,'app/code/Acme/Demo/view/frontend/layout/catalog_product_view.xml')
    await mkdir(join(root,'app/code/Acme/Demo/view/frontend/layout'),{recursive:true})
    await writeFile(f, `<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" layout="1column"><body><referenceBlock name="product.info.main"><block class="Acme\\Demo\\Block\\View" name="acme.view" template="Acme_Demo::view.phtml" cacheable="false"/></referenceBlock><move element="acme.view" destination="content" after="-"/><head><css src="css/demo.css"/><script src="js/demo.js"/></head></body></page>`)
    // create template file for templateExists true
    await mkdir(join(root,'app/code/Acme/Demo/view/frontend/templates'),{recursive:true})
    await writeFile(join(root,'app/code/Acme/Demo/view/frontend/templates/view.phtml'),'hi')
    const res = await r[0].execute({}, exec(root)) as { handles: Array<{handle:string,layoutType:string,blocks:Array<{name:string|null,class:string|null,template:string|null,templateExists:boolean|null}>,moves:Array<{element:string}>,head:{css:Array<{src:string}>,scripts:Array<{src:string}>},parseError:string|null}>, handleCount:number, blockCount:number, scannedFiles:number }
    expect(res.handleCount).toBe(1)
    expect(res.handles[0].handle).toBe('catalog_product_view')
    expect(res.handles[0].layoutType).toBe('page')
    expect(res.handles[0].blocks.length).toBe(1)
    expect(res.handles[0].blocks[0].name).toBe('acme.view')
    expect(res.handles[0].blocks[0].templateExists).toBe(true)
    expect(res.handles[0].moves[0].element).toBe('acme.view')
    expect(res.handles[0].head.css[0].src).toBe('css/demo.css')
  })
  it('derives handle from filename and reports templateExists false when missing', async ()=>{
    const { apply } = await import('../src/host/layout-xml-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    await mkdir(join(root,'view/frontend/layout'),{recursive:true})
    await writeFile(join(root,'view/frontend/layout/default.xml'), `<page><body><block name="a" class="A\\B" template="Missing::no.phtml"/></body></page>`)
    const res = await r[0].execute({}, exec(root)) as { handles: Array<{blocks:Array<{templateExists:boolean|null}>}> }
    expect(res.handles[0].handle).toBe('default')
    expect(res.handles[0].blocks[0].templateExists).toBe(false)
  })
  it('returns parseError on malformed XML without throwing', async ()=>{
    const { apply } = await import('../src/host/layout-xml-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    await mkdir(join(root,'app/code/X/Y/view/frontend/layout'),{recursive:true})
    await writeFile(join(root,'app/code/X/Y/view/frontend/layout/broken.xml'), `<page><body><block name="x"</body></page>`)
    const res = await r[0].execute({}, exec(root)) as { handles: Array<{parseError:string|null,blocks:unknown[]}> }
    expect(res.handles[0].parseError).not.toBeNull()
    expect(res.handles[0].blocks.length).toBe(0)
  })
  it('rejects changedFiles escaping workspace root', async ()=>{
    const { apply } = await import('../src/host/layout-xml-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    const res = await r[0].execute({ changedFiles: ['../../etc/passwd'] }, exec(root)) as { text?: string }
    const txt = typeof res==='string'? res : (res as {text?:string}).text ?? JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
  it('filters by changedFiles allow-list', async ()=>{
    const { apply } = await import('../src/host/layout-xml-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    await mkdir(join(root,'a/layout'),{recursive:true})
    await mkdir(join(root,'b/layout'),{recursive:true})
    await writeFile(join(root,'a/layout/one.xml'), `<page><body><block name="one"/></body></page>`)
    await writeFile(join(root,'b/layout/two.xml'), `<page><body><block name="two"/></body></page>`)
    const res = await r[0].execute({ changedFiles: ['a/layout/one.xml'] }, exec(root)) as { handles: Array<{file:string}>, scannedFiles:number }
    expect(res.handles.length).toBe(1)
    expect(res.handles[0].file).toContain('one.xml')
    expect(res.scannedFiles).toBe(1)
  })
})
