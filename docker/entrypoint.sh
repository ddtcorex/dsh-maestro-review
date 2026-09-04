#!/bin/sh
set -eu
# Auth: MAESTRO_GITLAB_TOKEN must be a PAT/Project/Group token (api scope).
# CI_JOB_TOKEN is deliberately NOT accepted: proven 2026-09-04 on GitLab 18.11
# (GET=200 but POST /notes=401 even with the source allowlisting this project),
# so falling back would "complete" reviews without ever posting the comment.
# The JOB-TOKEN header path (GITLAB_TOKEN_KIND, gitlab-auth.ts) stays for
# future use; it just must not be wired here until writes work.
if [ -z "${MAESTRO_GITLAB_TOKEN:-}" ] || [ -z "${SOURCE_PROJECT_ID:-}" ] || [ -z "${MR_IID:-}" ]; then
  echo "[review] missing required env (MAESTRO_GITLAB_TOKEN as a user/project token, SOURCE_PROJECT_ID, MR_IID)" >&2
  exit 1
fi
if [ -n "${CI_PROJECT_DIR:-}" ]; then cd "$CI_PROJECT_DIR"; fi
export REVIEW_REPORT_DIR="$PWD"
# GitLab's docker executor keeps the image WORKDIR (/app), not the job's build
# dir — without this, reports/history land inside the container and the
# artifacts/cache steps find nothing (proven 2026-09-04 live). Local `docker
# run -w` sets PWD already, so this only fires in real CI.
# Route selection (only for our baked template — the __CI_MANAGED__ marker; a
# job-mounted settings.yaml passes through untouched): deepseek is the sole
# baked default (needs DEEPSEEK_API_KEY). Setting REVIEW_LLM_API_KEY overlays
# the bring-your-own OpenAI-compatible route instead, so a deployment is never
# locked to a single provider.
if grep -q __CI_MANAGED__ /app/settings.yaml 2>/dev/null; then
  if [ -n "${REVIEW_LLM_API_KEY:-}" ]; then
    if [ -z "${REVIEW_LLM_BASE_URL:-}" ]; then
      echo "[review] REVIEW_LLM_BASE_URL is required when REVIEW_LLM_API_KEY is set" >&2
      exit 1
    fi
    if [ -z "${REVIEW_LLM_MODEL:-}" ]; then
      echo "[review] REVIEW_LLM_MODEL is required when REVIEW_LLM_API_KEY is set" >&2
      exit 1
    fi
    REVIEW_LLM_API="${REVIEW_LLM_API:-openai-completions}"
    case "$REVIEW_LLM_API" in
      openai-completions|openai-responses) ;;
      *)
        echo "[review] invalid REVIEW_LLM_API (allowed: openai-completions, openai-responses)" >&2
        exit 1
        ;;
    esac
    # Charset guards keep the sed substitutions below injection-free.
    case "$REVIEW_LLM_BASE_URL" in
      *[!A-Za-z0-9:/_.+-]*)
        echo "[review] invalid REVIEW_LLM_BASE_URL (allowed: A-Za-z0-9:/_.+-)" >&2
        exit 1
        ;;
    esac
    case "$REVIEW_LLM_MODEL" in
      *[!A-Za-z0-9/_+.-]*)
        echo "[review] invalid REVIEW_LLM_MODEL (allowed: A-Za-z0-9/_+.-)" >&2
        exit 1
        ;;
    esac
    sed -e "s#__REVIEW_LLM_API__#${REVIEW_LLM_API}#g" \
        -e "s#__REVIEW_LLM_BASE_URL__#${REVIEW_LLM_BASE_URL}#g" \
        -e "s#__REVIEW_LLM_MODEL__#${REVIEW_LLM_MODEL}#g" \
        /app/settings.generic-openai.yaml > /app/settings.yaml
  fi
fi
# Review history must survive across jobs (fresh container each run) or the
# push-gate and incremental context go blind. The reviewer job caches
# $REVIEW_REPORT_DIR/.maestro-history (see templates/reviewer-project.gitlab-ci.yml);
# point DSH's history store at it via symlink before exec (a symlink survives exec,
# a copy-back after would not). Falls back to ephemeral /app storage when unmounted.
if [ -d "$REVIEW_REPORT_DIR" ]; then
  mkdir -p "$REVIEW_REPORT_DIR/.maestro-history"
  # -sfn on an existing real dir would nest inside it; only link when absent.
  [ -e /app/dsh-maestro-review ] || ln -s "$REVIEW_REPORT_DIR/.maestro-history" /app/dsh-maestro-review
fi
# Boot the published DSH CLI against the baked reviewer-ci profile
# ($DSH_HOME/profiles/reviewer-ci).
exec dsh --profile reviewer-ci
