import type { MrOpenedPayload, ReviewRequest, ReviewResult } from '@ddtcorex/maestro-reviewer/lib/events.js'
import type { ReviewEngine } from '@ddtcorex/maestro-reviewer/lib/engine.js'

/** Host contracts: the webhook emits review requests, the host orchestrator runs them. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'maestro/review-request': (payload: ReviewRequest) => void
    /** A note carrying a /maestro command: answer the MR's pending commands. */
    'maestro/review-command': (payload: MrOpenedPayload) => void
  }
  interface Context {
    reviewRunner: (payload: ReviewRequest) => Promise<ReviewResult>
    reviewCommandRunner: (payload: MrOpenedPayload) => Promise<void>
    /** Provided by the engine's `maestro-review-engine` row (redeclared here: the engine augments its own cordis copy). */
    reviewEngine: ReviewEngine
  }
}
