import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('docker', () => {
  it('Dockerfile copies deepseek-harness source and installs it (dsh runs from source, not lib/)', () => {
    const df = readFileSync('docker/Dockerfile', 'utf-8')
    expect(df).toMatch(/ARG NODE_VERSION=22/)
    expect(df).toMatch(/FROM node:\$\{NODE_VERSION\}-slim AS builder/)
    expect(df).toMatch(/COPY deepseek-harness deepseek-harness/)
    expect(df).toMatch(/pnpm --dir deepseek-harness install/)
    expect(df).toMatch(/COPY packages\/dsh-maestro-config-lib packages\/dsh-maestro-config-lib/)
    expect(df).toMatch(/pnpm --dir packages\/dsh-maestro-config-lib install --frozen-lockfile/)
    expect(df).toMatch(/pnpm --dir packages\/dsh-maestro-review install --frozen-lockfile/)
    expect(df).toMatch(/pnpm --dir deepseek-harness (run )?build:lib/)
    expect(df).toMatch(/COPY packages\/dsh-maestro-review\/profiles\/reviewer-ci profiles\/reviewer-ci/)
    expect(df).toMatch(/ENV DSH_HOME=\/app\s*$/m)
    expect(df).toMatch(/\.agent-presets\/dsh-maestro-reviewer/)
    expect(df).toMatch(/\.agent-presets\/dsh-maestro-auditor/)
    expect(df).toMatch(/ci-settings\.yaml \/app\/settings\.yaml/)
    expect(df).toMatch(/tini/)
    expect(df).toMatch(/ENTRYPOINT.*entrypoint\.sh/)
  })

  it('entrypoint.sh validates required env then execs dsh --profile reviewer-ci with no task text', () => {
    const sh = readFileSync('docker/entrypoint.sh', 'utf-8')
    expect(sh).toMatch(/MAESTRO_GITLAB_TOKEN/)
    expect(sh).toMatch(/SOURCE_PROJECT_ID/)
    expect(sh).toMatch(/MR_IID/)
    expect(sh).toMatch(/--profile reviewer-ci"?\s*$/m)
    expect(sh).not.toMatch(/cli\.js/)
    expect(sh).toMatch(/REVIEW_REPORT_DIR/)
    expect(sh).toMatch(/OPENCODE_MODEL/)
    expect(sh).toMatch(/__OPENCODE_MODEL__/)
    expect(sh).toMatch(/\.maestro-history/)
    expect(sh).toMatch(/dsh-maestro-review/)
  })

  it('ci-settings.yaml mirrors the host LLM config with no embedded secrets', () => {
    const yml = readFileSync('docker/ci-settings.yaml', 'utf-8')
    // opencode-go + deepseek-via-zen; omni-route is deliberately NOT wired
    expect(yml).toMatch(/opencode-go/)
    expect(yml).toMatch(/llm-deepseek:/)
    expect(yml).not.toMatch(/omni-route/)
    expect(yml).not.toMatch(/OMNI_ROUTE_API_KEY/)
    // the opencode model is one env variable, substituted by entrypoint.sh
    // (exactly two value positions: catalog id + agent default)
    expect(yml.match(/^\s+(?:- id|model): __OPENCODE_MODEL__$/gm)).toHaveLength(2)
    expect(yml).toMatch(/^agent-default-model:/m)
    expect(yml).toMatch(/apiKeyEnv:\s*OPENCODE_GO_API_KEY/)
    // keys resolve from env at call time — never baked in
    expect(yml).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(yml).not.toMatch(/glpat-[A-Za-z0-9_.-]{8,}/)
  })
})
