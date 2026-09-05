import { describe, it, expect } from 'vitest'
import { buildReviewerScopePrompt } from '../src/host/orchestrator.js'

describe('buildReviewerScopePrompt', () => {
  it('mandates at least one govard_audit_lint call for full reviews', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'deep', profileInstruction: '' })
    expect(prompt).toContain('govard_audit_lint')
    expect(prompt).toMatch(/MUST call govard_audit_lint at least once/)
    expect(prompt).toContain('report_review_findings exactly once')
  })
  it('mandates lint for discussion-scope reviews too', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'discussion', discussionId: 'd1', path: 'a.php', line: 10, profileInstruction: '' })
    expect(prompt).toMatch(/MUST call govard_audit_lint at least once/)
  })
  it('keeps the dedup rule for full reviews', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'quick', profileInstruction: '' })
    expect(prompt).toContain('DEDUP RULE')
  })
  it('warns against filing findings positioned on a deleted file', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'quick', profileInstruction: '' })
    expect(prompt).toMatch(/DELETED FILES/)
    expect(prompt).toMatch(/never (file|post) a finding (located |positioned )?on a deleted file/i)
  })
})
