import { describe, it, expect } from 'vitest'
import { auditorOutputFromSession } from '../src/host/orchestrator.js'

function assistantMessage(text: string) {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 1,
    data: { message: { content: [{ type: 'text', text }] } },
  }
}

function textOf(blocks: Array<Record<string, unknown>>): string {
  return blocks.map((b) => ('text' in b ? String(b.text) : '')).join('')
}

describe('auditorOutputFromSession', () => {
  it('reads the legacy .events array', () => {
    const session = { events: [assistantMessage('audit done')] }
    expect(textOf(auditorOutputFromSession(session) as Array<Record<string, unknown>>)).toBe('audit done')
  })

  it('reads host-style sessions exposing only snapshotEvents() (regression: events is not iterable)', () => {
    const events = [assistantMessage('audit done')]
    const session = { snapshotEvents: () => events }
    expect(textOf(auditorOutputFromSession(session) as Array<Record<string, unknown>>)).toBe('audit done')
  })

  it('prefers ownEvents() child-owned suffix when present', () => {
    const session = {
      events: [assistantMessage('stale full log')],
      snapshotEvents: () => [assistantMessage('stale full log')],
      ownEvents: () => [assistantMessage('fresh child report')],
    }
    expect(textOf(auditorOutputFromSession(session) as Array<Record<string, unknown>>)).toBe('fresh child report')
  })

  it('returns [] instead of throwing when no event source exists', () => {
    expect(auditorOutputFromSession({})).toEqual([])
    expect(auditorOutputFromSession(undefined)).toEqual([])
  })
})
