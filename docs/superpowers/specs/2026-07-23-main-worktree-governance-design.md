# Main Worktree Governance Design

## Goal

Keep the HMS root checkout stable on `main`, require every implementation task to start from the latest reviewed local `main`, and ensure completed task work returns to `main` only after focused verification.

## Decisions

1. The primary repository checkout is the owner-facing root and must normally be clean and checked out on `main`.
2. Agents may inspect any checkout read-only, but they must not implement in a dirty or non-`main` root checkout.
3. Every feature, fix, refactor, migration, documentation change, or program checkpoint starts in a dedicated named branch and linked worktree created from the latest reviewed local `main` unless an explicit dependency names another reviewed base.
4. A task worktree must never reuse an unrelated dirty branch. Existing changes are preserved without stash, reset, clean, overwrite, or opportunistic commit.
5. Integration happens serially from a clean `main` worktree. A clean single-purpose branch may be fast-forwarded or merged; a mixed branch must be reduced to reviewed commits or a patch-level application.
6. The integrated result must receive fresh focused verification before it is considered complete.
7. Push, deployment, and production migration remain separately authorized external actions.

## Enforcement Layers

### Repository instructions

`agents.md` contains the mandatory startup contract and links to `.agent-rules/git-workflow.md`. The contract uses branch identity and Git metadata rather than a dated hardcoded worktree path.

### Detailed workflow rule

`.agent-rules/git-workflow.md` defines startup checks, task branch creation, dirty-workspace handling, integration, cleanup, and exceptions.

### Machine-readable preflight

`scripts/check-worktree-policy.mjs` provides three modes:

- `task`: requires a linked worktree on a non-`main` named branch and, by default, a clean starting state.
- `root`: requires the primary checkout on `main` and clean.
- `integration`: requires a clean worktree on `main`.

Agents run the checker before implementation or integration. `--allow-dirty` is permitted only when continuing the same already-owned task after confirming the dirty files belong to it.

### Regression contract

`test/repository-worktree-policy.test.ts` verifies that the mandatory instructions, detailed rule, package command, and checker behavior remain present.

## Exceptions

- Read-only investigation may run from any checkout, but no files may be changed.
- A long-running program may use a dedicated program branch, provided the branch was created from a reviewed base, remains single-purpose, uses checkpoint commits, and synchronizes with `main` before integration.
- Emergency direct work on `main` requires explicit user authorization and must still start clean, receive tests, and be committed immediately.

## Success Criteria

- Future agents discover the rule from `agents.md` before changing files.
- A task agent can run one command and prove it is in the correct isolation state.
- The root checkout is no longer identified by a stale physical path.
- Dirty unrelated work cannot silently become the base for a new task.
- Completion means committed task work plus verified integration into local `main`; push/deploy remain explicit decisions.
