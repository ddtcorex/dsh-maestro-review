// @vitest-environment jsdom
/**
 * The GitLab and Review section as the shell mounts it.
 *
 * This package had no DOM spec before, so nothing observed what the section
 * renders — the gap a sibling package's ReferenceError shipped through with
 * verify, 1240 tests and a clean dry-boot log all green.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ReviewSettings } from '../src/client/review/ReviewSettings.js'

function rpc(over: Record<string, unknown> = {}) {
  return vi.fn(async (endpoint: string) => {
    if (endpoint === 'maestro.getConfig') {
      return {
        gitlabBaseUrl: 'https://gitlab.example.com',
        botUsername: 'maestro-bot',
        webhookPort: '3081',
        autoRereviewOnPush: true,
        hasGitlabToken: true,
        hasWebhookSecret: false,
      }
    }
    return over[endpoint] ?? {}
  }) as any
}

afterEach(cleanup)

describe('ReviewSettings', () => {
  it('mounts and keeps the three-state secret contract', async () => {
    const { container } = render(<ReviewSettings rpcCall={rpc()} />)

    await waitFor(() => {
      expect(screen.getByText('GitLab and Review')).toBeInTheDocument()
    })
    // Present secret: stored, never rendered back.
    await waitFor(() => {
      expect(screen.getAllByText(/A value is stored/).length).toBe(1)
    })
    // Absent secret says so, and says it differently.
    expect(screen.getAllByText('Not set.').length).toBe(1)
    expect(container.querySelector('[data-review-secret]')).toBeInTheDocument()
  })

  it('never renders a stored secret back into an input', async () => {
    const { container } = render(<ReviewSettings rpcCall={rpc()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-review-secret]')).toBeInTheDocument()
    })
    for (const input of container.querySelectorAll('[data-review-secret]')) {
      expect((input as HTMLInputElement).type).toBe('password')
      expect((input as HTMLInputElement).value).toBe('')
    }
  })

  it('labels fields for a person, not with the config key', async () => {
    render(<ReviewSettings rpcCall={rpc()} />)

    // Every label was `String(key)`, so the page read "gitlabBaseUrl" and
    // "reviewSessionRetentionDays" to anyone who has not opened the store.
    await waitFor(() => {
      expect(screen.getByLabelText('GitLab base URL')).toBeInTheDocument()
    })
    for (const key of ['gitlabBaseUrl', 'botUsername', 'webhookPort', 'agentTimeoutMs', 'reviewSessionRetentionDays']) {
      expect(screen.queryByLabelText(key)).not.toBeInTheDocument()
    }
  })

  it('draws the house pattern: badged header, status line, two-column rows', async () => {
    const { container } = render(<ReviewSettings rpcCall={rpc()} />)

    expect(container.querySelector('[data-maestro-logo]')).toBeInTheDocument()
    expect(container.querySelector('[data-review-status]')).toBeInTheDocument()

    const rows = container.querySelectorAll('[data-review-row]')
    expect(rows.length).toBeGreaterThanOrEqual(9)
    for (const row of rows) {
      expect(row.querySelector('[data-review-row-text]')).toBeInTheDocument()
      expect(row.querySelector('[data-review-control]')).toBeInTheDocument()
    }
  })

  it('keeps each secret save beside the field it writes', async () => {
    const { container } = render(<ReviewSettings rpcCall={rpc()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-review-save-secret="gitlabToken"]')).toBeInTheDocument()
    })
    // It is disabled until the field holds something, so it belongs to that
    // row rather than floating between rows.
    expect((container.querySelector('[data-review-save-secret="gitlabToken"]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector('[data-review-row] [data-review-save-secret="gitlabToken"]')).not.toBeNull()
  })
})