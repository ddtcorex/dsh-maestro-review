import { describe, it, expect } from 'vitest'
import { parseRunnerConfig } from '../src/runner/cli.js'
describe('parseRunnerConfig', () => {
  it('parses SOURCE_PROJECT_ID and MR_IID as integers', () => {
    const cfg = parseRunnerConfig(
      { GITLAB_HOST: 'gitlab.example.com', MAESTRO_GITLAB_TOKEN: 'glpat-xxx',
        SOURCE_PROJECT_ID: '123', MR_IID: '456' }, [])
    expect(cfg.sourceProjectId).toBe(123)
    expect(cfg.mrIid).toBe(456)
    expect(cfg.gitlabBaseUrl).toBe('https://gitlab.example.com')
  })
  it('throws on missing token', () => {
    expect(() => parseRunnerConfig({ SOURCE_PROJECT_ID: '1', MR_IID: '2' }, []))
      .toThrow(/MAESTRO_GITLAB_TOKEN/)
  })
  it('throws on unsafe id (non-integer)', () => {
    expect(() => parseRunnerConfig(
      { GITLAB_HOST: 'h', MAESTRO_GITLAB_TOKEN: 't', SOURCE_PROJECT_ID: 'abc', MR_IID: '1' }, []))
      .toThrow(/unsafe projectId/)
  })
})
