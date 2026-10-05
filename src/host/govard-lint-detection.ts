import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Whether a binary named `govard` is executable on the host PATH. The lint and
 * environment commands the review prompts demand run through the shell tool, so
 * a host without the binary must not be told to run them.
 */
export function govardOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = env.PATH
  if (path === undefined || path === '') return false
  for (const entry of path.split(delimiter)) {
    if (entry === '') continue
    try {
      accessSync(join(entry, 'govard'), constants.X_OK)
      return true
    } catch {
      // not here, keep scanning
    }
  }
  return false
}

/**
 * Whether the reviewer prompt may demand the govard CLI lint run: the shell
 * tool (`bash`, from `@deepseek-ai/dsh-tool-bash`) must resolve for the agent
 * scope AND the `govard` binary must be on PATH.
 *
 * The tool answer comes from the harness registry, read as
 * `tools.get(name, scope)`. A registry that cannot be read is NOT evidence that
 * the tool exists, so every failure path answers false and none of them
 * throws: a lint signal that is merely absent must never fail a review.
 */
export function detectGovardLint(
  ctx: { get?: (name: string) => unknown },
  scope: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const tools = ctx.get?.('tools') as { get?: (name: string, scope: unknown) => unknown } | undefined
    if (typeof tools?.get !== 'function') return false
    if (tools.get('bash', scope) === undefined) return false
    return govardOnPath(env)
  } catch {
    return false
  }
}
