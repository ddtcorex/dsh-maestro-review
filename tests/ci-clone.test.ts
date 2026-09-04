import { describe, it, expect, vi } from 'vitest'
import { redactCloneUrl, cloneSourceRepo } from '../src/host/ci-clone.js'

function ctx(opts: { httpUrl?: string; status?: number; run?: (cmd: string, args: string[]) => Promise<void> }) {
  const fetcher = vi.fn(async () => new Response(
    JSON.stringify(opts.httpUrl === undefined ? {} : { http_url_to_repo: opts.httpUrl }),
    { status: opts.status ?? 200 },
  ))
  const run = vi.fn(async (cmd: string, args: string[]) => { await opts.run?.(cmd, args) })
  const base = {
    fetcher: fetcher as unknown as typeof fetch, run,
    host: 'git.example.com', projectId: 1, sourceBranch: 'feat/x',
    headSha: 'abc123', token: 'SEKRET', dir: '/tmp/x',
  }
  return { fetcher, run, base }
}

describe('ci-clone', () => {
  it('clones the branch, fetches and checks out the head SHA', async () => {
    const { run, base } = ctx({ httpUrl: 'https://git.example.com/g/p.git' })
    await expect(cloneSourceRepo(base)).resolves.toBe('/tmp/x')
    expect(run.mock.calls.map((c) => [c[0], (c[1] as string[]).join(' '), c[2]])).toEqual([
      ['git', 'clone --depth 50 --branch feat/x -- https://oauth2:SEKRET@git.example.com/g/p.git /tmp/x', undefined],
      ['git', 'fetch --depth 50 origin abc123', '/tmp/x'],
      ['git', 'checkout --detach abc123', '/tmp/x'],
    ])
  })

  it('redacts the token in clone errors', async () => {
    const { base } = ctx({
      httpUrl: 'https://git.example.com/g/p.git',
      run: async () => { throw new Error('clone https://oauth2:SEKRET@git.example.com/g/p.git failed') },
    })
    const err = await cloneSourceRepo(base).catch((e: Error) => e)
    expect(err.message).toMatch('oauth2:***@')
    expect(err.message).not.toMatch('SEKRET')
  })

  it('throws a clear error when the project has no http_url_to_repo', async () => {
    const { base } = ctx({})
    await expect(cloneSourceRepo(base)).rejects.toThrow('http_url_to_repo')
  })

  it('redactCloneUrl masks credentials', () => {
    expect(redactCloneUrl('https://oauth2:SEKRET@h/g.git')).toBe('https://oauth2:***@h/g.git')
    expect(redactCloneUrl('https://h/g.git')).toBe('https://h/g.git')
  })
})
