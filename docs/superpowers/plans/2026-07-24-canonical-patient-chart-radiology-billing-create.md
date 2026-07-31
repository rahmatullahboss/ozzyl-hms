# Canonical Patient-Chart Radiology Billing Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development and execute each task serially in the isolated worktree.

**Goal:** Integrate `patient-chart.radiology-billing.create` while preserving free-text/zero-value legacy and shadow behavior.

**Architecture:** Add a quick-radiology-specific legacy/strict adapter and a dedicated composite canonical command. Strict preparation is asynchronous and lazy; positive guarded legacy authority and canonical service/invoice authority share one batch.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, Node SQLite canonical fixtures.

## Global constraints

- Base: local `main` at `408430fa5`.
- Branch: `fix/canonical-patient-chart-radiology-billing-create-20260724`.
- Preserve free-text/zero-value disabled and shadow behavior.
- Strict mode rejects missing item, mapping or positive price before sequence allocation.
- Do not modify primary `radiology.billing.create`.
- No push, deploy, production mutation, migration, flag change or observation.

---

### Task 1: Composite canonical radiology command

**Files:**
- Create: `src/lib/canonical/commands/create-radiology-requisition-billing.ts`
- Create: `test/canonical/create-radiology-requisition-billing.test.ts`

**Produces:**

```ts
createRadiologyRequisitionBilling(
  db,
  input,
  execution?: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CreateRadiologyRequisitionBillingResult>>
```

Input includes tenant, idempotency key, accession/invoice numbers, patient, imaging item, billing-service item, display name, positive total minor, requested timestamp and business date.

- [ ] Write RED tests for applied command, actual requisition source mappings, replay/conflict and stale authoritative rollback.
- [ ] Run the test and confirm module absence failure.
- [ ] Implement validation, canonical service mapping, deterministic request/event/invoice identities, one accepted event, one invoice line, source mappings by accession number and outbox events.
- [ ] Run command and related lab/invoice regression tests plus TypeScript.
- [ ] Commit: `feat(canonical): add radiology requisition billing command`.

---

### Task 2: Quick-radiology legacy and strict adapter

**Files:**
- Create: `src/lib/canonical/patient-chart-radiology-billing.ts`
- Create: `test/canonical/patient-chart-radiology-billing.test.ts`

**Produces:**

```ts
executePatientChartRadiologyOriginalLegacy(db, input)
preparePatientChartRadiologyStrictContext(input)
preparePatientChartRadiologyStrictStatements(db, context)
```

- [ ] Write RED original-executor tests for lookup → accession → requisition → invoice sequence → bill → invoice item → link ordering, including free-text zero-value success.
- [ ] Write RED strict-preflight tests proving missing item, mapping and positive price fail before sequence callbacks.
- [ ] Write RED SQLite atomic tests for success, stale price, patient mismatch and duplicate accession/invoice.
- [ ] Implement the exact original SQL and separate strict context/statements.
- [ ] Verify adapter, command, strict coordinator and TypeScript.
- [ ] Commit: `feat(canonical): guard patient chart radiology billing`.

---

### Task 3: Route, coverage and governance integration

**Files:**
- Modify: `src/routes/tenant/patients.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `docs/database/legacy-table-disposition.yaml`
- Create: `test/integration/routes/patient-chart-radiology-canonical.test.ts`
- Modify: `test/integration/routes/patient-chart-workspace.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

- [ ] Write RED source contracts for original executor, async strict factory and canonical command.
- [ ] Add executable tests for legacy free-text success, shadow projection failure success and strict preflight 409 before insert.
- [ ] Integrate `executeStrictFinancialMutation`, context reload, canonical command and strict accounting-event skip.
- [ ] Set boundary `integrated`; move direct-write allowances to the adapter; keep primary radiology blocked.
- [ ] Run focused route/adapter/command/coverage/governance tests, TypeScript and canonical checker.
- [ ] Commit: `feat(canonical): integrate patient chart radiology billing`.

---

### Task 4: Verification and continuation

**Files:**
- Create: `docs/database/migration-runs/P11-patient-chart-radiology-billing-create-verification.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

- [ ] Run full canonical, TypeScript, governance, production build, worktree policy and diff gates.
- [ ] Perform final adversarial review for shadow isolation, strict pre-sequence rejection, source mapping and no primary-route changes.
- [ ] Record exact receipts and set next action to `pharmacy.billing.finalize` from latest reviewed local main.
- [ ] Run continuation contract and commit: `docs(canonical): record patient chart radiology checkpoint`.
- [ ] Integrate reviewed commits into clean local main, rerun full gates, then create the next isolated boundary worktree.
