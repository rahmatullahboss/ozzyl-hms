# CDB-121 Prescription and Medication-Intent Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally verify one encounter-linked canonical prescription and clinical medication-order authority without changing production or retiring legacy history.

**Architecture:** Add five tenant-scoped canonical tables, then implement idempotent commands, deterministic backfill, persistent reconciliation, disabled provider adapters, and selected local read-promotion evidence. Keep fulfilment, administration, reconciliation, stock, billing, and payment as separate facts.

**Tech Stack:** TypeScript, Drizzle SQLite schema, Cloudflare D1-compatible SQL, Vitest, existing canonical command-batch/source-mapping/outbox/reconciliation primitives.

## Global Constraints

- Work only in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725` on `program/cdb-main-continuous-20260725`.
- Keep the owner-facing root read-only.
- Before each new slice, verify local `main` is not ahead; merge reviewed `main` only when required.
- Use TDD for every behavior change.
- Production migration, backfill, query, flag, route, traffic, deployment, sync, retirement, database deletion, push, and CDB-to-main integration are prohibited without separate exact authorization.
- Names, phone numbers, medicine text, numeric-ID coincidence, and timestamp proximity are never identity or episode evidence.
- Final prescription versions are immutable; correction uses amendment/supersession.
- Medication administration, medication reconciliation, and fulfilment are not medication-order intent.
- Aggregate evidence must be PHI-minimised.

---

### Task 1: Freeze the design contract

**Files:**
- Create: `docs/database/audits/2026-07-27-prescription-medication-intent-authority-audit.md`
- Create: `docs/superpowers/specs/2026-07-27-cdb-121a-prescription-medication-intent-authority-design.md`
- Create: `test/canonical/prescription-medication-intent-design-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority-design.md`
- Modify: `task-progress.yaml`
- Modify: `docs/architecture/canonical-program-control-center.md`
- Modify: `.ai-bridge/current-plan.md`

**Interfaces:**
- Consumes: authority matrix entry `prescription_medication_intent` and the CDB-113 identity/episode foundation.
- Produces: checkpoint sequence `CDB-121A` through `CDB-121E` and exact table/command names.

- [ ] **Step 1: Write the failing design-contract test**

Assert that audit, design, plan, tracker, receipt, and control-center artifacts contain:

```ts
const required = [
  'canonical_prescriptions',
  'canonical_prescription_versions',
  'canonical_medication_orders',
  'canonical_medication_order_status_events',
  'canonical_prescription_safety_events',
  'createCanonicalPrescriptionDraft',
  'finalizeCanonicalPrescription',
  'amendCanonicalPrescription',
  'transitionCanonicalMedicationOrder',
  'CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA',
];
```

Also assert explicit separation from fulfilment, MAR/administration, reconciliation, stock, billing, and payment, plus zero-production-action statements.

- [ ] **Step 2: Run the test and verify RED**

Run:

```text
pnpm vitest run test/canonical/prescription-medication-intent-design-contract.test.ts
```

Expected: failure because the contract test and/or checkpoint artifacts are absent.

- [ ] **Step 3: Complete the artifacts**

Write the audit/design/receipt and align tracker/control/handoff with `CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN-VERIFIED` and next checkpoint `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA`.

- [ ] **Step 4: Run focused and continuity verification**

```text
pnpm vitest run test/canonical/prescription-medication-intent-design-contract.test.ts test/canonical/canonical-program-continuity-contract.test.ts test/canonical/main-based-continuation-contract.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```text
git add docs/database/audits/2026-07-27-prescription-medication-intent-authority-audit.md docs/superpowers/specs/2026-07-27-cdb-121a-prescription-medication-intent-authority-design.md docs/superpowers/plans/2026-07-27-cdb-121-prescription-medication-intent-authority.md test/canonical/prescription-medication-intent-design-contract.test.ts docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority-design.md task-progress.yaml docs/architecture/canonical-program-control-center.md .ai-bridge/current-plan.md
git commit -m "docs(canonical): design prescription medication authority"
```

---

### Task 2: Add the canonical schema and governance

**Files:**
- Create: `migrations/0554_canonical_prescription_medication_intent.sql`
- Create: `src/db/schema/canonical/medication.ts`
- Modify: `src/db/schema/canonical/index.ts`
- Modify: `docs/database/canonical-source-of-truth.yaml`
- Modify: `docs/database/canonical-authority-matrix.yaml`
- Modify: `docs/database/legacy-table-disposition.yaml` only when a reviewed migration waiver is required
- Create: `test/canonical/prescription-medication-intent-schema.test.ts`
- Modify/regenerate: `docs/database/canonical-authority-access-registry.yaml`

**Interfaces:**
- Produces Drizzle exports:

```ts
canonicalPrescriptions
canonicalPrescriptionVersions
canonicalMedicationOrders
canonicalMedicationOrderStatusEvents
canonicalPrescriptionSafetyEvents
```

- [ ] **Step 1: Write the failing migration/schema test**

Assert that migration `0554` creates all five tables with tenant-scoped public-ID uniqueness, composite foreign keys to canonical patient/encounter/practitioner identities, immutable version/event indexes, status checks, positive version checks, SHA-256 checks, and no cascading deletion of clinical history.

- [ ] **Step 2: Verify RED**

```text
pnpm vitest run test/canonical/prescription-medication-intent-schema.test.ts
```

Expected: failure because migration/schema exports do not exist.

- [ ] **Step 3: Implement additive SQL**

Create the five tables. Use `TEXT NOT NULL` tenant IDs, application-generated public IDs, normalized UTC timestamps, explicit status vocabularies, and tenant-scoped composite FKs. Do not alter or drop legacy tables.

- [ ] **Step 4: Implement Drizzle schema**

Mirror migration names, columns, checks, indexes, and foreign keys exactly in `src/db/schema/canonical/medication.ts`; export it from the canonical index.

- [ ] **Step 5: Register authority**

Change `prescription_medication_intent.targetAuthority.status` from `canonical_gap` to `partial_canonical`, register the five tables, name the schema module, record local schema evidence, and keep cutover/retirement blocked.

- [ ] **Step 6: Regenerate and verify governance**

```text
pnpm canonical:access-generate
pnpm vitest run test/canonical/prescription-medication-intent-schema.test.ts test/canonical/schema-governance.test.ts test/canonical/canonical-authority-check.test.ts test/canonical/canonical-authority-access.test.ts
pnpm canonical:check
pnpm build:migrations
pnpm exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```text
git add migrations/0554_canonical_prescription_medication_intent.sql src/db/schema/canonical/medication.ts src/db/schema/canonical/index.ts docs/database/canonical-source-of-truth.yaml docs/database/canonical-authority-matrix.yaml docs/database/canonical-authority-access-registry.yaml test/canonical/prescription-medication-intent-schema.test.ts
git commit -m "feat(canonical): add prescription medication schema"
```

---

### Task 3: Implement idempotent canonical commands

**Files:**
- Create: `src/lib/canonical/commands/manage-prescription-medication-intent.ts`
- Create: `test/canonical/prescription-medication-intent-commands.test.ts`
- Modify: access registry after reviewed scanner regeneration

**Interfaces:**

```ts
createCanonicalPrescriptionDraft(db, input, options)
replaceCanonicalPrescriptionDraft(db, input, options)
finalizeCanonicalPrescription(db, input, options)
amendCanonicalPrescription(db, input, options)
transitionCanonicalMedicationOrder(db, input, options)
recordCanonicalPrescriptionSafetyEvent(db, input, options)
```

All functions return `CanonicalCommandResult<T>` and use existing `readCanonicalCommandReplay` and `runCanonicalBatch` primitives.

- [ ] **Step 1: Write RED command tests**

Cover exact replay, conflicting replay, missing patient/encounter/practitioner rejection, cross-tenant rejection, draft creation, optimistic version failure, finalisation immutability, amendment supersession, status transition matrix, safety override reason requirement, rollback, PHI-minimised outbox, and no administration/fulfilment mutation.

- [ ] **Step 2: Run RED**

```text
pnpm vitest run test/canonical/prescription-medication-intent-commands.test.ts
```

- [ ] **Step 3: Implement validation and deterministic IDs**

Use exact trimmed strings, normalized UTC timestamps, lowercase SHA-256 validation, positive safe integers, deterministic source IDs, and explicit actor identity.

- [ ] **Step 4: Implement create/replace/finalise/amend batches**

Each batch co-commits current state, immutable versions, medication orders/events, source mappings, outbox, and batch assertions. Never hard-delete final history.

- [ ] **Step 5: Implement order transitions and safety events**

Use explicit transition maps and event-version guards. Safety events are append-only.

- [ ] **Step 6: Verify**

```text
pnpm vitest run test/canonical/prescription-medication-intent-commands.test.ts
pnpm canonical:access-generate
pnpm canonical:check
pnpm exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```text
git add src/lib/canonical/commands/manage-prescription-medication-intent.ts test/canonical/prescription-medication-intent-commands.test.ts docs/database/canonical-authority-access-registry.yaml
git commit -m "feat(canonical): add prescription medication commands"
```

---

### Task 4: Add bounded backfill and persistent reconciliation

**Files:**
- Create: `scripts/canonical/backfill-prescription-medication-intent.ts`
- Create: `scripts/canonical/reconcile-prescription-medication-intent.ts`
- Create: `test/canonical/prescription-medication-intent-backfill.test.ts`
- Create: `test/canonical/prescription-medication-intent-reconciliation.test.ts`
- Modify: authority matrix, access registry, package scripts if required

**Interfaces:**

```ts
buildPrescriptionMedicationBackfillPlan(input): BackfillPlan
buildPrescriptionMedicationReconciliation(input): ReconciliationPlan
```

Partitions: prescription headers, versions, items/orders, safety events, standalone CPOE orders, reconciliation.

- [ ] **Step 1: Write RED backfill tests**

Prove deterministic completion-claim/appointment/admission/visit encounter resolution, exact patient/practitioner mapping, stable IDs, ambiguity issues, no text matching, commercial fulfilment exclusion, source-row transaction boundaries, resumable cursors, and second-pass zero new rows.

- [ ] **Step 2: Implement the planner/executor**

Reuse source mappings and processing issues. Emit parameterized D1 statements only. Keep PHI out of receipts.

- [ ] **Step 3: Write RED reconciliation tests**

Require fixed checks for source coverage, identity/episode parity, version continuity, status/event parity, safety mapping, tenant safety, orphan references, duplicate authority, second pass, source immutability, FK zero, and integrity `ok`.

- [ ] **Step 4: Implement persistent reconciliation**

Persist aggregate check results through existing canonical reconciliation tables and stable issue IDs.

- [ ] **Step 5: Verify**

```text
pnpm vitest run test/canonical/prescription-medication-intent-backfill.test.ts test/canonical/prescription-medication-intent-reconciliation.test.ts
pnpm canonical:access-generate
pnpm canonical:check
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```text
git add scripts/canonical/backfill-prescription-medication-intent.ts scripts/canonical/reconcile-prescription-medication-intent.ts test/canonical/prescription-medication-intent-backfill.test.ts test/canonical/prescription-medication-intent-reconciliation.test.ts docs/database/canonical-authority-matrix.yaml docs/database/canonical-authority-access-registry.yaml package.json
git commit -m "feat(canonical): backfill prescription medication authority"
```

---

### Task 5: Add disabled providers and local readiness

**Files:**
- Create: `src/lib/canonical/prescription-medication-provider.ts`
- Create: `src/lib/canonical/prescription-medication-read-adapters.ts`
- Create: `docs/database/canonical-prescription-medication-provider-coverage.json`
- Create: `docs/database/prescription-medication-readiness.json`
- Create: `scripts/canonical/check-prescription-medication-readiness.ts`
- Create: `test/canonical/prescription-medication-provider.test.ts`
- Create: `test/canonical/prescription-medication-readiness.test.ts`
- Modify: selected local readers only after deterministic adapter tests

**Interfaces:**

Provider modes:

```ts
type PrescriptionMedicationProviderMode = 'legacy' | 'shadow' | 'canonical';
```

Missing/disabled/malformed configuration returns `legacy`.

- [ ] **Step 1: Write RED provider tests**

Prove disabled-safe legacy mode, deterministic mapping requirements, shadow aggregate comparison, canonical read shape, no fallback by name/text/time, and no provider activation.

- [ ] **Step 2: Implement provider and adapters**

Provide separate prescription-document and medication-order reads. Do not merge administration, reconciliation, or fulfilment responses.

- [ ] **Step 3: Build coverage/readiness checks**

Inventory exact selected readers, require zero unknown assignments, schema/command/backfill/reconciliation evidence, disabled flags, and blocked production/retirement gates.

- [ ] **Step 4: Verify full checkpoint**

```text
pnpm vitest run test/canonical/prescription-medication*.test.ts
pnpm canonical:access-generate
pnpm canonical:check
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

- [ ] **Step 5: Seal receipt and metadata**

Create `docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority.md`, update tracker/control/handoff with exact counts, blockers, commit IDs, and next clinical checkpoint.

- [ ] **Step 6: Commit**

```text
git add src/lib/canonical/prescription-medication-provider.ts src/lib/canonical/prescription-medication-read-adapters.ts docs/database/canonical-prescription-medication-provider-coverage.json docs/database/prescription-medication-readiness.json scripts/canonical/check-prescription-medication-readiness.ts test/canonical/prescription-medication-provider.test.ts test/canonical/prescription-medication-readiness.test.ts docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority.md task-progress.yaml docs/architecture/canonical-program-control-center.md .ai-bridge/current-plan.md docs/database/canonical-authority-access-registry.yaml
git commit -m "feat(canonical): verify prescription medication authority"
```

## Completion gate

CDB-121 is locally complete only when all five tables, commands, backfill, reconciliation, providers, coverage, readiness, full canonical tests, TypeScript, migration manifest, governance, sync and retirement blockers, receipt, tracker, control center, handoff, and clean-worktree proof pass.

Production remains separately blocked. CDB-121 completion does not authorise migration, backfill, flag, route, traffic, deployment, local sync, retirement, push, or CDB-to-main integration.
