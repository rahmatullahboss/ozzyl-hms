# Refund Request Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visually flat refund and payment-void request controls with responsive, accessible, colour-differentiated action cards and KPI panels while preserving all existing financial behaviour.

**Architecture:** Keep the current refund state and mutations in `ReceptionPatientDrawer.tsx`. Add small local presentation helpers for selectable refund modes and cash metrics, then replace only the affected JSX. Protect the structure with a focused source-level Vitest regression test.

**Tech Stack:** React, TypeScript, Tailwind CSS utility classes, lucide-react, Vitest.

## Global Constraints

- Do not change refund calculations, payloads, approval flow, cash-hold logic, payment reversal, or commission reconciliation.
- Preserve existing mode-switch state reset behaviour.
- Keep the layout stacked on narrow mobile screens and three-column from the small breakpoint.
- Preserve light and dark mode support.
- Do not touch unrelated dirty files or deploy/push.

---

### Task 1: Add visual-hierarchy regression coverage

**Files:**
- Create: `test/unit/reception-refund-request-visual-hierarchy.test.ts`
- Test: `test/unit/reception-refund-request-visual-hierarchy.test.ts`

**Interfaces:**
- Consumes: source text from `web/src/components/reception/ReceptionPatientDrawer.tsx`.
- Produces: regression assertions for accessible action cards, distinct visual tones, cash KPI cards, and payment-void warning copy.

- [ ] **Step 1: Write the failing test**

Create a Vitest test that reads the component source and asserts the following stable markers:

```ts
expect(source).toContain('data-refund-mode="full"');
expect(source).toContain('data-refund-mode="partial"');
expect(source).toContain('data-refund-mode="amount"');
expect(source).toContain('aria-pressed={selected}');
expect(source).toContain('data-cash-metric="expected"');
expect(source).toContain('data-cash-metric="held"');
expect(source).toContain('data-cash-metric="available"');
expect(source).toContain('paymentVoidConsequence');
```

Also assert the source contains amber, blue, violet, and emerald selected/accent class fragments and retains `refundMode === 'amount'` plus `refundMode !== 'amount'` contextual rendering.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/reception-refund-request-visual-hierarchy.test.ts`

Expected: FAIL because the new data markers and warning key are not present.

- [ ] **Step 3: Commit the failing regression test with the approved spec and plan**

Stage only:

```bash
git add docs/superpowers/specs/2026-07-26-refund-request-visual-hierarchy-design.md docs/superpowers/plans/2026-07-26-refund-request-visual-hierarchy.md test/unit/reception-refund-request-visual-hierarchy.test.ts
git commit -m "test(reception): specify refund request visual hierarchy"
```

### Task 2: Implement refund mode action cards and cash KPI cards

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx:1-20`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx:2008-2208`
- Test: `test/unit/reception-refund-request-visual-hierarchy.test.ts`

**Interfaces:**
- Consumes: existing `refundMode`, `setRefundMode`, `activeSession`, `availableCounterCash`, and translation function `t`.
- Produces: local `RefundModeCard` and `CashMetricCard` presentation components plus responsive JSX markers consumed by the regression test.

- [ ] **Step 1: Add presentation-only imports and helper types/components**

Add lucide icons for check state, item selection, amount entry, cash metrics, and warnings. Define local presentation helpers near the existing top-level utility functions:

```tsx
type RefundModeCardProps = {
  mode: 'full' | 'partial' | 'amount';
  selected: boolean;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'amber' | 'blue' | 'violet';
  onSelect: () => void;
};
```

The component must render a button with `data-refund-mode={mode}`, `aria-pressed={selected}`, a minimum height, icon tile, concise copy, and selected check indicator. Use explicit Tailwind class maps so each tone remains statically discoverable by Tailwind.

Define `CashMetricCard` with `data-cash-metric`, label, amount, icon, and tone props. Use explicit blue, amber, and emerald class maps.

- [ ] **Step 2: Replace the plain three-button selector**

Render a `grid grid-cols-1 gap-3 sm:grid-cols-3` containing:

- Full refund with amber tone and concise automatic-whole-bill description.
- Item-based partial refund with blue tone and concise service-selection description.
- Amount-based refund with violet tone and concise amount-entry description.

Each `onSelect` callback must execute the exact existing state resets:

```ts
setRefundMode(mode);
setRefundSelections({});
setManualRefundAmount('');
setRefundAllocationOverrides({});
```

- [ ] **Step 3: Replace neutral cash boxes with KPI cards**

Render Expected cash, Held refunds, and Available cash through `CashMetricCard`, preserving the exact current values:

```tsx
activeSession?.expectedCash ?? 0
activeSession?.heldRefundCash ?? 0
availableCounterCash
```

- [ ] **Step 4: Make amount entry visually prominent**

Keep the same input props, validation, allocation logic, and mode condition. Add a violet-tinted heading area, a leading currency visual, larger input text, and a concise helper sentence. Do not change numeric boundaries or state updates.

- [ ] **Step 5: Run the focused test**

Run: `pnpm vitest run test/unit/reception-refund-request-visual-hierarchy.test.ts`

Expected: PASS.

### Task 3: Clarify payment-void consequence and verify the complete change

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx:2008-2055`
- Test: `test/unit/reception-refund-request-visual-hierarchy.test.ts`

**Interfaces:**
- Consumes: existing `actionMode === 'paymentCorrectionRequest'` and payment target data.
- Produces: concise warning panel identified by the `patientDrawer.paymentVoidConsequence` translation key/default copy.

- [ ] **Step 1: Add the payment-void warning panel**

Immediately after the target receipt card, conditionally render a warning panel only for `paymentCorrectionRequest`. The copy must state that approval reverses the receipt, makes the invoice unpaid/due again, and reconciles affected commission/financial records. Keep the reason field and submit action unchanged.

- [ ] **Step 2: Run focused and nearby regression tests**

Run:

```bash
pnpm vitest run test/unit/reception-refund-request-visual-hierarchy.test.ts test/unit/approval-schemas.test.ts test/integration/routes/approvals.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run web typecheck/build verification**

Run the repository's applicable web typecheck or build command discovered from `package.json`. Expected: exit code 0.

- [ ] **Step 4: Review and commit**

Review the task-owned diff and confirm no financial logic changed. Stage only the component and test plus the approved docs, then commit:

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx test/unit/reception-refund-request-visual-hierarchy.test.ts docs/superpowers/specs/2026-07-26-refund-request-visual-hierarchy-design.md docs/superpowers/plans/2026-07-26-refund-request-visual-hierarchy.md
git commit -m "feat(reception): clarify refund and payment void requests"
```

Do not push or deploy.