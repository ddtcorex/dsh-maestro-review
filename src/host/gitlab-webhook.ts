import { createServer, type IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadUserConfig } from './config-store.js'
import { secretsMatch } from './secure-compare.js'
import type { MrOpenedPayload, ReviewRequest } from './events.ts'
import { routeGitlabReviewRequest } from './review-intake.js'

export const name = 'maestro-gitlab-webhook'

export interface Config {
  port: number
  /** Username of the GitLab service account used for reviewer assignments. */
  botUsername?: string
  /**
   * Fallback when Maestro Settings has no webhook secret; optional so a
   * deployment that configures everything through Settings boots without env
   * vars. With neither source set, every request is rejected (fail closed).
   */
  secret?: string
}

export const Config: z<Config> = z.object({
  port: z.natural().max(65535).required(),
  botUsername: z.string(),
  secret: z.string().role('secret'),
})

interface GitlabMrWebhookBody {
  object_kind: string
  project: { id: number; path_with_namespace: string }
  object_attributes: { iid: number; action: string; source_branch: string }
}

/** GitLab payloads are small; 5 MB is generous and stops unbounded buffering. */
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

export function apply(ctx: Context, config: Config): void {
  // Settings wins over the boot secret, re-read per request so a change in the
  // UI takes effect without a restart. With neither source set, every token
  // fails the comparison (a header string never equals `undefined`), so the
  // server stays closed until a secret is configured.
  let warnedUnconfigured = false
  async function requestAuthorized(headerValue: string | string[] | undefined): Promise<boolean> {
    const userConfig = await loadUserConfig()
    const expected = userConfig.webhookSecret ?? config.secret
    if (expected === undefined) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true
        console.error('maestro-gitlab-webhook: no webhook secret configured — set one in Maestro Settings or MAESTRO_GITLAB_WEBHOOK_SECRET; rejecting all requests until then')
      }
      return false
    }
    return secretsMatch(headerValue, expected)
  }

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }
    void requestAuthorized(req.headers['x-gitlab-token']).then(async (authorized) => {
      if (!authorized) {
        res.writeHead(401).end()
        return
      }
      readBody(req).then(async (raw) => {
        if (raw === undefined) {
          res.writeHead(413).end()
          return
        }
        if (req.url === '/hooks/gitlab-mr/trigger') {
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            res.writeHead(400).end()
            return
          }
          if (!isValidMrOpenedPayload(parsed)) {
            res.writeHead(400).end()
            return
          }
          const request: ReviewRequest = {
            ...parsed,
            trigger: 'mention',
            mode: 'quick',
            scope: { kind: 'mr' },
          }
          ctx.emit('maestro/review-request', request)
          res.writeHead(200).end()
          return
        }

        if (req.url !== '/hooks/gitlab-mr') {
          res.writeHead(404).end()
          return
        }
        let body: GitlabMrWebhookBody
        try {
          body = JSON.parse(raw)
        } catch {
          res.writeHead(400).end()
          return
        }
        const userConfig = await loadUserConfig()
        if ((body.object_kind === 'merge_request' || body.object_kind === 'note') && !hasValidGitlabMrIdentity(body)) {
          res.writeHead(400).end()
          return
        }
        const request = routeGitlabReviewRequest(
          body,
          userConfig.botUsername ?? config.botUsername ?? 'maestro',
          { pushEnabled: userConfig.autoRereviewOnPush === true },
        )
        if (request !== undefined) ctx.emit('maestro/review-request', request)
        res.writeHead(200).end()
      })
    })
  })

  server.listen(config.port)

  ctx.effect(() => async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  }, 'gitlab-webhook teardown')
}
