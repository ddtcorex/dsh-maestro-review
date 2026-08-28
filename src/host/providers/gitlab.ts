import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadUserConfig } from '../config-store.js'
import { secretsMatch } from '../secure-compare.js'
import type { MrOpenedPayload, ReviewRequest as OrchestratorReviewRequest } from '../events.js'
import { routeGitlabReviewRequest } from '../review-intake.js'
import type { ReviewProvider, ReviewRequest } from './interface.js'

export const name = 'maestro-review-webhook'
export const inject = ['webServer'] as const

export interface Config {
  botUsername?: string
  secret?: string
}
export const Config: z<Config> = z.object({
  botUsername: z.string(),
  secret: z.string().role('secret'),
})

interface GitlabMrWebhookBody {
  object_kind: string
  project: { id: number; path_with_namespace: string }
  object_attributes: { iid: number; action: string; source_branch: string }
}

const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024

function readBody(req: IncomingMessage, limit = MAX_WEBHOOK_BODY_BYTES): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    let raw = ''
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      if (raw.length + chunk.length > limit) {
        settled = true
        req.resume()
        resolvePromise(undefined)
        return
      }
      raw += chunk.toString()
    })
    req.on('end', () => { if (!settled) { settled = true; resolvePromise(raw) } })
    req.on('error', () => { if (!settled) { settled = true; resolvePromise(undefined) } })
  })
}

function isValidMrOpenedPayload(value: unknown): value is MrOpenedPayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.projectPath === 'string'
    && typeof v.projectId === 'number'
    && typeof v.mrIid === 'number'
    && typeof v.sourceBranch === 'string'
}

function hasValidGitlabMrIdentity(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  const project = body.project as Record<string, unknown> | undefined
  const attributes = body.object_attributes as Record<string, unknown> | undefined
  const mergeRequest = body.merge_request as Record<string, unknown> | undefined
  const source = body.object_kind === 'note' ? mergeRequest : attributes
  return typeof project?.id === 'number' && typeof project.path_with_namespace === 'string'
    && typeof source?.iid === 'number' && typeof source.source_branch === 'string'
}

// ReviewProvider implementation — pluggable interface for orchestrator
export const gitlabProvider: ReviewProvider = {
  id: 'gitlab',
  async intake(req: Request): Promise<ReviewRequest> {
    // Try to parse the request body as GitLab webhook JSON
    let body: unknown
    try {
      body = await req.clone().json()
    } catch {
      // Fallback/STUB: return generic empty request (keeps interface working without GitLab)
      return { provider: 'gitlab', projectPath: '', mrId: '', profile: 'generic' }
    }
    // If body looks like a GitLab MR webhook, map to ReviewRequest
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>
      const project = b.project as Record<string, unknown> | undefined
      const attrs = b.object_attributes as Record<string, unknown> | undefined
      const mr = b.merge_request as Record<string, unknown> | undefined
      const source = b.object_kind === 'note' ? mr : attrs
      const projectPath = typeof project?.path_with_namespace === 'string' ? project.path_with_namespace : ''
      const mrId = typeof source?.iid === 'number' ? String(source.iid) : ''
      if (projectPath && mrId) {
        return { provider: 'gitlab', projectPath, mrId, profile: 'generic' }
      }
    }
    // Fallback stub
    return { provider: 'gitlab', projectPath: '', mrId: '', profile: 'generic' }
  },
  async postFindings(_findings: any[]): Promise<void> {
    // Real posting is handled by orchestrator's GitLab API flow (postReviewFindings)
    // Keep interface compliant — no-op here; orchestrator will call postReviewFindings separately
  },
}

export function apply(ctx: Context, config: Config): void {
  let warnedUnconfigured = false
  async function requestAuthorized(headerValue: string | string[] | undefined): Promise<boolean> {
    const userConfig = await loadUserConfig()
    const expected = userConfig.webhookSecret ?? config.secret
    if (expected === undefined) {
      if (!warnedUnconfigured) { warnedUnconfigured = true; console.error('maestro-review-webhook: no webhook secret configured — set one in Maestro Settings or MAESTRO_GITLAB_WEBHOOK_SECRET; rejecting all requests until then') }
      return false
    }
    return secretsMatch(headerValue, expected)
  }
  function makeHandler(expectedPath: string) {
    return (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return }
      if (req.url !== expectedPath) { res.writeHead(404).end(); return }
      void requestAuthorized(req.headers['x-gitlab-token']).then(async (authorized) => {
        if (!authorized) { res.writeHead(401).end(); return }
        const raw = await readBody(req)
        if (raw === undefined) { res.writeHead(413).end(); return }
        if (expectedPath === '/hooks/gitlab-mr/trigger') {
          let parsed: unknown; try { parsed = JSON.parse(raw) } catch { res.writeHead(400).end(); return }
          if (!isValidMrOpenedPayload(parsed)) { res.writeHead(400).end(); return }
          const request: OrchestratorReviewRequest = { ...(parsed as any), trigger: 'mention', mode: 'quick', scope: { kind: 'mr' } }
          ctx.emit('maestro/review-request', request); res.writeHead(200).end(); return
        }
        let body: GitlabMrWebhookBody; try { body = JSON.parse(raw) } catch { res.writeHead(400).end(); return }
        const userConfig = await loadUserConfig()
        if ((body.object_kind === 'merge_request' || body.object_kind === 'note') && !hasValidGitlabMrIdentity(body)) { res.writeHead(400).end(); return }
        const request = routeGitlabReviewRequest(body, userConfig.botUsername ?? config.botUsername ?? 'maestro', { pushEnabled: userConfig.autoRereviewOnPush === true })
        if (request !== undefined) ctx.emit('maestro/review-request', request)
        res.writeHead(200).end()
      })
    }
  }
  const h1 = makeHandler('/hooks/gitlab-mr')
  const h2 = makeHandler('/hooks/gitlab-mr/trigger')
  const dispose1 = (ctx as any).webServer.register({ kind: 'exact', path: '/hooks/gitlab-mr', handler: h1 })
  const dispose2 = (ctx as any).webServer.register({ kind: 'exact', path: '/hooks/gitlab-mr/trigger', handler: h2 })
  ctx.effect(() => () => { dispose1(); dispose2() }, 'gitlab-webhook teardown')
}
