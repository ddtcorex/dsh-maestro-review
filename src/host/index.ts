/**
 * Package entry of @ddtcorex/dsh-maestro-review (row `maestro-review-plugin`).
 * Every capability is its own row in cordis.patch.yml (webhook, host
 * orchestrator, settings RPC); the root row exists so DSH serves the client
 * bundle, and apply() itself registers nothing.
 */
export const name = '@ddtcorex/dsh-maestro-review'

export function apply(): void {}
