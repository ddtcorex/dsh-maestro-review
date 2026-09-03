import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
describe('docker', () => {
  it('Dockerfile exists and uses node:22-slim + tini', () => {
    const df = readFileSync('docker/Dockerfile','utf-8')
    expect(df).toMatch(/FROM node:22-slim/)
    expect(df).toMatch(/tini/)
    expect(df).toMatch(/ENTRYPOINT.*entrypoint\.sh/)
  })
  it('entrypoint.sh is executable and checks required env', () => {
    const sh = readFileSync('docker/entrypoint.sh','utf-8')
    expect(sh).toMatch(/MAESTRO_GITLAB_TOKEN/)
    expect(sh).toMatch(/SOURCE_PROJECT_ID/)
    expect(sh).toMatch(/MR_IID/)
    expect(sh).toMatch(/exec node.*lib\/runner\/cli\.js/)
  })
})
