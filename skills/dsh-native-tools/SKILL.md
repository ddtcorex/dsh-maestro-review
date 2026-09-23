---
name: dsh-native-tools
description: Use when running a Maestro skill inside DeepSeek Harness and its text says "native ... when provided" — this maps each such capability (query-log stats, lint, deploy preflight, layout extraction, theme inspection, review scope split, escape scan, module check, MR diff) to the tool DSH actually exposes
---

# DSH Native Tools

Every public Maestro skill names a **capability**, never a tool: "if the runtime
provides a native query-log stats tool, prefer it; otherwise use the recipe below".
Inside DeepSeek Harness those tools exist, and this file is the map from capability
to call.

Load this whenever a loaded Maestro skill says *native … when provided*, then call
the tool named here instead of the portable recipe in that skill.

## Harness-agnostic actions → DSH tools

The process skills (superpowers fork, `using-superpowers`) describe actions in
harness-neutral words — announce, dispatch a subagent, ask your partner. On DSH:

| Action in skill text | DSH tool |
|---|---|
| Invoke / load a skill | `skill` with `{ name }` |
| Dispatch a fresh subagent per task | `subagent` (background by default; pass `run_in_background: false` only when the next step depends on its result) |
| Continue or redirect an existing subagent | `send_message` to its durable `subagent_id` |
| Fan out independent tasks concurrently | several independent tool calls in one assistant turn |
| Large multi-phase orchestration | `workflow` — only when the human explicitly asks for a workflow |
| Fresh-agent iterative loop | `ralph` — only when the human explicitly asks for Ralph |
| Seed a child with this conversation | `subagent_fork` |
| Create a todo / checklist item | `todo_write` (whole list every call) |
| Ask your human partner | `ask_user_question` |
| Present a plan for approval | `exit_plan_mode` (plan mode only) |
| Long-running objective across turns | goal tools: `create_goal`, `get_goal`, `update_goal` |
| Read a file / find files / search contents | `read`, `glob`, `grep` |
| Write / edit files | `write`, `edit` (read before edit) |
| Run shell commands, tests, git | `bash`; background via `run_in_background: true`, collect with `job_output`, stop with `job_kill` |
| Search the web | `web_search` |
| Look at an image file | `read_image` |
| Ensure an isolated workspace | `git_worktree {op:'inspect', worktreePath}` → {exists,branch,headSha,isClean,isWorktree} (`worktreePath` is required on every op) |
| Create a worktree | `git_worktree {op:'create', worktreePath, branch, base?}` → {created,headSha} |
| Clean up a worktree | `git_worktree {op:'remove', worktreePath}` → {removed,dirtyFiles} |

## Native capability tools

Left column is the phrase the public skill uses; right column is what to call.

| Public skill says | Tool and signature |
|---|---|
| native query-log stats tool | `maestro_perf_log_stats {topN?, repeatThreshold?, timeThresholdMs?}` → streaming and bounded; never hand-grep a 16–50k line log or open it as a spreadsheet |
| native lint tool | `govard_audit_lint`; in the review plugin `{worktreePath?, scope?: "diff"\|"project", base?}` — the workflow quick/deep split; in the govard plugin `{worktreePath?, mode?, phpVersions?}` or `{checks:["integrity"]}` for container-free analysis. Do not hand-parse text or exit codes |
| native deploy preflight | `govard_deploy_plan {remote, build?, artifactDir?}` prints the pipeline without connecting; `govard_deploy_check {remote, build?, artifactDir?}` runs it. Both read-only, `remote` required. Running a deploy stays in the terminal |
| native layout extraction | `layout_xml_extract {changedFiles:<MR layout files>}` → handles/blocks/moves + templateExists/parseError |
| native theme inspection | `hyva_theme_inspect {classes:["<class-from-diff>"]}` → `{themes[],tailwind:{major,...},hyvaPackages[]}`; a null field means downgrade to a question |
| native review scope split | `maestro_review_scope_split {diffStats:{files,addedLinesPerFile}, mode}` → `{split:{quick,deep},reason,estimatedSavingsTokens}`; run quick checks only on quick files |
| native escape scan | `phtml_escape_scan {scope:"diff", paths:<changed phtml>}` → `{findings[],scannedFiles,truncated}` with confidence + M2-SEC-xxx; `hyva_csp_scan {maxFiles?}` covers CSP work and truncates at `maxFiles` with no `truncated` flag — size the input yourself |
| native module check | `magento_module_check {modulePath:"app/code/Vendor/Module"}` → `{modules[],scannedModules,truncated}`; always check `scannedModules` against what you expected |
| native MR diff | `gitlab_get_mr_diff`, `gitlab_list_own_review_threads`, `gitlab_post_inline_comment` — diff plus own threads plus inline comments in one call |
| local lint inside a review worktree | `govard_audit_lint` (see the lint row above); `govard_shell` runs one command in the container |

The `maestro_get_skills` tool searches this same skill catalogue by keyword and
returns full content — useful when a review profile has not preloaded a skill.

## Session-shape notes

- Skills arrive as catalog summaries in a `<system-reminder>`; load one with the
  `skill` tool before acting on it. There is no session-start bootstrap injection
  on DSH, so checking the available-skills list first is your job.
- Background subagents notify you when they settle — do not poll. Collect any
  still-relevant jobs before finishing a turn.
- "Announce …" in a process skill is plain prose in your reply; DSH has no separate
  announcement channel.
- "interactive when the runtime supports it" means call `ask_user_question` rather
  than guessing a default; on DSH interactive questions are always available.

## Maintenance

- Public skills stay tool-neutral. Never copy a tool name back into
  `maestro-skills`: its catalog test rejects `maestro_*`, `govard_audit_lint`, `DSH`
  and `DeepSeek Harness` anywhere in skill content, `compatibility: dsh` frontmatter
  excepted.
- Renaming a tool in `src/host` must fail `tests/dsh-native-tools-skill.test.ts`, so
  this map cannot rot silently.
- Update this file when the DSH tool surface changes; the public skills need no edit.
