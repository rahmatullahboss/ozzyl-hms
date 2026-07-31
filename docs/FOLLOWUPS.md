# Follow-up Work

Issues discovered during the 9-branch hardening merge that are NOT
introduced by the merge batch. Each should be addressed in a dedicated
follow-up branch.

## `fix/migrate-order-cleanup` — pre-existing migration chain problems

`scripts/local-server/migrate.sh` and the local D1 migration runner
have pre-existing structural problems that prevent the versioned
migrations (0001..0352) from being applied to a fresh local D1:

- `tenant-schema.sql` contains ALTER TABLE ot_bookings / ot_team_members
  / ot_anesthesia_records blocks that reference tables only created
  by versioned migrations. On a fresh DB, these ALTERs fail.
- `migrations/0049_performance_indexes.sql` references
  `nursing_care_plans`, which is created by a later migration
  (~0052). The wrangler d1 migrations apply command aborts when
  any single migration fails, leaving the DB in a partial state.

Net result: the local_server D1 in CI cannot be fully migrated with
`HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1`. The CI smoke step is
therefore limited to baseline + tenant-schema, which means the
Playwright smoke test `GET /api/invite/nonexistent-token -> 400/404/429`
returns 500 (no `invitations` table).

Recommended cleanup:
1. Extract the ot_* ALTER blocks from `tenant-schema.sql` into a new
   versioned migration file (e.g. `0353_ot_bookings_additive_fields.sql`)
   so they run AFTER the versioned migrations that create the ot_*
   base tables.
2. Reorder `0049_performance_indexes.sql` so it does not reference
   tables created by migrations applied AFTER it. Or move the index
   creation into the migration that creates the table.
3. Re-enable `HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1` in the CI
   workflow once the chain is acyclic.

## `fix/clinical-routes-rbac` — P0-09 follow-up

P0-09 (Clinical mutation routes for vitals/allergies/diagnosis/notes
lack explicit role/permission gates) is the only P0 not closed by the
9-branch batch. The `fix/auth-rbac` central `ROUTE_PERMISSIONS` matrix
already lists `clinical.*` entries, but the route handlers in
`src/routes/tenant/clinical/*` are not wired to the matrix. Wire them.

## `fix/typescript-baseline-cleanup` — pre-existing TS error baseline

`pnpm exec tsc --noEmit` reports ~360 errors in 10 files on `main`
(patients.ts, queue.ts, accountingRecovery.ts, approvals.ts,
doctorCertificates.ts, sync.ts, patientPortal.ts, …). These are
pre-existing on `main` and were not introduced by the 9-branch batch.
The 9-branch batch actually fixes 16 errors it would have introduced
(see commit history). The 360-error baseline is documented in the
soft-gate in `.github/workflows/ci-cd.yml`. A separate cleanup branch
should fix the 10 files to bring tsc --noEmit to 0 errors.
