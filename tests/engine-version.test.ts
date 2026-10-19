import { describe, expect, it } from 'vitest'
import { engineVersionProblem } from '../scripts/check-engine-version.mjs'

// pnpm publish rewrites `workspace:^` to a caret range of the sibling engine's
// version; publishing against an older engine ships a range that never
// resolves to the engine this plugin was built for.
describe('engine version before publish', () => {
  it('accepts an engine at or above the plugin minor', () => {
    expect(engineVersionProblem('0.14.0', '0.14.0')).toBeUndefined()
    expect(engineVersionProblem('0.14.2', '0.14.0')).toBeUndefined()
    expect(engineVersionProblem('0.14.0', '0.15.1')).toBeUndefined()
  })

  it('refuses an older engine, naming both versions', () => {
    expect(engineVersionProblem('0.14.0', '0.13.0')).toMatch(/0\.13\.0.*0\.14\.0/)
    expect(engineVersionProblem('1.0.0', '0.99.9')).toBeDefined()
  })

  it('refuses a version it cannot read', () => {
    expect(engineVersionProblem('0.14.0', undefined)).toMatch(/cannot read/)
  })
})
