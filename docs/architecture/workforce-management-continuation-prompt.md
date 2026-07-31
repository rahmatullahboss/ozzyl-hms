# Workforce Management and Duty Roster Completion Handoff

Use this handoff after local `main` contains the workforce implementation and the post-integration verification metadata commit.

## Integrated state

- Task branch: `task/workforce-roster-planning-20260726`
- Task worktree: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/workforce-roster-planning-20260726`
- Original reviewed base: `a98cb0152`
- Current main synchronized at: `619e5caa6`
- Synchronization merge commit: `489c0a46c`
- Local-main integration: fast-forwarded to `489c0a46c`
- Integration conflicts: none
- Final evidence: `docs/reports/2026-07-26-workforce-management-implementation-verification.md`

## Fresh verification evidence

The full matrix passed after current-main synchronization and passed again on integrated local `main`:

- Backend, HR routes, staff, and RBAC: 26 files / 244 tests.
- Focused web: 4 files / 52 tests.
- Chromium HR workflow: 33 tests.
- TypeScript: passed.
- Web production build: passed.
- Migration manifest: 478 migrations generated.
- Canonical schema governance: 0 issues.
- Task and integration worktree policy checks: passed.

## Safety state

- Production mutation: not performed.
- Production migration application: not performed.
- Canonical workforce provider activation: not performed.
- Legacy workforce write retirement: not performed.
- Payroll financial semantics: not changed.
- Push: not performed.
- Local-main integration: performed.

## Remaining governed work

The implementation is complete on local `main`. Further work requires a separately authorized operational or canonical task.

### Non-production operational observation

```text
@HMS WFM-STAGING-OBSERVE করো।

Requirements:
1. Use a dedicated task branch and worktree from the then-current reviewed local main.
2. Apply migrations 0550 and 0551 only to an explicitly authorized non-production environment.
3. Observe biometric device retries and prove duplicate punches are not created.
4. Observe an overnight shift across the tenant timezone business-date boundary.
5. Verify leave approval, visible roster conflicts, attendance reprojection, and leave balance compare-and-set behavior.
6. Verify approved overtime hours, multiplier snapshots, audit rows, and read-only finance input behavior.
7. Record exact staging tenant, timestamps, device evidence, SQL/read-only reconciliation evidence, and rollback posture.
8. Do not deploy to production, enable a canonical workforce provider, retire legacy writes, push, or mutate production without separate explicit authorization.
```

### Canonical workforce authority

A future canonical workforce provider, backfill, shadow comparison, cutover, rollback, and legacy retirement remain deferred until an approved canonical workforce design exists.

## Stop state

```text
implementation present on local main: yes
runtime verification on local main: passed
production mutation performed: no
canonical provider enabled: no
legacy writes retired: no
payroll financial semantics changed: no
push performed: no
```
