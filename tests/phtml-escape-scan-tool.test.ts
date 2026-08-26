import { describe,it,expect,afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string,execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'pes-')); cleanup.push(d); return d}
afterEach(async()=>Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))))
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c',name:'phtml_escape_scan',arguments:{},signal:new AbortController().signal,agent:{session:{header:{cwd}}}}}

describe('phtml_escape_scan', ()=>{
  it('flags unescaped echo high', async ()=>{
    const {apply}=await import('../src/phtml-escape-scan-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{}); expect(r[0].name).toBe('phtml_escape_scan')
    const root=await tempDir()
    await writeFile(join(root,'a.phtml'),'<?= $var ?>\n')
    const res=await r[0].execute({scope:'paths', paths:['a.phtml']}, exec(root)) as {findings:Array<{type:string,confidence:string}>, scannedFiles:number}
    expect(res.findings.some(f=>f.type==='unescaped-echo' && f.confidence==='high')).toBe(true)
  })
  it('accepts escapeHtml as safe', async ()=>{
    const {apply}=await import('../src/phtml-escape-scan-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await writeFile(join(root,'b.phtml'),'<?= $escaper->escapeHtml($var) ?>\n<?= $block->escapeHtml($x) ?>\n')
    const res=await r[0].execute({scope:'paths', paths:['b.phtml']}, exec(root)) as {findings:unknown[]}
    expect(res.findings.length).toBe(0)
  })
  it('flags unescaped attr vs escapeHtmlAttr', async ()=>{
    const {apply}=await import('../src/phtml-escape-scan-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await writeFile(join(root,'c.phtml'),'<div title="<?= $title ?>"></div>\n<div title="<?= $escaper->escapeHtmlAttr($title) ?>"></div>\n')
    const res=await r[0].execute({scope:'paths', paths:['c.phtml']}, exec(root)) as {findings:Array<{type:string}>}
    expect(res.findings.some(f=>f.type==='unescaped-attr')).toBe(true)
    expect(res.findings.length).toBe(1)
  })
  it('flags superglobal', async ()=>{
    const {apply}=await import('../src/phtml-escape-scan-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await writeFile(join(root,'d.phtml'),'<?php echo $_GET["id"]; ?>\n')
    const res=await r[0].execute({scope:'paths', paths:['d.phtml']}, exec(root)) as {findings:Array<{type:string,confidence:string}>}
    expect(res.findings.some(f=>f.type==='direct-superglobal')).toBe(true)
  })
  it('scope paths filter and escape guard', async ()=>{
    const {apply}=await import('../src/phtml-escape-scan-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    await writeFile(join(root,'e.phtml'),'<?= $a ?>\n')
    const res=await r[0].execute({scope:'paths', paths:['../../etc/passwd']}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
})
