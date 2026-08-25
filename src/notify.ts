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

export function reviewDigestText(notification: {
  projectPath: string
  mrIid: number
  status: 'completed' | 'failed'
  summary?: string
}): string {
  const outcome = notification.status === 'completed' ? '✅ completed' : '⚠️ failed'
  const summary = notification.summary === undefined ? '' : `\n${notification.summary}`
  return `Maestro review of ${notification.projectPath} !${notification.mrIid}: ${outcome}${summary}`
}

export function pinRotationText(pin: string): string {
  return `DSH public access PIN was rotated\nNew PIN: ${pin}`
}
