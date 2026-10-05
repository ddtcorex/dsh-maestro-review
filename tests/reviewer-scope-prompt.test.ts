import { describe, it, expect } from 'vitest'
import { buildReviewerScopePrompt } from '../src/host/orchestrator.js'

const LINT = { worktreePath: '/tmp/wt', base: 'abc123' }

describe('buildReviewerScopePrompt', () => {
  it('mandates at least one govard_audit_lint call for full reviews', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'deep', profileInstruction: '', lint: LINT })
    expect(prompt).toContain('govard_audit_lint')
    expect(prompt).toMatch(/MUST call govard_audit_lint at least once/)
    expect(prompt).toContain('report_review_findings exactly once')
  })
  it('mandates lint for discussion-scope reviews too', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'discussion', discussionId: 'd1', path: 'a.php', line: 10, profileInstruction: '', lint: LINT })
    expect(prompt).toMatch(/MUST call govard_audit_lint at least once/)
  })
  it('keeps the dedup rule for full reviews', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'quick', profileInstruction: '', lint: LINT })
    expect(prompt).toContain('DEDUP RULE')
  })
  it('warns against filing findings positioned on a deleted file', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'quick', profileInstruction: '', lint: LINT })
    expect(prompt).toMatch(/DELETED FILES/)
    expect(prompt).toMatch(/never (file|post) a finding (located |positioned )?on a deleted file/i)
  })

  // The lint rule used to be unconditional and used to promise a wired base.
  // dsh-maestro-govard owns the tool and registers it globally, so review
  // asks the registry instead of mounting a fork, and carries the MR base sha
  // in the prompt because nothing wires it as a tool default any more.
  it('names the worktree and base the reviewer must pass', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'deep', profileInstruction: '', lint: LINT })
    expect(prompt).toContain('worktreePath "/tmp/wt"')
    expect(prompt).toContain('base "abc123"')
    expect(prompt).not.toContain('no base arg needed')
  })
  it('omits the lint rule entirely when the owning tool is not visible', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'full', mode: 'deep', profileInstruction: '', lint: null })
    expect(prompt).not.toContain('govard_audit_lint')
    expect(prompt).not.toContain('LINT RULE')
    // Everything else about the review still stands.
    expect(prompt).toContain('report_review_findings')
    expect(prompt).toContain('DEDUP RULE')
  })
  it('drops the lint rule from a discussion prompt too, and keeps the rest', () => {
    const prompt = buildReviewerScopePrompt({ scopeKind: 'discussion', discussionId: 'd1', path: 'a.php', line: 10, profileInstruction: '', lint: null })
    expect(prompt).not.toContain('LINT RULE')
    expect(prompt).toContain('gitlab_get_mr_diff')
    expect(prompt).toContain('d1')
  })
})