# IPD Discharge CTA Payment Behaviour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full-collection discharge CTA authoritative, support optional partial collection through the audited due-discharge flow, and keep all three footer actions on one line.

**Architecture:** Keep the change inside `DischargeModal`. Parse the optional input once, allocate partial payment to previous mapped invoices before the current IPD bill, and reuse the existing settlement and credit-discharge endpoints. No backend schema or route change is required because both endpoints already accept partial payment.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind CSS, existing `/api/settlements` and `/api/ip-billing/discharge-bill` APIs.

## Global Constraints

- Full CTA always collects the total shown on the button, regardless of input value.
- Optional input is used only by the due-discharge path.
- Partial payment allocation order is previous mapped invoices first, current IPD bill second.
- Existing credit reason, expected date, acknowledgement, approval, counter, refund, and pending-service controls remain mandatory.
- Do not alter unrelated billing or settlement code.
- Stage and commit only task-owned files.

---

### Task 1: Add failing component tests for the requested interaction

**Files:**
- Modify: `web/src/components/reception/DischargeModal.test.tsx`

**Interfaces:**
- Consumes: existing `renderModal`, `mockApiPost`, `mockMutate`, and credit-panel controls.
- Produces: regression expectations for full collection, partial allocation, zero-collection credit discharge, and footer layout.

- [ ] **Step 1: Replace the existing full-settlement test with a blank-input test**

Add a test that renders `externalDueFinancial`, clicks `Collect ৳6,200 & Discharge` without changing `Total Received Now`, and expects:

```ts
await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/settlements', expect.objectContaining({
  patient_id: admission.patientId,
  bill_ids: [77],
  paid_amount: 6200,
})));
expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
  discharge_mode: 'settled',
  paid_amount: 0,
}));
```

- [ ] **Step 2: Add a test proving the green CTA ignores a smaller input**

Enter `2000`, click the green CTA, and assert `/api/settlements` still receives `paid_amount: 6200`.

- [ ] **Step 3: Add a mixed partial-allocation test**

Render a financial state with `otherOutstanding: 1000`, `netPayable: 500`, and one mapped invoice due `1000`. Enter `1200`, open `Discharge with Due`, complete reason/date/acknowledgement, and confirm. Assert:

```ts
expect(mockApiPost).toHaveBeenCalledWith('/api/settlements', expect.objectContaining({
  paid_amount: 1000,
}));
expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
  discharge_mode: 'credit_pending',
  paid_amount: 200,
}));
```

- [ ] **Step 4: Add a zero-collection credit test**

Open due discharge with a blank input and complete the audit fields. Assert `mockApiPost` is not called and the discharge payload contains `paid_amount: 0`.

- [ ] **Step 5: Add a full-input credit rejection test**

Enter the complete payable amount, open due discharge, complete fields, submit, and expect an error instructing the user to use full collection. Assert no mutation occurs.

- [ ] **Step 6: Add a footer non-wrapping test**

Locate a `data-testid="discharge-footer-actions"` container and assert it contains `flex-nowrap`; assert Cancel, Discharge with Due, and Collect & Discharge are all children of that container.

- [ ] **Step 7: Run the focused test and verify RED**

Run:

```bash
pnpm -C web exec vitest run src/components/reception/DischargeModal.test.tsx
```

Expected: failures because blank-input full collection is blocked, partial credit payment is not allocated, the full-input credit guard is absent, and the footer test id/class is absent.

---

### Task 2: Implement authoritative full collection and audited partial credit collection

**Files:**
- Modify: `web/src/components/reception/DischargeModal.tsx`

**Interfaces:**
- Consumes: `financial.otherOutstanding`, `financial.netPayable`, mapped `outstandingInvoices`, existing `api.post`, and the existing discharge mutation.
- Produces: `collectMappedOutstanding(amount)` helper and `buildDischargePayload(mode, currentIpdPaidAmount)` payload construction.

- [ ] **Step 1: Derive optional partial-payment values**

Replace the current normal-shortfall semantics with:

```ts
const tenderValue = Math.max(0, Number(tenderAmount) || 0);
const enteredPayment = Math.min(totalPayableBeforeClearance, tenderValue);
const remainingAfterEnteredPayment = Math.max(0, totalPayableBeforeClearance - enteredPayment);
```

Use these values only for display and the credit path. Do not use them to validate the green CTA.

- [ ] **Step 2: Allow a caller-supplied current-IPD payment in the payload builder**

Change the signature to:

```ts
const buildDischargePayload = (
  mode: 'settled' | 'credit_pending',
  currentIpdPaidAmount = mode === 'settled' ? netPayable : 0,
) => ({
  // existing fields
  paid_amount: currentIpdPaidAmount,
});
```

- [ ] **Step 3: Extract mapped-invoice settlement**

Create an async helper that accepts the amount to collect, returns the amount applied to previous invoices, validates inline support and bill mappings only when the amount is positive, and posts:

```ts
await api.post('/api/settlements', {
  patient_id: admission.patientId,
  bill_ids: billIds,
  paid_amount: amountToExternalInvoices,
  deposit_deducted: 0,
  discount_amount: 0,
  payment_mode: paymentMethod,
  remarks: `Collected during IPD discharge for ${admission.admissionNo || admission.admissionId}`,
  idempotencyKey: `discharge-settlement-${mode}-${randomId}`,
});
```

Clamp `amountToExternalInvoices` to `Math.min(requestedCollection, otherOutstanding)`.

- [ ] **Step 4: Make normal submit ignore the input**

Remove the `normalPaymentShortfall` error. Settle the full `otherOutstanding`, then call:

```ts
dischargeMutation.mutate(buildDischargePayload('settled', netPayable) as unknown);
```

- [ ] **Step 5: Implement partial collection before credit discharge**

Make `handleCreditSubmit` async. After existing audit validation:

```ts
if (enteredPayment >= totalPayableBeforeClearance) {
  toast.error('The entered amount clears the full payable. Use Collect & Discharge.');
  return;
}

const appliedToExternal = await collectMappedOutstanding(enteredPayment, 'credit');
const currentIpdPaidAmount = Math.min(netPayable, Math.max(0, enteredPayment - appliedToExternal));
dischargeMutation.mutate(buildDischargePayload('credit_pending', currentIpdPaidAmount) as unknown);
```

Ensure settlement failure returns without discharging.

- [ ] **Step 6: Update payment and credit copy**

- Change the input label default to `Partial Received Now (optional)`.
- Continue showing the entered-payment remainder in the adjacent amount box.
- In the credit panel, show both `Collect now: ৳X` and `Remaining due after collection: ৳Y`.
- Keep the green button copy based on `totalPayableBeforeClearance`.

- [ ] **Step 7: Keep the footer actions on one line**

Change the action container to:

```tsx
<div data-testid="discharge-footer-actions" className="flex flex-nowrap items-center justify-end gap-2">
```

Add `whitespace-nowrap` to each action button and remove the green button's fixed `min-w-64` if needed to prevent wrapping.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run:

```bash
pnpm -C web exec vitest run src/components/reception/DischargeModal.test.tsx
```

Expected: all component tests pass.

---

### Task 3: Verify regressions and commit

**Files:**
- Verify: `web/src/components/reception/DischargeModal.tsx`
- Verify: `web/src/components/reception/DischargeModal.test.tsx`
- Verify: `docs/superpowers/specs/2026-07-27-ipd-discharge-cta-payment-behavior-design.md`
- Verify: `docs/superpowers/plans/2026-07-27-ipd-discharge-cta-payment-behavior.md`

**Interfaces:**
- Consumes: completed component behaviour.
- Produces: clean verified task branch ready for integration.

- [ ] **Step 1: Run focused frontend tests**

```bash
pnpm -C web exec vitest run src/components/reception/DischargeModal.test.tsx src/components/reception/ProvisionalBillingModal.test.tsx src/components/reception/ReceptionPatientDrawer.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run frontend type checking**

```bash
pnpm -C web exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Review task-owned diff**

Confirm no unrelated files changed and no `.ai-bridge`, generated dependency, or local artifact files are staged.

- [ ] **Step 4: Commit implementation**

```bash
git add web/src/components/reception/DischargeModal.tsx web/src/components/reception/DischargeModal.test.tsx docs/superpowers/plans/2026-07-27-ipd-discharge-cta-payment-behavior.md
git commit -m "fix: align IPD discharge payment actions"
```

- [ ] **Step 5: Integrate into local main**

From the clean main worktree, run the integration worktree policy check, merge the task branch, rerun the focused component test, and do not push or deploy without separate authorization.
