# CDB-V1-010 Protected Production-Core Surface Inventory

**Checkpoint:** `CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Inventory date:** 2026-07-28  
**Production access or mutation performed:** no

## Result

The protected Canonical Core V1 repository surface is now represented by one deterministic machine inventory:

- `docs/database/protected-core-v1-surface-inventory.json`
- generator: `scripts/canonical/generate-protected-core-surface-inventory.ts`
- validator: `scripts/canonical/check-protected-core-surface-inventory.ts`
- classification logic: `scripts/canonical/protected-core-surface-inventory.ts`
- contract test: `test/canonical/protected-core-surface-inventory.test.ts`

The generated inventory contains **875 classified surfaces**:

| Surface kind | Count |
|---|---:|
| HTTP routes | 44 |
| UI flows | 28 |
| Direct or indirect writers | 218 |
| Operational or reporting readers | 462 |
| Reached tables | 83 |
| Canonical target providers/contracts | 22 |
| Reports | 6 |
| Scheduled jobs | 1 |
| Exports | 3 |
| Shared dependencies | 8 |

**Unknown protected-core writers:** `0`  
**Unknown protected-core readers:** `0`

## Protected boundary represented

The inventory covers the owner-approved live core only:

1. tenant staff authentication, users, roles, permissions and audit;
2. Reception patient registration, lookup and hospital linkage;
3. appointments, check-in, queue, visits and encounter linkage used by Reception;
4. service/test master data, departments, effective prices and billing configuration;
5. invoices, invoice lines, receipts, tenders, allocations and collections;
6. deposits, credits, refunds, reversals, cash custody, shift close and handover;
7. doctor/practitioner setup, schedules and commission rules/accruals/settlements;
8. operational reports, PDFs/exports and the appointment-reminder scheduled job required by that core;
9. tenant, authentication, permission, audit, idempotency and database boundaries required by those workflows.

The runtime-access filter deliberately excludes Lab, Radiology, Pharmacy, Inventory, Procurement, Emergency, OT, Nursing, Insurance, Payroll, Expense, IPD and Patient Mobile code unless an explicit protected-core route definition claims a dependency. A review search found no path leakage from those non-production domains in the generated inventory.

## Classification method

The inventory combines three evidence layers:

1. **Owner-approved scope evidence** from `docs/architecture/hms-production-scope-policy.md` and the Core V1 runbook.
2. **Mounted repository surfaces** from `src/index.ts` and `apps/ozzyl-lifestyle/src/App.tsx`.
3. **Detected data access** from `docs/database/canonical-authority-access-registry.yaml`, filtered to protected concept IDs and protected runtime paths.

Each surface records:

- current authority or provider status;
- intended Canonical command, table or provider;
- repository evidence that the business surface belongs to the protected live scope;
- exact identity rules;
- exact minor-unit financial rules where applicable;
- migration/backfill requirements;
- read-promotion requirements;
- rollback action;
- legacy retirement gate.

Stable surface IDs are SHA-256-derived from kind, path, route/table and concept assignment. Regeneration is deterministic; the checked-in artifact must equal a fresh build byte-for-object.

## Identity and money rules

The inventory applies these fail-closed rules to every relevant surface:

- patient, practitioner, appointment and encounter identity requires exact tenant-scoped source mapping or public IDs;
- names, phone numbers, timestamps and numeric-ID coincidence are not mapping evidence;
- every monetary comparison uses integer minor units;
- invoice net, allocations, paid, due, credits, refunds, reversals, deposits and doctor commission balances require zero unexplained variance;
- no provider promotion or legacy retirement is permitted until shadow comparison, rollback evidence and the checkpoint-specific authorization gates pass.

## Production-proof boundary

This checkpoint did **not** query a production database, inspect live traffic, activate a provider, deploy a Worker, change traffic, run a migration/backfill or retire a legacy route. The `productionProof` field means **owner-approved live-scope plus repository evidence**, not authenticated live runtime evidence.

Authenticated live route evidence remains a later, separately authorized production package requirement. A mounted route or existing provider module is not evidence that Canonical authority is active in production.

## Verification

Required local gates:

```text
pnpm canonical:protected-core-inventory-generate
pnpm canonical:protected-core-inventory-check
pnpm vitest run test/canonical/protected-core-surface-inventory.test.ts
pnpm canonical:check
pnpm exec tsc --noEmit
```

The inventory checker fails when:

- the checked-in artifact is stale;
- an expected source/evidence path is missing;
- an HTTP mount is no longer registered;
- a required authority, identity, money, migration, promotion, rollback or retirement field is empty;
- a surface ID is duplicated;
- any protected writer or reader is unknown;
- any production access, mutation, activation, deployment or retirement authorization flag becomes true.

## Exit decision

`CDB-V1-010` meets its repository exit condition: **zero unknown protected-core writers and zero unknown protected-core readers**.

The next checkpoint is `CDB-V1-020-CORE-V1-AUTHORITY-AND-CONTRACT-FREEZE`. It must use this inventory to freeze exact table, command, provider, public-ID, status, correction, reconciliation, compatibility and retirement contracts. It must not activate production or resume `CDB-128A`.
