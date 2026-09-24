import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('profiles/reviewer-ci/cordis.patch.yml', () => {
  it('botUsername reads from REVIEW_BOT_USERNAME (falling back to maestro-bot) instead of a bare hardcoded value', () => {
    // The orchestrator's `botUsername` config also drives review-signals.ts's
    // unawardOwn() (clearing the running "eyes" marker) and gitlab-client.ts's
    // selectOwnThreads() (dedup/reply detection) — both filter GitLab objects
    // by `author.username === botUsername`. A hardcoded "maestro-bot" that
    // doesn't match the real identity behind MAESTRO_GITLAB_TOKEN (a personal
    // PAT posts as its owner's username, not "maestro-bot") means neither
    // check ever recognizes the reviewer's own objects: stale "eyes" markers
    // never get cleared, and re-reviews can't tell their own prior threads
    // apart from anyone else's — found live 2026-09-05 (every award_emoji
    // during today's real E2E tests was posted as the token owner's real
    // GitLab username, never "maestro-bot").
    const yml = readFileSync('profiles/reviewer-ci/cordis.patch.yml', 'utf-8')
    expect(yml).not.toMatch(/^\s*botUsername:\s*maestro-bot\s*$/m)
    expect(yml).toMatch(/botUsername:\s*!!js\s*["']process\.env\.REVIEW_BOT_USERNAME\s*\|\|\s*['"]maestro-bot['"]["']/)
  })
})

/**
 * The image delivers the reviewer/auditor presets through the Dockerfile's
 * `COPY presets/<id> ./.agent-presets/<id>`, and the orchestrator then mounts
 * them by id (`agentPresets.mount(agentCtx, 'dsh-maestro-reviewer')`). Only the
 * legacy provider reads that directory: `@deepseek-ai/dsh-agent-presets`
 * defaults `includeUserRoot` to true and scans `$DSH_HOME/.agent-presets`,
 * while the 0.1.7-line replacement `@deepseek-ai/dsh-agent-preset-registry`
 * collects declarations from loader rows alone (its `static inject` is
 * `['loader', 'sessionProjections']`; no directory scan exists anywhere in the
 * 0.1.7 tree — verified 2026-09-24 by grepping every package's `src/` for
 * `.agent-presets` and by running the legacy `discoverPresets()` against a
 * temp home, which found both presets).
 *
 * So swapping the provider row without also declaring `preset-dsh-maestro-*`
 * rows composes and boots cleanly and then fails at review time with an
 * unknown-preset mount. This test is the tripwire for that swap.
 */
describe('reviewer-ci preset delivery', () => {
  const patch = readFileSync('profiles/reviewer-ci/cordis.patch.yml', 'utf-8')
  const dockerfile = readFileSync('docker/Dockerfile', 'utf-8')
  const legacyProvider = /name:\s*'@deepseek-ai\/dsh-agent-presets'/.test(patch)
  const registryProvider = /name:\s*'@deepseek-ai\/dsh-agent-preset-registry'/.test(patch)

  it('inserts exactly one agent-preset provider row', () => {
    expect(legacyProvider).not.toBe(registryProvider)
  })

  it('keeps the .agent-presets COPY paired with a provider that scans that directory', () => {
    if (registryProvider) {
      expect(patch).toMatch(/id: preset-dsh-maestro-reviewer/)
      expect(patch).toMatch(/id: preset-dsh-maestro-auditor/)
    } else {
      expect(dockerfile).toMatch(/COPY presets\/maestro-reviewer \.\/\.agent-presets\/dsh-maestro-reviewer/)
      expect(dockerfile).toMatch(/COPY presets\/maestro-auditor \.\/\.agent-presets\/dsh-maestro-auditor/)
    }
  })
})
