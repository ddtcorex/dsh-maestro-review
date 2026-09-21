import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/host/index.js'

type Effect = { label?: string; dispose: () => void }

function makeCtx(overrides: Record<string, unknown> = {}) {
  const effects: Effect[] = []
  const skills = { registerProvider: vi.fn(() => () => {}) }
  const ctx = {
    connection: { rpc: { handle: vi.fn(() => () => {}) } },
    logger: { warn: vi.fn(), info: vi.fn() },
    effect: vi.fn((fn: () => unknown, label?: string) => {
      const dispose = fn()
      effects.push({ label, dispose: typeof dispose === 'function' ? (dispose as () => void) : () => {} })
      return () => {}
    }),
    get: vi.fn((key: string) => (key === 'skills' ? skills : undefined)),
    ...overrides,
  }
  return { ctx, effects, skills }
}

describe('host apply()', () => {
  it('registers the skill provider inside an effect', () => {
    const { ctx, skills } = makeCtx()
    apply(ctx as never)
    expect(skills.registerProvider).toHaveBeenCalledTimes(1)
    // registerProvider receives a factory, not a provider instance.
    const factory = skills.registerProvider.mock.calls[0][0] as () => { name: string }
    expect(typeof factory).toBe('function')
    expect(factory().name).toBe('maestro-review')
  })

  it('disposes the provider registration when the effect is cleaned up', () => {
    const unregister = vi.fn()
    const { ctx, effects } = makeCtx()
    ctx.get = vi.fn(() => ({ registerProvider: vi.fn(() => unregister) })) as never
    apply(ctx as never)
    const effect = effects.find(e => e.label === 'maestro-review:skill')
    expect(effect).toBeDefined()
    effect!.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('never throws when the skills service is missing', () => {
    const { ctx } = makeCtx()
    ctx.get = vi.fn(() => undefined) as never
    expect(() => apply(ctx as never)).not.toThrow()
  })

  it('never throws when registerProvider itself throws', () => {
    const { ctx } = makeCtx()
    ctx.get = vi.fn(() => ({ registerProvider: () => { throw new Error('boom') } })) as never
    expect(() => apply(ctx as never)).not.toThrow()
    expect(ctx.logger.warn).toHaveBeenCalled()
  })
})
