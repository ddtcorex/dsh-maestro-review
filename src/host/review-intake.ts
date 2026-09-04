import type { MrOpenedPayload, ReviewMode, ReviewRequest, ReviewScope } from './events.js'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function mrPayload(body: JsonRecord): MrOpenedPayload | undefined {
  const project = record(body.project)
  const attributes = record(body.object_attributes)
  const mergeRequest = record(body.merge_request)
  const source = body.object_kind === 'note' ? mergeRequest : attributes
  if (project === undefined || source === undefined
    || typeof project.id !== 'number' || typeof project.path_with_namespace !== 'string'
    || typeof source.iid !== 'number' || typeof source.source_branch !== 'string') return undefined
  return {
    projectId: project.id,
    projectPath: project.path_with_namespace,
    mrIid: source.iid,
    sourceBranch: source.source_branch,
  }
}

function usernames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((reviewer) => {
    const item = record(reviewer)
    return item !== undefined && typeof item.username === 'string' ? [item.username.toLowerCase()] : []
  })
}

function isMentioned(text: string, botUsername: string): boolean {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_.-])@${escaped}(?=$|[^A-Za-z0-9_.-])`, 'i').test(text)
}

function noteScope(attributes: JsonRecord): ReviewScope | undefined {
  const position = record(attributes.position)
  if (position === undefined) return { kind: 'mr' }
  const path = typeof position.new_path === 'string' ? position.new_path : position.old_path
  const line = typeof position.new_line === 'number' ? position.new_line : position.old_line
  if (typeof attributes.discussion_id !== 'string' || typeof path !== 'string' || typeof line !== 'number') return undefined
  return { kind: 'discussion', discussionId: attributes.discussion_id, path, line }
}

export interface RouteOptions {
  /** When true, an MR update carrying new commits routes a push re-review. */
  pushEnabled?: boolean
}

/** Actionable provider-layer drop reasons. Generic non-review GitLab noise
 * (closes, label edits, ...) intentionally has no reason and stays silent. */
export type DropReason = 'invalid-identity' | 'push-gate-off'

/**
 * Name why this webhook body will NOT route at the provider layer, or
 * `undefined` when it routes (or is generic noise the provider ignores).
 * Pure — the provider logs the returned reason with project/mr context.
 */
export function describeDrop(body: unknown, botUsername: string, options: RouteOptions = {}): DropReason | undefined {
  const value = record(body)
  if (value === undefined || botUsername.trim() === '') return 'invalid-identity'
  const payload = mrPayload(value)
  if (payload === undefined) return 'invalid-identity'
  if (value.object_kind === 'merge_request') {
    const attributes = record(value.object_attributes)
    const hasNewCommits = typeof attributes?.oldrev === 'string' && attributes.oldrev !== ''
    if (hasNewCommits && options.pushEnabled !== true) return 'push-gate-off'
  }
  return undefined
}

export function routeGitlabReviewRequest(body: unknown, botUsername: string, options: RouteOptions = {}): ReviewRequest | undefined {
  const value = record(body)
  if (value === undefined || botUsername.trim() === '') return undefined
  const payload = mrPayload(value)
  if (payload === undefined) return undefined
  const attributes = record(value.object_attributes)
  if (attributes === undefined) return undefined

  if (value.object_kind === 'merge_request') {
    const changes = record(value.changes)

    // New commits landed on an already-assigned MR: a quick re-review, gated
    // downstream on a previously completed review of the same MR.
    if (options.pushEnabled === true) {
      const hasNewCommits = typeof attributes.oldrev === 'string' && attributes.oldrev !== ''
      if (hasNewCommits) {
        return { ...payload, trigger: 'push', mode: 'quick', scope: { kind: 'mr' } }
      }
    }

    const reviewerChange = changes === undefined ? undefined : record(changes.reviewers)
    if (reviewerChange === undefined) return undefined
    const bot = botUsername.toLowerCase()
    const nowAssigned = usernames(reviewerChange.current).includes(bot)
    const previouslyAssigned = usernames(reviewerChange.previous).includes(bot)
    if (!nowAssigned || previouslyAssigned) return undefined
    return { ...payload, trigger: 'reviewer-assignment', mode: 'quick', scope: { kind: 'mr' } }
  }

  if (value.object_kind !== 'note' || typeof attributes.note !== 'string' || !isMentioned(attributes.note, botUsername)) return undefined
  const scope = noteScope(attributes)
  if (scope === undefined) return undefined
  // Deep runs the auditor (env + perf) and costs far more than quick, so the
  // trigger stays explicit: the `/maestro deep` slash command or the natural
  // phrase "deep review". A bare "deep" alone never triggers (too loose).
  const note = attributes.note
  const mode: ReviewMode = /(?:^|\s)\/maestro\s+deep(?:\s|$)/i.test(note) || /\bdeep\s+review\b/i.test(note) ? 'deep' : 'quick'
  return { ...payload, trigger: 'mention', mode, scope }
}
