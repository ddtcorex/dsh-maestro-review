import { describe, expect, it, vi } from 'vitest'
import { routeGitlabCommand } from '../src/host/review-intake.js'

vi.mock('../src/host/config-store.js', () => ({ loadUserConfig: vi.fn(async () => ({})) }))
const settings = vi.fn(async () => ({ file: {}, warnings: [] as string[] }))
vi.mock('@ddtcorex/maestro-reviewer/lib/ci-repo-settings.js', () => ({ loadRepoSettings: (...a: unknown[]) => settings(...(a as [])) }))
const pending = vi.fn(async () => [] as unknown[])
const answerCommands = vi.fn(async () => 1)
const replyToCommand = vi.fn(async () => {})
vi.mock('@ddtcorex/maestro-reviewer/lib/ci-commands.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/ci-commands.js')>()
  return { ...mod, findPendingCommands: (...a: unknown[]) => pending(...(a as [])), answerCommands: (...a: unknown[]) => answerCommands(...(a as [])), replyToCommand: (...a: unknown[]) => replyToCommand(...(a as [])) }
})
const latest = vi.fn(async () => undefined as unknown)
vi.mock('@ddtcorex/maestro-reviewer/lib/ci-coexist.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/ci-coexist.js')>()
  return { ...mod, fetchBotUserId: vi.fn(async () => 7), latestCompletedReview: (...a: unknown[]) => latest(...(a as [])) }
})
vi.mock('@ddtcorex/maestro-reviewer/lib/forge/gitlab/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ddtcorex/maestro-reviewer/lib/forge/gitlab/index.js')>()
  return { ...mod, gitlabForge: (...a: Parameters<typeof mod.gitlabForge>) => ({ ...mod.gitlabForge(...a), mrHeadSha: async () => 'head1' }) }
})

const note = (body: string, o: Record<string, unknown> = {}) => ({
  object_kind: 'note', user: { username: 'dev' },
  project: { id: 1, path_with_namespace: 'group/proj' },
  merge_request: { iid: 2, source_branch: 'feat/x' },
  object_attributes: { id: 55, note: body, noteable_type: 'MergeRequest', discussion_id: 'd1' },
  ...o,
})

describe('routeGitlabCommand', () => {
  it('routes a first-line /maestro explain, fix or rereview without a mention', () => {
    for (const b of ['/maestro fix', '/maestro explain please', '/maestro rereview app/']) {
      expect(routeGitlabCommand(note(b), 'maestro-bot'), b).toEqual({ projectId: 1, projectPath: 'group/proj', mrIid: 2, sourceBranch: 'feat/x' })
    }
  })

  it('ignores the bot, later lines, quotes, dismissals and other notes', () => {
    expect(routeGitlabCommand(note('/maestro fix', { user: { username: 'maestro-bot' } }), 'maestro-bot')).toBeUndefined()
    expect(routeGitlabCommand(note('thanks\n/maestro fix'), 'maestro-bot')).toBeUndefined()
    expect(routeGitlabCommand(note('> /maestro fix'), 'maestro-bot')).toBeUndefined()
    expect(routeGitlabCommand(note('/maestro dismiss RIG-A'), 'maestro-bot')).toBeUndefined()
    expect(routeGitlabCommand({ object_kind: 'merge_request' }, 'maestro-bot')).toBeUndefined()
  })
})

function host(mappings: unknown[] = []) {
  const run = vi.fn(async () => ({ ok: true, summary: 'done', failures: [], durationMs: 1 }))
  const answer = vi.fn(async () => 'text')
  const provided: Record<string, any> = {}
  const ons: string[] = []
  return import('../src/host/host-orchestrator.js').then(({ apply }) => {
    apply({ on: (e: string) => { ons.push(e) }, provide: (name: string, fn: any) => { provided[name] = fn }, reviewEngine: { run, answer } } as any,
      { projectMappings: mappings as any, gitlabBaseUrl: 'https://gitlab.example.com', botUsername: 'b', agentTimeoutMs: 1000, gitlabToken: 't' })
    return { run, answer, provided, ons }
  })
}
const mr = (o: Record<string, unknown> = {}) => ({ projectPath: 'group/proj', projectId: 1, mrIid: 2, sourceBranch: 'feat/x', headSha: 'abc123', trigger: 'mention', mode: 'quick', scope: { kind: 'mr' }, ...o })

describe('host reviews read .maestro-review.yml', () => {
  it('passes ignore globs, project rules and the file fan-out to the engine', async () => {
    settings.mockResolvedValueOnce({ file: { ignore: ['node/**'], rules: ['r1'], minSeverity: 'major', fanout: { files: 40 } }, warnings: ['w'] } as any)
    const { run, provided } = await host()
    await provided.reviewRunner(mr())
    const opts = (run.mock.calls[0] as any[])[1]
    expect(opts.ignoreGlobs).toContain('node/**')
    expect(opts.repo).toEqual({ rules: ['r1'], minSeverity: 'major', warnings: ['w'] })
    expect(opts.fanout.files).toBe(40)
  })

  it('keeps one reviewer when the file sets no fan-out', async () => {
    const { run, provided } = await host()
    await provided.reviewRunner(mr())
    expect((run.mock.calls[0] as any[])[1].fanout).toBeUndefined()
  })
})

describe('host commands', () => {
  it('registers the command event and runner', async () => {
    const { ons, provided } = await host()
    expect(ons).toContain('maestro/review-command')
    expect(typeof provided.reviewCommandRunner).toBe('function')
  })

  it('answers pending commands through the engine', async () => {
    pending.mockResolvedValueOnce([{ noteId: 3, discussionId: 'd1', command: { kind: 'fix' }, finding: { path: 'a', line: 1, body: 'x' } }])
    const { provided, answer } = await host()
    await provided.reviewCommandRunner({ projectId: 1, projectPath: 'group/proj', mrIid: 2, sourceBranch: 'feat/x' })
    expect(answerCommands).toHaveBeenCalled()
    const deps = (answerCommands.mock.calls.at(-1) as any[])[1]
    await deps.answer('p')
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ mrIid: 2 }), expect.objectContaining({ access: { kind: 'diff' } }), 'p')
  })

  it('runs a rereview limited to its path, carrying the full review of this head, and replies with the marker', async () => {
    pending.mockResolvedValueOnce([{ noteId: 8, discussionId: 'd4', command: { kind: 'rereview', path: 'app/' } }])
    const full = [{ code: 'X', fingerprint: 'f', severity: 'blocking' }]
    latest.mockResolvedValueOnce({ headSha: 'head1', findings: full })
    const { provided, run } = await host()
    await provided.reviewCommandRunner({ projectId: 1, projectPath: 'group/proj', mrIid: 2, sourceBranch: 'feat/x' })
    expect((run.mock.calls[0] as any[])[0]).toMatchObject({ pathPrefix: 'app/', trigger: 'mention' })
    expect((run.mock.calls[0] as any[])[1].carryFindings).toEqual(full)
    expect((replyToCommand.mock.calls.at(-1) as any[])[2]).toBe('d4')
    expect((replyToCommand.mock.calls.at(-1) as any[])[3]).toContain('<!-- maestro-command note=8 -->')
  })
})

describe('host command safety', () => {
  it('keeps a path rereview limited without a full review of this head to carry (host reviews post no metadata, so no gate reads them)', async () => {
    pending.mockResolvedValueOnce([{ noteId: 9, discussionId: 'd5', command: { kind: 'rereview', path: 'app/' } }])
    latest.mockResolvedValueOnce({ headSha: 'older', findings: [] })
    const { provided, run } = await host()
    await provided.reviewCommandRunner({ projectId: 1, projectPath: 'group/proj', mrIid: 2, sourceBranch: 'feat/x' })
    expect((run.mock.calls[0] as any[])[0]).toMatchObject({ pathPrefix: 'app/' })
    expect((run.mock.calls[0] as any[])[0]).not.toHaveProperty('headSha')
    expect((run.mock.calls[0] as any[])[1]).not.toHaveProperty('carryFindings')
  })

  it('runs one command pass per MR at a time, with one trailing pass for notes that came meanwhile (I1)', async () => {
    let active = 0
    let peak = 0
    let passes = 0
    pending.mockImplementation(async () => { active++; passes++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active--; return [] })
    const { provided } = await host()
    const p = { projectId: 1, projectPath: 'group/proj', mrIid: 2, sourceBranch: 'feat/x' }
    await Promise.all([provided.reviewCommandRunner(p), provided.reviewCommandRunner(p), provided.reviewCommandRunner(p)])
    expect(peak).toBe(1)
    expect(passes).toBe(2)
    pending.mockReset()
    pending.mockImplementation(async () => [])
  })
})
