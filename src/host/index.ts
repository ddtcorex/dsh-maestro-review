import type { Context } from '@deepseek-ai/cordis'
import { makeSkillProvider, resolveSkillsDir } from './skill-provider.js'

export const name = '@ddtcorex/dsh-maestro-review'

export function apply(ctx: Context): void {
  // The bundled DSH tool map is served from here, not from the public
  // `maestro-skills` plugin: that repo's catalog test requires its skill content
  // to stay tool-neutral, and this map names harness tools. Wrapped like the
  // rest of apply(): a missing service or a throwing registration must never
  // take down the whole plugin tree.
  try {
    const skills = (ctx as unknown as { get?: (key: string) => any }).get?.('skills')
    if (skills?.registerProvider) {
      ctx.effect(() => {
        let unregister: (() => void) | undefined
        try {
          // Package-root skills/ is resolved at runtime by walking to the
          // nearest package.json (robust to lib/ vs src/host/ layouts).
          unregister = skills.registerProvider(() => makeSkillProvider(resolveSkillsDir(__dirname)))
        } catch (e: any) {
          try { (ctx as any).logger?.warn?.(`[review] skill provider failed: ${e?.message ?? String(e)}`) } catch {}
        }
        return () => { try { unregister?.() } catch {} }
      }, 'maestro-review:skill')
    }
  } catch (e: any) {
    try { (ctx as any).logger?.warn?.(`[review] skill provider effect failed: ${e?.message ?? String(e)}`) } catch {}
  }

  ctx.effect(() => ctx.connection.rpc.handle('/dsh-maestro-review', async (endpoint, payload) => {
    if (endpoint === 'status') return { ok: true, value: { provider: 'gitlab' } }
    if (endpoint === 'providers') return { ok: true, value: { providers: ['gitlab', 'github'] } }
    if (endpoint === 'review') {
      const body = payload as Record<string, unknown> | undefined
      return { ok: true, value: { received: true, provider: (body as any)?.provider ?? 'gitlab' } }
    }
    return { ok: false, error: { code: 'bad-request', message: `Unknown endpoint: ${endpoint}`, details: { issues: [{ message: String(endpoint) }] } as any } }
  }, { authority: 'loopback' }), 'maestro-review rpc')
}
