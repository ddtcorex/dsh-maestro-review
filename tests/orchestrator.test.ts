import { describe, it, expect } from 'vitest'

describe('orchestrator', () => {
  it('exports orchestrator with provider integration', async () => {
    const mod = await import('../src/orchestrator.js')
    expect(mod).toBeDefined()
    // Should export either apply or runReviewWithProvider or gitlabProvider re-export
    expect(mod.gitlabProvider !== undefined || mod.runReviewWithProvider !== undefined || typeof mod.apply === 'function').toBe(true)
  })

  it('orchestrator imports ReviewProvider types', async () => {
    const fs = await import('node:fs')
    let text: string
    try {
      text = fs.readFileSync('packages/dsh-maestro-review/src/orchestrator.ts', 'utf8')
    } catch {
      text = fs.readFileSync('src/orchestrator.ts', 'utf8')
    }
    expect(text).toContain('ReviewProvider')
  })

  it('review provider pluggability: gitlab vs github', async () => {
    const { gitlabProvider } = await import('../src/providers/gitlab.js')
    const { githubProvider } = await import('../src/providers/github.stub.js')
    expect(gitlabProvider.id).not.toBe(githubProvider.id)
  })
})
