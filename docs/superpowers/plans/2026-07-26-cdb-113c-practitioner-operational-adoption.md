# CDB-113C Practitioner Operational Adoption Plan

**Base branch:** `program/cdb-main-continuous-20260725`  
**Base implementation:** `4166cd67d`  
**Base metadata:** `c373d9323`  
**Audit:** `docs/database/audits/2026-07-26-practitioner-operational-adoption-audit.md`  
**Execution:** serial TDD, additive/local-only, no production mutation

## Objective

Operationalize the existing canonical practitioner authority without replacing authentication, employee, marketplace, scheduling, or legacy profile extensions. Establish canonical mutation commands, a disabled provider abstraction, hardened backfill/reconciliation, and exact continuity evidence.

Authentication user is not practitioner identity. Employee is not practitioner identity. External referrer is an external practitioner role, not a copied internal doctor. Name-only practitioner matching is prohibited.

## Task 1 — Practitioner operational migration

### RED tests

Create `test/canonical/practitioner-operational-schema.test.ts` requiring:

- additive migration `0545_canonical_practitioner_operational_adoption.sql`;
- canonical schema exports remain in `src/db/schema/canonical/identity.ts`;
- `canonical_practitioners` has positive `version` and SHA-256 `source_evidence_sha256`;
- existing rows receive safe defaults;
- status/kind constraints remain unchanged;
- user/employee links remain one-to-one and tenant-scoped;
- identifier uniqueness remains tenant/system/issuer/value scoped;
- no `doctor_auth`, password, email, phone, fee, marketplace, or scheduling columns are copied into canonical identity authority;
- migration manifest remains deterministic.

### GREEN implementation

Add an additive migration. Do not rebuild or replace the six canonical practitioner tables. Add only operational fields/indexes/triggers required for versioned commands and evidence. Update Drizzle schema and canonical source registry evidence.

### Verification

Run the schema test, existing practitioner backfill tests, TypeScript, governance, and migration build before continuing.

## Task 2 — Create practitioner command

### RED tests

Create `test/canonical/practitioner-operational-commands.test.ts` with a SQLite harness using migrations 0505, 0506, and 0545.

Require `createPractitioner` to support:

- create internal practitioner;
- create external practitioner;
- deterministic practitioner/event public IDs when omitted;
- exact source mapping;
- optional BMDC/employee/other identifier;
- optional user link;
- optional employee link;
- optional specialty and department;
- registration identifier uniqueness;
- user/staff one-to-one link uniqueness;
- replay of identical request;
- conflict for changed request with same idempotency key;
- source mapping conflict;
- atomic rollback;
- caller-supplied `authoritativeStatements` for legacy compatibility;
- PHI-minimised outbox containing no display name, registration value, user ID, staff ID, phone, email, or credential.

### GREEN implementation

Create `src/lib/canonical/commands/manage-practitioner.ts` or a small cohesive command folder. Use `runCanonicalBatch` and `CanonicalCommandExecutionOptions`.

The create command batch order is:

1. outbox/idempotency claim;
2. caller-supplied authoritative compatibility statements;
3. canonical practitioner row;
4. optional identifier/link/specialty/department rows;
5. source mapping;
6. any transaction-local assertions.

`doctor_auth` is never written by the canonical identity command unless the caller supplies a separately reviewed authentication compatibility statement. That statement remains authentication state, not practitioner identity authority.

## Task 3 — Update or retire practitioner

### RED tests

Require:

- lookup by exact tenant and practitioner public ID;
- expected version mandatory;
- stale version fails before mutation;
- active/inactive/unknown status only;
- display-name update allowed as profile identity label, but name is never mapping evidence;
- practitioner kind cannot silently change after creation;
- deactivate/retire preserves row and links/history;
- optional authoritative compatibility statements co-commit;
- replay and changed replay behavior;
- atomic failure rollback.

### GREEN implementation

Implement `updateOrRetirePractitioner`. Update `version=version+1`, evidence hash, status/display label, and `updated_at_utc` under expected-version guard. Outbox event includes practitioner public ID, kind, status, and version only.

## Task 4 — User and employee link lifecycle

### RED tests

Require `linkOrUnlinkPractitionerUser` and `linkOrUnlinkPractitionerEmployee` to enforce:

- exact active practitioner;
- positive legacy user/staff ID;
- approved evidence type;
- one-to-one uniqueness;
- tenant scope;
- active/rejected/retired lifecycle;
- unlink as status retirement rather than delete;
- replay/conflict;
- source mapping or reviewed link evidence;
- atomic compatibility statements.

### GREEN implementation

Use explicit link public facts already represented by the link rows. Do not infer employee from shared names, emails, phone numbers, or raw numeric coincidence. When a link already exists, update lifecycle only when the same practitioner/source pair is supplied.

## Task 5 — Identifier lifecycle

### RED tests

Require `managePractitionerIdentifier` to support add, verify, reject, and retire identifier. Validate:

- `bmdc`, `employee_code`, or `other` system;
- normalized value using existing canonical normalization;
- issuer key;
- display value retained for UI but excluded from outbox;
- tenant/system/issuer/value uniqueness;
- exact practitioner association;
- replay/conflict;
- no name fallback.

### GREEN implementation

Use explicit verification status. Retire rather than delete. Conflict produces deterministic error or processing issue; it never assigns the identifier to a second practitioner.

## Task 6 — Specialty and department assignment

### RED tests

Require `assignPractitionerClassification` to support specialty or department with normalized key, display text, primary flag, idempotency, and exact practitioner public ID. Duplicate normalized assignment replays or conflicts deterministically.

### GREEN implementation

Write the existing specialty/department tables. Do not use specialty or department as identity evidence. Outbox contains classification type/key and primary flag, not free-text profile data.

## Task 7 — Practitioner provider

### RED tests

Create `test/canonical/practitioner-provider.test.ts`.

Provider contract:

- `resolvePractitionerProviderMode` reads feature flag `canonical_practitioner_provider_v1`;
- missing table/flag, disabled flag, or unsupported mode returns legacy mode;
- legacy mode reads explicit legacy doctor/referrer source and resolves canonical public ID through source mapping if present;
- shadow mode returns legacy projection plus aggregate parity report;
- canonical mode reads canonical practitioner, identifiers, specialties, departments, user link, and employee link;
- practitioner public ID is identity;
- legacy ID is compatibility metadata only;
- no name comparison establishes parity or mapping;
- identity-sensitive missing/ambiguous mapping fails closed;
- provider output excludes password/auth secrets.

### Adapter functions

Implement disabled adapters for:

1. global/search resolver;
2. appointment practitioner validation;
3. public/marketplace list adapter;
4. encounter participant resolver.

Feature flag remains disabled. Code paths may call the provider resolver but must preserve legacy behavior in legacy mode. No production flag change occurs.

## Task 8 — Backfill hardening

### RED tests

Extend `test/canonical/practitioner-backfill.test.ts` or add a focused hardening file. Require:

- source types `legacy_doctor` and `legacy_external_referrer` remain deterministic;
- operational command source mappings do not duplicate backfill mappings;
- second pass creates zero new practitioner/link/identifier/classification rows;
- cross-tenant user/staff links remain blocked;
- duplicate BMDC produces ambiguity issue;
- duplicate external names never merge identities;
- no name-only mapping;
- inactive legacy doctor maps to inactive canonical status;
- every source mapping has evidence hash.

### GREEN implementation

Reuse existing backfill; do not rewrite it wholesale. Add only missing source/evidence reconciliation and version defaults needed by operational commands.

## Task 9 — Persistent reconciliation

### RED tests

Create `test/canonical/practitioner-operational-reconciliation.test.ts` and `scripts/canonical/reconcile-practitioner-operational-adoption.ts`.

Persist `canonical_reconciliation_runs` evidence for:

- doctor/source mapping cardinality;
- external referrer mapping;
- registration identifier uniqueness;
- user/staff link uniqueness;
- missing/ambiguous practitioner issues;
- active provider parity;
- no name-only mapping;
- no cross-tenant user/staff links;
- canonical/legacy status compatibility;
- orphan canonical classification/link rows.

Tampered mappings/status/links must produce a failed receipt.

## Task 10 — Governance and continuity

After implementation:

- update `docs/database/canonical-source-of-truth.yaml` if schema evidence changes;
- update `docs/database/canonical-authority-matrix.yaml` practitioner concept evidence/status without inventing another concept unless a genuinely separate fact exists;
- regenerate `docs/database/canonical-authority-access-registry.yaml`;
- update both authority audits and the practitioner audit;
- create `docs/database/migration-runs/P11-canonical-practitioner-operational-adoption.md`;
- update `docs/architecture/canonical-program-control-center.md`;
- update `task-progress.yaml`;
- update `.ai-bridge/current-plan.md`;
- update continuity tests;
- record implementation and metadata commits;
- set exact next checkpoint to `CDB-113D-APPOINTMENT-AUTHORITY`.

## Task 11 — Verification gates

Run:

1. focused practitioner schema/command/provider/backfill/reconciliation tests;
2. existing practitioner, encounter, appointment-billing, compensation, reporting, and source-mapping tests;
3. `pnpm exec tsc --noEmit`;
4. `pnpm canonical:check`;
5. `pnpm vitest run test/canonical`;
6. `pnpm build:migrations`;
7. `pnpm canonical:local-sync-readiness`;
8. `pnpm canonical:legacy-retirement-readiness`;
9. `pnpm worktree:check -- --mode=task --allow-dirty` before commit;
10. clean `pnpm worktree:check -- --mode=task` after commit.

## Commit structure

Use reviewable commits:

1. practitioner audit/plan contract;
2. additive operational schema;
3. practitioner commands;
4. practitioner provider/adapters;
5. backfill/reconciliation hardening;
6. governance, receipt, tracker, handoff, and continuity metadata.

Do not stop at an intermediate dirty state without writing exact next action and blockers.

## Safety boundaries

Production mutation is not authorised. Local-sync expansion remains paused. Destructive legacy retirement is not authorised.

Do not access production, protected exports, credentials, or secrets. Do not deploy, apply remote migrations/backfills, enable feature flags, change traffic, run production observation, delete legacy doctor/referrer data, retire legacy writers, push, or integrate CDB to `main` without fresh explicit authorization.

The next program checkpoint after verified CDB-113C is `CDB-113D-APPOINTMENT-AUTHORITY`.
