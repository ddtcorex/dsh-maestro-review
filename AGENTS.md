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

## Release checklist

Every release ships **two independent artifacts** that must stay in lockstep:
the npm package (`@ddtcorex/dsh-maestro-review`) and the Docker image
(`ddtcorex/maestro-reviewer`). The Docker image installs the npm package
from the registry rather than copying source (`docker/Dockerfile`), so a
release that stops after the npm tag ships a Docker image running **stale
code** — every step below exists because of a live incident that class of
gap caused. Version bump: patch (`X.Y.Z+1`) for a fix-only batch (matches
`CHANGELOG.md` precedent, e.g. 0.5.0 → 0.5.1); minor for an Added/Changed
batch.

1. **Bump + sync version, on a `chore/release-X.Y.Z` branch:**
   - `package.json`'s `version`.
   - `CHANGELOG.md` — new `## [X.Y.Z] - YYYY-MM-DD` section (Keep a Changelog
     style), referencing the merged PR numbers it bundles.
   - Every `0.Y.Z`-shaped image-tag reference: `docker/Dockerfile`'s
     top-comment example (`-t ddtcorex/maestro-reviewer:X.Y.Z`),
     `templates/reviewer-project.gitlab-ci.yml`'s `REVIEWER_IMAGE`, and the
     two mentions in `docs/ci-reviewer-setup.md` (intro + troubleshooting
     `:latest` explanation). `grep -rn "0\.<prev-minor>\.<prev-patch>"
     docker/ templates/ docs/` to find every instance before committing.
   - `pnpm verify && pnpm test && pnpm build` clean, then PR → CI green →
     **human `APPROVED`** → squash-merge.
2. **Tag + publish** (guarded — present the exact commands and get explicit
   approval before running, per the git-protection rule below):
   ```sh
   git -C <repo> tag vX.Y.Z
   git -C <repo> push origin vX.Y.Z
   ```
   Pushing the tag triggers `.github/workflows/release.yml` →
   `dsh-maestro-ci`'s `node-release.yml` (`pnpm publish --access public` +
   GitHub Release). Never run `pnpm publish`/`npm publish` manually — it
   bypasses the Release workflow and leaves `CHANGELOG`/GitHub Release out
   of sync. Confirm both: `gh run watch <run-id>` on the release workflow,
   and poll `npm view @ddtcorex/dsh-maestro-review version` until it shows
   `X.Y.Z` (registry propagation lags the workflow's "done" by roughly
   1-2 minutes — a stale `npm view` right after tagging is not a failure).
3. **Bump the `profiles/reviewer-ci` pin, on its own `chore/pin-reviewer-ci-X.Y.Z`
   branch** (mandatory, not optional — this is the step that actually makes
   the Docker image pick up the release): set
   `profiles/reviewer-ci/package.json`'s
   `dependencies["@ddtcorex/dsh-maestro-review"]` to `X.Y.Z`, then
   regenerate the lockfile with the pnpm supply-chain age gate bypassed —
   a version published minutes ago is inside pnpm's 24h `minimumReleaseAge`
   window and a plain `pnpm install` will reject it (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`),
   even though the exact same flag is already baked into
   `docker/Dockerfile`'s own frozen install for this reason:
   ```sh
   cd profiles/reviewer-ci && pnpm --config.minimumReleaseAge=0 install
   ```
   Verify the resulting `git diff --stat profiles/reviewer-ci/pnpm-lock.yaml`
   touches only that one package (specifier/resolution/integrity) before
   committing — unrelated transitive churn is a signal something else drifted
   and needs a closer look, not a rubber-stamp commit. PR → CI green →
   `APPROVED` → merge.
4. **Rebuild and push the Docker image — only after step 3 merges:**
   ```sh
   docker build -f docker/Dockerfile -t ddtcorex/maestro-reviewer:X.Y.Z -t ddtcorex/maestro-reviewer:latest .
   ```
   Verify before pushing, don't assume: confirm the release's actual fix is
   present in the built image (e.g. `docker run --rm --entrypoint sh
   ddtcorex/maestro-reviewer:X.Y.Z -c 'grep -c <distinguishing-symbol>
   .../lib/orchestrator.js'`), and — if the change touches shared harness
   packages — confirm no dual-instance regression:
   `find /app/profiles/reviewer-ci/node_modules/.pnpm -maxdepth 1 -iname
   '@deepseek-ai+dsh-scope@*'` inside the image must show exactly one match.
   Then:
   ```sh
   docker push ddtcorex/maestro-reviewer:X.Y.Z
   docker push ddtcorex/maestro-reviewer:latest
   ```

**Live-testing the CI image locally before/without a full release** (used
to validate a fix before it ships): overlay a local build's `lib/` onto a
running container's installed package instead of rebuilding the whole
image — `docker cp lib/. <container>:<pnpm-store-path-to-package>/lib/`,
found via `docker exec <container> readlink -f
/app/profiles/reviewer-ci/node_modules/@ddtcorex/dsh-maestro-review`. Two
gotchas proven live: (1) exec `/entrypoint.sh` itself, not `dsh --profile
reviewer-ci` directly — the `REVIEW_LLM_*` bring-your-own route only
activates inside `entrypoint.sh`'s settings-file switch, so execing `dsh`
directly silently skips it. (2) the push-gate (`already reviewed`) and the
coexistence check (`webhook already reviewed`) both key off state already
on the MR (local `reviews.json` history file, and any existing completed-
review comment) — clear both before a repeat test run, or the run silently
short-circuits without exercising real code.

## Conventions

- **ReviewProvider is pluggable** — all provider-specific behavior goes behind `providers/interface.ts`. Add a new forge by implementing the interface, never by branching `if gitlab / if github` in the orchestrator.
- **Tool-only review subagents** — review/audit subagents run with tool-only presets; findings are written via `review-findings` tool, not free text.
- **Secrets** — compare PINs/tokens with `secure-compare.ts`; never log or commit real tokens. In CI, `MAESTRO_GITLAB_TOKEN` must be a PAT/group token (`api` scope) — `CI_JOB_TOKEN` is read-only for posting (probed on GitLab 18.11); redact it from clone URLs and errors.
- **CI flow** — `providers/ci-trigger.ts` owns the push-gate + coexistence yield; the orchestrator's CI-deep branch clones and reuses `runReviewAndAudit` with a plain worktree (no vendor/govard linking) and a static-only auditor prompt. Webhook behavior stays untouched: CI yields, never the reverse.
- Keep host (network/webhook/orchestration) and client (settings UI) split; RPC is loopback authority.

## Validation

`pnpm verify` + `pnpm test` green before any success claim. Provider intake must be validated against a real MR (webhook payload → intake → findings), not just stubs.
