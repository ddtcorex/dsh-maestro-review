import { describe, it, expect } from 'vitest'
import { resolveReviewTriggers } from '../src/host/orchestrator.ts'

describe('resolveReviewTriggers', () => {
  it('defaults to assign-ON push-OFF', () => {
    expect(resolveReviewTriggers({})).toEqual({ onPush: false, onAssign: true })
  })
  it('global flags apply without a mapping', () => {
    expect(resolveReviewTriggers({ autoRereviewOnPush: true, autoReviewOnAssign: false }))
      .toEqual({ onPush: true, onAssign: false })
  })
  it('row overrides beat globals', () => {
    expect(resolveReviewTriggers(
      { autoRereviewOnPush: true, autoReviewOnAssign: true },
      { projectPath: 'g', localRepoPath: '/x', rereviewOnPush: false, reviewOnAssign: false },
    )).toEqual({ onPush: false, onAssign: false })
  })
  it('unset row inherits globals', () => {
    expect(resolveReviewTriggers(
      { autoRereviewOnPush: true },
      { projectPath: 'g', localRepoPath: '/x' },
    )).toEqual({ onPush: true, onAssign: true })
  })
})
