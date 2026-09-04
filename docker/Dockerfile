# syntax=docker/dockerfile:1.7
# Maestro reviewer image — npm-based: every runtime dependency comes from a
# registry, nothing is COPYed from a host checkout, so the image is
# reproducible from any machine. Build context is the package directory:
#   docker build -f docker/Dockerfile \
#     -t ddtcorex/maestro-reviewer:0.1.0 -t ddtcorex/maestro-reviewer:latest .
# Pinned versions: DSH CLI below + profiles/reviewer-ci/package.json.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS runtime
ARG CI_COMMIT_SHA=""
ARG CI_COMMIT_TAG=""
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.7.0 --activate \
 && npm install -g @deepseek-ai/dsh@0.1.2-rc.1
WORKDIR /app
ENV DSH_HOME=/app
# Non-interactive build: pnpm v11 aborts a modules-dir purge without TTY
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) unless CI is set.
ENV CI=true

# reviewer-ci profile — hand-authored package.json (exact registry pins, no
# link:) + cordis.patch.yml. Installed once here, read from
# $DSH_HOME/profiles/reviewer-ci at boot.
COPY profiles/reviewer-ci ./profiles/reviewer-ci
# --config.minimumReleaseAge=0: every dep here is an exact pin verified in
# the frozen lockfile, so the 24h supply-chain age gate only blocks fresh
# releases of our own packages (verified 2026-09-04: it rejected
# dsh-maestro-review@0.5.1 published hours earlier despite
# minimumReleaseAgeExclude entries).
RUN pnpm --dir profiles/reviewer-ci --config.minimumReleaseAge=0 install --frozen-lockfile

# Reviewer/auditor agent presets — orchestrator mounts preset ids
# 'dsh-maestro-reviewer'/'dsh-maestro-auditor', and dsh-agent-presets derives the
# id from the directory name, so these must land under the user preset root
# with their installed names (<DSH_HOME>/.agent-presets, always scanned).
COPY presets/maestro-reviewer ./.agent-presets/dsh-maestro-reviewer
COPY presets/maestro-auditor ./.agent-presets/dsh-maestro-auditor
# Host LLM-config mirror for model serving — dsh registers LLM adapters from
# DSH_HOME settings, which is empty in a fresh container. Three variants
# (selection in entrypoint.sh): ci-settings.opencode.yaml (default, host
# mirror), ci-settings.deepseek.yaml (api.deepseek.com straight), and
# ci-settings.generic-openai.yaml (bring-your-own OpenAI-compatible endpoint,
# REVIEW_LLM_BASE_URL-gated, highest priority). Holds no secrets (each key
# resolves from its apiKeyEnv var at call time). A job-mounted
# /app/settings.yaml overrides all three.
COPY docker/ci-settings.opencode.yaml /app/settings.yaml
COPY docker/ci-settings.deepseek.yaml /app/settings.deepseek.yaml
COPY docker/ci-settings.generic-openai.yaml /app/settings.generic-openai.yaml
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

LABEL org.opencontainers.image.source="https://github.com/ddtcorex/dsh-maestro-review"
LABEL org.opencontainers.image.revision="$CI_COMMIT_SHA"
LABEL org.opencontainers.image.version="$CI_COMMIT_TAG"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

# Variants:
# - maestro-reviewer:quick (default, no govard)
# - maestro-reviewer:deep  (adds the govard binary + php, needs DinD or a larger image — phase 2)
