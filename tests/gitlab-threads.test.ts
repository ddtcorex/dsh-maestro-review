import { describe, it, expect } from 'vitest'
import { selectOwnThreads } from '../src/host/gitlab-client.js'

function note(author: string, body: string, extra: Record<string, unknown> = {}) {
  return { body, author: { username: author }, ...extra }
}

const pos = (path: string, line: number) => ({ new_path: path, new_line: line })

describe('selectOwnThreads', () => {
  it('returns an unresolved own inline thread', () => {
    const out = selectOwnThreads([
      { id: 'd1', notes: [note('doductoan', 'first', { position: pos('a.phtml', 10), resolved: false })] },
    ], 'doductoan')
    expect(out.threads).toHaveLength(1)
    expect(out.threads[0]).toMatchObject({ discussionId: 'd1', path: 'a.phtml', line: 10, resolved: false })
    expect(out.totalDiscussions).toBe(1)
  })

  it('includes resolved own threads with resolved:true instead of dropping them', () => {
    const out = selectOwnThreads([
      { id: 'd2', notes: [note('doductoan', 'old', { position: pos('b.php', 3), resolved: true })] },
    ], 'doductoan')
    expect(out.threads).toHaveLength(1)
    expect(out.threads[0].resolved).toBe(true)
  })

  it('treats a missing resolved flag as unresolved', () => {
    const out = selectOwnThreads([
      { id: 'd3', notes: [note('doductoan', 'x', { position: pos('c.php', 1) })] },
    ], 'doductoan')
    expect(out.threads).toHaveLength(1)
    expect(out.threads[0].resolved).toBe(false)
  })

  it('excludes other authors, position-less and empty threads but counts them in totalDiscussions', () => {
    const out = selectOwnThreads([
      { id: 'd4', notes: [note('someone', 'hi', { position: pos('a.phtml', 1), resolved: false })] },
      { id: 'd5', notes: [note('doductoan', 'general', { resolved: false })] },
      { id: 'd6', notes: [] },
    ], 'doductoan')
    expect(out.threads).toHaveLength(0)
    expect(out.totalDiscussions).toBe(3)
  })

  it('uses the last note body as lastCommentBody', () => {
    const out = selectOwnThreads([
      { id: 'd7', notes: [
        note('doductoan', 'first', { position: pos('a.phtml', 5), resolved: false }),
        note('doductoan', 'follow-up', { resolved: false }),
      ] },
    ], 'doductoan')
    expect(out.threads[0].lastCommentBody).toBe('follow-up')
  })
})
