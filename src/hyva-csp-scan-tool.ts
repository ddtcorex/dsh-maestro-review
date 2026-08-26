import { join, resolve, sep, basename } from 'node:path'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-hyva-csp-scan-tool'
export const inject = ['tools']
export const Config: z<{ rootPath?: string }> = z.object({ rootPath: z.string() })

interface SessionCwdSource { agent?: { session?: { header?: { cwd?: string } } } }
function workspaceRootFor(configuredRoot: string | undefined, exec: unknown): string {
  if (configuredRoot !== undefined) return configuredRoot
  const cwd = (exec as SessionCwdSource | undefined)?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}
async function isInsideRoot(rootPath: string, target: string): Promise<boolean> {
  const absoluteRoot = resolve(rootPath)
  const resolved = resolve(absoluteRoot, target)
  if (resolved !== absoluteRoot && !resolved.startsWith(absoluteRoot + sep)) return false
  try {
    const realRoot = await realpath(absoluteRoot)
    const realTarget = await realpath(resolved)
    return realTarget === realRoot || realTarget.startsWith(realRoot + sep)
  } catch { return false }
}
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES_DEFAULT = 200
const MAX_ISSUES = 100
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'pub/static'])
const PHTML_RE = /\.phtml$/
const SCRIPT_RE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi
const HYVA_CSP_RE = /\$hyvaCsp\s*->\s*registerInlineScript\s*\(/
const DIRECTIVE_RE = /\s(@click|x-show|x-model|:value|@input|:class|x-text|x-if|x-for|@change)\s*=\s*"([^"]*)"/g
const DOT_PATH_RE = /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*(\([^)]*\))?$/

async function* walkPhtml(dir: string, base: string, budget: { files: number }): AsyncGenerator<string> {
  if (budget.files <= 0) return
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (budget.files <= 0) return
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walkPhtml(join(dir, entry.name), base, budget)
      continue
    }
    if (!entry.isFile()) continue
    if (!PHTML_RE.test(entry.name)) continue
    budget.files -= 1
    yield join(dir, entry.name)
  }
}
function lineOf(text: string, idx: number): number { return text.slice(0, idx).split('\n').length }

export function apply(ctx: Context, config: { rootPath?: string } = {}): void {
  const configuredRoot = config.rootPath
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'hyva_csp_scan',
    description: 'Scan .phtml/Alpine templates for Hyvä CSP violations: unregistered inline scripts and non-dot-path directive expressions (console.warn-only at runtime, so static review is the gate).',
    parameters: {
      scope: { type: 'string', enum: ['diff', 'paths', 'dir'], required: true },
      paths: { type: 'array', items: { type: 'string' } },
      dir: { type: 'string' },
      cspBuild: { type: 'boolean' },
      maxFiles: { type: 'number' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          issues: { type: 'array', required: true },
          scannedFiles: { type: 'number', required: true },
          clean: { type: 'boolean', required: true },
        },
      },
      render: (_args, v: { clean: boolean; scannedFiles: number; issues: unknown[] }) => [{ type: 'text', text: v.clean ? `CSP clean — ${v.scannedFiles} files scanned.` : `${(v.issues as unknown[]).length} CSP issue(s) in ${v.scannedFiles} files` }],
    },
    async execute(args, exec) {
      const root = workspaceRootFor(configuredRoot, exec)
      const scope = (args as { scope: string }).scope
      const cspBuild = (args as { cspBuild?: boolean }).cspBuild ?? false
      const maxFiles = (args as { maxFiles?: number }).maxFiles ?? MAX_FILES_DEFAULT

      let files: string[] = []
      if (scope === 'paths') {
        const paths = (args as { paths?: string[] }).paths ?? []
        for (const p of paths) {
          if (!(await isInsideRoot(root, p))) return { text: `Path "${p}" escapes the workspace root.`, truncated: false } as never
          const abs = resolve(root, p)
          try { const s = await stat(abs); if (s.isFile() && PHTML_RE.test(p)) files.push(p) } catch {}
        }
      } else if (scope === 'dir') {
        const dirArg = (args as { dir?: string }).dir
        const base = dirArg ? resolve(root, dirArg) : root
        if (dirArg && !(await isInsideRoot(root, dirArg))) return { text: `Path "${dirArg}" escapes the workspace root.`, truncated: false } as never
        const budget = { files: maxFiles }
        for await (const f of walkPhtml(base, root, budget)) {
          const rel = f.startsWith(root + sep) ? f.slice(root.length + 1) : basename(f)
          files.push(rel)
          if (files.length >= maxFiles) break
        }
      } else {
        // diff fallback: walk all phtml
        const budget = { files: maxFiles }
        for await (const f of walkPhtml(root, root, budget)) {
          const rel = f.startsWith(root + sep) ? f.slice(root.length + 1) : basename(f)
          files.push(rel)
          if (files.length >= maxFiles) break
        }
      }

      const issues: Array<{ file: string; line: number; type: string; directive: string | null; snippet: string }> = []
      let scannedFiles = 0
      for (const rel of files.slice(0, maxFiles)) {
        if (issues.length >= MAX_ISSUES) break
        const abs = resolve(root, rel)
        let text: string
        try {
          const buf = await readFile(abs)
          if (buf.byteLength > MAX_FILE_BYTES) continue
          text = buf.toString('utf-8')
        } catch { continue }
        scannedFiles++
        const hasRegister = HYVA_CSP_RE.test(text)
        // reset regex lastIndex
        SCRIPT_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = SCRIPT_RE.exec(text)) !== null) {
          if (!hasRegister) {
            const line = lineOf(text, m.index)
            issues.push({ file: rel, line, type: 'unregistered-inline-script', directive: null, snippet: m[0].slice(0, 240).replace(/\s+/g, ' ') })
            if (issues.length >= MAX_ISSUES) break
          }
        }
        DIRECTIVE_RE.lastIndex = 0
        let dm: RegExpExecArray | null
        while ((dm = DIRECTIVE_RE.exec(text)) !== null) {
          const directive = dm[1]
          const value = dm[2].trim()
          if (!value) continue
          if (directive === 'x-model' && cspBuild) {
            const line = lineOf(text, dm.index)
            issues.push({ file: rel, line, type: 'x-model-on-csp-build', directive, snippet: dm[0].slice(0, 240) })
            continue
          }
          const isDotPath = DOT_PATH_RE.test(value)
          if (!isDotPath) {
            const line = lineOf(text, dm.index)
            const type = /\s/.test(value) || /\b(true|false|null|\d+)\b/.test(value) ? 'global-or-literal-value' : 'expression-in-directive'
            // But for test @click="count++" -> expression-in-directive (contains ++)
            const finalType = /(\+\+|--|&&|\|\||[+\-*/%!?:])/.test(value) ? 'expression-in-directive' : type
            issues.push({ file: rel, line, type: finalType, directive, snippet: dm[0].slice(0, 240) })
            if (issues.length >= MAX_ISSUES) break
          } else if (/(\+\+|--|&&|\|\||[+\-*/%!])/.test(value)) {
            const line = lineOf(text, dm.index)
            issues.push({ file: rel, line, type: 'expression-in-directive', directive, snippet: dm[0].slice(0, 240) })
          }
        }
      }
      const clean = issues.filter((i) => i.type !== 'x-model-on-csp-build').length === 0
      return { issues: issues.slice(0, MAX_ISSUES), scannedFiles, clean } as never
    },
  }), 'hyva csp scan'))
}
