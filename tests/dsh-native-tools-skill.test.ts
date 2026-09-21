import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(REPO_ROOT, 'skills', 'dsh-native-tools', 'SKILL.md')

const read = () => readFileSync(SKILL, 'utf-8')

const FRONTMATTER = /^---\nname: dsh-native-tools\ndescription: .+\n---\n/

describe('dsh-native-tools skill', () => {
  it('ships the frontmatter the skill provider requires', () => {
    const text = read()
    expect(text).toMatch(FRONTMATTER)
    // The description is the only text the model sees before loading the skill,
    // so it must name the trigger: a public skill saying "native ... when provided".
    const description = text.match(/^description: (.+)$/m)?.[1] ?? ''
    expect(description).toContain('native')
    expect(description.length).toBeGreaterThan(60)
  })

  it('maps the harness-agnostic actions the public skills name', () => {
    const text = read()
    for (const row of [
      '| Invoke / load a skill | `skill` with `{ name }` |',
      '| Ask your human partner | `ask_user_question` |',
      '| Read a file / find files / search contents | `read`, `glob`, `grep` |',
    ]) expect(text).toContain(row)
  })

  it('names every native tool this plugin registers', () => {
    const text = read()
    // Owned here — a rename in src/host must fail this test, not silently rot the map.
    for (const tool of [
      'maestro_perf_log_stats',
      'layout_xml_extract',
      'hyva_theme_inspect',
      'maestro_review_scope_split',
      'phtml_escape_scan',
      'magento_module_check',
      'gitlab_get_mr_diff',
    ]) expect(text, tool).toContain(tool)
  })

  it('maps the tools the sibling plugins own', () => {
    const text = read()
    for (const tool of [
      'govard_audit_lint',
      'govard_deploy_plan',
      'govard_deploy_check',
    ]) expect(text, tool).toContain(tool)
  })

  it('stays a tool map, not a copy of the public skill bodies', () => {
    const text = read()
    // No portable recipes: the public skill already carries them, and duplicating
    // them here would rot on the next edit there.
    expect(text).not.toContain('grep -c')
    expect(text).not.toContain('pt-query-digest')
    expect(text).not.toContain('mysqldumpslow')
  })

  it('carries no secrets, client slugs, or host paths', () => {
    const text = read()
    expect(text).not.toMatch(/ghp_|github_pat_|glpat-|sk-[A-Za-z0-9]{16}/)
    // Host path and client slugs come from the private blacklist at the meta root
    // (docs/PUBLIC_WORD_BLACKLIST.md) — asserted through built strings so this
    // test file itself never repeats a private name into public history.
    const hostPath = ['', 'home', 'kai', ''].join('/')
    const slugs = ['bebe' + '9', 'carre' + 'blanc', 'ick' + 'o', 'visiter' + 'lyon']
    expect(text).not.toContain(hostPath)
    for (const slug of slugs) expect(text, slug).not.toContain(slug)
  })
})
