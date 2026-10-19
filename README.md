# @ddtcorex/dsh-maestro-review

Maestro Review on a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH) web host: GitLab webhook intake, project mappings with local worktrees,
the Maestro Review Settings section and Telegram review digests. Every review
runs through the engine of [`@ddtcorex/maestro-reviewer`](https://github.com/ddtcorex/maestro-reviewer),
which also carries the GitLab CI flow.

## What it provides

- **Webhook intake** (row `maestro-review-webhook`): `/hooks/gitlab-mr` on the
  raw DSH webserver, authenticated by `X-Gitlab-Token`. An `@<bot>` mention
  asks for a quick review, `/maestro deep` or "deep review" for a deep one;
  reviewer assignment and pushes trigger reviews when enabled.
- **Host orchestrator** (row `maestro-review-host-orchestrator`): reads the
  settings, applies the trigger gates, prunes history, and calls the engine's
  `reviewEngine` service. A mapped project is reviewed on a worktree of its
  local checkout (vendor and `app/etc/env.php` linked, a per-MR govard
  environment for the deep auditor, torn down afterwards); a missing branch
  falls back to a diff-only review. An unmapped project gets a diff-only
  review on mention and a "Not started" note for deep.
- **Settings** (row `maestro-review-settings-rpc`, channel
  `/dsh-maestro-review`, Settings section `maestro-review`): GitLab URL,
  token, bot username, webhook secret, project mappings, trigger defaults,
  review model, agent timeout and history retention, stored in the shared
  Maestro settings store.
- **Telegram digest**: one message per finished review when enabled, through
  the optional `maestroNotifier` service of `@ddtcorex/dsh-maestro-notifier`.

## Install

```sh
dsh plugin --profile web add @ddtcorex/maestro-reviewer @ddtcorex/dsh-maestro-review
```

Both packages are needed: the engine rows (`maestro-review-host`,
`maestro-review-engine`) come from `@ddtcorex/maestro-reviewer`.

## Development

```sh
pnpm --dir ../../maestro-reviewer build   # the engine's lib/ first
pnpm install
pnpm verify
pnpm build    # host lib/ plus the client bundle lib/client.js
pnpm test
```

## License

MIT
