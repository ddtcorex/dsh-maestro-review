import { describe,it,expect } from 'vitest'

describe('maestro_review_scope_split', ()=>{
  it('quick mode puts all files in quick', async ()=>{
    const { apply } = await import('../src/scope-split-tool.js')
    // harness like other tools but pure function also exported
    const { splitScope } = await import('../src/scope-split-tool.js')
    const res = splitScope({files:['a.phtml','b.js','c.less']}, 'quick')
    expect(res.split.quick.files).toEqual(['a.phtml','b.js','c.less'])
    expect(res.split.deep.files.length).toBe(0)
  })
  it('deep mode splits phtml vs php correctly', async ()=>{
    const { splitScope } = await import('../src/scope-split-tool.js')
    const res = splitScope({files:['view.phtml','Model/Catalog.php','etc/di.xml','app/code/Acme/Mod/Plugin/Foo.php']}, 'deep')
    expect(res.split.quick.files).toContain('view.phtml')
    expect(res.split.deep.files).toContain('Model/Catalog.php')
    expect(res.split.deep.files).toContain('etc/di.xml')
    expect(res.split.deep.files.some(f=>f.includes('Plugin'))).toBe(true)
  })
  it('estimates savings ~ quick*1400 and handles mixed 18 quick 12 deep', async ()=>{
    const { splitScope } = await import('../src/scope-split-tool.js')
    const quick = Array.from({length:18}, (_,i)=>`a${i}.phtml`)
    const deep = Array.from({length:12}, (_,i)=>`B${i}.php`)
    const res = splitScope({files:[...quick, ...deep]}, 'deep')
    expect(res.split.quick.files.length).toBe(18)
    expect(res.split.deep.files.length).toBe(12)
    expect(res.estimatedSavingsTokens).toBe(18*1400)
    expect(res.estimatedSavingsPercent).toBeGreaterThan(15)
  })
  it('unknown extension goes deep with warning', async ()=>{
    const { splitScope } = await import('../src/scope-split-tool.js')
    const res = splitScope({files:['foo.xyz']}, 'deep')
    expect(res.split.deep.files).toContain('foo.xyz')
    expect(res.warnings.length).toBeGreaterThan(0)
  })
  it('tool registers and returns same split via tool call', async ()=>{
    const { apply } = await import('../src/scope-split-tool.js')
    type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
    const regs:Reg[]=[]
    const ctx={tools:{register:(d:Reg)=>regs.push(d)}, effect(fn:()=>void){fn()}} as unknown as any
    apply(ctx as any,{})
    expect(regs[0].name).toBe('maestro_review_scope_split')
    const exec={callId:'c', name:'maestro_review_scope_split', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd:'/tmp'}}}} as unknown
    const res=await regs[0].execute({diffStats:{files:['a.phtml','b.php'], addedLinesPerFile:{'a.phtml':10,'b.php':50}}, mode:'deep'}, exec) as {split:{quick:{files:string[]},deep:{files:string[]}}, reason:string}
    expect(res.split.quick.files).toContain('a.phtml')
    expect(res.reason).toBeDefined()
  })
})
