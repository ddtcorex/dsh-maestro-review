import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESETS = join(fileURLToPath(new URL('..', import.meta.url)), 'presets')

/** Preset directory under `presets/`, and the preset id the Dockerfile installs it as. */
const PRESET_DIRS = ['maestro-reviewer', 'maestro-auditor', 'maestro-coder'] as const

/** The `- id: <id>` row block, ended by the next row at any indentation. */
function rowBlock(yml: string, id: string): string {
  const lines = yml.split('\n')
  const start = lines.findIndex(l => l.trimStart() === `- id: ${id}`)
  expect(start, `row ${id} present`).toBeGreaterThan(-1)
  const block: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*- id: /.test(lines[i])) break
    block.push(lines[i])
  }
  return block.join('\n')
}

const read = (dir: string): string => readFileSync(join(PRESETS, dir, 'agent.cordis.yml'), 'utf8')

describe.each(PRESET_DIRS)('%s persona row', (dir) => {
  const block = rowBlock(read(dir), 'persona')

  // `@deepseek-ai/dsh-persona` renamed its config field `text` to `prefix` and
  // added `suffix`; a row still naming `text` fails schema validation at mount
  // and takes the whole preset with it.
  it('declares prefix and no text key', () => {
    expect(block).toMatch(/^\s+prefix: /m)
    expect(block).not.toMatch(/^\s+text:/m)
  })

  it('carries a non-empty prefix', () => {
    const header = block.split('\n').find(l => /^\s+prefix: /.test(l))?.replace(/^\s+prefix:\s*/, '').trim()
    // A block-scalar header (`>-`, `|`) carries its content on the lines below.
    if (header === undefined || /^[|>]/.test(header)) {
      expect(block).toMatch(/^\s+prefix: [|>]/m)
      expect(block.split('\n').filter(l => /^\s{6,}\S/.test(l)).length).toBeGreaterThan(0)
      return
    }
    expect(header.length).toBeGreaterThan(0)
  })

  // An omitted suffix is not neutral: `dsh-persona` always registers
  // `deployment:persona-suffix`, so an empty one shadows the deployment's
  // working-directory line away for every session on this preset.
  it('restates the deployment working-directory suffix', () => {
    expect(block).toMatch(/^\s+suffix: Your working directory is \{\{cwd\}\}\.$/m)
  })
})

// Root-caused 2026-09-14: a real MR review crashed calling
// maestro_load_review_profile with a guessed profile on a diff-only CI run
// that has no REVIEW_PROFILE configured — the static persona prefix (cached,
// sent on every turn) unconditionally told the model to call this tool
// "before inspecting code", while the per-request scope prompt separately
// told it "this is a diff-only review with no local checkout or Magento
// environment", giving the model two conflicting instructions with no
// guidance on which wins. skills-tool.ts's loadedReviewProfile() now
// tolerates the resulting Cordis DI gap, but the reviewer prefix should
// still not tell the model to do something the request may not want.
describe('maestro-reviewer persona row scopes the profile-loading step', () => {
  const block = rowBlock(read('maestro-reviewer'), 'persona')

  it('only calls maestro_load_review_profile when the review request names a profile', () => {
    expect(block).toMatch(/if the review request names a (review )?profile/i)
  })

  it('tells the model to skip profile loading for a diff-only review', () => {
    expect(block).toMatch(/diff-only review.*skip/is)
  })
})

describe('maestro-coder parity with the shipped standard preset', () => {
  const yml = read('maestro-coder')

  it('registers the /goal command into the preset scope', () => {
    expect(rowBlock(yml, 'command-goal')).toMatch(/^\s+name: '@deepseek-ai\/dsh-command-goal'$/m)
  })

  it('registers the present tool', () => {
    expect(rowBlock(yml, 'present')).toMatch(/^\s+name: '@deepseek-ai\/dsh-tool-present'$/m)
  })

  it('lets a delegating session choose the child model', () => {
    const block = rowBlock(yml, 'tool-subagent')
    expect(block).toMatch(/^\s+toolName: subagent$/m)
    expect(block).toMatch(/modelSelectionSettings: true/)
  })
})

/**
 * The reviewer and auditor are each mounted by the orchestrator as their own
 * agent; delegating to a Codex/Claude child is what lets a review fan out.
 * `tool-subagent` registers no tool while its provider is absent, so a
 * deployment without the provider bundles gets an inert row, not a mount
 * failure.
 */
describe.each(['maestro-reviewer', 'maestro-auditor'])('%s delegation rows', (dir) => {
  const yml = read(dir)

  it.each([
    ['tool-subagent-codex', 'codex', 'subagent_codex'],
    ['tool-subagent-claude-code', 'claude-code', 'subagent_claude_code'],
  ])('routes %s to its provider as a one-shot child', (id, provider, toolName) => {
    const block = rowBlock(yml, id)
    expect(block).toMatch(/^\s+name: '@deepseek-ai\/dsh-tool-subagent'$/m)
    expect(block).toMatch(new RegExp(`^\\s+provider: ${provider}$`, 'm'))
    expect(block).toMatch(new RegExp(`^\\s+toolName: ${toolName}$`, 'm'))
    expect(block).toMatch(/^\s+backgroundMode: one-shot$/m)
    expect(block).toMatch(/^\s+maxDepth: provider-managed$/m)
  })
})
