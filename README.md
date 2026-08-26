# @ddtcorex/dsh-maestro-review

Automated merge-request review for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
pluggable **ReviewProvider** (GitLab first), an orchestrator that spins up reviewer/auditor
child agents on fresh worktrees, webhook intake for GitLab events, and a settings/tunnel
client UI injected into the DSH Web slots.

Part of the Maestro Harness suite (`dsh-maestro-*`). Cordis patch rows:
`maestro-review-webhook` (intake), `maestro-review-orchestrator` (pipeline),
`maestro-review-settings-rpc` (settings UI) — all served by this npm package.

## What it provides

- **ReviewProvider abstraction** — GitLab client today; other forges plug in behind the same
  interface.
- **Orchestrator** — reviewer + auditor agent runs against a disposable worktree of the MR,
  model selection overridable globally (`reviewModel`) and per project mapping.
- **Webhook intake** — receives GitLab MR events, enqueues reviews (dedup + retention).
- **Review findings/history/signals** — findings written through the `review-findings`
  tool by tool-only review subagents (never free text); history + signals tracked per MR.
- **Govard/workspace tooling** available inside review runs.
- **Client half** — settings section rendered into DSH Web slots; notification copy stays
  here, delivery goes through the optional `maestroNotifier` service.

## Settings

Reads its configuration through the **shared namespaced settings store**
(`~/.dsh/maestro/settings.json`, owned by `@ddtcorex/dsh-maestro-config-lib`) via the flat
adapter in `src/config-store.ts`; machine runtime state stays in a package-local sidecar.

## Install

```sh
dsh plugin --profile web add @ddtcorex/dsh-maestro-review
# or everything at once:
dsh plugin --profile web add @ddtcorex/dsh-maestro-meta
```

## Development

```sh
pnpm install
pnpm verify        # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc -> lib/
pnpm run build:client   # browser bundle -> lib/client.js (required after client changes)
```

See AGENTS.md for conventions (host/client split, secrets handling, live-validation rules).

## License

MIT
