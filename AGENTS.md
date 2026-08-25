# AGENTS.md — dsh-maestro-review

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Merge-request (MR) review plugin for the DeepSeek Harness (DSH): a pluggable review pipeline (webhook → orchestrator → review-intake → findings) with GitLab implemented and GitHub stubbed, plus review history/signals and govard/workspace tools.

Names by boundary: npm package = `@ddtcorex/dsh-maestro-review`; Cordis patch rows = `maestro-review-webhook`, `maestro-review-orchestrator`, `maestro-review-settings-rpc`.

Part of the Maestro Harness suite. Host half + client half (review settings/slot UI).

## Layout

- `src/providers/interface.ts` — the `ReviewProvider` contract (pluggable).
- `src/providers/gitlab.ts` — GitLab provider implementation.
- `src/providers/github.stub.ts` — GitHub provider stub (implement per contract when needed).
- `src/orchestrator.ts` — the review pipeline orchestration.
- `src/gitlab-webhook.ts` — GitLab webhook intake (row `maestro-review-webhook`).
- `src/review-intake.ts` / `src/review-findings-tool.ts` / `src/review-history.ts` / `src/review-signals.ts` — intake, findings tool, history, signals.
- `src/settings-rpc.ts` — settings RPC (row `maestro-review-settings-rpc`).
- `src/config-store.ts` / `src/pin-store.ts` / `src/secure-compare.ts` — config + PIN auth (constant-time).
- `src/govard-tool.ts` / `src/workspace-tool.ts` — govard + workspace tooling.
- `src/telegram.ts` / `src/telegram-notifier.ts` / `src/skills-tool.ts` — Telegram + skills helpers.
- `src/events.ts` — typed event contract; `src/index.ts` — host `apply()`.
- `tests/{orchestrator,provider}.test.ts` — vitest suites.

## Development

```sh
pnpm verify   # tsc --noEmit
pnpm test     # vitest run
pnpm build    # tsc  -> lib/
```

## Git workflow

- Default branch `master`. No direct commits to `master` — use `feat/<topic>` / `fix/<topic>` and a PR.
- Conventional commits, imperative mood (`feat(review): ...`, `fix(review): ...`).
- One TDD task = one commit; never commit while `pnpm verify` is red.

## Conventions

- **ReviewProvider is pluggable** — all provider-specific behavior goes behind `providers/interface.ts`. Add a new forge by implementing the interface, never by branching `if gitlab / if github` in the orchestrator.
- **Tool-only review subagents** — review/audit subagents run with tool-only presets; findings are written via `review-findings` tool, not free text.
- **Secrets** — compare PINs/tokens with `secure-compare.ts`; never log or commit real tokens.
- Keep host (network/webhook/orchestration) and client (settings UI) split; RPC is loopback authority.

## Validation

`pnpm verify` + `pnpm test` green before any success claim. Provider intake must be validated against a real MR (webhook payload → intake → findings), not just stubs.
