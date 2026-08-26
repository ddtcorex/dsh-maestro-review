import { describe, it, expect } from 'vitest'
import {
  deniedToolForReview,
  createReviewToolPolicyHandler,
  REVIEW_DENIED_TOOLS,
} from '../src/tool-policy.js'
import * as policyPlugin from '../src/tool-policy.js'

describe('review tool policy', () => {
  it('denies exactly the leaked host tools with an explanatory reason', () => {
    for (const tool of REVIEW_DENIED_TOOLS) {
      expect(deniedToolForReview(tool)).toContain('not available to Maestro review agents')
    }
    expect(deniedToolForReview('maestro_read_file')).toBeUndefined()
    expect(deniedToolForReview('maestro_search_files')).toBeUndefined()
    expect(deniedToolForReview('gitlab_list_mr_diffs')).toBeUndefined()
    expect(deniedToolForReview('report_review_findings')).toBeUndefined()
  })

  it('handler denies without calling next for listed tools', async () => {
    const handler = createReviewToolPolicyHandler()
    let nextCalled = false
    const decision = await handler({ name: 'memory' }, async () => {
      nextCalled = true
      return { kind: 'allow' as const }
    })
    expect(decision.kind).toBe('deny')
    expect(nextCalled).toBe(false)
  })

  it('handler delegates to next for allowed tools', async () => {
    const handler = createReviewToolPolicyHandler()
    let nextCalled = false
    const decision = await handler({ name: 'maestro_search_files' }, async () => {
      nextCalled = true
      return { kind: 'allow' as const }
    })
    expect(decision.kind).toBe('allow')
    expect(nextCalled).toBe(true)
  })

  it('is a registerable plugin whose apply wires the pre-execute listener', () => {
    expect(policyPlugin.name).toBe('maestro-review-tool-policy')
    const listeners: Array<[string, unknown]> = []
    const effects: Array<() => void> = []
    const ctx = {
      on(event: string, handler: unknown) { listeners.push([event, handler]) },
      effect(fn: () => void) { effects.push(fn) },
    }
    policyPlugin.apply(ctx as never)
    // ctx.effect registers immediately in real cordis; invoke the callback here.
    effects[0]()
    expect(listeners).toHaveLength(1)
    expect(listeners[0][0]).toBe('tools/pre-execute')
    expect(typeof listeners[0][1]).toBe('function')
  })
})
