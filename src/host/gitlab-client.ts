import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-gitlab-client'
export const inject = ['tools']

export interface Config {
  baseUrl: string
  projectId: string | number
  mrIid: number
  token: string
  botUsername: string
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  projectId: z.union([z.string(), z.number()]).required(),
  mrIid: z.number().required(),
  token: z.string().role('secret').required(),
  botUsername: z.string().required(),
})

interface GitlabDiff {
  old_path: string
  new_path: string
  diff: string
}

interface GitlabDiffRefs {
  base_sha: string
  start_sha: string
  head_sha: string
}

interface GitlabDiscussionNote {
  body: string
  author: { username: string }
  position?: { new_path: string, new_line: number | null }
  resolved: boolean
}

interface GitlabDiscussion {
  id: string
  notes: GitlabDiscussionNote[]
}

export function apply(ctx: Context, config: Config): void {
  const apiBase = `${config.baseUrl}/api/v4/projects/${config.projectId}/merge_requests/${config.mrIid}`
  const headers = { 'PRIVATE-TOKEN': config.token }
  let cachedDiffRefs: GitlabDiffRefs | undefined

  async function getDiffRefs(): Promise<GitlabDiffRefs> {
    if (cachedDiffRefs !== undefined) return cachedDiffRefs
    const response = await fetch(apiBase, { headers })
    if (!response.ok) {
      throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
    }
    cachedDiffRefs = (await response.json() as { diff_refs: GitlabDiffRefs }).diff_refs
    return cachedDiffRefs
  }

  ctx.tools.register(defineTool({
    name: 'gitlab_get_mr_diff',
    description: 'Fetch the current unified diff for this merge request.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const response = await fetch(`${apiBase}/diffs`, { headers })
      if (!response.ok) {
        throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      const diffs = await response.json() as GitlabDiff[]
      const text = diffs.map(d => `--- ${d.old_path}\n+++ ${d.new_path}\n${d.diff}`).join('\n\n')
      return { text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gitlab_post_mr_comment',
    description: 'Post a Markdown comment (discussion note) on this merge request.',
    parameters: {
      body: { type: 'string', required: true, description: 'Markdown comment body.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { posted: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'Comment posted.' }],
    },
    async execute(args) {
      const response = await fetch(`${apiBase}/notes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: args.body }),
      })
      if (!response.ok) {
        throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      return { posted: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gitlab_list_own_review_threads',
    description: 'List this merge request\'s unresolved inline discussion threads previously created by this bot account, so you can reply instead of duplicating.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const response = await fetch(`${apiBase}/discussions`, { headers })
      if (!response.ok) {
        throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      const discussions = await response.json() as GitlabDiscussion[]
      const ownThreads = discussions
        .filter(d => d.notes.length > 0 && d.notes[0].author.username === config.botUsername && !d.notes[0].resolved && d.notes[0].position !== undefined)
        .map(d => ({ discussionId: d.id, path: d.notes[0].position!.new_path, line: d.notes[0].position!.new_line, lastCommentBody: d.notes[d.notes.length - 1].body }))
      return { text: JSON.stringify(ownThreads) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gitlab_post_inline_comment',
    description: 'Create a new inline discussion at a specific file and line in this merge request\'s current diff.',
    parameters: {
      path: { type: 'string', required: true, description: 'File path on the new (target) side of the diff.' },
      line: { type: 'number', required: true, description: 'Line number on the new (target) side of the diff.' },
      body: { type: 'string', required: true, description: 'Markdown comment body.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { posted: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'Inline comment posted.' }],
    },
    async execute(args) {
      const diffRefs = await getDiffRefs()
      const response = await fetch(`${apiBase}/discussions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: args.body,
          position: {
            position_type: 'text',
            base_sha: diffRefs.base_sha,
            start_sha: diffRefs.start_sha,
            head_sha: diffRefs.head_sha,
            old_path: args.path,
            new_path: args.path,
            new_line: args.line,
          },
        }),
      })
      if (!response.ok) {
        throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      return { posted: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gitlab_reply_to_thread',
    description: 'Reply to an existing inline discussion thread (discussionId from gitlab_list_own_review_threads) without resolving it.',
    parameters: {
      discussionId: { type: 'string', required: true },
      body: { type: 'string', required: true, description: 'Markdown reply body.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { posted: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'Reply posted.' }],
    },
    async execute(args) {
      const response = await fetch(`${apiBase}/discussions/${args.discussionId}/notes`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: args.body }),
      })
      if (!response.ok) {
        throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
      }
      return { posted: true }
    },
  }))
}
