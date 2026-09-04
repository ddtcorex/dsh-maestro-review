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
# job-mounted settings.yaml passes through untouched):
# 1. REVIEW_LLM_BASE_URL, if set, always wins — an explicit bring-your-own
#    OpenAI-compatible endpoint, so a deployment is never locked to opencode.ai.
# 2. Otherwise opencode is the default (host mirror) unless only a deepseek
#    key is present. An explicit REVIEW_MODEL_PROVIDER pin wins over this
#    default elsewhere (row-config).
if grep -q __CI_MANAGED__ /app/settings.yaml 2>/dev/null; then
  if [ -n "${REVIEW_LLM_BASE_URL:-}" ]; then
    if [ -z "${REVIEW_LLM_MODEL:-}" ]; then
      echo "[review] REVIEW_LLM_MODEL is required when REVIEW_LLM_BASE_URL is set" >&2
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
  elif [ -z "${OPENCODE_GO_API_KEY:-}" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    cp /app/settings.deepseek.yaml /app/settings.yaml
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
# The opencode model is one env variable: substitute the __OPENCODE_MODEL__
# placeholder in the baked settings template (default muse-spark-1.3-contributor).
# A job-mounted /app/settings.yaml has no placeholder, so this is a no-op for it.
# The id charset guard keeps the sed substitution injection-free.
if [ -n "${OPENCODE_MODEL:-}" ]; then
  case "$OPENCODE_MODEL" in
    *[!A-Za-z0-9/_+.-]*)
      echo "[review] invalid OPENCODE_MODEL (allowed: A-Za-z0-9/_+.-)" >&2
      exit 1
      ;;
  esac
fi
OPENCODE_MODEL="${OPENCODE_MODEL:-muse-spark-1.3-contributor}"
export OPENCODE_MODEL
if grep -q __OPENCODE_MODEL__ /app/settings.yaml 2>/dev/null; then
  sed "s#__OPENCODE_MODEL__#${OPENCODE_MODEL}#g" /app/settings.yaml > /app/settings.yaml.rendered
  mv /app/settings.yaml.rendered /app/settings.yaml
fi
# Boot the published DSH CLI against the baked reviewer-ci profile
# ($DSH_HOME/profiles/reviewer-ci).
exec dsh --profile reviewer-ci
