import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUserConfig, saveUserConfig, type MaestroUserConfig } from '../src/host/config-store.ts'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'rstore-')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })


describe('config-store v2 (lib-backed adapter)', () => {
  it('save writes into the shared namespaced store, not the package file', async () => {
    await saveUserConfig({ gitlabToken: 'tok', tunnelMode: 'named' }, home)
    const raw = JSON.parse(await readFile(join(home, 'dsh-maestro-config', 'settings.json'), 'utf8'))
    expect(raw.domains.gitlab.token).toBe('tok')
    expect(raw.domains.tunnel.mode).toBe('named')
  })

  it('load reads the shared store back through the flat view', async () => {
    await saveUserConfig({
      gitlabBaseUrl: 'https://g',
      reviewModel: { provider: 'openai', model: 'gpt-x' },
      telegramChatId: '42',
    }, home)
    const cfg = await loadUserConfig(home)
    expect(cfg.gitlabBaseUrl).toBe('https://g')
    expect(cfg.reviewModel).toEqual({ provider: 'openai', model: 'gpt-x' })
    // telegramChatId is saved but NOT read back: notifier ownership moved to
    // dsh-maestro-notifier, so review's load is scoped to the keys review owns
    // (see REVIEW_OWNED_KEYS and tests/config-scope.spec.ts). This assertion
    // used to expect '42' — it pinned the leak.
    expect(cfg.telegramChatId).toBeUndefined()
    // The write still landed in the shared store; scoping is a READ boundary.
    const store = JSON.parse(await readFile(join(home, 'dsh-maestro-config', 'settings.json'), 'utf8'))
    expect(store.domains.notifier.telegram.chatId).toBe('42')
  })

  it('lastTunnelRunning is machine state — routed to the package sidecar, not settings', async () => {
    await saveUserConfig({ lastTunnelRunning: true, tunnelId: 'tid' }, home)
    const sidecar = JSON.parse(await readFile(join(home, 'dsh-maestro-review', 'runtime.json'), 'utf8'))
    expect(sidecar.lastTunnelRunning).toBe(true)
    const store = JSON.parse(await readFile(join(home, 'dsh-maestro-config', 'settings.json'), 'utf8'))
    expect(JSON.stringify(store)).not.toContain('lastTunnelRunning')
    expect((await loadUserConfig(home)).lastTunnelRunning).toBe(true)
  })

  it('save merges without losing sibling keys across domains', async () => {
    // tunnelHostname is remote's key, and review's load no longer returns it —
    // but the SAVE still routes it to the shared tunnel domain, and a sibling
    // gitlab key written afterwards must survive it. Assert the store, not the
    // scoped read: this test is about merge semantics, not read scope.
    await saveUserConfig({ gitlabBaseUrl: 'https://g', tunnelHostname: 'h' }, home)
    await saveUserConfig({ gitlabToken: 'late' }, home)
    const cfg = await loadUserConfig(home)
    expect(cfg.gitlabBaseUrl).toBe('https://g') // sibling survived
    expect(cfg.gitlabToken).toBe('late')
    expect(cfg.tunnelHostname).toBeUndefined()
    const store = JSON.parse(await readFile(join(home, 'dsh-maestro-config', 'settings.json'), 'utf8'))
    expect(store.domains.tunnel.hostname).toBe('h')
  })

  it('sidecar file is owner-only (0600)', async () => {
    await saveUserConfig({ lastTunnelRunning: true }, home)
    const st = await stat(join(home, 'dsh-maestro-review', 'runtime.json'))
    expect(st.mode & 0o777).toBe(0o600)
  })

  it('round-trips the trigger flags (global + per-row)', async () => {
    await saveUserConfig({
      autoReviewOnAssign: false,
      projectMappings: [{ projectPath: 'g/p', localRepoPath: '/x', rereviewOnPush: true, reviewOnAssign: false }],
    }, home)
    const cfg = await loadUserConfig(home)
    expect(cfg.autoReviewOnAssign).toBe(false)
    expect(cfg.projectMappings?.[0]).toEqual({ projectPath: 'g/p', localRepoPath: '/x', rereviewOnPush: true, reviewOnAssign: false })
  })
})
