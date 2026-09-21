/**
 * Ambient types for the DSH skills provider contract.
 *
 * `@deepseek-ai/dsh-skill` ships inside the deepseek-harness host and is not a
 * resolvable dependency of this package (verified: `require.resolve` returns
 * MODULE_NOT_FOUND while `dsh-tools`, `dsh-agent` etc. do resolve). Declaring
 * the slice we implement here keeps the types honest without adding a
 * dependency that cannot be installed — the same approach
 * `dsh-maestro-supervisor` uses for its own provider.
 *
 * Field-for-field against
 * `deepseek-harness/packages/skill/skill/lib/types/index.d.ts`. Getting this
 * wrong is worse than having no type at all: an invented shape compiles against
 * a wrong call and rejects a correct one.
 */
declare module '@deepseek-ai/dsh-skill' {
  /** Invocation controls shared by skill discovery consumers. */
  export interface SkillInvocationPolicy {
    readonly modelInvocable: boolean
    readonly userInvocable: boolean
  }

  /** Provider-specific base used by loaded bodies to resolve relative resources. */
  export type SkillResourceBase =
    | { readonly kind: 'directory'; readonly path: string }
    | { readonly kind: 'url'; readonly url: string }
    | { readonly kind: 'opaque'; readonly description: string }

  /** Invocation-neutral metadata; `path` and `resourceBase` are optional. */
  export interface SkillSummary {
    readonly path?: string
    readonly name: string
    readonly description: string
    readonly whenToUse?: string
    readonly invocation: SkillInvocationPolicy
    readonly source: string
    readonly provider: string
    readonly resourceBase?: SkillResourceBase
  }

  /** Provider catalog entry; `rank` orders duplicates, `locator` is opaque. */
  export interface SkillCandidate extends SkillSummary {
    readonly rank: number
    readonly locator: unknown
    readonly metadata?: Readonly<Record<string, unknown>>
  }

  /** Complete parsed skill definition, including the loaded body. */
  export interface SkillDefinition extends SkillSummary {
    readonly content: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }

  /** Caller context for cwd-sensitive and abortable provider work. */
  export interface SkillLookupOptions {
    readonly cwd?: string | undefined
    readonly signal?: AbortSignal | undefined
  }

  /** Registration-scoped lifecycle and invalidation capability. */
  export interface SkillProviderControl {
    readonly signal: AbortSignal
    invalidate: () => void
  }

  /** The provider contract `registerProvider` expects. */
  export interface SkillProvider {
    readonly name: string
    readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[]>
    readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
  }
}
