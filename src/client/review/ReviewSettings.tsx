/**
 * The GitLab and Review keys `dsh-maestro-review` owns, and nothing else.
 *
 * Secrets follow a three-state rule and are never rendered back: the server
 * answers `hasGitlabToken` / `hasWebhookSecret` instead of the value, a blank
 * field keeps what is stored, and a filled field replaces it.
 */
import * as React from 'react'
import type { RpcCall } from '../index.js'

interface Cfg {
  gitlabBaseUrl?: string
  botUsername?: string
  webhookPort?: string | number
  autoRereviewOnPush?: boolean
  autoReviewOnAssign?: boolean
  agentTimeoutMs?: number
  reviewSessionRetentionDays?: number
  hasGitlabToken?: boolean
  hasWebhookSecret?: boolean
}

function Field(props: { label: string; hint?: string; children?: React.ReactNode }) {
  return React.createElement(
    'div',
    { 'data-review-field': '' },
    React.createElement('label', { 'data-review-label': '' }, props.label),
    props.children,
    props.hint ? React.createElement('p', { 'data-review-hint': '' }, props.hint) : null,
  )
}

function SecretField(props: {
  label: string
  present: boolean
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return Field({
    label: props.label,
    hint: props.present ? 'A value is stored. Leave blank to keep it.' : 'Not set.',
    children: React.createElement('input', {
      type: 'password',
      value: props.value,
      placeholder: props.present ? 'stored — type to replace' : 'not set',
      disabled: props.disabled,
      autoComplete: 'new-password',
      'data-review-secret': '',
      onChange: (e: any) => props.onChange(e.target.value),
    }),
  })
}

export function ReviewSettings(props: { rpcCall: RpcCall }) {
  const { rpcCall } = props
  const [cfg, setCfg] = React.useState<Cfg>({})
  const [gitlabToken, setGitlabToken] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const fail = React.useCallback((e: unknown) => {
    setNotice({ tone: 'bad', text: e instanceof Error ? e.message : String(e) })
  }, [])

  const refresh = React.useCallback(async () => {
    setBusy(true)
    try {
      setCfg((await rpcCall('maestro.getConfig')) ?? {})
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }, [rpcCall, fail])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const save = React.useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true)
      try {
        await rpcCall('maestro.saveConfig', patch)
        // Blank means keep, so the local field clears only after the save
        // landed; otherwise a failed save would silently drop what was typed.
        if ('gitlabToken' in patch) setGitlabToken('')
        if ('webhookSecret' in patch) setWebhookSecret('')
        setNotice({ tone: 'ok', text: 'Saved.' })
        await refresh()
      } catch (e) {
        fail(e)
      } finally {
        setBusy(false)
      }
    },
    [rpcCall, refresh, fail],
  )

  const text = (key: keyof Cfg, placeholder = '') =>
    Field({
      label: String(key),
      children: React.createElement('input', {
        type: 'text',
        value: (cfg[key] as string | number | undefined) ?? '',
        placeholder,
        disabled: busy,
        'data-review-input': String(key),
        onChange: (e: any) => setCfg((c) => ({ ...c, [key]: e.target.value })),
        onBlur: (e: any) => void save({ [key]: e.target.value }),
      }),
    })

  const toggle = (key: keyof Cfg, title: string) =>
    Field({
      label: title,
      children: React.createElement('input', {
        type: 'checkbox',
        checked: cfg[key] === true,
        disabled: busy,
        'aria-label': title,
        'data-review-toggle': String(key),
        onChange: (e: any) => void save({ [key]: e.target.checked }),
      }),
    })

  return React.createElement(
    'div',
    { 'data-review-root': '' },
    React.createElement('h2', { 'data-review-title': '' }, 'GitLab and Review'),

    notice
      ? React.createElement('p', { 'data-review-notice': '', 'data-tone': notice.tone, role: 'status' }, notice.text)
      : null,

    React.createElement('div', { 'data-review-actions': '' },
      React.createElement('button', { type: 'button', disabled: busy, onClick: () => void refresh() }, 'Refresh'),
    ),

    text('gitlabBaseUrl', 'https://gitlab.example.com'),
    text('botUsername', 'maestro-bot'),

    SecretField({
      label: 'GitLab token',
      present: cfg.hasGitlabToken === true,
      value: gitlabToken,
      disabled: busy,
      onChange: setGitlabToken,
    }),
    React.createElement('button', {
      type: 'button',
      disabled: busy || gitlabToken === '',
      'data-review-save-secret': 'gitlabToken',
      onClick: () => void save({ gitlabToken }),
    }, 'Save token'),

    SecretField({
      label: 'Webhook secret',
      present: cfg.hasWebhookSecret === true,
      value: webhookSecret,
      disabled: busy,
      onChange: setWebhookSecret,
    }),
    React.createElement('button', {
      type: 'button',
      disabled: busy || webhookSecret === '',
      'data-review-save-secret': 'webhookSecret',
      onClick: () => void save({ webhookSecret }),
    }, 'Save secret'),

    text('webhookPort', '3081'),
    toggle('autoRereviewOnPush', 'Re-review on push'),
    toggle('autoReviewOnAssign', 'Review on assign'),
    text('agentTimeoutMs', '600000'),
    text('reviewSessionRetentionDays', '30'),
  )
}