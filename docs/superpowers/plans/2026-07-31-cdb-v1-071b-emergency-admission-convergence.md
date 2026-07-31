# CDB-V1-071B Emergency Admission Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair canonical admission encounter-type validation, deterministically converge exact emergency and missing planned admission encounters, and produce fail-closed reconciliation/release evidence for the blocked production rollout.

**Architecture:** A new additive migration aligns admission-to-encounter validation. Existing bounded backfill gains two narrow paths: accept exact emergency mappings and synthesize deterministic inpatient encounters only for non-emergency admissions with one exact patient link and no mapping. Separate protected reconciliation tooling handles existing ambiguous run artifacts and the four bed-cache variance issues; production execution remains authorization-gated.

**Tech Stack:** TypeScript, Vitest, SQLite/D1 migrations, Cloudflare D1, existing canonical deterministic-ID/source-mapping helpers.

## Global Constraints

- Base SHA: `ea2930dfa29d1b154de2187838e203ffca1d10ef`.
- No production mutation in implementation tasks.
- No legacy patients, admissions, beds, patient-bed intervals, visits, billing, or clinical-note mutation.
- Emergency encounter identity must remain emergency; it must never be retyped to inpatient.
- Non-emergency canonical admissions must reference inpatient encounters.
- Deterministic IDs, source mappings, and idempotent replay are mandatory.
- Legacy remains final response authority; Worker traffic remains unchanged.

---

### Task 1: Admission Encounter-Type Migration

**Files:**
- Create: `migrations/0571_canonical_admission_encounter_type_alignment.sql`
- Modify: `test/canonical/encounter-admission-bed-migration.test.ts`

**Interfaces:**
- Produces D1 triggers `canonical_admissions_validate_insert` and `canonical_admissions_validate_update`.
- Trigger rule: emergency admission → emergency encounter; every other admission type → inpatient encounter; tenant and patient link exact.

- [ ] Write failing migration tests that insert emergency/inpatient encounter fixtures and assert allowed and rejected admission combinations.
- [ ] Run `pnpm exec vitest run test/canonical/encounter-admission-bed-migration.test.ts`; expect failure because migration 0571 is absent.
- [ ] Create migration 0571 that drops/recreates both triggers and watches `admission_type` on update.
- [ ] Re-run the migration test; expect pass.
- [ ] Commit exact migration and test files with `fix(canonical): align admission encounter types`.

### Task 2: Exact Emergency Admission Convergence

**Files:**
- Modify: `scripts/canonical/backfill-encounter-admission-bed-convergence.ts`
- Modify: `test/canonical/encounter-admission-bed-backfill.test.ts`

**Interfaces:**
- Add pure helper `isAdmissionEncounterTypeCompatible(admissionType, encounterType): boolean`.
- Emergency is compatible only with emergency; every other admission type only with inpatient.

- [ ] Add a failing test with one exact patient link, one mapped emergency encounter, and an emergency legacy admission; expect canonical admission/event/mapping creation and no encounter update.
- [ ] Run the focused backfill test; expect current `CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT` issue.
- [ ] Implement the compatibility helper and replace the hardcoded inpatient check.
- [ ] Re-run focused tests and existing reconciliation tests; expect pass.
- [ ] Commit with `fix(canonical): converge emergency admissions`.

### Task 3: Missing Planned Inpatient Encounter Synthesis

**Files:**
- Modify: `scripts/canonical/backfill-encounter-admission-bed-convergence.ts`
- Modify: `test/canonical/encounter-admission-bed-backfill.test.ts`

**Interfaces:**
- Add `createAdmissionEncounterStatements(context,row,patientLink,admittedAtUtc,dischargedAtUtc,status,evidence)` returning deterministic encounter/event/mapping/link statements plus the synthesized encounter identity.
- Source identity: `entity_type=encounter`, `source_type=legacy_admission`, source table `admissions`.

- [ ] Add a failing test for a planned admission with one exact patient link, no encounter mapping, and one bed stay.
- [ ] Assert deterministic inpatient encounter, initial encounter event, encounter source mapping, encounter-admission link, canonical admission/event/mapping, then bed-stay convergence.
- [ ] Run the focused test; expect current mapping-missing issue.
- [ ] Implement the minimal synthesis path. Derive encounter status from admission status: discharged→completed, cancelled→cancelled, otherwise in_progress.
- [ ] Add idempotency assertion: replay creates zero new business rows and retains exact mappings.
- [ ] Run backfill and reconciliation suites; expect pass.
- [ ] Commit with `fix(canonical): synthesize admission encounters`.

### Task 4: Protected Replay and Issue Disposition Contract

**Files:**
- Create: `scripts/canonical/cdb-v1-071b-admission-replay-reconciliation.ts`
- Create: `test/canonical/cdb-v1-071b-admission-replay-reconciliation.test.ts`

**Interfaces:**
- Validator binds final candidate SHA, migration 0571, tenant 100, exact issue counts `4/34/16/4`, source hashes, active Worker fingerprint, and zero traffic change.
- Atomic reconciliation may only supersede exact ambiguous admission mappings, resolve exact old issue rows after successful replay, and formally resolve/waive exact four cache-variance issues with interval evidence authoritative.

- [ ] Write failing tests for exact authorization/evidence binding and all count-drift cases.
- [ ] Write failing tests proving prohibited legacy-table update/delete SQL is absent.
- [ ] Implement deterministic evidence collector and guarded plan builder.
- [ ] Implement post-state validator requiring zero open admission/bed mapping issues, exactly four formally dispositioned cache variances, unchanged source hashes, and unchanged traffic fingerprint.
- [ ] Run focused tests and TypeScript; expect pass.
- [ ] Commit with `feat(canonical): add admission replay reconciliation gate`.

### Task 5: Full Verification and New Release Package

**Files:**
- Modify generated migration manifest through `pnpm exec tsx scripts/build-migration-manifest.ts` only.
- Create protected evidence outside repository during later authorized execution; do not commit it.

**Interfaces:**
- Produces a final verified `main` candidate SHA and bundle SHA.
- Produces exact authorization text for migration 0571, bounded reconciliation/replay, cache disposition, candidate upload, and `5% → 50% → 100%` rollout.

- [ ] Run all canonical admission/encounter/bed tests, reconciliation tests, authority-access test, and CDB release tests.
- [ ] Run `pnpm exec tsc --noEmit` and production build.
- [ ] Run full test suite in deterministic shards if one process is terminated by host limits.
- [ ] Perform adversarial code review; fix all high/medium findings.
- [ ] Commit remaining verified changes.
- [ ] Fast-forward integrate into clean `main`, rerun merged verification, push `origin/main`, and freeze candidate SHA/bundle hash.
- [ ] Read-only collect current production issue/mapping/traffic evidence and prepare a new exact protected authorization request. Do not execute migration/reconciliation/deploy without that authorization.
