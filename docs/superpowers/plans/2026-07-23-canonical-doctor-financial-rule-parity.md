# Canonical Doctor Financial Rule Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Preserve the active doctor compensation calculation and lifecycle contract in canonical storage and expose an explicit all-or-nothing canonical dashboard provider.

**Architecture:** Add an accrual reporting-context table, populate it inside live canonical batches, build a canonical adapter for the existing `doctor-compensation-v1` response shape, and route summary/detail together through a dedicated tenant flag. Generic canonical reporting flags remain unable to switch the active dashboard.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest.

## Global Constraints

- Do not read legacy financial tables from the canonical provider.
- Do not change active dashboard output unless `canonical_doctor_analytics_v1` is enabled in `canonical` mode.
- Use BDT minor units internally and major units at the response boundary.
- Preserve existing response aliases and pagination behavior.
- Use TDD for every behavior change.

---

### Task 1: Canonical compensation reporting context

**Files:**
- Create: `migrations/0530_canonical_compensation_reporting_context.sql`
- Modify: `src/lib/canonical/live-doctor-compensation.ts`
- Modify: `src/lib/canonical/live-performer-reserve.ts`
- Modify: `src/lib/lab-finance.ts`
- Modify: `src/lib/diagnostic-performer-reserve.ts`
- Test: `test/canonical/live-doctor-compensation.test.ts`
- Test: `test/canonical/live-performer-reserve.test.ts`

**Interfaces:**
- Produces `canonical_compensation_reporting_context` keyed by `(tenant_id, accrual_public_id)`.
- Adds optional source context to live doctor and performer reserve inputs.

- [x] Write failing tests proving canonical accruals create source kind, detail name, source reference, and waiver reason context.
- [x] Run the focused tests and confirm failure because the table/context writes do not exist.
- [x] Add migration and batch statements; pass source metadata from legacy callers.
- [x] Run focused tests and confirm green.
- [x] Commit the schema and live projection checkpoint.

### Task 2: Canonical compensation lifecycle adapter

**Files:**
- Create: `src/lib/canonical/reporting/executive-doctor-analytics.ts`
- Test: `test/canonical/executive-doctor-analytics.test.ts`

**Interfaces:**
- Produces `getCanonicalExecutiveDoctorPerformance()` and `getCanonicalExecutiveDoctorPerformanceDetails()` using the existing response types.
- Reads canonical practitioners, mappings, invoices, lines, payments, compensation rules/accruals/context/settlements only.

- [x] Write failing fixtures for full waiver, partial settlement, settlement reversal, paid/unpaid performer reserve, and reversed-row exclusion.
- [x] Run the new test and confirm module/API absence.
- [x] Implement summary aggregation with earned, waiver, payable-before-settlement, paid, and outstanding semantics.
- [x] Implement commission ledger details and bounded activity/test evidence from canonical facts.
- [x] Run focused tests and confirm green.
- [x] Commit the canonical provider checkpoint.

### Task 2B: Historical reporting-context recovery

**Files:**
- Create: `src/lib/canonical/backfill-compensation-reporting-context.ts`
- Create: `scripts/canonical/backfill-compensation-reporting-context.ts`
- Modify: `scripts/canonical/prepare-tenant-financial-backfill.ts`
- Modify: `scripts/canonical/tenant-financial-import-contract.ts`
- Test: `test/canonical/backfill-compensation-reporting-context.test.ts`

- [x] Write failing tests for doctor/reserve recovery, duplicate mappings, idempotency, and excessive waiver rejection.
- [x] Implement bounded source-mapping recovery and an active missing-context count.
- [x] Require migration `0530`, context-table import, and zero remaining active rows in tenant financial preparation.
- [x] Run backfill, import-contract, and schema-governance tests.
- [x] Commit the historical recovery checkpoint.

### Task 3: Explicit provider router

**Files:**
- Create: `src/lib/doctor-analytics-provider.ts`
- Modify: `src/lib/executive-doctor-analytics.ts`
- Test: `test/canonical/doctor-analytics-provider.test.ts`
- Test: `test/integration/routes/dashboard-doctor-performance.test.ts`
- Test: `test/integration/routes/dashboard-doctor-compensation-details.test.ts`

**Interfaces:**
- Reads only `canonical_doctor_analytics_v1` for active provider selection.
- `legacy` and `shadow` return legacy responses; `canonical` returns canonical responses for summary and detail.

- [x] Write failing tests proving the generic `canonical_reporting_v1` flag cannot switch the dashboard.
- [x] Write failing tests proving the dedicated canonical mode switches both summary and detail.
- [x] Implement provider mode loading and wrapper delegation without silent fallback in canonical mode.
- [x] Run route and provider tests and confirm green.
- [x] Commit the provider-switch checkpoint.

### Task 4: Verification and cutover evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-canonical-doctor-financial-rule-parity-design.md`

- [x] Run canonical financial, compensation lifecycle, canonical reporting, and doctor dashboard integration suites.
- [x] Run `pnpm exec tsc --project tsconfig.json --noEmit`.
- [x] Run `git diff --check` and review all changed application files adversarially.
- [x] Record verified behavior and unresolved non-financial display gaps in the design evidence section.
- [x] Commit the verification checkpoint.
