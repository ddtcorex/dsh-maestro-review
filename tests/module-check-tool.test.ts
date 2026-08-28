import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'modchk-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown} }
function exec(cwd:string):unknown{ return {callId:'c', name:'magento_module_check', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('magento_module_check', ()=>{
  it('valid module passes with no critical issues', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('magento_module_check')
    const root=await tempDir()
    const mod=join(root,'app/code/Acme/Demo')
    await mkdir(join(mod,'etc'),{recursive:true})
    await writeFile(join(mod,'registration.php'),"<?php\n\\Magento\\Framework\\Component\\ComponentRegistrar::register(\\Magento\\Framework\\Component\\ComponentRegistrar::MODULE,'Acme_Demo',__DIR__);")
    await writeFile(join(mod,'etc/module.xml'),'<config><module name="Acme_Demo" setup_version="1.0.0"><sequence><module name="Magento_Catalog"/></sequence></module></config>')
    await writeFile(join(mod,'composer.json'), JSON.stringify({name:'acme/magento2-demo', autoload:{'psr-4':{'Acme\\Demo\\':'src/'}}}))
    await writeFile(join(mod,'etc/db_schema.xml'),'<schema><table name="acme_demo"><column xsi:type="int" name="entity_id"/></table></schema>')
    const res=await r[0].execute({}, exec(root)) as {modules:Array<{path:string, module:{name:string|null,sequence:string[],hasRegistration:boolean,registrationValid:boolean,hasEtcModuleXml:boolean,hasDbSchema:boolean}, issues:unknown[], isHyvaCompatible:boolean|null}>, scannedModules:number}
    expect(res.scannedModules).toBe(1)
    expect(res.modules[0].module.name).toBe('Acme_Demo')
    expect(res.modules[0].module.hasRegistration).toBe(true)
    expect(res.modules[0].module.registrationValid).toBe(true)
    expect(res.modules[0].module.hasDbSchema).toBe(true)
  })
  it('missing registration.php reports issue and hasRegistration false', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const mod=join(root,'app/code/Acme/Bad')
    await mkdir(join(mod,'etc'),{recursive:true})
    await writeFile(join(mod,'etc/module.xml'),'<config><module name="Acme_Bad"/></config>')
    const res=await r[0].execute({}, exec(root)) as {modules:Array<{module:{hasRegistration:boolean,registrationValid:boolean|null}, issues:Array<{severity:string,rule:string}>}>}
    expect(res.modules[0].module.hasRegistration).toBe(false)
    expect(res.modules[0].issues.some(i=>i.rule==='registration-missing')).toBe(true)
  })
  it('name mismatch between registration and module.xml flagged', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const mod=join(root,'app/code/Acme/Mismatch')
    await mkdir(join(mod,'etc'),{recursive:true})
    await writeFile(join(mod,'registration.php'),"<?php ComponentRegistrar::register(ComponentRegistrar::MODULE,'Acme_Mismatch',__DIR__);")
    await writeFile(join(mod,'etc/module.xml'),'<config><module name="Acme_Other"/></config>')
    const res=await r[0].execute({}, exec(root)) as {modules:Array<{issues:Array<{rule:string}>}>}
    expect(res.modules[0].issues.some(i=>i.rule==='name-mismatch')).toBe(true)
  })
  it('single modulePath mode scans only that module', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await mkdir(join(root,'app/code/Acme/A/etc'),{recursive:true})
    await mkdir(join(root,'app/code/Acme/B/etc'),{recursive:true})
    await writeFile(join(root,'app/code/Acme/A/registration.php'),"<?php ComponentRegistrar::register(ComponentRegistrar::MODULE,'Acme_A',__DIR__);")
    await writeFile(join(root,'app/code/Acme/A/etc/module.xml'),'<config><module name="Acme_A"/></config>')
    await writeFile(join(root,'app/code/Acme/B/registration.php'),"<?php ComponentRegistrar::register(ComponentRegistrar::MODULE,'Acme_B',__DIR__);")
    await writeFile(join(root,'app/code/Acme/B/etc/module.xml'),'<config><module name="Acme_B"/></config>')
    const res=await r[0].execute({modulePath:'app/code/Acme/A'}, exec(root)) as {modules:Array<{path:string}>, scannedModules:number}
    expect(res.scannedModules).toBe(1)
    expect(res.modules[0].path).toContain('Acme/A')
  })
  it('rejects escaping modulePath', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({modulePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
  it('detects Hyva incompatible via data-bind in phtml', async ()=>{
    const {apply}=await import('../src/host/module-check-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const mod=join(root,'app/code/Acme/HyvaTest')
    await mkdir(join(mod,'etc'),{recursive:true})
    await mkdir(join(mod,'view/frontend/templates'),{recursive:true})
    await writeFile(join(mod,'registration.php'),"<?php ComponentRegistrar::register(ComponentRegistrar::MODULE,'Acme_HyvaTest',__DIR__);")
    await writeFile(join(mod,'etc/module.xml'),'<config><module name="Acme_HyvaTest"/></config>')
    await writeFile(join(mod,'view/frontend/templates/test.phtml'),'<div data-bind=\"text: foo\"></div>')
    const res=await r[0].execute({modulePath:'app/code/Acme/HyvaTest'}, exec(root)) as {modules:Array<{isHyvaCompatible:boolean|null, compatNotes:string[]}>}
    expect(res.modules[0].isHyvaCompatible).toBe(false)
    expect(res.modules[0].compatNotes.join(' ')).toContain('knockout')
  })
})
