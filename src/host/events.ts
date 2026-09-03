export interface MrOpenedPayload {
  projectPath: string
  projectId: number
  mrIid: number
  sourceBranch: string
}

export type ReviewMode = 'quick' | 'deep'

export type ReviewScope =
  | { kind: 'mr' }
  | { kind: 'discussion'; discussionId: string; path: string; line: number }

import type { ReviewSkillProfile } from './skills-tool.js'

export interface ReviewRequest extends MrOpenedPayload {
  /** `push` arrives only when auto re-review on push is enabled and passes the completed-history gate. */
  trigger: 'reviewer-assignment' | 'mention' | 'push'
  mode: ReviewMode
  scope: ReviewScope
  /**
   * CI-only override (ci-trigger sets it from REVIEW_PROFILE). The GitLab webhook
   * producer never sets it — mapped projects resolve their profile from the mapping.
   * Undefined preserves the legacy diff-only generic review.
   */
  reviewProfile?: ReviewSkillProfile
}

export interface ReviewResult {
  /** false = the review could not run or failed outright (infra error) — a CI caller should exit non-zero. */
  ok: boolean
  summary?: string
  failures: string[]
  durationMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'maestro/review-request': (payload: ReviewRequest) => void
  }
  interface Context {
    reviewRunner: (payload: ReviewRequest) => Promise<ReviewResult>
  }
}
