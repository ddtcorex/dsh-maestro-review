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

## CI reviewer (no local checkout)

The same pipeline also runs headless from GitLab CI: a shared reviewer
project (holds secrets + image) serves any number of source projects through
a small bridge job — no DSH host, no project mapping needed. Quick runs
diff-only (or on a real checkout when `REVIEW_PROFILE` is set — reviewer-only,
no auditor); on-demand deep clones the MR head and reviews reviewer-only with
a static-only audit (no govard runtime in the container).

Full setup, per-case trigger workflows (quick/deep × CI/webhook), model
selection, and troubleshooting: [`docs/ci-reviewer-setup.md`](docs/ci-reviewer-setup.md).
Templates live in `templates/`, the image in `docker/`.

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

## Release

A release ships **two artifacts that must stay in lockstep**: the npm
package and the `ddtcorex/maestro-reviewer` Docker image — the image
installs the npm package from the registry rather than copying source, so
tagging a release alone is not enough to ship it to CI users. In short:
bump `package.json` + `CHANGELOG.md` + the three image-tag references →
tag `vX.Y.Z` (triggers npm publish + GitHub Release) → bump
`profiles/reviewer-ci/package.json`'s own pin to match → rebuild and push
the Docker image. Full step-by-step checklist, including the pnpm
supply-chain age-gate workaround and how to live-test a fix in the image
before a full release: see **Release checklist** in [`AGENTS.md`](AGENTS.md).

## License

MIT
