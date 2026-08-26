import { basename, extname, join, resolve, sep } from 'node:path'
import { readdir, readFile, realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-search-tool'
export const inject = ['tools']

export interface Config {
  rootPath?: string
}

export const Config: z<Config> = z.object({
  rootPath: z.string(),
})

/**
 * Same root-resolution rule as the workspace tools (parity with
 * @ddtcorex/dsh-maestro-govard/src/workspace-tool.ts): explicit config wins,
 * otherwise the calling agent's per-session workspace so review agents search
 * their own worktree instead of the harness process cwd.
 */
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
    // Unresolvable paths (broken symlinks etc.) cannot be proven contained.
    return false
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 2000
const MAX_MATCHES = 50

function globToRegExp(glob: string): RegExp | undefined {
  if (glob === '' || glob === '*') return undefined
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** Bounded recursive walk yielding file paths relative to `dir`. */
async function* walkFiles(dir: string, base: string, budget: { files: number }): AsyncGenerator<string> {
  if (budget.files <= 0) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.files <= 0) return
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walkFiles(join(dir, entry.name), base, budget)
      continue
    }
    if (!entry.isFile()) continue
    budget.files -= 1
    yield join(dir, entry.name)
  }
}

/**
 * Grep-style content search over the review workspace. Reviewers have no
 * shell; this is how they verify claims against the actual project sources
 * (tailwind.config.js extensions/safelist, class usages, block wiring).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const configuredRoot = config.rootPath

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'maestro_search_files',
    description: 'Search file contents under the current workspace root with a regular expression. Returns matching lines as "path:line: text". Use this before claiming something does or does not exist in the codebase.',
    parameters: {
      pattern: { type: 'string', required: true, description: 'Regular expression (JavaScript syntax) matched against each line.' },
      path: { type: 'string', description: 'Optional directory or file prefix, relative to the workspace root.' },
      glob: { type: 'string', description: 'Optional filename filter, e.g. "*.phtml" or "**/*.css".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const root = workspaceRootFor(configuredRoot, exec)
      const requested = args.path ?? ''
      if (!(await isInsideRoot(root, requested))) {
        return { text: `Path "${requested}" escapes the workspace root.`, truncated: false } as never
      }
      const searchRoot = requested === '' ? root : resolve(root, requested)

      let pattern: RegExp
      try {
        pattern = new RegExp(args.pattern)
      } catch (err) {
        return { text: `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`, truncated: false } as never
      }
      const nameFilter = args.glob === undefined ? undefined : globToRegExp(args.glob)

      const budget = { files: MAX_FILES }
      const lines: string[] = []
      let totalMatched = 0
      let truncated = false
      for await (const file of walkFiles(searchRoot, root, budget)) {
        if (nameFilter !== undefined && !nameFilter.test(basename(file))) continue
        if (extname(file) === '.zip') continue
        let content: string
        try {
          const stat = await readFile(file)
          if (stat.byteLength > MAX_FILE_BYTES) continue
          content = stat.toString('utf-8')
        } catch {
          continue
        }
        const relative = file.startsWith(root + sep) ? file.slice(root.length + 1) : basename(file)
        content.split('\n').forEach((row, index) => {
          if (!pattern.test(row)) return
          totalMatched += 1
          if (totalMatched <= MAX_MATCHES) {
            lines.push(`${relative}:${index + 1}: ${row.trim().slice(0, 240)}`)
          }
        })
      }
      if (budget.files <= 0 || totalMatched > MAX_MATCHES) truncated = true
      const header = lines.length === 0 ? `No matches for /${args.pattern}/` : `${lines.length} match(es)${truncated ? ' (truncated)' : ''}:`
      return { text: [header, ...lines].join('\n'), truncated } as never
    },
  }), 'maestro search tool'))
}
