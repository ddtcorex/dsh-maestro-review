import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'maestro-skills-tool'
export const inject = ['skills', 'tools']

export type ReviewSkillProfile = 'magento2' | 'generic'

/**
 * Exact skill names rather than a fuzzy search: a review must not silently
 * omit a security or quality pass just because a similarly named skill exists.
 */
export const REVIEW_PROFILE_SKILLS: Record<ReviewSkillProfile, readonly string[]> = {
  magento2: [
    'govard-toolbox',
    'govard-magento',
    'magento2-dev-core',
    'magento2-code-review',
    'magento2-linter',
    'magento2-security-scan',
    'magento2-performance-audit',
  ],
  /** Diff review against general best practices; no project skill set required. */
  generic: [],
}

export const MAESTRO_SKILLS_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/ddtcorex/maestro-skills/master/install.sh | bash -s -- --scope personal --target dsh --skills govard-toolbox,govard-magento,magento2-dev-core,magento2-code-review,magento2-linter,magento2-security-scan,magento2-performance-audit -y'

// This is deliberately process-local and keyed by the reviewer Agent object,
// which every Cordis child context inherits. Preset mounting inserts child
// contexts, so keying on the plugin's context would make a successful load
// invisible to the orchestrator's agent context.
const loadedReviewProfiles = new WeakMap<object, ReviewSkillProfile>()

export function loadedReviewProfile(ctx: Context): ReviewSkillProfile | undefined {
  return ctx.agent === undefined ? undefined : loadedReviewProfiles.get(ctx.agent)
}

// Mirrors @deepseek-ai/dsh-skill's consumer-facing `SkillRegistry` (verified
// against ../../deepseek-harness/packages/skill/skill/lib/types/index.d.ts):
// `list()` returns bare `SkillSummary`-shaped entries (no `locator`/`rank` —
// those belong only to the `SkillProvider` interface a provider implements
// inside `registerProvider()`), and `get()` takes a plain name string, not a
// candidate object.
interface SkillSummaryLike {
  name: string
  description: string
}

interface SkillDefinitionLike {
  name: string
  description: string
  content: string
}

interface SkillsServiceLike {
  list(): Promise<SkillSummaryLike[]>
  get(name: string): Promise<SkillDefinitionLike | undefined>
}

/** Single owned access path to the skills service (declared via `inject`). */
export function skillsService(ctx: Context): SkillsServiceLike {
  return (ctx as unknown as { skills: SkillsServiceLike }).skills
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'maestro_get_skills',
    description: 'Search the DSH skill knowledge base by keyword (matches skill name or description) and return the full content of every matching skill.',
    parameters: {
      query: { type: 'string', required: true, description: 'Keyword to match against skill name/description, e.g. "magento2" or "govard-laravel".' },
    },
    output: {
      // The resolved skill content is part of the validated schema (matching
      // dsh-tools' own `job_output` pattern of declaring every render-needed
      // field on `output.schema`) rather than smuggled past validation on a
      // key excluded from `properties`: `render(args, value)` has no third
      // `extra` argument (verified against
      // node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts), and an
      // `additionalProperties: false` object schema REJECTS undeclared keys
      // outright rather than merely leaving them unvalidated, so a hidden
      // field would fail every call at the registry's output-validation step.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: { type: 'number', required: true },
          skills: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.skills.length === 0) {
          return [{ type: 'text', text: 'No skills matched that query.' }]
        }
        const text = value.skills
          .map(s => `## ${s.name}\n\n${s.content}`)
          .join('\n\n---\n\n')
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const skills = skillsService(ctx)
      const summaries = await skills.list()
      const query = args.query.toLowerCase()
      const matched = summaries.filter(s =>
        s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
      if (matched.length === 0) {
        throw new Error(`No skill matched query "${args.query}".`)
      }
      const resolved: SkillDefinitionLike[] = []
      for (const summary of matched) {
        const def = await skills.get(summary.name)
        if (def !== undefined) resolved.push(def)
      }
      return {
        matches: resolved.length,
        skills: resolved.map(s => ({ name: s.name, content: s.content })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'maestro_load_review_profile',
    description: 'Load the complete, exact skill set required for a configured review profile. Fails if any required skill is unavailable.',
    parameters: {
      profile: { type: 'string', required: true, description: 'Review profile configured for the project. Supported: "magento2" (full Magento skill set), "generic" (no skills required).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profile: { type: 'string', required: true },
          skills: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.skills.length === 0
          ? `Review profile "${value.profile}" loaded. No project-specific skills are required; review the diff against general correctness, security, and performance best practices.`
          : value.skills.map(s => `## ${s.name}\n\n${s.content}`).join('\n\n---\n\n'),
      }],
    },
    async execute(args, exec) {
      const required = REVIEW_PROFILE_SKILLS[args.profile as ReviewSkillProfile]
      if (required === undefined) {
        throw new Error(`Unsupported review skill profile "${args.profile}". Supported profiles: ${Object.keys(REVIEW_PROFILE_SKILLS).map(name => `"${name}"`).join(', ')}.`)
      }
      if (exec.agent === undefined) {
        throw new Error('Review profile loader is not running inside an agent context.')
      }
      const skills = skillsService(ctx)
      const available = new Set((await skills.list()).map(skill => skill.name))
      const missing = required.filter(skill => !available.has(skill))
      if (missing.length > 0) {
        throw new Error(`Missing required review skill(s) for profile "${args.profile}": ${missing.join(', ')}. Install maestro-skills for DSH with: ${MAESTRO_SKILLS_INSTALL_COMMAND}`)
      }
      const resolved = await Promise.all(required.map(skill => skills.get(skill)))
      const unavailable = required.filter((_, index) => resolved[index] === undefined)
      if (unavailable.length > 0) {
        throw new Error(`Required review skill(s) could not be loaded: ${unavailable.join(', ')}. Reinstall maestro-skills for DSH with: ${MAESTRO_SKILLS_INSTALL_COMMAND}`)
      }
      loadedReviewProfiles.set(exec.agent, args.profile as ReviewSkillProfile)
      return {
        profile: args.profile,
        skills: resolved.map(skill => ({ name: skill!.name, content: skill!.content })),
      }
    },
  }))
}
