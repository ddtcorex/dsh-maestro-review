import { describe, it, expect } from 'vitest'
import { routeGitlabReviewRequest } from '../src/host/review-intake.js'

const BOT = 'maestro-bot'

function noteBody(note: string, withPosition = false) {
  return {
    object_kind: 'note',
    project: { id: 1137, path_with_namespace: 'app/example/magento' },
    merge_request: { iid: 3786, source_branch: 'feat/x' },
    object_attributes: {
      note,
      ...(withPosition
        ? { position: { new_path: 'a.php', new_line: 10 }, discussion_id: 'abc123' }
        : {}),
    },
  }
}

describe('review-intake: deep mode trigger', () => {
  it('routes /maestro deep to deep (legacy slash command)', () => {
    const req = routeGitlabReviewRequest(noteBody(`@${BOT} /maestro deep`), BOT)
    expect(req?.mode).toBe('deep')
  })
  it('routes natural "deep review" phrase to deep', () => {
    const req = routeGitlabReviewRequest(noteBody(`@${BOT} deep review please`), BOT)
    expect(req?.mode).toBe('deep')
  })
  it('routes "Deep Review" case-insensitively to deep', () => {
    const req = routeGitlabReviewRequest(noteBody(`@${BOT} Deep Review`), BOT)
    expect(req?.mode).toBe('deep')
  })
  it('keeps plain mentions on quick', () => {
    const req = routeGitlabReviewRequest(noteBody(`@${BOT} please review this`), BOT)
    expect(req?.mode).toBe('quick')
  })
  it('does not trigger deep on "deepen"/"deepdive" (word boundary)', () => {
    expect(routeGitlabReviewRequest(noteBody(`@${BOT} deepen the checks`), BOT)?.mode).toBe('quick')
    expect(routeGitlabReviewRequest(noteBody(`@${BOT} deepdive this`), BOT)?.mode).toBe('quick')
  })
  it('keeps deep trigger working on inline discussion scope', () => {
    const req = routeGitlabReviewRequest(noteBody(`@${BOT} deep review this line`, true), BOT)
    expect(req?.mode).toBe('deep')
    expect(req?.scope).toEqual({ kind: 'discussion', discussionId: 'abc123', path: 'a.php', line: 10 })
  })
  it('ignores notes that do not mention the bot', () => {
    expect(routeGitlabReviewRequest(noteBody('deep review'), BOT)).toBeUndefined()
  })
})
