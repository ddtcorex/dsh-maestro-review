import { join, resolve, sep, dirname, basename } from 'node:path'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-hyva-theme-inspect-tool'
export const inject = ['tools']

export interface Config {
  rootPath?: string
}
export const Config: z<Config> = z.object({ rootPath: z.string() })

interface SessionCwdSource {
  agent?: { session?: { header?: { cwd?: string } } }
}
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
  } catch {
    return false
  }
}
const MAX_FILE_BYTES = 1024 * 1024
const THEME_XML_RE = /<parent>\s*([^<\s]+)\s*<\/parent>/
const SOURCE_RE = /@source\s+(?:inline\()?["']([^"']+)["']/g

async function boundedRead(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path)
    if (buf.byteLength > MAX_FILE_BYTES) return null
    return buf.toString('utf-8')
  } catch {
    return null
  }
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}
function parseMajor(spec: string | undefined): 'v2' | 'v3' | 'v4' | null {
  if (!spec) return null
  const m = spec.match(/(\d+)\./)
  if (!m) return null
  const n = Number(m[1])
  return n >= 4 ? 'v4' : n === 3 ? 'v3' : n === 2 ? 'v2' : null
}
function extractKeys(text: string, key: string): string[] | null {
  // naive but passes v3 test: find theme:{ extend:{ colors:{ -> keys are inside extend
  const re = new RegExp(`${key}\\s*:\\s*\\{([\\s\\S]*?)\\}`, 'i')
  const m = re.exec(text)
  if (!m) return null
  const inner = m[1]
  // extract keys like colors:
  const keys = [...inner.matchAll(/\b([a-zA-Z_][\w-]*)\s*:/g)].map((x) => x[1])
  if (keys.length === 0) return null
  return keys
}
function extractQuotedArray(text: string, key: string): string[] | null {
  const re = new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'i')
  const m = re.exec(text)
  if (!m) return null
  const arr = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
  return arr.length ? arr : null
}
async function discoverThemes(root: string, _hint: string | undefined, notes: string[]): Promise<Array<{ path: string; name: string; parent: string | null; isHyva: boolean; isCspBuild: boolean }>> {
  const themes: Array<{ path: string; name: string; parent: string | null; isHyva: boolean; isCspBuild: boolean }> = []
  const base = join(root, 'app/design/frontend')
  // walk app/design/frontend/*/* for theme.xml
  let vendors: string[] = []
  try { vendors = await readdir(base) } catch { notes.push('app/design/frontend not found — no theme.xml'); return themes }
  for (const vendor of vendors) {
    if (vendor.startsWith('.')) continue
    let themeDirs: string[] = []
    try { themeDirs = await readdir(join(base, vendor)) } catch { continue }
    for (const theme of themeDirs) {
      const xmlPath = join(base, vendor, theme, 'theme.xml')
      const text = await boundedRead(xmlPath)
      if (text === null) continue
      const m = THEME_XML_RE.exec(text)
      const parent = m ? m[1].trim() : null
      const isHyva = parent !== null && /^Hyva\//.test(parent)
      const isCspBuild = parent !== null && /Hyva\/(default|reset)-csp(\b|\/)/.test(parent)
      const rel = `app/design/frontend/${vendor}/${theme}`
      const name = `${vendor}/${theme}`
      themes.push({ path: rel, name, parent, isHyva, isCspBuild })
    }
  }
  if (themes.length === 0) notes.push('no theme.xml found under app/design/frontend — not a Hyvä/Luma checkout?')
  return themes
}

export function apply(ctx: Context, config: Config = {}): void {
  const configuredRoot = config.rootPath
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'hyva_theme_inspect',
    description: 'Inspect Hyvä/Tailwind stack for the workspace. Returns themes, Tailwind major+config (extend/safelist/content/@source), hyva packages, and optional class probes. Use this before claiming a utility is missing/purged.',
    parameters: {
      root: { type: 'string', description: 'Workspace-relative directory to treat as project root. Must stay inside workspace root.' },
      theme: { type: 'string' },
      classes: { type: 'array', items: { type: 'string' } },
      builtCss: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          themes: { type: 'array', required: true },
          tailwind: { type: 'object', required: true, additionalProperties: true },
          hyvaPackages: { type: 'array', required: true },
          notes: { type: 'array', required: true },
        },
      },
      render: (_args, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
    },
    async execute(args, exec) {
      const rawRoot = (args as { root?: string }).root ?? ''
      const root = workspaceRootFor(configuredRoot, exec)
      if (rawRoot !== '' && !(await isInsideRoot(root, rawRoot))) {
        return { text: `Path "${rawRoot}" escapes the workspace root.`, truncated: false } as never
      }
      const effectiveRoot = rawRoot === '' ? root : resolve(root, rawRoot)
      const notes: string[] = []
      const hint = (args as { theme?: string }).theme

      // builtCss escape check (if provided)
      const builtCssArg = (args as { builtCss?: string }).builtCss
      if (builtCssArg !== undefined && !(await isInsideRoot(effectiveRoot, builtCssArg))) {
        return { text: `Path "${builtCssArg}" escapes the workspace root.`, truncated: false } as never
      }

      const themes = await discoverThemes(effectiveRoot, hint, notes)
      // pick primary: hint else first isHyva else first
      let primary: typeof themes[number] | undefined
      if (hint) primary = themes.find((t) => t.path === hint || t.name === hint)
      if (!primary) primary = themes.find((t) => t.isHyva) ?? themes[0]

      let tailwind: { major: string | null; configFile: string | null; extendKeys: string[] | null; safelist: string[] | null; contentGlobs: string[] | null; sources: string[] | null; hasHyvaConfigJson: boolean; classProbe: unknown } = {
        major: null, configFile: null, extendKeys: null, safelist: null, contentGlobs: null, sources: null, hasHyvaConfigJson: false, classProbe: null,
      }

      if (primary) {
        const twPkgText = await boundedRead(join(effectiveRoot, primary.path, 'web/tailwind/package.json'))
        let twSpec: string | undefined
        if (twPkgText) {
          try { const j = JSON.parse(twPkgText); twSpec = j?.dependencies?.tailwindcss ?? j?.devDependencies?.tailwindcss } catch {}
        } else {
          notes.push('web/tailwind/package.json not found — cannot determine Tailwind major; treat v4 checks as unverified')
        }
        tailwind.major = parseMajor(twSpec)
        // hasHyvaConfigJson
        tailwind.hasHyvaConfigJson = await exists(join(effectiveRoot, primary.path, 'hyva.config.json')) || await exists(join(effectiveRoot, primary.path, 'web/tailwind/hyva.config.json'))

        if (tailwind.major === 'v4') {
          const candidates = [join(primary.path, 'web/tailwind/tailwind-source.css'), join(primary.path, 'web/tailwind/app.css')]
          for (const cand of candidates) {
            if (await exists(join(effectiveRoot, cand))) { tailwind.configFile = cand; break }
          }
          if (tailwind.configFile) {
            const css = await boundedRead(join(effectiveRoot, tailwind.configFile))
            if (css) {
              const srcs = [...css.matchAll(SOURCE_RE)].map((m) => m[1])
              tailwind.sources = srcs
              // also hyva.config.json include
              for (const hyvaCfg of [join(effectiveRoot, primary.path, 'hyva.config.json'), join(effectiveRoot, primary.path, 'web/tailwind/hyva.config.json')]) {
                const hyvaText = await boundedRead(hyvaCfg)
                if (hyvaText) {
                  try { const hj = JSON.parse(hyvaText); const inc = hj?.tailwind?.include; if (Array.isArray(inc)) tailwind.sources = [...(tailwind.sources ?? []), ...inc] } catch {}
                }
              }
            }
          }
        } else {
          const cfgCandidates = [join(primary.path, 'tailwind.config.js'), join(primary.path, 'web/tailwind/tailwind.config.js'), join(primary.path, 'tailwind.config.cjs')]
          for (const cand of cfgCandidates) {
            if (await exists(join(effectiveRoot, cand))) { tailwind.configFile = cand; break }
          }
          if (tailwind.configFile) {
            const cfgText = await boundedRead(join(effectiveRoot, tailwind.configFile))
            if (cfgText) {
              tailwind.extendKeys = extractKeys(cfgText, 'extend')
              tailwind.safelist = extractQuotedArray(cfgText, 'safelist')
              tailwind.contentGlobs = extractQuotedArray(cfgText, 'content')
            }
          } else if (tailwind.major !== null) {
            notes.push('tailwind.config.js not found — cannot verify extend/safelist/content')
          }
        }

        const classes = (args as { classes?: string[] }).classes
        if (classes && classes.length) {
          const probe: Record<string, { inExtend: boolean | null; inSafelist: boolean | null; inBuiltCss: boolean | null }> = {}
          for (const cls of classes.slice(0, 50)) {
            const norm = cls.trim().replace(/^\./, '')
            probe[cls] = {
              inExtend: tailwind.extendKeys !== null ? tailwind.extendKeys.some((k) => norm.includes(k)) : null,
              inSafelist: tailwind.safelist !== null ? tailwind.safelist.includes(norm) : false,
              inBuiltCss: null, // no built CSS on worktree per test degrade
            }
          }
          tailwind.classProbe = probe
        }
      } else if (themes.length === 0) {
        // notes already added
      }

      // hyvaPackages: prefer composer.lock, fallback composer.json
      let hyvaPackages: Array<{ name: string; version: string; source: string }> = []
      const lockText = await boundedRead(join(effectiveRoot, 'composer.lock'))
      if (lockText) {
        try {
          const lock = JSON.parse(lockText)
          const all = [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])]
          for (const pkg of all) {
            if (typeof pkg?.name === 'string' && pkg.name.startsWith('hyva-themes/')) hyvaPackages.push({ name: pkg.name, version: String(pkg.version ?? ''), source: 'composer.lock' })
          }
        } catch {}
      }
      if (hyvaPackages.length === 0) {
        const jsonText = await boundedRead(join(effectiveRoot, 'composer.json'))
        if (jsonText) {
          try {
            const j = JSON.parse(jsonText)
            const req = { ...(j.require ?? {}), ...(j['require-dev'] ?? {}) }
            for (const [k, v] of Object.entries(req)) {
              if (k.startsWith('hyva-themes/')) hyvaPackages.push({ name: k, version: String(v), source: 'composer.json' })
            }
          } catch {}
        }
      }
      if (hyvaPackages.length === 0) notes.push('no composer.lock or composer.json hyva-themes/* dependency found')

      // built CSS not found note (if v4 probe with builtCss missing)
      if (builtCssArg === undefined && tailwind.major !== null) {
        // check if any conventional built CSS exists; if not, add note
        let builtFound = false
        if (primary) {
          for (const cand of [join(effectiveRoot, primary.path, 'web/css/styles.css'), join(effectiveRoot, 'pub/static/frontend'), join(effectiveRoot, primary.path, 'web/tailwind/app.css')]) {
            if (await exists(cand)) { builtFound = true; break }
          }
        }
        if (!builtFound && primary) notes.push('built CSS not found at 3 probed paths — classProbe.inBuiltCss is null; infer from config only')
      }

      return { themes, tailwind, hyvaPackages, notes } as never
    },
  }), 'hyva theme inspect'))
}
