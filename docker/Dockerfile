# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

# ---- builder ----
FROM node:${NODE_VERSION}-slim AS builder
# deepseek-harness and dsh-maestro-review both pin packageManager: pnpm@11.7.0 —
# pnpm@9 (an earlier assumption, before this image needed to install
# deepseek-harness itself) fails deepseek-harness's frozen-lockfile install
# with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH (verified 2026-09-03: pnpm@9 hashes
# the lockfile's `overrides` config differently from the pnpm version that
# last wrote it, even though the override values themselves are identical).
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /build

# deepseek-harness — dsh runs `node --import tsx/esm apps/cli/src/bin.ts` from
# source, there is no prebuilt lib/ to copy instead. build:lib compiles the
# workspace's own packages (dsh-base, dsh-agent-presets, ...) that the
# reviewer-ci profile's `link:` dependencies point at below.
#
# --frozen-lockfile (verified 2026-09-03): pnpm refuses with
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH on deepseek-harness's own checked-in
# pnpm-lock.yaml (a pre-existing drift in that repo, not introduced here —
# reproduces on pnpm@9 and pnpm@11.7.0 alike, and --no-frozen-lockfile
# reconciles it without rewriting a single byte of the lockfile). This
# matches the workspace's own documented convention (AGENTS.md's mandatory
# post-upgrade workflow uses plain `pnpm --dir deepseek-harness install`,
# never --frozen-lockfile) — deepseek-harness is developed as a living
# monorepo where the lockfile is expected to reconcile locally, unlike
# dsh-maestro-review's own clean install below which keeps --frozen-lockfile.
COPY deepseek-harness deepseek-harness
RUN pnpm --dir deepseek-harness install \
 && pnpm --dir deepseek-harness run build:lib

# dsh-maestro-config-lib — dsh-maestro-review's pnpm-workspace.yaml declares it as
# a sibling ('../dsh-maestro-config-lib'), resolved via workspace:^ protocol, so
# it must be a real sibling directory in this build context too (verified
# 2026-09-03: without it, tsc fails with "Cannot find module
# '@ddtcorex/dsh-maestro-config-lib'" even though a published npm version
# exists — workspace: deps only ever resolve locally).
COPY packages/dsh-maestro-config-lib packages/dsh-maestro-config-lib
RUN pnpm --dir packages/dsh-maestro-config-lib install --frozen-lockfile \
 && pnpm --dir packages/dsh-maestro-config-lib run build

# dsh-maestro-review host lib (orchestrator.ts, ci-trigger.ts, review-findings-tool.ts, ...)
COPY packages/dsh-maestro-review packages/dsh-maestro-review
RUN pnpm --dir packages/dsh-maestro-review install --frozen-lockfile \
 && pnpm --dir packages/dsh-maestro-review run build

# profile reviewer-ci — hand-authored. @deepseek-ai/dsh-base + @deepseek-ai/dsh-agent-presets
# link: to the deepseek-harness checkout above (workspace-internal, not published
# standalone). @ddtcorex/dsh-maestro-review link:s to the package built two steps up
# in THIS SAME build stage, not the npm registry — verified 2026-09-03: the currently
# published tarball is missing cordis.patch.yml (a package.json `files` array gap,
# invisible everywhere else because production installs this package via `link:`,
# never a registry tarball) and `dsh` fails to boot without it. Once a release
# includes the `files` fix, switching back to a registry semver range is safe again.
# @ddtcorex/maestro-skills still pulls from the real npm registry (pinned version).
COPY packages/dsh-maestro-review/profiles/reviewer-ci profiles/reviewer-ci
RUN pnpm --dir profiles/reviewer-ci install --frozen-lockfile

# ---- runtime ----
FROM node:${NODE_VERSION}-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/deepseek-harness ./deepseek-harness
# packages/dsh-maestro-review link:s to a package built in the SAME stage (see
# comment above) — pnpm creates a RELATIVE symlink at install time, computed
# from the builder's directory depth (/build/profiles/reviewer-ci -> ../../packages/...).
# DSH_HOME=/app (not /app/dsh-home) keeps the runtime layout at the same depth
# as /build, so that relative symlink still resolves after the copy; an extra
# nesting level here would silently produce a dangling symlink at runtime.
# packages/dsh-maestro-config-lib is copied too — dsh-maestro-review's own
# node_modules holds a matching relative link: to it.
COPY --from=builder /build/packages ./packages
COPY --from=builder /build/profiles/reviewer-ci ./profiles/reviewer-ci
# Reviewer/auditor agent presets — orchestrator mounts preset ids
# 'dsh-maestro-reviewer'/'dsh-maestro-auditor', and dsh-agent-presets derives the
# id from the directory name, so the package's presets/maestro-* dirs must land
# under the user preset root with their installed names. dsh-agent-presets always
# scans <DSH_HOME>/.agent-presets (DSH_HOME=/app here), so bake them into the image
# (verified 2026-09-04: without these, boot succeeds but runReview fails with
# 'preset "dsh-maestro-reviewer" not found (available: standard, ptc, minimal, cordis)').
COPY --from=builder /build/packages/dsh-maestro-review/presets/maestro-reviewer ./.agent-presets/dsh-maestro-reviewer
COPY --from=builder /build/packages/dsh-maestro-review/presets/maestro-auditor ./.agent-presets/dsh-maestro-auditor
# Host LLM-config mirror for model serving — dsh registers LLM adapters from
# DSH_HOME settings, which is empty in a fresh container (verified 2026-09-04:
# pinning opencode-go without this fails with 'no adapter registered for
# provider "opencode-go"'). Mirrors the host's opencode-go, llm-deepseek, and
# agent-default-model sections; the opencode model id itself is one env variable
# (OPENCODE_MODEL, substituted by entrypoint.sh into the __OPENCODE_MODEL__
# placeholders). Holds no secrets (each key resolves from its apiKeyEnv var at
# call time). A job-mounted /app/settings.yaml overrides it.
# Interactive-host sections (permission/sidebar/presets) are deliberately excluded.
COPY packages/dsh-maestro-review/docker/ci-settings.yaml /app/settings.yaml
COPY packages/dsh-maestro-review/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DSH_HOME=/app

LABEL org.opencontainers.image.source="https://github.com/ddtcorex/dsh-maestro-review"
LABEL org.opencontainers.image.revision="$CI_COMMIT_SHA"
LABEL org.opencontainers.image.version="$CI_COMMIT_TAG"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

# Variants:
# - maestro-reviewer:quick (default, no govard)
# - maestro-reviewer:deep  (adds the govard binary + php, needs DinD or a larger image — phase 2)
