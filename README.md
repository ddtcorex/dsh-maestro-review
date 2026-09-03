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

## Runner (GitLab CI)

One-shot Docker image for GitLab Runner — headless review without a long-running `dsh web`.
The **reviewer project** holds all secrets; the **source project** only triggers it (fork-safe).

### Quick start

1. **Reviewer project** (`ddtcorex/maestro-reviewer`): copy `templates/reviewer-project.gitlab-ci.yml`
   to `.gitlab-ci.yml`, set CI variables **Protected + Masked**:
   `MAESTRO_GITLAB_TOKEN` (Project/Group Access Token, scope `api`), `DEEPSEEK_API_KEY` (or
   `OPENCODE_GO_API_KEY`), optional `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.

   ```yaml
   # templates/reviewer-project.gitlab-ci.yml
   review:
     stage: review
     image: ddtcorex/maestro-reviewer:0.1.0   # or :latest
     rules: [{ if: $CI_PIPELINE_SOURCE == "pipeline" }, { if: $CI_PIPELINE_SOURCE == "trigger" }, { if: $CI_PIPELINE_SOURCE == "web", when: manual }]
     variables: { GIT_STRATEGY: none }
     script: ['/entrypoint.sh review']
     artifacts: { when: always, expire_in: 1 week, paths: [review-report.json, review-report.md] }
   ```

2. **Source project** (e.g. `my-group/my-app`): add 10-line trigger job from
   `templates/source-project.gitlab-ci.yml` — **no secrets** in this file:

   ```yaml
   maestro:trigger-review:
     stage: review
     rules: [{ if: $CI_PIPELINE_SOURCE == "merge_request_event" }]
     trigger: { project: ddtcorex/maestro-reviewer, branch: main, strategy: depend }
     variables: { SOURCE_PROJECT_ID: $CI_PROJECT_ID, MR_IID: $CI_MERGE_REQUEST_IID, GITLAB_HOST: $CI_SERVER_HOST }
   ```

   Fallback if `trigger: project` is not allowed: use a **Trigger Token** (`$TRIGGER_TOKEN`, scope
   `trigger_pipeline` only — cannot read code) via `curl` (see template comments and spec §7).

3. Open an MR — the reviewer pipeline comments inline discussions + summary note.

### Environment

| Variable | Required | Where | Description |
|---|---|---|---|
| `GITLAB_HOST` | yes | reviewer CI + trigger `variables` | GitLab host, e.g. `gitlab.ddtcorex.com` or `https://gitlab.example.com` |
| `MAESTRO_GITLAB_TOKEN` | yes | reviewer CI (Protected, Masked) | Project/Group Access Token with `api` scope — posts notes/discussions |
| `DEEPSEEK_API_KEY` / `OPENCODE_GO_API_KEY` | yes | reviewer CI (Protected, Masked) | LLM API key for reviewer agent |
| `SOURCE_PROJECT_ID` | yes | trigger `variables` (`$CI_PROJECT_ID`) | Numeric ID of the source project |
| `MR_IID` | yes | trigger `variables` (`$CI_MERGE_REQUEST_IID`) | MR iid within source project |
| `REVIEW_MODE` | no | reviewer CI | `quick` (default) or `deep` |
| `REVIEW_DRY_RUN` | no | reviewer CI | `1` = no POST to GitLab, only writes `review-report.json/md` artifacts |
| `GITLAB_TOKEN` | no | reviewer CI | Alias for `MAESTRO_GITLAB_TOKEN` (compat) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | no | reviewer CI | Telegram digest (via `maestroNotifier`) |

### Dry-run

Run locally without posting to GitLab (writes `review-report.json` + `review-report.md`):

```sh
MAESTRO_GITLAB_TOKEN=dummy GITLAB_HOST=example.com SOURCE_PROJECT_ID=1 MR_IID=2 REVIEW_DRY_RUN=1 node lib/runner/cli.js review --dry-run
# or: REVIEW_DRY_RUN=1 node lib/runner/cli.js review
```

Artifacts are also uploaded by the reviewer pipeline (`artifacts: paths: [review-report.json, review-report.md]`, `expire_in: 1 week`, `when: always`).

### Security notes

- **Fork safety:** the source `trigger` job carries **zero secrets** — fork MRs can modify `.gitlab-ci.yml` but cannot exfiltrate `MAESTRO_GITLAB_TOKEN`/`DEEPSEEK_API_KEY` (they live only in the reviewer project). The reviewer pipeline fetches the MR diff via API read-only; it never checks out fork code beyond the diff.
- **`CI_JOB_TOKEN` cannot comment:** GitLab's `CI_JOB_TOKEN` is read-only for notes/discussions; use a Project/Group Access Token (`MAESTRO_GITLAB_TOKEN`, scope `api`) stored as Protected + Masked in the reviewer project. `Masked` redacts `glpat-`/`sk-` in job logs; `entrypoint.sh` uses `set +x` and never logs token values.
- **`GIT_STRATEGY: none`** — reviewer job does not clone its own repo; all GitLab access is via API.
- **Trigger Token fallback:** only has `trigger_pipeline` scope — safer than an API token if cross-project `trigger:` is not permitted.
- **Prompt injection:** MR diff is passed as tool data, not system instruction; `AGENTS.md` from the MR branch is never loaded.

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
