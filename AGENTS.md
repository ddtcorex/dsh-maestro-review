# AGENTS.md: dsh-maestro-review

> `CLAUDE.md` is a symlink to `AGENTS.md`. Only edit `AGENTS.md`.

## Purpose

The DeepSeek Harness (DSH) host plugin of Maestro Review. The review engine
and the CI flow live in `@ddtcorex/maestro-reviewer`; this package adds what
only a developer's DSH host does with it.

## Development

```sh
pnpm verify   # tsc --noEmit
pnpm test     # vitest run
pnpm build    # tsc -> lib/ (flat lib/index.js)
```

The engine is a `workspace:^` dependency on the sibling checkout
`../../maestro-reviewer`; build it first.

## Git workflow

- Default branch `master`; work on `feat/<topic>` or `fix/<topic>` and a PR.
- Conventional commits, imperative mood.
- Never merge or release without an explicit human approval.
