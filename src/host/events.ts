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
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'maestro/review-request': (payload: ReviewRequest) => void
  }
}
