# Changelog

## [0.15.0] - 2026-10-21

### Added

- `/maestro explain`, `/maestro fix` and `/maestro rereview [path]` over the
  note webhook (#3): a note whose first line is a command is routed without a
  mention and answered with the engine's `answerCommands`, under the same
  Developer or above rule and answer markers as CI. One command pass runs per
  MR at a time, with one trailing pass for notes that arrive during it. A
  rereview stays limited to its path and carries the findings of a full
  review of the current head when one exists.
- Host reviews read `.maestro-review.yml` from the project's default branch
  through the engine's `loadRepoSettings`: ignore globs, project rules,
  minimum severity, comment language and, only when the file sets it,
  fan-out.

### Changed

- Requires `@ddtcorex/maestro-reviewer` 0.19, which redacts a host worktree
  whenever no runtime audit runs and stops the review when that fails.

## [0.14.0] - 2026-10-20

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
