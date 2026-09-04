import { describe, it, expect } from 'vitest'
import { buildReviewComment, buildNotStartedComment } from '../src/host/orchestrator.js'

describe('comment marker', () => {
  const base = {
    projectPath: 'g/p', mrIid: 7, gitlabBaseUrl: 'https://git.example',
    mode: 'quick', summary: 's', failures: [] as string[],
  }
  it('buildReviewComment appends the marker when given', () => {
    const body = buildReviewComment({ ...base, marker: { sha: 'abc123', flow: 'ci-quick' } })
    expect(body).toMatch('<!-- maestro-review sha=abc123 flow=ci-quick status=completed -->')
  })
  it('buildReviewComment omits the marker when absent', () => {
    expect(buildReviewComment(base)).not.toMatch('maestro-review sha=')
  })
  it('buildNotStartedComment appends the marker when given', () => {
    const body = buildNotStartedComment({ gitlabBaseUrl: 'https://h', projectPath: 'p', mrIid: 1, marker: { sha: 'abc123', flow: 'webhook' } })
    expect(body).toMatch('<!-- maestro-review sha=abc123 flow=webhook status=completed -->')
  })
})
