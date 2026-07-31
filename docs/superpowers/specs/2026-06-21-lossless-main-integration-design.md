# Lossless Main Integration Design

## Goal

Reconcile every currently relevant HMS branch, worktree, pull request, stash, and migration artifact into a reviewed local `main` without overwriting newer work or publishing/deploying unverified changes.

## Source of truth and preservation boundary

- `origin/main` is the integration base.
- The dirty enterprise worktree, patient-portal worktree, all stashes, and untracked production SQL/data artifacts remain untouched.
- Work is reconstructed in the clean `integration/all-branches-main` worktree instead of merging a dirty branch wholesale.
- Push, production deploy, production migration application, stash deletion, and dirty-worktree cleanup are outside this run.

## Candidate classification

1. Patch-equivalent local commits need no code merge; their history remains preserved in their current branches.
2. PR 167 is superseded by batching already present on `origin/main`; its stale conflict metadata is not integrated.
3. PR 168 is reimplemented as a hardened patient-summary route with clinical-role authorization, tenant-scoped lookup, minimal external context, typed prompts, and retry-safe fallback semantics.
4. The dirty root overlay is ported by verified behavior slice. Duplicate cash sources, date-scope regressions, localization regressions, no-op/conflicting migrations, generated output, and sensitive SQL are excluded.
5. The idempotent legacy-voucher compatibility migration is added because production schema evidence shows the legacy compatibility objects exist while repository migration history does not.
6. CI/local-server migration ordering is fixed only after reproducing and testing the exact failure path.

## Accounting and AI invariants

- A cash statement combines two non-overlapping write boundaries: patient cash collections/refunds from `emp_cash_transactions` and physical/manual custody movements from `cash_drawer_movements`.
- Drawer references that mirror patient bill/payment/refund flows are excluded from the drawer side so one physical event cannot be counted twice.
- A period statement reports net movement unless a real opening balance is available; it must not label a zero-based accumulator as actual balance.
- Patient-summary access is limited to clinical/administrative roles already authorized for clinical context.
- External AI prompts exclude patient name, patient code, full date of birth, phone, address, and identifiers. Fallback output is not cached as successful model output.

## Verification and integration

Every behavior change follows red-green TDD and receives a focused commit. The integrated branch is typechecked, tested, and built before it is merged into the existing local `main` with a normal merge that preserves the patch-equivalent local commit. Final verification compares local `main` with the integration branch and rechecks dirty worktrees and stashes for preservation.
