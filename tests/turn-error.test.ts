import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertTurnSucceeded, assertTurnSucceededOrSalvage } from '../src/host/orchestrator.js'

// Matches the real @deepseek-ai/dsh-session `Session` class: it exposes
// `snapshotEvents()`/`ownEvents()` methods, NOT a bare `.events` array
// property (proven live 2026-09-05: a real AgentHandle's
// `agent.session.events` is `undefined`, silently defeating this whole
// assertion — see `readSessionEvents()`'s doc comment for the host/session
// API-skew this must tolerate).
function handleWithEvents(events: unknown[]): unknown {
  return { agent: { session: { snapshotEvents: () => events } } }
}

const erroredHandle = handleWithEvents([
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'Insufficient balance', code: 'AUTH' } } } },
])
const completedHandle = handleWithEvents([
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
])

describe('assertTurnSucceeded', () => {
  it('does not throw when the handle has no events', () => {
    expect(() => assertTurnSucceeded(handleWithEvents([]))).not.toThrow()
  })

  it('does not throw when the last turn completed', () => {
    const handle = handleWithEvents([
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    expect(() => assertTurnSucceeded(handle)).not.toThrow()
  })

  it('throws with the underlying message when the turn errored (auth/billing failure)', () => {
    const handle = handleWithEvents([
      {
        type: 'turn/end',
        data: {
          turn: 1,
          reason: {
            kind: 'error',
            error: {
              message:
                'OpenAI API error (401): {"type":"CreditsError","message":"Insufficient balance."}',
              code: 'AUTH',
            },
          },
        },
      },
    ])
    expect(() => assertTurnSucceeded(handle)).toThrow(/Insufficient balance/)
  })

  it('throws with the error code when no message is present', () => {
    const handle = handleWithEvents([
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'TIMEOUT' } } } },
    ])
    expect(() => assertTurnSucceeded(handle)).toThrow(/TIMEOUT/)
  })

  it('also reads a legacy handle whose session only exposes a bare .events array', () => {
    const handle = { agent: { session: { events: [
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'legacy shape', code: 'AUTH' } } } },
    ] } } }
    expect(() => assertTurnSucceeded(handle)).toThrow(/legacy shape/)
  })
})

describe('assertTurnSucceededOrSalvage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw when the turn completed, regardless of salvageable output', () => {
    expect(() => assertTurnSucceededOrSalvage(completedHandle, false, 'reviewer')).not.toThrow()
    expect(() => assertTurnSucceededOrSalvage(completedHandle, true, 'reviewer')).not.toThrow()
  })

  it('throws the turn error when it errored and there is nothing to salvage', () => {
    expect(() => assertTurnSucceededOrSalvage(erroredHandle, false, 'reviewer')).toThrow(/Insufficient balance/)
  })

  it('does not throw when the turn errored but there is salvageable output -- warns instead', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertTurnSucceededOrSalvage(erroredHandle, true, 'reviewer')).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reviewer'))
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Insufficient balance')
  })
})
