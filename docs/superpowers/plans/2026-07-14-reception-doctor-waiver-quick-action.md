# Reception Doctor Waiver Quick Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible one-click Doctor waiver source that auto-splits discount against eligible commission and auto-fills the selected doctor's name into the editable discount reference field across reception billing flows.

**Architecture:** Keep `DiscountAllocationEditor` as the shared source-allocation UI and calculation boundary. Add a click-only callback so parent billing forms can update their own reference state without coupling automatic commission-preview refreshes to the text input. Reuse the existing `createAllocationsForSource` accounting helper rather than duplicating waiver calculations.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library, Tailwind utility classes.

## Global Constraints

- Hospital discount remains the default source.
- Doctor waiver must never exceed eligible selected-doctor commission.
- Excess discount must remain Hospital-funded.
- One explicit Doctor waiver click must replace the whole source allocation and enable advanced allocation details.
- Auto-fill the selected internal doctor's name only on the explicit source click; later preview updates must not overwrite manual edits.
- Keep other sources inside `Advanced / Split`.
- Do not change receipt-facing total discount behavior or backend accounting contracts.

---

### Task 1: Lock the one-click allocation behavior with component tests

**Files:**
- Modify: `web/src/components/reception/DiscountAllocationEditor.test.tsx`

**Interfaces:**
- Consumes: `createAllocationsForSource(totalDiscount, reason, context)` and the `DiscountAllocationEditor` React component.
- Produces: Regression coverage for smaller-than-commission allocation and the persistent Doctor waiver quick action.

- [x] **Step 1: Add the below-commission helper test**

Assert `createAllocationsForSource(200, 'doctor_commission_waiver', { selectedDoctorId: 7, doctorAvailableWaiverAmount: 250 })` returns one doctor-waiver row for `200` and no Hospital remainder.

- [x] **Step 2: Add the rendered interaction test**

Render the editor with `enabled={false}`, `totalDiscount={200}`, doctor id `7`, available waiver `250`, and spies for `onEnabledChange`, `onRowsChange`, and `onQuickSourceSelected`. Assert `Hospital`, `Doctor waiver`, and `Advanced / Split` are visible, then click Doctor waiver and verify the full allocation and callback.

- [x] **Step 3: Run the focused test in red state**

Run: `pnpm --dir web exec vitest run src/components/reception/DiscountAllocationEditor.test.tsx`

Expected before implementation: FAIL because the persistent quick action and callback prop are absent.

### Task 2: Implement persistent Hospital and Doctor waiver quick actions

**Files:**
- Modify: `web/src/components/reception/DiscountAllocationEditor.tsx`

**Interfaces:**
- Consumes: Existing `createAllocationsForSource` and `DiscountAllocationReason`.
- Produces: Optional prop `onQuickSourceSelected?: (reason: DiscountAllocationReason) => void`.

- [x] **Step 1: Separate primary and advanced source options**

Keep Hospital and Doctor waiver in an always-visible primary group. Keep Management, Charity, Staff benefit, VIP, Owner, and Shareholder in the advanced chip area.

- [x] **Step 2: Add the explicit-click callback prop**

Extend the component props with `onQuickSourceSelected?: (reason: DiscountAllocationReason) => void`.

- [x] **Step 3: Implement full-allocation primary selection**

On Hospital or Doctor waiver click, replace all rows with `createAllocationsForSource(total, reason, context)`. Doctor waiver enables advanced details. Emit the callback only from the explicit click handler.

- [x] **Step 4: Render primary chips beside Advanced / Split**

Render Hospital and Doctor waiver in the editor header in both simple and advanced states, with the current source highlighted.

- [x] **Step 5: Run focused component tests**

Run: `pnpm --dir web exec vitest run src/components/reception/DiscountAllocationEditor.test.tsx`

Expected: PASS.

### Task 3: Share the source controls and auto-fill doctor references

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx`
- Modify: `web/src/pages/ReceptionDashboard.test.tsx`

**Interfaces:**
- Consumes: `onQuickSourceSelected` from Task 2 and the existing internal-doctor collection.
- Produces: Explicit-click handlers for F2 quick billing, Today's Patient Flow add-service billing, and final visit billing.

- [x] **Step 1: Add source-wiring regression assertions**

Verify each relevant editor usage passes `onQuickSourceSelected`, checks for `doctor_commission_waiver`, and updates `setQuickBillDiscountByName`, `setServiceDiscountByName`, or `setBillDiscountByName`.

- [x] **Step 2: Run the dashboard test in red state**

Run: `pnpm --dir web exec vitest run src/pages/ReceptionDashboard.test.tsx`

Expected before implementation: FAIL because the callback wiring is absent.

- [x] **Step 3: Resolve selected doctor names**

Near each waiver doctor id, derive the internal doctor name from `doctors` using numeric id equality and use an empty string when no internal doctor matches.

- [x] **Step 4: Wire all three billing flows**

When the explicitly selected source is Doctor waiver and a matching internal doctor exists, auto-fill the corresponding editable `Discount referred by` state.

- [x] **Step 5: Remove the add-service-only source UI divergence**

After `serviceDiscountAmount` becomes positive, render the shared `DiscountAllocationEditor` directly instead of requiring the standalone Advanced button to be clicked first. Retain the Advanced button only while the amount is zero so scheme preparation remains available.

- [x] **Step 6: Run focused dashboard tests**

Run: `pnpm --dir web exec vitest run src/pages/ReceptionDashboard.test.tsx`

Expected: PASS.

### Task 4: Verify and commit the isolated change

**Files:**
- Verify: `web/src/components/reception/DiscountAllocationEditor.tsx`
- Verify: `web/src/components/reception/DiscountAllocationEditor.test.tsx`
- Verify: `web/src/pages/ReceptionDashboard.tsx`
- Verify: `web/src/pages/ReceptionDashboard.test.tsx`
- Create: `docs/superpowers/specs/2026-07-14-reception-doctor-waiver-quick-action-design.md`
- Create: `docs/superpowers/plans/2026-07-14-reception-doctor-waiver-quick-action.md`

**Interfaces:**
- Consumes: Completed implementation.
- Produces: A tested isolated feature branch with no unrelated workspace artifacts.

- [x] **Step 1: Run combined focused tests**

Run: `pnpm --dir web exec vitest run src/components/reception/DiscountAllocationEditor.test.tsx src/pages/ReceptionDashboard.test.tsx`

Expected: PASS.

- [x] **Step 2: Run the web production build**

Run: `pnpm --dir web build`

Expected: TypeScript and Vite build complete successfully.

- [x] **Step 3: Review the scoped diff**

Confirm only the shared discount editor, reception dashboard wiring/tests, and these design/plan documents are staged. Do not include temporary extraction scripts or unrelated E2E artifacts.

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-07-14-reception-doctor-waiver-quick-action-design.md docs/superpowers/plans/2026-07-14-reception-doctor-waiver-quick-action.md web/src/components/reception/DiscountAllocationEditor.tsx web/src/components/reception/DiscountAllocationEditor.test.tsx web/src/pages/ReceptionDashboard.tsx web/src/pages/ReceptionDashboard.test.tsx
git commit -m "feat(reception): add one-click doctor waiver allocation"
```
