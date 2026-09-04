import { describe, it, expect } from 'vitest'
import { assertTurnSucceeded } from '../src/host/orchestrator.js'

function handleWithEvents(events: unknown[]): unknown {
  return { agent: { session: { events } } }
}

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
})
