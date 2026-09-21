/**
 * Ambient types for the DSH skills provider contract.
 *
 * `@deepseek-ai/dsh-skill` ships inside the deepseek-harness host and is not a
 * resolvable dependency of this package (verified: `require.resolve` returns
 * MODULE_NOT_FOUND while `dsh-tools`, `dsh-agent` etc. do resolve). Declaring
 * the slice we implement here keeps the types honest without adding a
 * dependency that cannot be installed — the same approach
 * `dsh-maestro-supervisor` uses for its own provider.
 */
declare module '@deepseek-ai/dsh-skill' {
  export interface SkillInvocation {
    modelInvocable: boolean
    userInvocable: boolean
  }

  export interface ResourceBase {
    kind: string
    path: string
  }

  export interface SkillCandidate {
    name: string
    description: string
    invocation: SkillInvocation
    source: string
    provider: string
    rank: number
    locator: string
    path: string
    resourceBase: ResourceBase
    metadata: Record<string, unknown>
  }

  export interface SkillDefinition {
    name: string
    description: string
    invocation: SkillInvocation
    source: string
    provider: string
    resourceBase: ResourceBase
    path: string
    content: string
    metadata: Record<string, unknown>
  }

  export interface SkillLookupOptions {
    query?: string
    limit?: number
  }
}
