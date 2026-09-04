import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('docker', () => {
  it('Dockerfile installs everything from registries (no host-checkout COPY)', () => {
    const df = readFileSync('docker/Dockerfile', 'utf-8')
    expect(df).toMatch(/ARG NODE_VERSION=22/)
    expect(df).toMatch(/FROM node:\$\{NODE_VERSION\}-slim AS runtime/)
    // published DSH CLI, not a source checkout
    expect(df).toMatch(/npm install -g @deepseek-ai\/dsh@/)
    expect(df).not.toMatch(/COPY deepseek-harness/)
    expect(df).not.toMatch(/COPY packages\//)
    expect(df).not.toMatch(/AS builder/)
    // profile deps from the registry, frozen install, package-relative COPYs
    expect(df).toMatch(/COPY profiles\/reviewer-ci \.\/profiles\/reviewer-ci/)
    expect(df).toMatch(/pnpm --dir profiles\/reviewer-ci .* install --frozen-lockfile/)
    expect(df).toMatch(/ENV DSH_HOME=\/app\s*$/m)
    expect(df).toMatch(/\.agent-presets\/dsh-maestro-reviewer/)
    expect(df).toMatch(/\.agent-presets\/dsh-maestro-auditor/)
    expect(df).toMatch(/ci-settings\.opencode\.yaml \/app\/settings\.yaml/)
    expect(df).toMatch(/ci-settings\.deepseek\.yaml \/app\/settings\.deepseek\.yaml/)
    expect(df).toMatch(/tini/)
    expect(df).toMatch(/ENTRYPOINT.*entrypoint\.sh/)
    // CI deep reviews clone the source at the MR head SHA — git must exist in the image.
    expect(df).toMatch(/apt-get install[^&]*\bgit\b/)
  })

  it('entrypoint.sh validates required env then execs dsh --profile reviewer-ci with no task text', () => {
    const sh = readFileSync('docker/entrypoint.sh', 'utf-8')
    expect(sh).toMatch(/MAESTRO_GITLAB_TOKEN/)
    expect(sh).toMatch(/SOURCE_PROJECT_ID/)
    expect(sh).toMatch(/MR_IID/)
    expect(sh).toMatch(/--profile reviewer-ci"?\s*$/m)
    expect(sh).not.toMatch(/cli\.js/)
    expect(sh).toMatch(/REVIEW_REPORT_DIR/)
    expect(sh).toMatch(/CI_PROJECT_DIR/)
    expect(sh).toMatch(/MAESTRO_GITLAB_TOKEN as a user\/project token/)
    expect(sh).toMatch(/GITLAB_TOKEN_KIND/)
    expect(sh).toMatch(/OPENCODE_MODEL/)
    expect(sh).toMatch(/__OPENCODE_MODEL__/)
    expect(sh).toMatch(/__CI_MANAGED__/)
    expect(sh).toMatch(/settings\.deepseek\.yaml/)
    expect(sh).toMatch(/DEEPSEEK_API_KEY/)
    expect(sh).toMatch(/\.maestro-history/)
    expect(sh).toMatch(/dsh-maestro-review/)
  })

  it('ci-settings.opencode.yaml mirrors the host LLM config with no embedded secrets', () => {
    const yml = readFileSync('docker/ci-settings.opencode.yaml', 'utf-8')
    expect(yml).toMatch(/__CI_MANAGED__/)
    expect(yml).toMatch(/opencode-go/)
    expect(yml).toMatch(/llm-deepseek:/)
    // the opencode model is one env variable, substituted by entrypoint.sh
    // (exactly two value positions: catalog id + agent default)
    expect(yml.match(/^\s+(?:- id|model): __OPENCODE_MODEL__$/gm)).toHaveLength(2)
    expect(yml).toMatch(/^agent-default-model:/m)
    expect(yml).toMatch(/apiKeyEnv:\s*OPENCODE_GO_API_KEY/)
    // keys resolve from env at call time — never baked in
    expect(yml).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(yml).not.toMatch(/glpat-[A-Za-z0-9_.-]{8,}/)
  })

  it('ci-settings.deepseek.yaml serves deepseek-official from api.deepseek.com', () => {
    const yml = readFileSync('docker/ci-settings.deepseek.yaml', 'utf-8')
    expect(yml).toMatch(/llm-deepseek:/)
    expect(yml).toMatch(/apiKeyEnv:\s*DEEPSEEK_API_KEY/)
    expect(yml).toMatch(/baseURL:\s*https:\/\/api\.deepseek\.com/)
    expect(yml).toMatch(/provider:\s*deepseek-official/)
    expect(yml).not.toMatch(/__OPENCODE_MODEL__/)
    expect(yml).not.toMatch(/__CI_MANAGED__/)
    expect(yml).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
  })
})
