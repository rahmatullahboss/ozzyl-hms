# Git and Worktree Workflow

## Root checkout contract

The primary repository checkout is the owner-facing root. It must normally be clean and checked out on local `main`.

Before treating a checkout as the root, run:

```bash
pnpm worktree:check -- --mode=root
```

Do not identify the main checkout by a dated physical path. Discover the worktree checked out on branch `main` using Git metadata such as `git worktree list --porcelain`.

A non-`main` or dirty primary checkout may be inspected read-only, but it is not an implementation base. Never reset, clean, stash, overwrite, or opportunistically commit work found there.

## Task worktree contract

Every feature, fix, refactor, migration, documentation change, or program checkpoint must use a dedicated named branch and linked worktree created from the exact latest fetched `origin/main`. Never use local `main`, a backup branch, an integration branch, an explicitly named historical SHA, or an unrelated task branch as the base for a new task.

The only continuation exception is an explicit request to resume an already-owned named task branch/worktree. Verify its identity, ancestry, dirty state, and remote state before continuing; do not recreate or replace it.

Never use an unrelated dirty branch as a task base.

Required startup sequence, before the first task-owned edit:

1. Inspect `git status --short --branch` and `git worktree list --porcelain`; preserve every existing dirty or untracked change.
2. Run `git fetch origin main`. If it fails, do not silently use a stale base and do not begin implementation.
3. Record the exact base SHA with `git rev-parse origin/main`.
4. Create a unique single-purpose task branch from that exact SHA and a linked worktree under `.worktrees/`.
5. Verify the worktree branch, its recorded base, and that `.worktrees/` is ignored.
6. Run project setup and a focused clean baseline test.
7. Run:

```bash
pnpm worktree:check -- --mode=task --require-latest-origin-main
```

The command must pass before the first task-owned edit.

When continuing an already-owned task that now has task-owned dirty changes, first inspect every changed file and confirm ownership. Then use:

```bash
pnpm worktree:check -- --mode=task --allow-dirty
```

`--allow-dirty` is not permission to adopt unknown changes. It is only a continuation acknowledgement for the same task.

## Implementation and commit contract

- One branch represents one logical task or one explicitly defined long-running program.
- Preserve checkpoint commits for long-running programs.
- Stage exact files only. Never use bulk staging in a workspace containing unrelated files.
- Do not commit `.ai-bridge` logs, generated E2E artifacts, dependency directories, local secrets, or unrelated reports unless they are explicit task deliverables.
- Run focused tests, applicable regression tests, type checks, and builds before integration.
- Commit every verified task-owned slice. Do not leave completed work uncommitted.

## Integration contract

Integration happens serially from a clean dedicated integration worktree checked out on local `main`; never integrate through the owner-facing root when it is dirty or on another branch.

Before integration, run:

```bash
pnpm worktree:check -- --mode=integration --require-latest-origin-main
```

Then:

1. Confirm the task branch is single-purpose, committed, and clean.
2. Fetch `origin/main`, fast-forward the clean integration `main` to it, and reconcile the task branch with that exact current base.
3. Review the complete branch diff and commit list.
4. Fast-forward or merge a clean branch. For a mixed branch, cherry-pick only reviewed commits or apply a reviewed patch; never merge the whole mixed branch.
5. Run fresh post-merge verification on `main`.
6. Push the verified integration result to `origin/main` and confirm the remote contains the task commits.
7. Treat the task as complete only after the verified change is present on `origin/main`.

General direct tasks should be integrated and pushed after verification. Protocol-governed worker tasks that explicitly require `READY FOR INTEGRATION` may stop there only because a named integrator owns the merge; that integrator remains responsible for the verified `origin/main` push and mandatory cleanup.

The user's standing repository instruction authorizes completed-task merge pushes to `origin/main` and deletion of the merged task branch. Deploying, applying production migrations, and changing production flags remain separately authorized actions.

## Cleanup contract

After successful integration, post-merge verification, and confirmation that `origin/main` contains every task commit:

- Verify the task worktree is clean and the task branch has no commits unmerged from `origin/main`.
- Remove only the worktree created for that task.
- Delete the fully merged local task branch.
- Delete the remote task branch if it exists.
- Run `git worktree prune` and verify the final branch/worktree state.
- Never delete another task's branch or worktree.
- Never delete a dirty, unmerged, unpushed, failed, or still-in-progress branch/worktree; preserve it and report the blocker.

## Exceptions

### Read-only investigation

Read-only inspection may occur from any checkout. The moment a file must change, create or enter the correct task worktree first.

### Long-running program branch

A long-running program branch is permitted when it:

- starts from the exact latest fetched `origin/main`;
- remains single-purpose;
- uses clean checkpoint commits;
- keeps a dedicated worktree;
- synchronizes with current `main` before final integration.

### Emergency changes

There is no automatic direct-`main` exception. Emergency fixes still require a task branch and linked worktree from the latest fetched `origin/main`, followed by verification, clean integration, push, and safe cleanup.

## Red flags

Stop before editing when any of these is true:

- the current checkout is the primary root but is not on `main`;
- the task is about to start from a review, audit, release, or unrelated feature branch;
- the selected worktree already contains unknown dirty files;
- the same branch is checked out in another worktree;
- `origin/main` has not been fetched successfully for the new task;
- the exact `origin/main` base commit has not been recorded and verified;
- integration would overwrite or mix unrelated changes;
- someone proposes resetting, cleaning, or stashing another task's work to make the checkout usable.

## Required completion evidence

Every completed task report must state the base `origin/main` SHA, task branch/worktree, verification results, merge SHA, `origin/main` push status, and local branch, remote branch, and worktree cleanup status.
