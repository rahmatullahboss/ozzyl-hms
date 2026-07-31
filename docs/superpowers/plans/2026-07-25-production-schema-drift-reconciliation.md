# Production Schema Drift Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record and enforce the reviewed disposition of dirty-root migrations `0424` through `0432` so they cannot be accidentally reapplied or restored over current `main`.

**Architecture:** Add one machine-readable drift registry and one human-readable production evidence report. A repository-only Vitest guard validates the complete migration set, current replacements, production-only orphan classification, and the reviewed paid-commission refund policy without connecting to production.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem APIs, JSON governance artifacts, Cloudflare D1 migration repository.

## Global Constraints

- Do not apply a production migration or mutate production D1.
- Do not deploy, upload, move traffic, or change feature flags.
- Treat the dirty root as read-only and do not copy its implementation files over current `main`.
- Do not reintroduce paid-commission clawback behaviour; current reviewed policy blocks refunds that would reduce payable below already-paid commission.
- Do not claim production-only orphan objects are safe to drop without a separately authorised dependency audit.
- Integrate only verified governance, evidence, and test files into clean local `main`; do not push.

---

### Task 1: Add a failing drift-disposition contract

**Files:**
- Create: `test/production-schema-drift-disposition.test.ts`
- Read: `test/unit/billing-refund-commission.test.ts`

**Interfaces:**
- Consumes: repository root, `docs/database/production-schema-drift-disposition.json`, current migration files.
- Produces: a deterministic repository guard for the nine dirty-root migration filenames and their replacements.

- [ ] **Step 1: Write the failing test**

Create a Vitest suite that:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCommissionRefundImpact } from '../src/lib/billing-refund-commission';

type DriftEntry = {
  filename: string;
  disposition: 'abandoned' | 'superseded' | 'production_only_orphan';
  productionLedgerRecorded: false;
  productionSchemaEffect: 'absent' | 'present' | 'superseded_equivalent_present';
  replacementMigrations: string[];
  orphanObjects: string[];
  currentRuntimeAuthority: boolean;
  action: 'do_not_apply' | 'preserve_until_authorised_cleanup';
};

type DriftRegistry = {
  version: 1;
  incidentId: string;
  productionMutationPerformed: false;
  entries: DriftEntry[];
};

const root = process.cwd();
const registryPath = join(root, 'docs/database/production-schema-drift-disposition.json');
const dirtyRootMigrations = [
  '0424_canonical_financial_reconciliation.sql',
  '0425_canonical_cash_ledger_event_identity.sql',
  '0426_canonical_cash_ledger_business_date.sql',
  '0427_financial_event_outbox.sql',
  '0428_shift_closing_canonical_evidence.sql',
  '0429_financial_provider_config_backfill.sql',
  '0430_doctor_commission_ledger_hardening.sql',
  '0431_doctor_commission_settlement_accounting.sql',
  '0432_lab_test_commission_eligibility.sql',
] as const;

function registry(): DriftRegistry {
  return JSON.parse(readFileSync(registryPath, 'utf8')) as DriftRegistry;
}

describe('production schema drift disposition', () => {
  it('records one reviewed disposition for every dirty-root migration', () => {
    const entries = registry().entries;
    expect(entries.map((entry) => entry.filename).sort()).toEqual([...dirtyRootMigrations].sort());
    expect(new Set(entries.map((entry) => entry.filename)).size).toBe(dirtyRootMigrations.length);
    expect(entries.every((entry) => entry.productionLedgerRecorded === false)).toBe(true);
  });

  it('keeps abandoned and production-only orphan SQL out of the reviewed migration chain', () => {
    for (const entry of registry().entries) {
      expect(existsSync(join(root, 'migrations', entry.filename))).toBe(false);
      expect(entry.currentRuntimeAuthority).toBe(false);
      expect(['do_not_apply', 'preserve_until_authorised_cleanup']).toContain(entry.action);
    }
  });

  it('keeps every superseded replacement migration present', () => {
    const superseded = registry().entries.filter((entry) => entry.disposition === 'superseded');
    expect(superseded.length).toBeGreaterThan(0);
    for (const entry of superseded) {
      expect(entry.replacementMigrations.length).toBeGreaterThan(0);
      for (const filename of entry.replacementMigrations) {
        expect(existsSync(join(root, 'migrations', filename))).toBe(true);
      }
    }
  });

  it('classifies the unledgered doctor-commission objects as production-only orphans', () => {
    const entries = registry().entries.filter((entry) => entry.disposition === 'production_only_orphan');
    expect(entries.map((entry) => entry.filename).sort()).toEqual([
      '0430_doctor_commission_ledger_hardening.sql',
      '0431_doctor_commission_settlement_accounting.sql',
    ]);
    expect(entries.every((entry) => entry.productionSchemaEffect === 'present')).toBe(true);
    expect(entries.every((entry) => entry.orphanObjects.length > 0)).toBe(true);
    expect(entries.every((entry) => entry.action === 'preserve_until_authorised_cleanup')).toBe(true);
  });

  it('preserves the reviewed paid-commission refund blocking policy', () => {
    const result = calculateCommissionRefundImpact({
      commissionBaseAmount: 400,
      commissionRateBps: 2500,
      commissionFlatAmount: 0,
      earnedCommissionAmount: 100,
      doctorWaiverAmount: 0,
      payableCommissionAmount: 100,
      paidAmount: 100,
      allocatedRefundAmount: 200,
      itemRefundableBalance: 400,
    });
    expect(result.blockedReason).toMatch(/already paid/i);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec vitest run test/production-schema-drift-disposition.test.ts
```

Expected: FAIL because `docs/database/production-schema-drift-disposition.json` does not exist.

---

### Task 2: Add the reviewed registry and production evidence

**Files:**
- Create: `docs/database/production-schema-drift-disposition.json`
- Create: `docs/database/migration-runs/production/2026-07-25-doctor-commission-schema-drift-reconciliation.md`
- Test: `test/production-schema-drift-disposition.test.ts`

**Interfaces:**
- Consumes: the nine exact dirty-root migration filenames and the read-only production observations recorded in the design.
- Produces: a stable machine-readable disposition and human-readable recovery evidence.

- [ ] **Step 1: Create the machine-readable registry**

Use this top-level structure:

```json
{
  "version": 1,
  "incidentId": "production-schema-drift-20260725",
  "observedAtUtc": "2026-07-25T00:00:00Z",
  "database": {
    "name": "hms-super-admin-production-apac",
    "id": "c68a5360-a2c1-44cc-9e71-f21057bea102"
  },
  "readOnlyEvidence": {
    "migrationRows": 482,
    "latestMigrationId": 484,
    "canonicalTableCount": 65,
    "changedDb": false,
    "rowsWritten": 0
  },
  "productionMutationPerformed": false,
  "globalRules": {
    "oldSqlMayBeApplied": false,
    "oldImplementationMayBeRestored": false,
    "orphanCleanupRequiresSeparateAuthorisation": true
  },
  "entries": []
}
```

Populate exactly nine entries. Use:

- `abandoned`, `productionSchemaEffect: "absent"`, no replacements, and `action: "do_not_apply"` for `0424`, `0425`, `0426`, and `0428`.
- `superseded` for:
  - `0427` → `0505_canonical_program_foundation.sql`;
  - `0429` → `0505_canonical_program_foundation.sql`;
  - `0432` → `0520_lab_test_commission_eligibility.sql`.
- `production_only_orphan`, `productionSchemaEffect: "present"`, and `action: "preserve_until_authorised_cleanup"` for `0430` and `0431`.
- Set `currentRuntimeAuthority` to `false` for all nine entries.
- Include exact orphan table/column/index names observed from `0430` and `0431`.
- Include reviewed replacement migrations `0524_refund_commission_reservations.sql`, `0531_canonical_compensation_refund_reservations.sql`, and `0513_canonical_practitioner_compensation.sql` where they explain the current doctor-commission authority.

- [ ] **Step 2: Write the evidence report**

The report must state:

- exact local-main base and recovery branch;
- production queries were read-only;
- ledger, canonical table, and old-object observations;
- migration-by-migration disposition table;
- paid-refund policy rationale;
- no production mutation/deploy/push occurred;
- orphan cleanup remains separately authorised future work.

- [ ] **Step 3: Run the guard test to verify GREEN**

Run:

```bash
pnpm exec vitest run test/production-schema-drift-disposition.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 4: Commit the contract**

```bash
git add test/production-schema-drift-disposition.test.ts docs/database/production-schema-drift-disposition.json docs/database/migration-runs/production/2026-07-25-doctor-commission-schema-drift-reconciliation.md docs/superpowers/plans/2026-07-25-production-schema-drift-reconciliation.md
git commit -m "test(database): guard production schema drift disposition"
```

---

### Task 3: Verify and integrate locally

**Files:**
- Verify: all files created in Tasks 1 and 2.

**Interfaces:**
- Consumes: completed recovery branch.
- Produces: verified local `main` with no production or remote mutation.

- [ ] **Step 1: Run focused regression tests**

```bash
pnpm exec vitest run test/production-schema-drift-disposition.test.ts test/canonical/schema-governance.test.ts test/unit/billing-refund-commission.test.ts
```

Expected: 3 test files pass with 21 tests.

- [ ] **Step 2: Build the migration manifest**

```bash
pnpm build:migrations
```

Expected: exit code 0; no old dirty-root migration enters the manifest.

- [ ] **Step 3: Run TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Review the branch diff**

Confirm the diff contains only:

- one design document;
- one implementation plan;
- one drift registry;
- one production evidence report;
- one repository guard test.

- [ ] **Step 5: Integrate into clean local main**

From the clean main worktree:

```bash
pnpm worktree:check -- --mode=integration
git merge --ff-only fix/production-schema-drift-reconciliation-20260725
```

Then rerun the focused regression command and `pnpm build:migrations` on `main`.

- [ ] **Step 6: Clean up only the recovery worktree**

After verified local-main integration, remove `.worktrees/production-schema-drift-reconciliation-20260725`, prune worktrees, and delete the fully merged local recovery branch. Preserve the dirty root and every unrelated branch/worktree.
