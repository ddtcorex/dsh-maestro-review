#!/bin/sh
set -eu
if [ -z "${MAESTRO_GITLAB_TOKEN:-}" ] || [ -z "${SOURCE_PROJECT_ID:-}" ] || [ -z "${MR_IID:-}" ]; then
  echo "[review] missing required env (MAESTRO_GITLAB_TOKEN, SOURCE_PROJECT_ID, MR_IID)" >&2
  exit 1
fi
export REVIEW_REPORT_DIR="$PWD"
cd /app/deepseek-harness
exec node --import tsx/esm apps/cli/src/bin.ts --profile reviewer-ci
