/** Provider-neutral notifier contract plus every message text this plugin owns. */

export interface NotifyDeliveryResult {
  sent: boolean
  reason?: 'not-configured' | 'request-failed' | 'unknown-provider'
}

/**
 * Structural view of the optional `maestroNotifier` service published by
 * `@ddtcorex/dsh-maestro-notifier`. Consumed via `ctx.get` so an absent
 * notifier plugin degrades to "no notifications" instead of breaking reviews.
 */
export interface NotifierLike {
  send(providerId: string, target: Record<string, unknown>, message: { text: string }): Promise<NotifyDeliveryResult>
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatSummary(text: string, maxLen = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) return normalized
  const cut = normalized.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  const truncated = (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()
  return `${truncated} …`
}

export function reviewDigestText(notification: {
  projectPath: string
  mrIid: number
  status: 'completed' | 'failed'
  summary?: string
  mode?: string
  profile?: string
  gitlabBaseUrl?: string
  findings?: { newCount: number; replyCount: number; failedCount: number }
  durationMs?: number
}): string {
  const isOk = notification.status === 'completed'
  const statusLabel = isOk ? '✅ Completed' : '⚠️ Failed'
  const mrUrl = notification.gitlabBaseUrl !== undefined
    ? `${notification.gitlabBaseUrl.replace(/\/$/, '')}/${notification.projectPath}/-/merge_requests/${notification.mrIid}`
    : undefined
  const mrLink = mrUrl !== undefined
    ? `<a href="${escapeHtml(mrUrl)}">!${notification.mrIid}</a>`
    : `!${notification.mrIid}`

  const metaParts: string[] = []
  if (notification.mode !== undefined) metaParts.push(`<code>${escapeHtml(notification.mode)}</code>`)
  if (notification.profile !== undefined) metaParts.push(`<code>${escapeHtml(notification.profile)}</code>`)
  if (notification.durationMs !== undefined && notification.durationMs > 0) {
    const s = Math.round(notification.durationMs / 1000)
    metaParts.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)
  }
  const metaLine = metaParts.length > 0 ? ` · ${metaParts.join(' · ')}` : ''

  const findingsLine = notification.findings !== undefined
    ? (() => {
        const f = notification.findings
        const parts: string[] = []
        if (f.newCount > 0) parts.push(`${f.newCount} new`)
        if (f.replyCount > 0) parts.push(`${f.replyCount} reply`)
        if (f.failedCount > 0) parts.push(`${f.failedCount} failed`)
        if (parts.length === 0) parts.push('no inline findings')
        return `\n<b>Findings:</b> ${parts.join(' · ')}`
      })()
    : ''

  const summaryBlock = notification.summary !== undefined && notification.summary.trim() !== ''
    ? `\n\n${escapeHtml(formatSummary(notification.summary.trim()))}`
    : ''

  const footerLink = mrUrl !== undefined ? `\n\n<a href="${escapeHtml(mrUrl)}">View MR →</a>` : ''

  return `<b>🤖 Maestro Review</b> — <code>${escapeHtml(notification.projectPath)}</code> ${mrLink}\n<b>Status:</b> ${statusLabel}${metaLine}${findingsLine}${summaryBlock}${footerLink}`
}

export function pinRotationText(pin: string): string {
  return `DSH public access PIN was rotated\nNew PIN: ${pin}`
}
