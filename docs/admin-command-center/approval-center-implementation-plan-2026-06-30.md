# Approval Center Implementation Plan

Date: 2026-06-30
Spec: `docs/admin-command-center/approval-center-spec-2026-06-30.md`

## 1. Implementation approach

Use an incremental implementation that does not require a database migration. Existing `approval_requests.request_data` remains the source for context/evidence links. The backend enriches approval list/summary responses with computed policy, evidence, SLA, and execution metadata. The frontend consumes those fields and shows them in the Approval Center worklist and drawer.

This keeps the change safe for current cloud and local-server tenants while creating a stable API contract for the next schema-backed policy engine.

## 2. Files changed

### Documentation

- `docs/admin-command-center/approval-center-spec-2026-06-30.md`
- `docs/admin-command-center/approval-center-implementation-plan-2026-06-30.md`

### Backend

- `src/routes/tenant/approvals.ts`

Backend changes:

1. Add policy helper functions:
   - `approvalPolicyReason`
   - `approvalEvidenceRequired`
   - `approvalEvidenceStatus`
   - `approvalSlaMinutes`
   - `approvalSlaDueAt`
   - `approvalAssignedRole`
   - `enrichApprovalRow`
2. Add evidence/policy/SLA fields to `GET /api/approvals` rows.
3. Add evidence/policy/SLA fields to virtual cash handover rows.
4. Add `missingEvidence` and `executionFailed` to `GET /api/approvals/summary`.
5. Keep existing self-approval, duplicate pending, execution lock, bill cancel, refund, and payment void behavior unchanged.

### Frontend

- `web/src/pages/admin/PendingApprovals.tsx`
- `web/src/components/admin/ApprovalDetailDrawer.tsx`

Frontend changes:

1. Rename visible page title to `Approval Center` with action-center subtitle.
2. Add KPI cards:
   - Missing Evidence
   - Failed Execution
3. Add quick filters:
   - Missing evidence
   - Failed execution
4. Add table context for:
   - Policy reason
   - Evidence status
   - SLA due time
   - Execution status
5. Add drawer section `Policy & Evidence`.
6. Block quick approve when evidence is missing.
7. Keep high-risk and unsafe-type quick approve blocks.

### Tests

- `test/integration/routes/approvals.test.ts`
- `web/src/pages/admin/PendingApprovals.test.tsx`

Test coverage:

1. API list returns policy/evidence/SLA metadata.
2. API summary counts missing evidence and failed execution.
3. UI displays Missing Evidence and Failed Execution KPI cards.
4. UI filters missing-evidence rows.
5. UI blocks quick approve for missing-evidence requests.
6. Drawer displays policy/evidence section.

## 3. Rollout plan

### Step 1 — Documentation

Create the spec and implementation plan docs.

### Step 2 — Backend enrichment

Implement computed metadata only. Do not add migration in this increment.

### Step 3 — Frontend display

Use the backend metadata when available. Fall back to existing frontend-derived logic when older API responses do not include the new fields.

### Step 4 — Tests

Run targeted backend and frontend tests:

```bash
pnpm vitest run test/integration/routes/approvals.test.ts
pnpm --filter web vitest run src/pages/admin/PendingApprovals.test.tsx
```

### Step 5 — Next phase

After this increment is stable, add schema-backed policy tables and multi-level approval steps.

## 4. Risk notes

- No patient medical data should be added to logs.
- Evidence URLs should be treated as sensitive references; future implementation should use short-lived signed URLs.
- This increment does not add true multi-level approval yet.
- This increment does not move all fragmented approval-like queues into `approval_requests`; it makes the current center safer and more informative first.

## 5. Definition of done

- Documentation exists and matches implemented scope.
- Targeted backend tests pass.
- Targeted frontend tests pass.
- Git diff shows only related approval-center changes.
