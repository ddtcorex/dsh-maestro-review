import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

/**
 * The Save button must sit INLINE with the field it saves.
 *
 * The markup was always `div[data-review-secret-group] > input + button`, so a
 * test that only asserts the marker exists passes on the stacked layout too —
 * the marker says nothing about layout. These assertions therefore read the CSS
 * declaration and the inline style, never the marker's presence.
 */
const styles = readFileSync(new URL('../src/client/review/styles.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const panel = readFileSync(new URL('../src/client/review/ReviewSettings.tsx', import.meta.url), 'utf8')

/** The declaration body of the first rule whose selector list contains `selector`. */
function ruleBody(source: string, selector: string): string {
  const pattern = new RegExp(
    `([^{}]*\\${selector}[^{}]*)\\{([^}]*)\\}`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match[1].split(',').some((part) => part.trim().endsWith(selector))) return match[2]
  }
  return ''
}

describe('the secret field row', () => {
  it('lays the group out as a row, not a column', () => {
    const body = ruleBody(styles, '[data-review-secret-group]')
    assert.match(body, /display:\s*flex/)
    assert.match(
      body,
      /flex-direction:\s*row/,
      'the group must be a row; a column stacks the Save below the field',
    )
    assert.doesNotMatch(body, /flex-direction:\s*column/)
  })

  it('keeps the field flexible so it takes the free width', () => {
    // The input has no width rule of its own; the group must let it grow. A
    // fixed width here would leave the buttons squeezed on a narrow phone.
    // `min-width: 220px` is a floor and predates this change — only a `width`
    // would pin the box.
    const body = ruleBody(styles, '[data-review-secret-group]')
    assert.doesNotMatch(
      body,
      /(?:^|[\s;])width:\s*\d/,
      'the group must not fix a width; the field should flex',
    )
    assert.match(
      ruleBody(styles, '[data-review-secret-group] input'),
      /flex:\s*1/,
      'the input must flex to take the remaining width',
    )
    assert.match(
      ruleBody(styles, '[data-review-secret-group] input'),
      /min-width:\s*0/,
      'the input needs min-width:0 or it will not shrink below its intrinsic size',
    )
  })

  it('pins the buttons to the right edge and centres them against the field', () => {
    const body = ruleBody(styles, '[data-review-secret-group] button')
    assert.match(
      body,
      /flex:\s*none/,
      'the Save button must not grow, or it eats the field width',
    )
    assert.match(body, /align-self:\s*center/, 'the button centres against the field')
    assert.doesNotMatch(
      body,
      /align-self:\s*flex-end/,
      'flex-end was the stacked-row placement this change replaces',
    )
  })

  it('keeps the Save button disabled until the field holds something', () => {
    // Deliberate, per the panel's own comment: the save belongs to the field.
    const group = panel.slice(panel.indexOf('data-review-secret-group'))
    const disabled = /disabled:\s*props\.disabled\s*\|\|\s*props\.value\s*===\s*''/.exec(group)
    assert.ok(
      disabled,
      'Save must stay disabled while the field is empty',
    )
  })

  it('keeps the button chrome it already had', () => {
    const body = ruleBody(styles, '[data-review-secret-group] button')
    assert.match(body, /border:\s*1px solid var\(--dsw-alias-border-l2\)/)
    assert.match(body, /background:\s*var\(--dsw-alias-bg-layer-1\)/)
  })
})
