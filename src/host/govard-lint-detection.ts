/**
 * Whether the globally registered `govard_audit_lint` is visible to a review
 * agent. `dsh-maestro-govard` owns the tool; review must not mount a second
 * copy, so the only question left is whether the reviewer prompt may demand a
 * lint call.
 *
 * The answer comes from the harness tool registry, which the supervisor's
 * `src/host/tool-view.ts` already reads as `tools.get(name, scope)`. A registry
 * that cannot be read is NOT evidence that the tool exists, so every failure
 * path answers false and none of them throws: a lint signal that is merely
 * absent must never fail a review.
 */
export function detectGovardLint(
  ctx: { get?: (name: string) => unknown },
  scope: unknown,
): boolean {
  try {
    const tools = ctx.get?.('tools') as { get?: (name: string, scope: unknown) => unknown } | undefined
    if (typeof tools?.get !== 'function') return false
    return tools.get('govard_audit_lint', scope) !== undefined
  } catch {
    return false
  }
}