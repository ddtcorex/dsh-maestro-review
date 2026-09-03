#!/bin/sh
set -eu
if [ -z "${MAESTRO_GITLAB_TOKEN:-}" ]; then echo "[review] missing MAESTRO_GITLAB_TOKEN" >&2; exit 1; fi
if [ -z "${SOURCE_PROJECT_ID:-}" ]; then echo "[review] missing SOURCE_PROJECT_ID" >&2; exit 1; fi
if [ -z "${MR_IID:-}" ]; then echo "[review] missing MR_IID" >&2; exit 1; fi
exec node /app/lib/runner/cli.js "$@"
