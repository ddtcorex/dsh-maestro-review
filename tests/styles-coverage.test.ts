import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REVIEW_CSS } from '../src/client/review/styles.js'

/**
 * A style hook with no rule is a defect even when nothing looks obviously
 * broken — jsdom computes no layout, so a spec that only mounts the component
 * cannot see it. This gate asks the stylesheet to cover every control type the
 * section actually emits, and to declare the text hooks once.
 *
 * It exists because of two measured defects:
 *   - the row's box rule listed input[type="text"] and select but not
 *     input[type="password"], so the two secret fields rendered at the UA
 *     default — 21px tall, no radius — beside 32px fields in the same column;
 *   - a stale 12px/600 label rule sat BELOW the house 14px/400 one and won on
 *     source order at equal specificity, so the whole tab rendered at the old
 *     weight. Duplicate rules are only a defect when they compete over the
 *     same property — `[data-x-row]` and `[data-x-row]:last-of-type` are not.
 */
const entry = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/review/ReviewSettings.tsx'),
  'utf8',
)

/** Every input type and select the section actually renders. */
function controlTypesEmitted(): string[] {
  const types = new Set<string>()
  for (const m of entry.matchAll(/type:\s*'(text|password|checkbox)'/g)) types.add(`input[type="${m[1]}"]`)
  if (/createElement\(\s*'select'/.test(entry)) types.add('select')
  return [...types].sort()
}

/** Block comments stripped, so prose above a rule can never satisfy an assertion. */
const stripped = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * The declaration body of the rule whose selector list starts with `prefix` and
 * which styles a form control. Scoping the assertion to this body is what stops
 * an unrelated rule elsewhere in the sheet from satisfying it.
 */
function fieldRuleBody(css: string, prefix: string): string {
  const source = stripped(css)
  for (const m of source.matchAll(new RegExp(`(${prefix.replace(/[[\]]/g, '\\$&')}[^{}]*(?:input|select|textarea)[^{}]*)\\{([^{}]*)\\}`, 'g'))) {
    if (m[2]!.includes('min-height')) return m[2]!
  }
  return ''
}

/**
 * The shared settings field box, copied from the host's own form primitive
 * (`ui-primitives/src/ConfigField.module.css`) plus the one Maestro-only value,
 * `min-height: 44px`, for the >=40px touch target AGENTS.md requires.
 *
 * Tokens, never resolved values: `--dsw-radius-md` must stay the token so a
 * host change reaches this plugin without editing it.
 */
const standardBox = (body: string): boolean =>
  /padding:\s*6px 12px/.test(body)
  && /border:\s*0\.5px solid var\(--dsw-alias-border-l4\)/.test(body)
  && /border-radius:\s*var\(--dsw-radius-md\)/.test(body)
  && /background:\s*var\(--dsw-alias-bg-layer-3\)/.test(body)
  && /min-height:\s*44px/.test(body)

describe('review settings stylesheet', () => {
  it('has a rule for every control type the section emits', () => {
    const emitted = controlTypesEmitted()
    expect(emitted.length, 'the section must emit at least one control').toBeGreaterThan(0)

    for (const selector of emitted) {
      expect(REVIEW_CSS, `no rule matches ${selector}`).toContain(selector)
    }
  })

  it('declares the text hooks once, so nothing wins on source order', () => {
    for (const hook of ['label', 'hint'] as const) {
      const rules = REVIEW_CSS.match(new RegExp(`\\[data-review-${hook}\\]\\s*\\{`, 'g')) ?? []
      expect(rules.length, `duplicate [data-review-${hook}] rule silently wins`).toBe(1)
    }
  })

  it('carries the house row values', () => {
    // 14/400 label, 12/18 tertiary hint — the reference row's values.
    expect(REVIEW_CSS).toMatch(/\[data-review-label\]\s*\{[^}]*font-size:\s*14px[^}]*font-weight:\s*400/s)
    expect(REVIEW_CSS).toMatch(/\[data-review-hint\]\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*18px/s)
  })

  it('holds every row control to the same box', () => {
    // Collect the CONTROL rules that give a control its box, and assert their
    // combined selector list covers every non-checkbox control the section
    // emits, all at one geometry. A type missing from that list is exactly what
    // rendered the two secret fields at the UA default: 21px tall, no radius.
    const boxRules = [...REVIEW_CSS.matchAll(/(\[data-review-control\][^{}]*)\{([^}]*min-height:\s*44px[^}]*)\}/g)]
    expect(boxRules.length, 'no control box rule found').toBeGreaterThan(0)
    const selectors = boxRules.map((m) => m[1]!).join(' , ')
    for (const type of controlTypesEmitted()) {
      if (type === 'input[type="checkbox"]') continue
      expect(selectors, type + ' is in no 44px box rule').toContain(type)
    }
    for (const m of boxRules) {
      expect(m[2]!, 'a 44px control rule without the host radius token').toMatch(/border-radius:\s*var\(--dsw-radius-md\)/)
    }
  })

  it('gives the checkbox the harness size, not the UA default', () => {
    // Measured 13x13 on the live dialog without this rule; the reference row
    // draws 16x16 with the brand accent.
    expect(REVIEW_CSS).toMatch(/input\[type="checkbox"\]\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/s)
  })

  it('every field control uses the shared settings box', () => {
    const body = fieldRuleBody(REVIEW_CSS, '[data-review-control]')
    expect(body, 'review fields must use the shared box from ConfigField').not.toBe('')
    expect(standardBox(body)).toBe(true)
  })

  it('the shared box never reaches the checkbox', () => {
    // The harness draws a checkbox at 16px square. A field-box rule that also
    // matched it would inflate it to 44px; the checkbox rule must stay separate.
    const body = fieldRuleBody(REVIEW_CSS, '[data-review-control]')
    expect(body).not.toContain('input[type="checkbox"]')
    expect(REVIEW_CSS).toMatch(/input\[type="checkbox"\]\s*\{[^}]*width:\s*16px/s)
  })
})