#!/usr/bin/env node
// prepublishOnly: refuse to publish against an engine older than this
// plugin's minor. pnpm publish rewrites `workspace:^` to a caret range of the
// sibling engine's version, so an older engine ships a range that never
// resolves to the engine this plugin was built for.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const parse = (v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '')?.slice(1).map(Number)

/** Why publishing is unsafe, or undefined when the engine is at or above the plugin's major.minor. */
export function engineVersionProblem(pluginVersion, engineVersion) {
  const p = parse(pluginVersion)
  const e = parse(engineVersion)
  if (!p || !e) return `cannot read the plugin (${pluginVersion}) or engine (${engineVersion}) version`
  const older = e[0] < p[0] || (e[0] === p[0] && e[1] < p[1])
  return older ? `the engine @ddtcorex/maestro-reviewer is ${engineVersion}, older than this plugin's ${pluginVersion}; publish the engine first` : undefined
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')).version } catch { return undefined } }
  const problem = engineVersionProblem(read(join(root, 'package.json')), read(join(root, 'node_modules/@ddtcorex/maestro-reviewer/package.json')))
  if (problem) { console.error(`check-engine-version: ${problem}`); process.exit(1) }
}
