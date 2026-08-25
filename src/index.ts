import type { Context } from '@deepseek-ai/cordis'

export const name = '@ddtcorex/dsh-maestro-review'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.connection.rpc.handle('/maestro/review', async (endpoint, payload) => {
    if (endpoint === 'status') return { ok: true, value: { provider: 'gitlab' } }
    if (endpoint === 'providers') return { ok: true, value: { providers: ['gitlab', 'github'] } }
    if (endpoint === 'review') {
      const body = payload as Record<string, unknown> | undefined
      return { ok: true, value: { received: true, provider: (body as any)?.provider ?? 'gitlab' } }
    }
    return { ok: false, error: { code: 'bad-request', message: `Unknown endpoint: ${endpoint}`, details: { issues: [{ message: String(endpoint) }] } as any } }
  }, { authority: 'loopback' }), 'maestro-review rpc')
}
