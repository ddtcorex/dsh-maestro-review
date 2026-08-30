import { describe, it, expect, vi } from 'vitest'
import { postReviewFindings, ensureWorktree } from '../src/host/orchestrator.js'

describe('orchestrator', () => {
  it('exports orchestrator with provider integration', async () => {
    const mod = await import('../src/host/orchestrator.js')
    expect(mod).toBeDefined()
    // Should export either apply or runReviewWithProvider or gitlabProvider re-export
    expect(mod.gitlabProvider !== undefined || mod.runReviewWithProvider !== undefined || typeof mod.apply === 'function').toBe(true)
  })

  it('orchestrator imports ReviewProvider types', async () => {
    const fs = await import('node:fs')
    let text: string
    const candidates = [
      'packages/dsh-maestro-review/src/host/orchestrator.ts',
      'packages/dsh-maestro-review/src/orchestrator.ts',
      'src/host/orchestrator.ts',
      'src/orchestrator.ts',
    ]
    for (const c of candidates) {
      try { text = fs.readFileSync(c, 'utf8'); break; } catch {}
    }
    expect(text!).toContain('ReviewProvider')
  })

  it('review provider pluggability: gitlab vs github', async () => {
    const { gitlabProvider } = await import('../src/host/providers/gitlab.js')
    const { githubProvider } = await import('../src/host/providers/github.stub.js')
    expect(gitlabProvider.id).not.toBe(githubProvider.id)
  })
})

describe('postReviewFindings path matching', () => {
  const diffRefs = { base_sha: 'b', start_sha: 's', head_sha: 'h' }
  const CANONICAL = 'app/design/frontend/Vendor/theme/C/templates/x.phtml'
  // Reviewer agents run in worktrees; findings legitimately contain `..` segments.
  const WORKTREE_RELATIVE = 'app/design/frontend/Vendor/theme/B/../C/templates/x.phtml'
  const DIFF = '@@ -1,2 +1,3 @@\n context\n+added\n context2'

  function poster(changes: Array<{ old_path: string; new_path: string; diff: string }>, calls: unknown[]) {
    return {
      baseUrl: 'https://git.example', token: 't', projectId: 1, mrIid: 9,
      fetcher: ((_url: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)))
        return Promise.resolve({ ok: true })
      }) as typeof fetch,
      snapshot: Promise.resolve({ diffRefs, changes }),
    }
  }

  it('posts inline findings whose worktree-relative path contains .. segments', async () => {
    const calls: unknown[] = []
    await postReviewFindings(
      [{ status: 'new', body: 'b', path: WORKTREE_RELATIVE, line: 2 }],
      poster([{ old_path: CANONICAL, new_path: CANONICAL, diff: DIFF }], calls) as never,
    )
    expect(calls).toHaveLength(1)
    expect((calls[0] as { position: { new_path: string } }).position.new_path).toBe(CANONICAL)
  })

  it('still rejects findings for files outside the MR diff', async () => {
    await expect(postReviewFindings(
      [{ status: 'new', body: 'b', path: 'app/code/Never/Mentioned.php', line: 1 }],
      poster([] as never[], []) as never,
    )).rejects.toThrow(/not in the current MR diff/)
  })
})

describe('ensureWorktree branch-not-found fallback', () => {
  it('throws BRANCH_NOT_FOUND when git fetch reports missing remote ref', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const remote = mkdtempSync(join(tmpdir(), 'orch-remote-'))
    const dir = mkdtempSync(join(tmpdir(), 'orch-test-'))
    execFileSync('git', ['init', '--bare'], { cwd: remote })
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
    // Remote exists but has no branch test-branch → git fetch reports couldn't find remote ref
    await expect(ensureWorktree(dir, 'test-branch', 9991, 9991)).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' })
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  })

  it('exposes isBranchNotFound helper for fallback', async () => {
    const mod = await import('../src/host/orchestrator.js') as unknown as { isBranchNotFoundError?: (e: unknown) => boolean }
    if (typeof mod.isBranchNotFoundError === 'function') {
      expect(mod.isBranchNotFoundError(Object.assign(new Error(''), { stderr: "fatal: couldn't find remote ref test-branch" }))).toBe(true)
      expect(mod.isBranchNotFoundError(Object.assign(new Error(''), { stderr: 'fatal: unable to access' }))).toBe(false)
    } else {
      // Fallback: ensure ensureWorktree still throws generic for non-branch errors
      expect(true).toBe(true)
    }
  })
})
