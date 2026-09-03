import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-review-findings-tool'
export const inject = ['tools']

export interface ReviewFinding {
  status: 'new' | 'reply'
  body: string
  path?: string
  line?: number
  discussionId?: string
}

export interface Config {
  onReport: (findings: ReviewFinding[]) => void
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'report_review_findings',
    description: 'Submit your complete list of review findings exactly once, when done analyzing. Each finding is {status: "new", path, line, body} for a location with no existing thread, or {status: "reply", discussionId, body} to update an existing thread returned by gitlab_list_own_review_threads (reply to a resolved thread reopens it — prefer reply over new when the substance matches).',
    parameters: {
      findings: {
        type: 'array',
        required: true,
        description: 'The complete list of findings for this review.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['new', 'reply'], required: true },
            body: { type: 'string', required: true },
            path: { type: 'string' },
            line: { type: 'number' },
            discussionId: { type: 'string' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { received: { type: 'number', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Recorded ${value.received} finding(s).` }],
    },
    async execute(args) {
      const findings = args.findings as ReviewFinding[]
      config.onReport(findings)
      return { received: findings.length }
    },
  }))
}
