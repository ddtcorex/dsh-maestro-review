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

export interface ReviewRequest extends MrOpenedPayload {
  /** `push` arrives only when auto re-review on push is enabled and passes the completed-history gate. */
  trigger: 'reviewer-assignment' | 'mention' | 'push'
  mode: ReviewMode
  scope: ReviewScope
  /** Short (8-char) head-sha hint for `push` triggers, taken from the webhook
   * body — feeds the in-flight key so two concurrent pushes stop deduping
   * each other. Absent when the body carries no sha. */
  pushSha?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'maestro/review-request': (payload: ReviewRequest) => void
  }
}
