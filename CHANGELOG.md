# Changelog

## [Unreleased]

### Changed

- **The DSH host side of Maestro Review, under its old name.** Version 0.14.0
  continues above the last `@ddtcorex/dsh-maestro-review` release (0.12.1,
  before the package became `@ddtcorex/maestro-reviewer`). It carries the
  webhook intake, the host orchestrator (settings, project mappings,
  worktrees, the govard environment, the unmapped-deep decline), the settings
  RPC, the Settings section and the Telegram digest, and runs every review
  through the `reviewEngine` service of `@ddtcorex/maestro-reviewer` 0.14.
- The orchestrator row is `maestro-review-host-orchestrator` and the RPC
  channel `/dsh-maestro-review`. Settings keys, the Settings section id and
  order, and the `dsh-maestro-review/` data directory are unchanged.
