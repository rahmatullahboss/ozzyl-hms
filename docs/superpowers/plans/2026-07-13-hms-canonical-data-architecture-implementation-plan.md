# HMS Canonical Data Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `using-superpowers`, then `executing-plans` or the repository manual worker protocol. Steps use checkbox syntax for tracking. Execute exactly one task ID at a time and update `task-progress.yaml` before and after work.

**Goal:** Implement the approved canonical HMS data architecture in independently testable, reversible waves while preserving production data and achieving zero unexplained financial variance.

**Architecture:** Add canonical tables and domain-command services beside the legacy model, map and backfill deterministic source facts, shadow-write and reconcile, cut over reads/writes by tenant-scoped flags, and retire legacy authorities only after observation. Keep D1 as the database engine and use atomic D1 batches for bounded business mutations plus outbox records.

**Tech Stack:** TypeScript 5.9, Hono, Drizzle ORM, Cloudflare D1/SQLite, Wrangler 4.93, Vitest 4, pnpm.

## Global Constraints

- Program integration branch is `feature/hms-canonical-data-architecture`, based on `main` at `9985adb59`.
- Every CDB task branch/worktree starts from the current program branch and integrates back into it after review; no CDB task merges directly into `main`.
- Production writes are prohibited during planning and audit-only tasks.
- The production D1 identity must be verified from Wrangler configuration and account output before export or migration.
- Full export/import rehearsal is mandatory before any production schema change.
- The disabled local server must remain disconnected until Task CDB-110 is explicitly authorized.
- Canonical posted money uses integer minor units and `currency_code`.
- Canonical tenant ownership uses `tenant_id TEXT NOT NULL`.
- No generic untyped `reference_id` may be added.
- Every financial and sync-capable mutation requires idempotency, audit, tenant validation, and reconciliation coverage.
- Ambiguous historical mappings are exceptions, never guessed values.
- No legacy table is dropped during the first canonical cutover.
- The migration number `0423` is reserved by this plan only if it is still the next manifest-safe number when implementation begins; an agent must run the migration-manifest collision test before creating it and renumber the entire canonical migration sequence consistently if a newer migration has landed.

---

## File structure to create

```text
src/db/schema/canonical/
  index.ts
  meta.ts
  identity.ts
  clinical.ts
  services.ts
  billing.ts
  compensation.ts
  inventory.ts
  accounting.ts

src/lib/canonical/
  ids.ts
  time.ts
  money.ts
  idempotency.ts
  command-batch.ts
  source-mapping.ts
  feature-flags.ts
  reconciliation.ts
  commands/
    record-service-event.ts
    issue-invoice.ts
    collect-payment.ts
    apply-deposit.ts
    issue-credit-note.ts
    reverse-payment.ts
    accrue-compensation.ts
    record-stock-movement.ts

scripts/canonical/
  inspect-production.ts
  export-production.sh
  import-staging.sh
  snapshot-schema.ts
  baseline-reconciliation.ts
  backfill-runner.ts
  cutover-check.ts

docs/database/
  canonical-source-of-truth.yaml
  legacy-table-disposition.yaml
  metric-registry.yaml
  architecture-decisions/
  migration-runs/

test/canonical/
  foundation-migration.test.ts
  schema-governance.test.ts
  ids-time-money.test.ts
  practitioner-backfill.test.ts
  encounter-backfill.test.ts
  service-catalog-backfill.test.ts
  service-event-backfill.test.ts
  invoice-backfill.test.ts
  payment-allocation-backfill.test.ts
  compensation-backfill.test.ts
  ipd-projection.test.ts
  inventory-reconciliation.test.ts
  accounting-reconciliation.test.ts
  reporting-parity.test.ts
  cutover-runbook.test.ts
```

Existing files expected to change in controlled tasks:

- `src/db/schema/index.ts`;
- selected exports in `src/db/schema/schema.ts` only where compatibility links are needed;
- `scripts/build-migration-manifest.ts`;
- `package.json`;
- route modules currently writing appointments, visits, lab orders, radiology orders, provisional items, bills, invoice items, payments, deposits, refunds, commission accruals, cash movements, inventory movements, and accounting events;
- executive/doctor/test/IPD/billing report query modules;
- production migration guard and route integration tests.

## Interface contracts used across tasks

```ts
export type TenantId = string;
export type PublicId = string;
export type MinorAmount = number;
export type BusinessDate = string; // YYYY-MM-DD

export interface CanonicalCommandContext {
  tenantId: TenantId;
  actorUserId: number;
  idempotencyKey: string;
  occurredAtUtc: string;
  businessDate: BusinessDate;
}

export interface CanonicalCommandResult<T> {
  replayed: boolean;
  value: T;
  outboxEventPublicId: PublicId;
}
```

All later task plans must use these names unless an ADR intentionally changes them and updates all references.

---

### Task CDB-001: Freeze and verify the planning baseline

**Files:**
- Read: `agents.md`
- Read: both canonical specs and both canonical plans
- Create: `docs/database/migration-runs/P00-planning-baseline.md`
- Modify: `task-progress.yaml`

**Produces:** A signed-off planning baseline with workspace path, branch, git head, production-write prohibition, and next task.

- [ ] Record current branch/head and changed files using workspace-native git status tools.
- [ ] Confirm the only intended changes are planning artifacts.
- [ ] Write `P00-planning-baseline.md` with the exact artifact paths and SHA-256 values returned by the write tools.
- [ ] Update `task-progress.yaml` task CDB-001 to `completed` with evidence.
- [ ] Review the planning diff for accidental production commands or secrets.
- [ ] Commit only planning artifacts with message `docs: plan canonical HMS data architecture`.

**Verification:** `pnpm build:migrations` must still pass because planning files do not alter the migration manifest.

### Task CDB-010: Identify the live D1 database without mutation

**Files:**
- Create: `scripts/canonical/inspect-production.ts`
- Create: `test/canonical/production-inspection-contract.test.ts`
- Create: `docs/database/migration-runs/P01-production-identity.md`
- Modify: `package.json`

**Interface:**

```ts
export interface D1ProductionIdentity {
  environment: 'production';
  binding: string;
  databaseName: string;
  databaseId: string;
  accountIdMasked: string;
}
```

- [ ] Write a failing contract test that requires the script to read Wrangler configuration, reject local/staging bindings, mask account identifiers, and perform no SQL mutation.
- [ ] Run `pnpm vitest run test/canonical/production-inspection-contract.test.ts`; expect failure because the script does not exist.
- [ ] Implement the parser and explicit confirmation output without printing secrets.
- [ ] Add `canonical:inspect-production` script to `package.json`.
- [ ] Run the focused test and `pnpm exec tsc --noEmit`.
- [ ] Run the inspection command and record the verified production identity in the redacted run file.
- [ ] Commit with message `chore: identify canonical migration production database`.

### Task CDB-011: Export production and create an isolated staging clone

**Files:**
- Create: `scripts/canonical/export-production.sh`
- Create: `scripts/canonical/import-staging.sh`
- Create: `test/canonical/clone-script-contract.test.ts`
- Create: `docs/database/migration-runs/P01-clone-rehearsal.md`

**Rules encoded in scripts:**

```bash
npx wrangler d1 export "$PRODUCTION_DB" --remote --output="$EXPORT_FILE"
npx wrangler d1 execute "$STAGING_DB" --remote --file="$EXPORT_FILE"
```

The scripts must require explicit environment variables, refuse identical production/staging database names or IDs, use timestamped filenames, and never overwrite an existing export.

- [ ] Write failing source-contract tests for the refusal and safety checks.
- [ ] Implement scripts with `set -euo pipefail`, explicit confirmations, and redacted logging.
- [ ] Run the tests.
- [ ] Record a D1 Time Travel bookmark/timestamp before export.
- [ ] Export production, create/import staging, and retain command output in the run report without PHI.
- [ ] Compare table counts and total database row counts between export and staging.
- [ ] Commit scripts/tests/report with message `chore: rehearse D1 production clone`.

### Task CDB-012: Capture live schema and baseline reconciliation

**Files:**
- Create: `scripts/canonical/snapshot-schema.ts`
- Create: `scripts/canonical/baseline-reconciliation.ts`
- Create: `test/canonical/baseline-reconciliation.test.ts`
- Create: `docs/database/migration-runs/P01-production-baseline.md`
- Create: `docs/database/migration-runs/P01-exceptions.yaml`

**Produces:** JSON/Markdown summaries for tables, columns, indexes, FKs, checks, views, row counts, orphan counts, and financial totals.

- [ ] Write tests against a fixture D1/SQLite database containing a known FK violation, duplicate source, mixed money type, and mismatched bill total.
- [ ] Implement schema snapshot using SQLite metadata and PRAGMA queries.
- [ ] Implement baseline calculations for bills/lines/payments/due/deposits/refunds/commission/IPD/stock/cash/accounting.
- [ ] Ensure logs contain IDs and aggregates but no names, phones, diagnoses, or free-text notes.
- [ ] Run the scripts against the staging clone.
- [ ] Classify every mismatch in `P01-exceptions.yaml` with stable exception IDs.
- [ ] Commit with message `test: capture canonical migration production baseline`.

### Task CDB-020: Add canonical registries and schema modules

**Files:**
- Create: `src/db/schema/canonical/index.ts`
- Create: `src/db/schema/canonical/meta.ts`
- Modify: `src/db/schema/index.ts`
- Create: `migrations/0423_canonical_program_foundation.sql`
- Create: `test/canonical/foundation-migration.test.ts`

**Tables:**

```text
canonical_schema_versions
canonical_migration_runs
canonical_backfill_checkpoints
canonical_source_mappings
canonical_outbox_events
canonical_processing_issues
canonical_reconciliation_runs
canonical_feature_flags
```

**Required uniqueness:**

```text
(tenant_id, entity_type, source_type, source_public_id)
(tenant_id, idempotency_key)
(tenant_id, flag_key)
```

- [ ] Run `pnpm build:migrations` and migration collision tests before reserving `0423`.
- [ ] Write a failing migration test that asserts all tables, text tenant IDs, UTC timestamps, status checks, and unique indexes.
- [ ] Add Drizzle schema definitions and additive SQL migration.
- [ ] Export the canonical schema barrel from `src/db/schema/index.ts`.
- [ ] Run migration tests, `pnpm build:migrations`, and `pnpm exec tsc --noEmit`.
- [ ] Apply only to local/test D1, then to the staging clone after review; do not apply production.
- [ ] Commit with message `feat: add canonical migration foundation`.

### Task CDB-021: Add canonical primitives and atomic command batch

**Files:**
- Create: `src/lib/canonical/ids.ts`
- Create: `src/lib/canonical/time.ts`
- Create: `src/lib/canonical/money.ts`
- Create: `src/lib/canonical/idempotency.ts`
- Create: `src/lib/canonical/command-batch.ts`
- Create: `test/canonical/ids-time-money.test.ts`
- Create: `test/canonical/command-batch.test.ts`

**Interfaces:**

```ts
export function createPublicId(nowMs?: number): PublicId;
export function toMinorUnits(amount: string | number): MinorAmount;
export function deriveBusinessDate(utcIso: string, timeZone: string): BusinessDate;
export async function runCanonicalBatch<T>(db: D1Database, command: CanonicalBatch<T>): Promise<CanonicalCommandResult<T>>;
```

- [ ] Write failing tests for monotonic IDs, exact decimal conversion, negative/overflow rejection, timezone boundary dates, duplicate idempotency replay, and batch rollback.
- [ ] Implement minimal utilities without floating-point accumulation.
- [ ] Ensure the batch includes the outbox write and idempotency claim.
- [ ] Run focused tests and TypeScript checks.
- [ ] Commit with message `feat: add canonical command primitives`.

### Task CDB-022: Add architecture governance checks

**Files:**
- Create: `scripts/canonical/check-schema-governance.ts`
- Create: `test/canonical/schema-governance.test.ts`
- Create: `docs/database/canonical-source-of-truth.yaml`
- Create: `docs/database/legacy-table-disposition.yaml`
- Modify: `package.json`
- Modify: `scripts/build-migration-manifest.ts`

**Checks:** canonical money `REAL`, missing text tenant ID, generic references, direct legacy writes, destructive SQL, unexported schema tables, duplicate migration numbers, missing metric registry entry.

- [ ] Build intentionally invalid fixtures and verify each rule fails with a stable code.
- [ ] Implement an explicit legacy allowlist whose entries require owner and removal phase.
- [ ] Add `canonical:check` and include it in the relevant CI/build verification sequence without breaking existing approved legacy files.
- [ ] Run the focused test, migration build, and TypeScript checks.
- [ ] Commit with message `test: enforce canonical database architecture rules`.

### Task CDB-030: Introduce practitioners and explicit identity links

**Files:**
- Create: `src/db/schema/canonical/identity.ts`
- Create: `migrations/0424_canonical_practitioners.sql`
- Create: `scripts/canonical/backfill-practitioners.ts`
- Create: `test/canonical/practitioner-backfill.test.ts`
- Create: `src/lib/canonical/source-mapping.ts`

**Tables:** practitioners, practitioner-user links, practitioner-employee links, identifiers, specialties, departments.

- [ ] Write fixtures covering internal doctor with/without user, external referrer, duplicate registration number, same-name ambiguity, and cross-tenant collision.
- [ ] Implement deterministic mappings; ambiguous matches become issue rows.
- [ ] Verify rerunning the backfill creates no duplicates.
- [ ] Reconcile doctor/referrer counts on staging.
- [ ] Commit with message `feat: add canonical practitioner identity`.

### Task CDB-031: Promote encounters and map OPD/IPD episodes

**Files:**
- Create: `src/db/schema/canonical/clinical.ts`
- Create: `migrations/0425_canonical_encounters.sql`
- Create: `scripts/canonical/backfill-encounters.ts`
- Create: `test/canonical/encounter-backfill.test.ts`
- Create: `src/lib/canonical/commands/start-encounter.ts`

**Tables/links:** encounter participants, encounter legacy mappings, admission encounter link, bed stays.

- [ ] Write tests for appointment with no-show, walk-in visit, consultation+visit duplication, signed encounter, admission, and ambiguous multiple visits.
- [ ] Implement deterministic encounter grouping and participant role mapping.
- [ ] Preserve signed snapshots/addenda and do not rewrite historical clinical text.
- [ ] Add shadow encounter resolver without switching production reads.
- [ ] Reconcile active episode counts/statuses on staging.
- [ ] Commit with message `feat: establish canonical clinical encounters`.

### Task CDB-040: Create unified service catalog and effective pricing

**Files:**
- Create: `src/db/schema/canonical/services.ts`
- Create: `migrations/0426_canonical_service_catalog.sql`
- Create: `scripts/canonical/backfill-service-catalog.ts`
- Create: `test/canonical/service-catalog-backfill.test.ts`

**Tables:** service catalog items, price history, lab/radiology/consultation/bed/procedure/product mappings.

- [ ] Test conflicting lab/radiology/billing prices, duplicate codes, inactive items, and overlapping price periods.
- [ ] Implement a deterministic catalog winner/mapping policy and emit exceptions for unresolved conflicts.
- [ ] Store price amounts in minor units with exact conversion reports.
- [ ] Reconcile item and active price counts on staging.
- [ ] Commit with message `feat: unify HMS service catalog and pricing`.

### Task CDB-041: Create service requests and service events

**Files:**
- Modify: `src/db/schema/canonical/services.ts`
- Create: `migrations/0427_canonical_service_events.sql`
- Create: `src/lib/canonical/commands/record-service-event.ts`
- Create: `scripts/canonical/backfill-service-events.ts`
- Create: `test/canonical/service-event-backfill.test.ts`
- Create: `test/canonical/record-service-event.test.ts`

- [ ] Test lab order item, radiology requisition, doctor visit, IPD round, bed charge, procedure, medicine, cancelled source, duplicate source, and missing performer.
- [ ] Implement request/item mappings and service-event creation with explicit participants.
- [ ] Encode the current tenant diagnostic policy: non-cancelled ordered diagnostic items count operationally without requiring LIS completion.
- [ ] Ensure missing performer is unassigned/exception, never replaced by referrer.
- [ ] Reconcile counts by day/category and rerun backfill for idempotency.
- [ ] Commit with message `feat: add canonical service request and event facts`.

### Task CDB-050: Add canonical invoices and typed lines

**Files:**
- Create: `src/db/schema/canonical/billing.ts`
- Create: `migrations/0428_canonical_invoices.sql`
- Create: `src/lib/canonical/commands/issue-invoice.ts`
- Create: `scripts/canonical/backfill-invoices.ts`
- Create: `test/canonical/invoice-backfill.test.ts`
- Create: `test/canonical/issue-invoice.test.ts`

- [ ] Test doctor, test, IPD, procedure, medicine, package, discount, tax, cancelled line, missing reference, and mixed legacy unit cases.
- [ ] Implement typed line links to service events and adjustment events.
- [ ] Implement deterministic line discount allocation and minor-unit rounding.
- [ ] Persist header totals calculated from lines.
- [ ] Shadow-create canonical invoices from one selected billing path behind a tenant flag.
- [ ] Reconcile every header/line total on staging.
- [ ] Commit with message `feat: add canonical invoices and typed lines`.

### Task CDB-060: Add receipts, tenders, and allocations

**Files:**
- Modify: `src/db/schema/canonical/billing.ts`
- Create: `migrations/0429_canonical_payments.sql`
- Create: `src/lib/canonical/commands/collect-payment.ts`
- Create: `scripts/canonical/backfill-payments.ts`
- Create: `test/canonical/payment-allocation-backfill.test.ts`
- Create: `test/canonical/collect-payment.test.ts`

- [ ] Test cash/card/mobile split tender, partial payment, multi-invoice allocation, overpayment, duplicate request, gateway verifying state, and reversal.
- [ ] Backfill deterministic one-bill payments directly; classify ambiguous historical line allocation separately.
- [ ] Ensure receipt total equals tenders and allocations plus unallocated balance.
- [ ] Link cash tenders to custody outbox events in the same batch.
- [ ] Reconcile invoice paid/due values on staging.
- [ ] Commit with message `feat: persist canonical payment allocations`.

### Task CDB-061: Normalize deposits, credits, and refunds

**Files:**
- Modify: `src/db/schema/canonical/billing.ts`
- Create: `migrations/0430_canonical_adjustments.sql`
- Create: `src/lib/canonical/commands/apply-deposit.ts`
- Create: `src/lib/canonical/commands/issue-credit-note.ts`
- Create: `src/lib/canonical/commands/reverse-payment.ts`
- Create: `test/canonical/adjustment-lifecycle.test.ts`

- [ ] Test deposit receipt/application/refund, partial credit note, cash refund, non-cash reversal, paid performer reserve block, and duplicate execution.
- [ ] Implement immutable adjustment/reversal documents and allocation reversals.
- [ ] Keep original receipts/invoices unchanged except derived status/cache updates.
- [ ] Reconcile deposit liability and refund totals.
- [ ] Commit with message `feat: canonicalize deposits credits and refunds`.

### Task CDB-070: Consolidate practitioner compensation

**Files:**
- Create: `src/db/schema/canonical/compensation.ts`
- Create: `migrations/0431_canonical_practitioner_compensation.sql`
- Create: `src/lib/canonical/commands/accrue-compensation.ts`
- Create: `scripts/canonical/backfill-compensation.ts`
- Create: `test/canonical/compensation-backfill.test.ts`

- [ ] Test fixed performer reserve, percentage referral commission, remaining-base calculation, discount/tax treatment, unassigned performer, settlement, refund, and paid reversal.
- [ ] Map legacy commission accruals and reserve rows with source identities.
- [ ] Enforce one accrual per service line/practitioner/role/rule version.
- [ ] Reconcile payables and settlements on staging.
- [ ] Commit with message `feat: unify practitioner compensation accruals`.

### Task CDB-071: Replace IPD provisional and ledger authorities with projections

**Files:**
- Create: `src/lib/canonical/ipd-projection.ts`
- Create: `src/routes/tenant/canonicalIpdBilling.ts`
- Create: `test/canonical/ipd-projection.test.ts`
- Create: `test/integration/routes/canonical-ipd-billing.test.ts`

- [ ] Build fixtures containing bed stay, round, test, medicine, procedure, deposit, partial payment, credit, refund, and discharge.
- [ ] Implement un-invoiced service-event projection and canonical admission balance.
- [ ] Add tenant-flagged shadow endpoint for comparison; do not switch current route yet.
- [ ] Compare every active staging admission against legacy ledger and classify differences.
- [ ] Commit with message `feat: derive IPD billing from canonical facts`.

### Task CDB-080: Canonicalize pharmacy and inventory movement links

**Files:**
- Create: `src/db/schema/canonical/inventory.ts`
- Create: `migrations/0432_canonical_inventory_links.sql`
- Create: `src/lib/canonical/commands/record-stock-movement.ts`
- Create: `scripts/canonical/backfill-inventory.ts`
- Create: `test/canonical/inventory-reconciliation.test.ts`

- [ ] Test purchase receipt, transfer, issue, dispense, sale, return, waste, expiry, adjustment, lot, location, unit conversion, retry, and negative-stock policy.
- [ ] Map existing immutable movement facts and create source mappings.
- [ ] Link pharmacy dispense/sale to service events and invoice lines without duplicate stock-out.
- [ ] Reconcile balances by tenant/item/location/lot.
- [ ] Commit with message `feat: align inventory with canonical service and finance facts`.

### Task CDB-081: Align expense, payroll, cash custody, and accounting

**Files:**
- Create: `src/db/schema/canonical/accounting.ts`
- Create: `migrations/0433_canonical_accounting_outbox.sql`
- Create: `src/lib/canonical/accounting-poster.ts`
- Create: `test/canonical/accounting-reconciliation.test.ts`
- Modify: `src/lib/cash-ledger-writer.ts`

- [ ] Test bill issue, payment, deposit, refund, expense, payroll payment, doctor payout, stock receipt, duplicate event, failed posting, and reversal voucher.
- [ ] Route canonical outbox events to idempotent balanced voucher posting.
- [ ] Keep cash custody separate from revenue/expense classification.
- [ ] Preserve existing cash shadow issue monitoring during transition.
- [ ] Reconcile vouchers and cash custody on staging.
- [ ] Commit with message `feat: connect canonical events to cash and accounting`.

### Task CDB-090: Add metric registry and canonical reporting queries

**Files:**
- Create: `docs/database/metric-registry.yaml`
- Create: `src/lib/canonical/reporting/doctor-performance.ts`
- Create: `src/lib/canonical/reporting/test-performance.ts`
- Create: `src/lib/canonical/reporting/ipd-finance.ts`
- Create: `src/lib/canonical/reporting/collections.ts`
- Create: `test/canonical/reporting-parity.test.ts`
- Modify: existing executive reporting modules after parity is proven

- [ ] Register each KPI's fact, date, status, role, amount/quantity, and refund semantics.
- [ ] Write parity tests where card and drill-down consume the same canonical query result.
- [ ] Eliminate query-time proportional payment allocation.
- [ ] Ensure test volume uses approved non-cancelled service-event semantics and explicit performer role.
- [ ] Shadow-compare legacy and canonical reports on staging and selected production read-only queries.
- [ ] Commit with message `feat: report from canonical HMS facts`.

### Task CDB-100: Build and rehearse the domain cutover runbook

**Files:**
- Create: `scripts/canonical/cutover-check.ts`
- Create: `docs/database/migration-runs/P10-cutover-runbook.md`
- Create: `test/canonical/cutover-runbook.test.ts`
- Modify: `task-progress.yaml`

**Runbook order:** maintenance mode → bookmark → export → delta backfill → reconciliation → enable domain flags → smoke tests → go/no-go → reopen.

- [ ] Write tests that reject cutover when any financial variance, unresolved critical exception, failed outbox item, missing backup, or unknown migration exists.
- [ ] Rehearse the full runbook against staging twice.
- [ ] Record duration and rollback time for each domain.
- [ ] Do not execute production cutover without explicit owner authorization.
- [ ] Commit with message `docs: rehearse canonical HMS cutover`.

### Task CDB-101: Execute production cutovers by domain

**Files:**
- Create one run file per domain under `docs/database/migration-runs/production/`
- Modify: `task-progress.yaml`
- Modify: tenant feature flags through approved commands

- [ ] Obtain explicit production authorization for the named domain.
- [ ] Enter maintenance/read-only mode when required.
- [ ] Record bookmark and fresh export.
- [ ] Run final delta backfill and cutover checks.
- [ ] Enable only the named domain's canonical read/write flags.
- [ ] Run patient, appointment, OPD, diagnostic, billing, payment, IPD, refund, and report smoke tests relevant to the domain.
- [ ] Reopen or roll back according to thresholds.
- [ ] Record exact evidence and observation-period owner.

A single task branch must not combine multiple production domain cutovers.

### Task CDB-105: Retire legacy writes and create compatibility views

**Files:**
- Create: `migrations/0434_canonical_legacy_compatibility.sql`
- Create: `test/canonical/legacy-write-ban.test.ts`
- Modify: route modules identified in the live write-path inventory
- Modify: `docs/database/legacy-table-disposition.yaml`

- [ ] Search and classify every legacy write.
- [ ] Route active commands through canonical services.
- [ ] Add CI failure for new direct writes.
- [ ] Replace required legacy reads with compatibility views/adapters.
- [ ] Verify no active production route writes retired tables.
- [ ] Commit with message `refactor: retire legacy HMS write paths`.

### Task CDB-110: Rebuild local-server synchronization on canonical public IDs

**Files:**
- Modify: `scripts/local-server/`
- Modify: local sync routes/services and mapping tables
- Create: `test/canonical/local-sync-replay.test.ts`
- Create: `docs/database/migration-runs/P11-local-sync-rehearsal.md`

- [ ] Keep the local server disconnected during development.
- [ ] Add schema-version handshake and reject unknown future versions.
- [ ] Use canonical public IDs, origin IDs, outbox/inbox, and replay-safe idempotency.
- [ ] Test duplicate delivery, interruption, reordering, stale version, and conflict handling.
- [ ] Prohibit blind last-write-wins for signed clinical and posted financial records.
- [ ] Rehearse upgrade/import/sync against a production clone.
- [ ] Activate only after explicit owner authorization.
- [ ] Commit with message `feat: sync canonical HMS records safely`.

### Task CDB-120: Final retirement and program verification

**Files:**
- Create: a separately numbered retirement migration only after observation
- Create: `docs/database/migration-runs/final-program-verification.md`
- Modify: `task-progress.yaml`
- Modify: canonical registries and ADRs

- [ ] Prove all legacy tables targeted for removal have zero active readers/writers/integrations.
- [ ] Export production and rehearse retirement on staging.
- [ ] Run full unit, integration, data-integrity, web build, migration build, TypeScript, canonical checks, and production smoke suites.
- [ ] Confirm zero unexplained financial variance and all approved operational exceptions resolved or formally archived.
- [ ] Remove legacy structures in a separate authorized maintenance release.
- [ ] Mark the program complete only after rollback window and observation period pass.

## Required recurring verification commands

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm vitest run test/canonical/
pnpm test:data-integrity
pnpm --filter web build
pnpm canonical:check
```

Domain tasks add their focused existing regression suites. Production smoke commands require explicit production authorization and the repository's existing safety environment variables.

## Plan self-review checklist

- Every normative architecture area maps to at least one task.
- No task permits guessing ambiguous historical links.
- Production mutation is isolated to explicitly authorized cutover tasks.
- Local sync remains disabled until cloud stabilization.
- Canonical facts have one source of truth and a reconciliation invariant.
- All new financial writes are tenant-scoped, idempotent, audited, and batch/outbox guarded.
- Legacy removal is separated from expansion and cutover.
- Task IDs exactly match `task-progress.yaml`.