import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeSkillProvider, resolveSkillsDir } from '../src/host/skill-provider.js'

async function fixture(raw: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'native-tools-'))
  const dir = join(root, 'skills', 'dsh-native-tools')
  await mkdir(dir, { recursive: true })
  if (raw !== null) await writeFile(join(dir, 'SKILL.md'), raw)
  return root
}

const VALID = [
  '---',
  'name: dsh-native-tools',
  'description: test description',
  '---',
  '',
  '# DSH Native Tools',
  '',
  'body',
].join('\n')

describe('skill-provider', () => {
  it('resolves the package-root skills/ dir from a nested module dir', () => {
    // lib/host/ and src/host/ both resolve to <package>/skills.
    const repoRoot = resolveSkillsDir(join(process.cwd(), 'src', 'host'))
    expect(repoRoot).toBe(join(process.cwd(), 'skills'))
  })

  it('lists the skill with frontmatter name and description', async () => {
    const root = await fixture(VALID)
    try {
      const provider = makeSkillProvider(join(root, 'skills'))
      const listed = await provider.list({} as never)
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ name: 'dsh-native-tools', description: 'test description' })
      // The dsh-skill service attributes a candidate through the provider's own
      // name — a missing one surfaces at runtime as `provider "undefined"`.
      expect(provider.name).toBe('maestro-review')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns undefined from get() when the candidate path is unreadable', async () => {
    const root = await fixture(VALID)
    try {
      const provider = makeSkillProvider(join(root, 'skills'))
      const [candidate] = await provider.list({} as never)
      expect(await provider.get({ ...candidate, path: join(root, 'gone.md') } as never, {} as never)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists nothing when the skill dir or file is absent', async () => {
    const noFile = await fixture(null)
    const noDir = await mkdtemp(join(tmpdir(), 'native-tools-empty-'))
    try {
      expect(await makeSkillProvider(join(noFile, 'skills')).list({} as never)).toEqual([])
      expect(await makeSkillProvider(join(noDir, 'skills')).list({} as never)).toEqual([])
    } finally {
      await rm(noFile, { recursive: true, force: true })
      await rm(noDir, { recursive: true, force: true })
    }
  })

  it('serves the skill body without its frontmatter', async () => {
    const root = await fixture(VALID)
    try {
      const provider = makeSkillProvider(join(root, 'skills'))
      const [candidate] = await provider.list({} as never)
      const def = await provider.get(candidate as never, {} as never)
      expect(def?.content).toContain('# DSH Native Tools')
      expect(def?.content).not.toContain('description: test description')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves the real shipped skill', async () => {
    const provider = makeSkillProvider(resolveSkillsDir(join(process.cwd(), 'src', 'host')))
    const [candidate] = await provider.list({} as never)
    expect(candidate?.name).toBe('dsh-native-tools')
    const def = await provider.get(candidate as never, {} as never)
    expect(def?.content).toContain('maestro_perf_log_stats')
  })
})
