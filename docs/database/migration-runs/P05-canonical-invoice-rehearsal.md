# P05 Canonical Invoice Rehearsal

Date: 2026-07-14
Task: `CDB-050`
Worker branch: `task/cdb-050-canonical-invoicing`
Migration: `0428_canonical_invoices.sql`

## Scope

This rehearsal verified the additive canonical invoice header and typed invoice-line authorities, deterministic legacy classification, exact integer-minor-unit reconciliation, runtime atomic posting, replay safety, and the production no-write boundary.

Payments, receipts, tenders, and allocations remain outside this task and are reserved for `CDB-060`.

## Implemented authority boundary

- `canonical_invoices` owns invoice identity, lifecycle, currency, subtotal, adjustments, and total.
- `canonical_invoice_lines` owns typed service-event and explicit adjustment lines.
- A service line requires a tenant-scoped canonical service-event reference.
- Generic legacy references, descriptions, and names are not financial identity authorities.
- One canonical service event can be claimed by at most one invoice line.
- Posted financial values use exact integer minor units.
- Legacy `line_total` is treated as net major-unit evidence.
- `quantity × unit_price − line_total` becomes an explicit discount adjustment.
- Explicit line tax becomes a typed tax adjustment.
- Header subtotal, adjustment total, and total must exactly equal line-derived values.
- Any unresolved active line prevents partial canonical invoice creation.
- Cancelled legacy lines are excluded from active authority but receive stable rejected mappings.
- Runtime invoice, line, source-mapping, idempotency claim, and PHI-free outbox writes occur in one atomic batch.

## Adversarial verification

The focused RED run reproduced three defects before implementation hardening:

1. posted invoices could omit `posted_at_utc`;
2. cancelled source lines were not classified;
3. deterministic line-ID conflicts could be silently ignored.

After the minimal fixes, the focused suite passed:

- test files: `2`
- tests: `15`
- failures: `0`

Coverage includes lifecycle timestamps, safe-integer bounds, SQL/Drizzle partial-index parity, tenant-scoped foreign keys, duplicate line IDs, duplicate invoice numbers, source-evidence drift, terminal migration-run reuse, idempotency replay, PHI-free outbox payloads, and atomic rollback.

## Full repository verification

- canonical and migration-manifest tests: `19 files / 135 tests`
- failures: `0`
- canonical governance issues: `0`
- canonical registry tables after CDB-050: `26`
- generated migration manifest: `438`
- TypeScript errors: `0`
- `git diff --check`: passed

## Synthetic valid-path proof

The synthetic typed fixture produced one posted invoice with:

- service subtotal: `20,000` minor units
- discount adjustment: `-2,000` minor units
- tax adjustment: `500` minor units
- final total: `18,500` minor units
- unexplained variance: `0`

The fixture also proved replay safety, duplicate-event rejection, tenant isolation, duplicate invoice-number rollback, and no partial outbox or domain state after failure.

## Protected exact-snapshot rehearsal

A copy of the protected post-CDB041 snapshot received only migration `0428`. The original protected snapshot was not modified.

Source state:

- tenants with bills: `2`
- legacy bills: `1,322`
- legacy invoice lines: `2,102`
- active invoice lines: `2,101`
- cancelled invoice lines: `1`

First pass:

- bills scanned: `1,322`
- canonical invoices created: `0`
- canonical invoice lines created: `0`
- source mappings created: `3,424`
- processing issues created: `1,322`

Second pass:

- bills scanned: `1,322`
- canonical invoices created: `0`
- canonical invoice lines created: `0`
- source mappings created: `0`
- processing issues created: `0`

Final classification:

- invoice mappings: `1,322`
- ambiguous invoice mappings: `1,322`
- invoice-line mappings: `2,102`
- ambiguous active-line mappings: `2,101`
- rejected cancelled-line mappings: `1`
- mapped invoices: `0`
- mapped lines: `0`

Issue aggregates:

- `INVOICE_TYPED_LINE_UNRESOLVED`: `1,322` rows / `1,322` occurrences

Integrity results:

- all source bills classified: yes
- all source lines classified: yes
- source aggregates unchanged: yes
- partial invoices: `0`
- invoice financial variances: `0`
- duplicate service-event claims: `0`
- duplicate tenant invoice numbers: `0`
- mappings without evidence hash: `0`
- ambiguous or rejected mappings with canonical IDs: `0`
- mapped rows missing canonical targets: `0`
- foreign-key violations: `0`

The safe live-snapshot result is therefore intentionally zero posted canonical invoices. No typed financial authority was guessed from generic legacy references.

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- region observed: APAC

Preflight confirmed:

- invoice canonical tables: `0`
- migration `0428`: `0`
- migrations `0423` through `0427`: `5`
- source bills: `1,322`
- source lines: `2,102`
- foreign-key violations: `0`

Pre-apply Time Travel bookmark:

`00000019-00000000-000050a8-0114143649c61b89e48c47f1a8af269a`

A rehearsal migration lock was acquired before mutation. Wrangler then applied only `0428_canonical_invoices.sql`.

A protected aggregate-equivalent bundle was generated outside Git:

- domain data statements: `4,754`
- migration runs: `4`
- checkpoints: `4`
- source mappings: `3,424`
- processing issues: `1,322`
- canonical invoices: `0`
- canonical invoice lines: `0`
- bundle size: `2,685,729` bytes
- SHA-256: `57a49aabebe247cd33e24e544012bb2f59b6ffb37e20eff8c996dfce862fc2bb`

Wrangler processed `4,756` queries including the two safety pragmas. Remote aggregate reconciliation exactly matched the protected local result:

- source bills: `1,322`
- source lines: `2,102`
- invoice mappings: `1,322`
- line mappings: `2,102`
- ambiguous invoices: `1,322`
- ambiguous active lines: `2,101`
- rejected cancelled lines: `1`
- issue rows / occurrences: `1,322 / 1,322`
- invoices / invoice lines: `0 / 0`
- evidence violations: `0`
- null-mapping violations: `0`
- financial variances: `0`
- duplicate event claims: `0`
- duplicate invoice numbers: `0`
- foreign-key violations: `0`
- migration `0428` ledger rows: `1`

Post-import Time Travel bookmark:

`00000019-000002c8-000050a8-ad0689b2a3bd0ed3806a60b91e988c68`

The rehearsal migration lock was released after successful verification. No restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Fresh read-only verification returned:

- canonical tables: `0`
- migrations `0423` through `0428`: `0`
- latest migration ledger ID: `447`
- `changed_db`: `false`
- rows written: `0`

No production migration, backfill, deployment, Time Travel restore, or application write was attempted.

## Protected artifacts

The SQLite copies, aggregate-only runners, exact clone configuration, and data-bearing import bundle remain outside Git under the protected rehearsal directory. No raw SQL, SQLite database, PHI, signed URL, or protected bundle is committed or included in this report.

## Program integration

- worker branch: `task/cdb-050-canonical-invoicing`
- worker commit: `ab82d976`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `792d603d07a5e71f0f223d5c2c2daef81fb3cd25`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical and migration-manifest tests: `19 files / 135 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `438`
- TypeScript errors: `0`

The tracker, current plan, agent status, and decisions now mark CDB-050 complete and CDB-060 ready. The integration touched only the program branch; `main`, production, deployment, push, Time Travel restore, the local server, and the original dirty workspace remained untouched.

## Result

CDB-050 rehearsal and program integration passed. The implementation creates typed invoice authority only when service-event identity and financial evidence reconcile exactly. The current production snapshot safely produces no canonical invoices and deterministically classifies every legacy bill and line without partial or guessed authority.
