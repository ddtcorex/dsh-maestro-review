/**
 * Webhook secret generation and the URL an operator pastes into GitLab.
 *
 * Parked at the meta root when the Maestro settings card lost its GitLab tab,
 * and never ported: `review` kept the secret FIELD in its own settings section
 * but had no way to produce a value for it, so the operator had to invent a
 * 32-character base64url string by hand. A pasted secret with a `+`, a `/` or
 * a `=` is a common outcome, and those characters are exactly what GitLab's
 * token comparison and a URL path segment cannot carry.
 */

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** The merge-request webhook path this plugin serves. */
export const GITLAB_WEBHOOK_PATH = '/hooks/gitlab-mr'

/**
 * Generate an opaque 256-bit secret suitable for GitLab's webhook token.
 *
 * Each byte contributes 6 bits (`byte & 0b00111111`), so the result is always
 * 32 base64url characters with no padding and no character outside the
 * alphabet — the two properties GitLab's comparison and a URL path segment
 * both need. The randomness source is injectable so the mapping is testable
 * without weakening the production path.
 */
export function generateWebhookSecret(
  randomValues: (array: Uint8Array) => Uint8Array = globalThis.crypto.getRandomValues.bind(globalThis.crypto),
): string {
  const bytes = randomValues(new Uint8Array(32))
  return Array.from(bytes, byte => BASE64URL_ALPHABET[byte & 0b00111111]).join('')
}

/**
 * GitLab's merge-request webhook endpoint for the configured public hostname.
 *
 * A user pasting the value back out of the settings field usually brings a
 * scheme and a trailing slash with it, so both are stripped. An absent
 * hostname names itself rather than producing a URL that looks real.
 */
export function gitlabWebhookUrl(hostname?: string): string {
  const authority = hostname?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') || '<your-hostname>'
  return `https://${authority}${GITLAB_WEBHOOK_PATH}`
}