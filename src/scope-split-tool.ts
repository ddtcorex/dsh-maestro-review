import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name='maestro-scope-split-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string}>=z.object({rootPath:z.string()})

const QUICK_EXTS=new Set(['.phtml','.html','.js','.ts','.less','.css','.xml','.csv','.json'])
const DEEP_EXTS=new Set(['.php'])
const QUICK_PATH_HINTS=/^(view\/frontend|view\/adminhtml|i18n)\// 
const DEEP_PATH_HINTS=/(Plugin\/|Observer\/|Controller\/|Setup\/|Model\/|etc\/(di|acl|webapi)\.xml|composer\.json|registration\.php)/

function extOf(f:string):string{ const i=f.lastIndexOf('.'); return i>=0? f.slice(i).toLowerCase(): ''}

export interface SplitInput{ files:string[], addedLinesPerFile?:Record<string,number>, baseRef?:string}
export interface SplitResult{
  split:{quick:{files:string[], reason:string}, deep:{files:string[], reason:string}},
  reason:string,
  estimatedSavingsTokens:number,
  estimatedSavingsPercent:number,
  manifest:{totalFiles:number, totalAddedLines:number, riskBreakdown:Array<{risk:string,count:number,examples:string[]}>},
  warnings:string[]
}

export function splitScope(diffStats: SplitInput, mode:'quick'|'deep'): SplitResult{
  const warnings:string[]=[]
  const quick:string[]=[]
  const deep:string[]=[]
  if(mode==='quick'){
    for(const f of diffStats.files) quick.push(f)
  } else {
    for(const f of diffStats.files){
      const ext=extOf(f)
      if(DEEP_PATH_HINTS.test(f)){ deep.push(f); continue }
      if(QUICK_PATH_HINTS.test(f)){ quick.push(f); continue }
      if(ext==='.phtml' || ext==='.html' || ext==='.js' || ext==='.ts' || ext==='.less' || ext==='.css' || ext==='.csv' || ext==='.json'){
        quick.push(f); continue
      }
      if(ext==='.xml'){
        // layout xml is quick, other xml deep? Treat layout as quick
        if(f.includes('/layout/') || f.includes('view/')) quick.push(f)
        else deep.push(f)
        continue
      }
      if(DEEP_EXTS.has(ext) || ext==='.php'){ deep.push(f); continue }
      // unknown ext
      deep.push(f)
      warnings.push(`unknown extension ${ext||'(none)'} for ${f} → deep (fail-safe)`)
    }
  }
  const estimatedSavingsTokens=quick.length*1400
  const totalFiles=diffStats.files.length
  const totalAddedLines=diffStats.addedLinesPerFile? Object.values(diffStats.addedLinesPerFile).reduce((a,b)=>a+b,0): 0
  const totalTokensIfAllDeep=totalFiles*1800
  const estimatedSavingsPercent= totalTokensIfAllDeep>0 ? Math.round(estimatedSavingsTokens/totalTokensIfAllDeep*100) : 0
  const reason = `split ${quick.length} quick (phtml/js/less/xml) vs ${deep.length} deep (php/di.xml/Plugin) → saves ~${estimatedSavingsTokens} tokens (${estimatedSavingsPercent}%)`
  const manifest={
    totalFiles,
    totalAddedLines,
    riskBreakdown:[
      {risk:'quick', count:quick.length, examples:quick.slice(0,3)},
      {risk:'deep', count:deep.length, examples:deep.slice(0,3)},
    ]
  }
  return {
    split:{
      quick:{files:quick, reason:'quick: templates, frontend assets'},
      deep:{files:deep, reason:'deep: php, di.xml, Plugin/Observer'},
    },
    reason,
    estimatedSavingsTokens,
    estimatedSavingsPercent,
    manifest,
    warnings,
  }
}

export function apply(ctx:Context, _config:{rootPath?:string}={}):void{
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'maestro_review_scope_split',
    description:'Deterministic QA split for MR diff: quick (templates) vs deep (php/di.xml/Plugin) with token savings estimate.',
    parameters:{
      diffStats:{type:'object', required:true, additionalProperties:false, properties:{files:{type:'array', items:{type:'string'}, required:true}, addedLinesPerFile:{type:'object', additionalProperties:true}, baseRef:{type:'string'}}},
      mode:{type:'string', enum:['quick','deep'], required:true},
      quickExtensions:{type:'array', items:{type:'string'}},
      deepExtensions:{type:'array', items:{type:'string'}},
      maxDeepFiles:{type:'number'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          split:{type:'object', required:true, additionalProperties:true},
          reason:{type:'string', required:true},
          estimatedSavingsTokens:{type:'number', required:true},
          estimatedSavingsPercent:{type:'number', required:true},
          manifest:{type:'object', required:true, additionalProperties:true},
          warnings:{type:'array', required:true},
        }
      },
      render:(_a,v:{reason:string})=>[{type:'text', text:v.reason}],
    },
    async execute(args){
      const diffStats=(args as {diffStats:SplitInput}).diffStats
      const mode=(args as {mode:'quick'|'deep'}).mode
      return splitScope(diffStats, mode) as never
    }
  }), 'scope split'))
}
