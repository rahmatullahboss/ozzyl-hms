# Inventory Intelligence Final Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining production gaps for inventory intelligence by wiring stock-changing workflows to safe recompute scheduling and aligning auto-PR generation with intelligence snapshots.

**Architecture:** Add a small dependency-injected scheduler helper that can trigger tenant-wide recompute immediately or via `waitUntil` without blocking user workflows. Update GR receipt and issue creation touchpoints to call the helper after successful stock mutation, and refactor reorder PR generation to prefer intelligence snapshots while retaining legacy fallback.

**Tech Stack:** TypeScript, Hono, D1 SQL, Vitest, React/Vite tests already in place.

## Global Constraints

- Use TDD: write failing tests first and verify RED before production changes.
- Keep recompute helper safe: recompute failure must be logged, never block stock receive/issue success.
- Keep manual recompute endpoint and dashboard behavior unchanged.
- Prefer intelligence snapshot suggestions for generated PRs; fallback to legacy reorder-level only when snapshot table is missing or empty.
- Do not add broad architecture rewrites or new dependencies.

---

### Task 1: Safe recompute trigger helper

**Files:**
- Create: `src/lib/inventory-intelligence/triggers.ts`
- Test: `test/unit/inventory-intelligence-triggers.test.ts`

**Interfaces:**
- Produces: `scheduleInventoryIntelligenceRecompute(input): void`
- Consumes: `recomputeInventoryIntelligence(dbClient, tenantId)` from `src/lib/inventory-intelligence/recompute.ts`

- [ ] Write failing tests for immediate recompute, waitUntil scheduling, and swallowed/logged failures.
- [ ] Implement minimal helper with dependency injection for `recompute` and `logger`.
- [ ] Verify tests pass.

### Task 2: Wire stock-changing workflows

**Files:**
- Modify: `src/routes/tenant/inventory/gr.ts`
- Modify: `src/lib/inventory-issue-service.ts`
- Test: `test/unit/inventory-intelligence-stock-change-hooks.test.ts`

**Interfaces:**
- Consumes: `scheduleInventoryIntelligenceRecompute`
- Produces: stock receive/issue responses that still succeed even if recompute scheduling fails.

- [ ] Write failing static integration tests that assert GR and issue service import/use the trigger helper near successful stock mutation completion.
- [ ] Add trigger calls after successful GR item processing and after issue stock mutation/accounting scheduling.
- [ ] Verify tests pass.

### Task 3: Intelligence-first auto PR generation

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Test: `test/unit/inventory-reorder-intelligence-pr.test.ts`

**Interfaces:**
- Produces: helper SQL functions for intelligence suggestions and legacy suggestions reusable by `/suggestions` and `/generate-pr`.

- [ ] Write failing tests that require generate-PR SQL to use `inventory_stock_intelligence_snapshot`, `suggested_order_qty`, and avoid static-only `HAVING current_stock <= I.ReOrderLevel` as the only source.
- [ ] Refactor shared suggestion loader and update generate-PR to prefer intelligence rows.
- [ ] Verify tests pass.

### Task 4: Final verification

**Files:**
- Existing tests only.

- [ ] Run all targeted inventory intelligence unit tests.
- [ ] Run inventory dashboard render tests.
- [ ] Run TypeScript check.
- [ ] Run web production build.
- [ ] Report remaining caveats honestly.
