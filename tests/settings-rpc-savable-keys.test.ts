import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/host/settings-rpc.ts'), 'utf8')
const block = /const SAVABLE_KEYS[^=]*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? ''
const keys = [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])

/** The eleven keys review still owns: the six gitlab ones and the five review ones. */
const REVIEW_OWNS = [
  'agentTimeoutMs', 'autoRereviewOnPush', 'autoReviewOnAssign', 'botUsername',
  'gitlabBaseUrl', 'gitlabToken', 'projectMappings', 'reviewModel',
  'reviewSessionRetentionDays', 'webhookPort', 'webhookSecret',
]

describe('SAVABLE_KEYS ownership', () => {
  it('reads the real set out of the source', () => {
    // Guards the test itself: an empty or renamed block would make every
    // assertion below pass vacuously.
    expect(keys.length).toBeGreaterThan(0)
  })

  it('keeps exactly the gitlab and review keys', () => {
    expect([...keys].sort()).toEqual([...REVIEW_OWNS].sort())
  })

  it('no longer claims a tunnel, proxy, pin or telegram key', () => {
    for (const key of [
      'tunnelMode', 'tunnelId', 'tunnelHostname', 'tunnelCredentialsFile', 'quickTarget',
      'proxyPort', 'proxyHost', 'lanPinEnabled', 'pinSessionTtlHours',
      'telegramBotToken', 'telegramChatId', 'telegramReviewNotifications',
    ]) {
      expect(keys, key).not.toContain(key)
    }
  })

  it('never re-admits lanPort or lanHost', () => {
    // They exist in the store's key map on purpose but are machine-local: a
    // sync rewrites domains.tunnel from the per-machine tunnel profile, so a
    // Settings write for either key is silently discarded. Making them
    // savable looks like a fix and reopens the 2026-09-02 outage.
    for (const key of ['lanPort', 'lanHost']) {
      expect(keys, key).not.toContain(key)
    }
  })

  it('does not hard-depend on the tunnel service', () => {
    expect(source).toMatch(/export const inject = \['connection'\]/)
    expect(source).not.toContain("inject = ['connection', 'maestroTunnel']")
  })

  it('no longer serves the model pass-throughs', () => {
    // They read the harness llm / agentDefaultModel services, neither of which
    // this module declares, and contribute no review behaviour.
    expect(source).not.toContain('modelsList')
    expect(source).not.toContain('modelsCurrent')
  })

  it('names the owning plugin when it rejects a migrated key', () => {
    expect(source).toContain('OWNER_OF')
    expect(source).toContain('dsh-maestro-remote')
    expect(source).toContain('dsh-maestro-notifier')
  })
})