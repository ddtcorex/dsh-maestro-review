import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { RpcErrorDetailsMap, RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { existsSync, statSync } from 'node:fs'
import { loadUserConfig, saveUserConfig, type MaestroUserConfig } from './config-store.js'
import { listReviews } from './review-history.js'
import { pinRotationText, type NotifierLike } from './notify.js'

export const name = 'maestro-settings-rpc'
export const inject = ['connection', 'maestroTunnel']

/** Keys the Settings card may persist; anything else is a rejected save. */
const SAVABLE_KEYS = new Set<keyof MaestroUserConfig>([
  'gitlabBaseUrl', 'gitlabToken', 'botUsername', 'webhookSecret', 'webhookPort',
  'projectMappings', 'reviewModel', 'autoRereviewOnPush', 'agentTimeoutMs', 'reviewSessionRetentionDays',
  'tunnelMode', 'quickTarget', 'tunnelId', 'tunnelCredentialsFile', 'tunnelHostname',
  'proxyPort', 'proxyHost', 'lanPinEnabled', 'telegramBotToken', 'telegramChatId',
  'telegramReviewNotifications',
])

function validateReviewModel(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return 'reviewModel must be an object.'
  const { provider, model, reasoningEffort } = value as Record<string, unknown>
  if (typeof provider !== 'string' || provider.trim() === '') return 'reviewModel.provider must be a non-empty string.'
  if (typeof model !== 'string' || model.trim() === '') return 'reviewModel.model must be a non-empty string.'
  if (reasoningEffort !== undefined && typeof reasoningEffort !== 'string') return 'reviewModel.reasoningEffort must be a string.'
  if (typeof reasoningEffort === 'string' && reasoningEffort.trim() === '') return 'reviewModel.reasoningEffort must be a non-empty string when provided.'
  return null
}

/** Secrets never returned to the client; the UI learns only their presence. */
const SECRET_KEYS = ['gitlabToken', 'webhookSecret', 'telegramBotToken'] as const

function maskSecrets(config: MaestroUserConfig): MaestroUserConfig & Record<string, boolean> {
  const masked: Record<string, unknown> = { ...config }
  for (const key of SECRET_KEYS) {
    if (typeof config[key] === 'string' && config[key] !== '') {
      delete masked[key]
      masked[`has${key.charAt(0).toUpperCase()}${key.slice(1)}`] = true
    }
  }
  return masked as MaestroUserConfig & Record<string, boolean>
}

/**
 * Validate a save payload from the Settings card. Secrets follow a
 * three-state rule: absent keeps the stored value, `''` clears it, a
 * non-empty string replaces it. A mapping's `localRepoPath` must be an
 * existing directory containing a `.git` entry, because reviews check out
 * worktrees from it.
 */
function validateSavePayload(payload: unknown): { ok: true; patch: Partial<MaestroUserConfig> } | { ok: false; message: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, message: 'Settings payload must be a JSON object.' }
  }
  const patch: Partial<MaestroUserConfig> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!SAVABLE_KEYS.has(key as keyof MaestroUserConfig)) {
      return { ok: false, message: `Unknown settings key "${key}".` }
    }
    if (key === 'projectMappings') {
      if (!Array.isArray(value)) return { ok: false, message: 'projectMappings must be an array.' }
      for (const mapping of value) {
        if (typeof mapping !== 'object' || mapping === null) return { ok: false, message: 'Each project mapping must be an object.' }
        const { projectPath, localRepoPath, reviewModel } = mapping as Record<string, unknown>
        if (typeof projectPath !== 'string' || projectPath.trim() === '') return { ok: false, message: 'Each mapping needs a non-empty projectPath.' }
        if (typeof localRepoPath !== 'string' || localRepoPath.trim() === '') return { ok: false, message: 'Each mapping needs a non-empty localRepoPath.' }
        if (localRepoPath !== '/' && !(localRepoPath as string).startsWith('/')) {
          return { ok: false, message: `localRepoPath "${String(localRepoPath)}" must be an absolute path.` }
        }
        if (!existsSync(localRepoPath) || !statSync(localRepoPath).isDirectory() || !existsSync(`${localRepoPath}/.git`)) {
          return { ok: false, message: `localRepoPath "${localRepoPath}" is not an existing git repository checkout.` }
        }
        if (reviewModel !== undefined) {
          const err = validateReviewModel(reviewModel)
          if (err !== null) return { ok: false, message: `projectMappings reviewModel: ${err}` }
        }
      }
    }
    if (key === 'reviewModel') {
      if (value === null) {
        patch[key as keyof MaestroUserConfig] = undefined as never
        continue
      }
      const err = validateReviewModel(value)
      if (err !== null) return { ok: false, message: err }
    }
    if (key === 'webhookPort' && value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535)) {
      return { ok: false, message: 'webhookPort must be an integer between 1 and 65535.' }
    }
    if (key === 'agentTimeoutMs' && value !== undefined && (typeof value !== 'number' || value < 1000)) {
      return { ok: false, message: 'agentTimeoutMs must be at least 1000 ms.' }
    }
    if (key === 'reviewSessionRetentionDays' && value !== undefined && (typeof value !== 'number' || value < 0)) {
      return { ok: false, message: 'reviewSessionRetentionDays must be 0 (off) or a positive number of days.' }
    }
    patch[key as keyof MaestroUserConfig] = value as never
  }
  return { ok: true, patch }
}

export const MAESTRO_RPC_CHANNEL = '/dsh-maestro-review'
export const MAESTRO_ENDPOINTS = Object.freeze({
  status: 'maestro.status',
  getConfig: 'maestro.getConfig',
  saveConfig: 'maestro.saveConfig',
  tunnelStart: 'maestro.tunnelStart',
  tunnelStop: 'maestro.tunnelStop',
  proxyStatus: 'maestro.proxyStatus',
  getPin: 'maestro.getPin',
  rotatePin: 'maestro.rotatePin',
  lanPinStatus: 'maestro.lanPin.status',
  lanPinSetEnabled: 'maestro.lanPin.setEnabled',
  lanPinRotate: 'maestro.lanPin.rotate',
  reviewsList: 'maestro.reviews.list',
  modelsList: 'maestro.models.list',
  modelsCurrent: 'maestro.models.current',
})

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function fail(message: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      // Synthetic details, not real Zod validation output: `bad-request`'s real `details`
      // shape is `{ issues: ZodIssue[] }` from the `zod` package (a specific discriminated
      // union), but this is an app-level "unknown endpoint" error being shoehorned into
      // DSH's shared RPC error taxonomy, not an actual Zod-validated payload. Constructing
      // a byte-perfect ZodIssue here would be disproportionate, so we cast this one value
      // to the narrow per-code details type (not the wider `RpcError['details']` union,
      // which doesn't satisfy the 'bad-request' discriminant on its own).
      details: { issues: [{ message }] } as RpcErrorDetailsMap['bad-request'],
    },
  }
}

export function apply(ctx: Context): void {
  const handler = async (endpoint: string, payload: unknown) => {
    if (endpoint === MAESTRO_ENDPOINTS.status) {
      return ok(ctx.maestroTunnel.status())
    }
    if (endpoint === MAESTRO_ENDPOINTS.getConfig) {
      return ok(maskSecrets(await loadUserConfig()))
    }
    if (endpoint === MAESTRO_ENDPOINTS.saveConfig) {
      const validated = validateSavePayload(payload)
      if (!validated.ok) return fail(validated.message)
      const merged = await saveUserConfig(validated.patch)
      return ok(maskSecrets(merged))
    }
    if (endpoint === MAESTRO_ENDPOINTS.tunnelStart) {
      return ok(await ctx.maestroTunnel.start())
    }
    if (endpoint === MAESTRO_ENDPOINTS.tunnelStop) {
      return ok(await ctx.maestroTunnel.stop())
    }
    if (endpoint === MAESTRO_ENDPOINTS.proxyStatus) {
      return ok(ctx.maestroTunnel.proxyStatus())
    }
    if (endpoint === MAESTRO_ENDPOINTS.getPin) {
      return ok({ pin: await ctx.maestroTunnel.getPin() })
    }
    if (endpoint === MAESTRO_ENDPOINTS.rotatePin) {
      const pin = await ctx.maestroTunnel.rotatePin()
      // Delivery is deliberately detached: a slow/unavailable notifier cannot make the
      // explicit security operation appear to fail or hold the Settings UI open.
      void loadUserConfig().then((config) => {
        const notifier = ctx.get?.('maestroNotifier') as NotifierLike | undefined
        if (notifier === undefined) return undefined
        return notifier.send(
          'telegram',
          { botToken: config.telegramBotToken, chatId: config.telegramChatId },
          { text: pinRotationText(pin) },
        )
      }).then((delivery) => {
        if (!delivery) return
        if (delivery.sent) {
          ctx.logger?.info?.('maestro-telegram: PIN rotation notification delivered')
        } else if (delivery.reason === 'request-failed') {
          ctx.logger?.warn?.('maestro-telegram: PIN rotation notification failed')
        }
      }).catch(() => {
        ctx.logger?.warn?.('maestro-telegram: PIN rotation notification failed')
      })
      return ok({ pin })
    }
    if (endpoint === MAESTRO_ENDPOINTS.lanPinStatus) {
      const config = await loadUserConfig()
      // Disabled by default; the LAN PIN is only read (and generated) once the
      // user opts in, so an untouched install keeps LAN access open.
      if (config.lanPinEnabled !== true) return ok({ enabled: false })
      return ok({ enabled: true, pin: await ctx.maestroTunnel.getLanPin() })
    }
    if (endpoint === MAESTRO_ENDPOINTS.lanPinSetEnabled) {
      const enabled = (payload as { enabled?: unknown } | undefined)?.enabled === true
      await saveUserConfig({ lanPinEnabled: enabled })
      // The proxy reads lanPinEnabled at boot; a reload applies the new gate
      // without waiting for a harness restart.
      await ctx.maestroTunnel.reloadConfig()
      return ok({ enabled })
    }
    if (endpoint === MAESTRO_ENDPOINTS.lanPinRotate) {
      return ok({ pin: await ctx.maestroTunnel.rotateLanPin() })
    }
    if (endpoint === MAESTRO_ENDPOINTS.reviewsList) {
      return ok(await listReviews(20))
    }
    if (endpoint === MAESTRO_ENDPOINTS.modelsCurrent) {
      const agentDefaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } | undefined
      const fallback = agentDefaultModel?.currentSelection() ?? { provider: 'deepseek-official', model: 'deepseek-chat' }
      return ok(fallback)
    }
    if (endpoint === MAESTRO_ENDPOINTS.modelsList) {
      const agentDefaultModel = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } | undefined
      const fallbackSelection = agentDefaultModel?.currentSelection() ?? { provider: 'deepseek-official', model: 'deepseek-chat' }
      const llm = ctx.get('llm') as { listProviders?: () => Array<{ id: string; name: string }>; listModels?: (provider: string) => Promise<Array<{ id: string; name?: string }>> } | undefined
      if (llm?.listProviders !== undefined && llm?.listModels !== undefined) {
        try {
          const providers = llm.listProviders()
          const groups: Array<{ provider: string; name: string; models: string[] }> = []
          for (const p of providers) {
            try {
              const models = await llm.listModels(p.id)
              groups.push({ provider: p.id, name: p.name, models: models.map(m => m.id) })
            } catch {
              groups.push({ provider: p.id, name: p.name, models: [] })
            }
          }
          if (groups.length > 0) return ok({ groups, current: fallbackSelection })
        } catch {
          // fall through to fallback
        }
      }
      // Fallback: single group containing the current selection so dropdown still works
      return ok({ groups: [{ provider: fallbackSelection.provider, name: fallbackSelection.provider, models: [fallbackSelection.model] }], current: fallbackSelection })
    }
    return fail(`Unknown endpoint: ${endpoint}`)
  }
  const disposeRpc = ctx.connection.rpc.handle(MAESTRO_RPC_CHANNEL, handler, { authority: 'loopback' })

  ctx.effect(() => () => { disposeRpc(); }, 'maestro-settings-rpc teardown')
}
