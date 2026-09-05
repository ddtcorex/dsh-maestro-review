import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('profiles/reviewer-ci/cordis.patch.yml', () => {
  it('botUsername reads from REVIEW_BOT_USERNAME (falling back to maestro-bot) instead of a bare hardcoded value', () => {
    // The orchestrator's `botUsername` config also drives review-signals.ts's
    // unawardOwn() (clearing the running "eyes" marker) and gitlab-client.ts's
    // selectOwnThreads() (dedup/reply detection) — both filter GitLab objects
    // by `author.username === botUsername`. A hardcoded "maestro-bot" that
    // doesn't match the real identity behind MAESTRO_GITLAB_TOKEN (a personal
    // PAT posts as its owner's username, not "maestro-bot") means neither
    // check ever recognizes the reviewer's own objects: stale "eyes" markers
    // never get cleared, and re-reviews can't tell their own prior threads
    // apart from anyone else's — found live 2026-09-05 (every award_emoji
    // during today's real E2E tests was posted as the token owner's real
    // GitLab username, never "maestro-bot").
    const yml = readFileSync('profiles/reviewer-ci/cordis.patch.yml', 'utf-8')
    expect(yml).not.toMatch(/^\s*botUsername:\s*maestro-bot\s*$/m)
    expect(yml).toMatch(/botUsername:\s*!!js\s*["']process\.env\.REVIEW_BOT_USERNAME\s*\|\|\s*['"]maestro-bot['"]["']/)
  })
})
