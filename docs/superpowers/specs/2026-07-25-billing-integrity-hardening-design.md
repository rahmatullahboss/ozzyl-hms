# Billing Integrity Hardening Design

## Problem

The reviewed local `main` has strong invoice, settlement, discount-allocation, and commission arithmetic coverage, but several billing entry points disagree about who may select a referring doctor and what payment metadata must accompany a non-cash collection.

The resulting failures are operational rather than purely mathematical:

1. Direct `/api/billing` creation infers a referring doctor from the patient's latest visit for the current day when the client sends no doctor. A service-only sale can therefore create referral or prescriber commission without an explicit cashier decision.
2. Billing Counter visit changes can retain a doctor selected by a previous visit when the new visit has no doctor or the user returns to walk-in mode.
3. Reception Patient Drawer uses the first doctor-bearing visit from the patient's recent-visit list, even when that visit is historical, while the UI claims it is using today's visit doctor.
4. Billing Dashboard exposes a discount input but does not send the backend-required discount reason and approving/reference name.
5. Billing Dashboard, Reception Dashboard, and Reception Patient Drawer expose non-cash payment methods without consistently capturing and sending the required external transaction/reference number.
6. Patient Drawer allows an above-threshold discount without collecting `discountByName`.
7. Doctor-waiver preview relies on client-supplied performer reserve metadata. Some billing screens do not have that metadata, so preview can overstate the doctor-funded portion compared with final commission accrual.
8. Doctor-waiver preview rounds to whole taka while final commission and discount authorities use two-decimal money.
9. Discount Allocation Editor displays the Philippine peso symbol in several Bangladesh billing messages.

## Goals

- A doctor is attached to a bill only through an explicit user selection or a clearly bounded same-day visit context.
- Changing patient or visit context cannot leave a stale doctor attached to the next bill.
- Every paid non-cash collection captures and sends a transaction/reference number before submission.
- Every direct Billing Dashboard discount sends the complete backend contract.
- Above-threshold Patient Drawer discounts collect the approving/reference name.
- Doctor-waiver preview uses the same performer-reserve authority as final commission accrual.
- Preview and final calculations preserve two-decimal money.
- Focused regression tests reproduce every corrected failure.

## Non-Goals

- Retrospectively changing historical bills or commission accruals.
- Changing doctor commission rules, rates, settlement policy, or payout eligibility.
- Changing provisional billing semantics.
- Enabling unsupported payment methods on endpoints that do not currently persist an external reference.
- Refactoring the large reception pages beyond the smallest boundaries required for correctness.

## Authority Contracts

### 1. Referring doctor authority

#### Direct Billing API

`POST /api/billing` must never infer `referringDoctorId` from patient history. The value is nullable and remains null unless the request explicitly contains a tenant-owned active doctor ID.

Consultation pricing may still require an explicitly selected doctor. Service/test lines remain valid without a referring doctor.

#### Billing Counter visit selection

Selecting a visit with a doctor sets that doctor as patient-context referral. Selecting walk-in or a visit without a doctor clears patient-context referral data, doctor-waiver availability, and line prescriber IDs.

Manual referral controls remain the visible authority. A later explicit manual selection is sent as manual provenance; a visit-derived selection is sent as patient-context provenance.

#### Reception Patient Drawer

The drawer may prefill a doctor only from a visit whose `visit_date` is the current Bangladesh business date and whose status is not cancelled. Historical visits must not prefill a new bill.

The drawer copy must only say “today visit doctor” when that condition is true.

### 2. Discount submission authority

#### Billing Dashboard

When discount is greater than zero, the UI must collect and send:

- `discount`
- `discountReason`
- `discountByName`

The form must reject submission locally when the approving/reference name is blank. Zero-discount requests omit the additional fields.

#### Reception Patient Drawer

When effective discount exceeds 20% of the gross cart subtotal, `discountByName` is required before invoice mutation. The value is sent with the invoice. Scheme-provided references may prefill it.

### 3. Non-cash payment reference authority

The following paid non-cash flows must expose a reference field and send `externalTransactionId`:

- Billing Dashboard due collection
- Reception Dashboard due collection, including batch allocation
- Reception Dashboard quick service bill
- Reception Dashboard visit-service bill
- Reception Dashboard selected pending-lab payment
- Reception Dashboard appointment pay-now
- Reception Patient Drawer due collection
- Reception Patient Drawer quick bill

A reference is required only when:

- the effective payment method is non-cash; and
- the immediate paid amount is greater than zero.

Credit/due creation with zero immediate payment does not require a reference even if a stale non-cash method remains selected. Switching back to cash clears the pending reference so it cannot be attached accidentally.

A shared frontend helper defines the non-cash method set and the `requiresPaymentReference(method, paidAmount)` rule so all screens use the same condition.

### 4. Doctor-waiver preview authority

The server, not the client, resolves diagnostic performer reserve for preview whenever the item carries a valid billing service item reference.

For each preview item:

1. Resolve the effective performer payout rule for the tenant, billing service item, and bill date.
2. Use gross line amount, line discount, quantity, and the same diagnostic payout split used by final reserve creation.
3. Preserve an explicitly supplied reserve only for callers that already possess an authoritative value.
4. Pass the hydrated reserve into `previewDoctorCommissionForItems`.

The resulting eligible doctor commission is calculated from:

`discounted diagnostic amount - performer reserve`

The preview route rounds with the shared two-decimal money helper, not whole-taka `Math.round`.

### 5. Currency copy

All Bangladesh billing and discount allocation messages use `৳`. No `₱` symbol remains in the touched billing components.

## Data Flow

### Bill creation

1. UI selects patient and optional current visit.
2. UI resolves referral state under the explicit/current-visit contract.
3. UI calculates line discounts and payment draft.
4. UI validates discount reference and non-cash transaction reference.
5. Backend revalidates patient, doctor, discount, settlement, and reference ownership/contracts.
6. Finalization creates performer reserves and commission accruals from canonical invoice lines.

### Doctor-waiver preview

1. UI sends item category, quantity, gross, discounted line total, and billing service item reference.
2. Preview route hydrates performer reserve from the effective server rule.
3. Commission preview deducts the hydrated reserve.
4. Discount allocation caps doctor waiver at eligible commission and leaves excess hospital-funded.
5. Final accrual uses the same payout split and therefore agrees with preview.

## Error Handling

- Missing non-cash reference is blocked in the UI and remains rejected by backend validation.
- Missing Billing Dashboard discount approver/reference is blocked before mutation and remains rejected by schema validation.
- Invalid or cross-tenant doctor IDs remain rejected by the backend.
- Missing performer payout rule means reserve `0`; preview continues without inventing a reserve.
- A historical visit doctor is treated as no default doctor, not as an error.

## Verification Matrix

| Scenario | Expected result |
|---|---|
| Direct service bill, same-day visit exists, no doctor sent | Bill referrer remains null; no inferred commission doctor |
| Billing Counter changes from doctor visit to walk-in | Referral and line prescriber IDs clear |
| Drawer patient has only historical doctor visits | No doctor is preselected |
| Drawer patient has a doctor visit today | Today's doctor is preselected and labelled as such |
| Billing Dashboard discount with blank approver | Local submit blocked |
| Billing Dashboard discount with reason and approver | Complete payload sent and backend accepts authorized request |
| Paid bKash/card/bank flow without reference | Local submit blocked; backend remains fail-closed |
| Credit bill with zero immediate payment | No reference required |
| Diagnostic line gross 1,000, discount 100, performer reserve 200 | Waiver preview commission base is 700 |
| Fractional eligible commission | Preview preserves two decimals |
| Discount allocation helper copy | Uses `৳` |

## Rollout

This is a local-main code correction only. It requires focused backend tests, web tests, TypeScript checks, and production builds before integration. It does not authorize push, deployment, production migration, or historical data mutation.
