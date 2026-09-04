# AGENTS.md — dsh-maestro-review

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Merge-request (MR) review plugin for the DeepSeek Harness (DSH): a pluggable review pipeline (webhook → orchestrator → review-intake → findings) with GitLab implemented and GitHub stubbed, plus review history/signals and govard/workspace tools.

Names by boundary: npm package = `@ddtcorex/dsh-maestro-review`; Cordis patch rows = `maestro-review-webhook`, `maestro-review-orchestrator`, `maestro-review-settings-rpc`.

Part of the Maestro Harness suite. Host half + client half (review settings/slot UI).

## Layout

Host code lives in `src/host/` (flat `rootDir`, emits `lib/index.js`):

- `providers/interface.ts` — the `ReviewProvider` contract (pluggable).
- `providers/gitlab.ts` — GitLab provider implementation.
- `providers/github.stub.ts` — GitHub provider stub (implement per contract when needed).
- `providers/ci-trigger.ts` — CI entry: builds the `ReviewRequest` from env, push-gate, coexistence yield.
- `orchestrator.ts` — the review pipeline orchestration (`runReview`, comment builders, CI-deep clone branch).
- `review-intake.ts` — webhook routing (`@bot` mention → quick, `/maestro deep` → deep).
- `review-marker.ts` / `ci-coexist.ts` / `ci-clone.ts` — comment marker, yield checks, CI source clone.
- `review-findings-tool.ts` / `review-history.ts` / `review-signals.ts` — intake, findings tool, history, signals.
- `gitlab-auth.ts` — header selection (`PRIVATE-TOKEN` vs `JOB-TOKEN` via `GITLAB_TOKEN_KIND`).
- `settings-rpc.ts` — settings RPC (row `maestro-review-settings-rpc`).
- `config-store.ts` / `pin-store.ts` / `secure-compare.ts` — config + PIN auth (constant-time).
- `govard-tool.ts` / `workspace-tool.ts` — govard + workspace tooling.
- `notify.ts` / `skills-tool.ts` — notifier texts + contract slice (delivery via the optional
  `maestroNotifier` service from `@ddtcorex/dsh-maestro-notifier`) and skills helpers.
- `events.ts` — typed event contract; `index.ts` — host `apply()`.
- `profiles/reviewer-ci/` — headless DSH profile for the CI image (settings-rpc disabled: no web connection in CI).
- `docker/` — reviewer image (`Dockerfile`, `entrypoint.sh`, `ci-settings.*.yaml` model variants).
- `templates/` — `reviewer-project.gitlab-ci.yml` (secrets holder) + `source-project.gitlab-ci.yml` (bridge).
- `docs/ci-reviewer-setup.md` — setup + per-case trigger workflows (quick/deep × CI/webhook).
- `tests/` — vitest suites (`pnpm test`).

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
- Always request approval before merge or release: never merge a PR/MR or publish a release (`git tag`/`pnpm publish`/`gh release`) without an explicit human approval — request review (`gh pr ready` / `gh pr request-review` / ask in chat) and wait for `APPROVED`. This applies to every `master` merge and every `vX.Y.Z` tag.

## Conventions

- **ReviewProvider is pluggable** — all provider-specific behavior goes behind `providers/interface.ts`. Add a new forge by implementing the interface, never by branching `if gitlab / if github` in the orchestrator.
- **Tool-only review subagents** — review/audit subagents run with tool-only presets; findings are written via `review-findings` tool, not free text.
- **Secrets** — compare PINs/tokens with `secure-compare.ts`; never log or commit real tokens. In CI, `MAESTRO_GITLAB_TOKEN` must be a PAT/group token (`api` scope) — `CI_JOB_TOKEN` is read-only for posting (probed on GitLab 18.11); redact it from clone URLs and errors.
- **CI flow** — `providers/ci-trigger.ts` owns the push-gate + coexistence yield; the orchestrator's CI-deep branch clones and reuses `runReviewAndAudit` with a plain worktree (no vendor/govard linking) and a static-only auditor prompt. Webhook behavior stays untouched: CI yields, never the reverse.
- Keep host (network/webhook/orchestration) and client (settings UI) split; RPC is loopback authority.

## Validation

`pnpm verify` + `pnpm test` green before any success claim. Provider intake must be validated against a real MR (webhook payload → intake → findings), not just stubs.
