# Reception + Service/Test Billing Readiness

Date: 2026-05-11

Scope: reception appointment flow, consultation-fee handoff, billing counter pending queue, and service/test item master setup. Pharmacy is intentionally out of this pass.

## DanpheEMR Reference Pattern

Danphe separates patient/visit context from billing posting, but the operational screen keeps the cashier/reception workflow smooth:

- A billing counter/session must be active before money collection.
- Pending/provisional bill items are visible before final invoice posting.
- Invoice/payment posting is centralized through the billing transaction layer.
- IP billing/discharge fetches pending items by patient visit and finalizes them through the billing transaction flow.
- Counter/cash drawer context is attached to billing and cash movement records.

For HMS, the safe equivalent is not to create a second appointment-billing engine. Appointment screens call the centralized billing service, and unpaid charges are visible in the billing counter queue.

## Final HMS Flow

```text
Patient Entry
↓
Book Appointment
↓
Doctor fee resolved server-side
↓
Pending consultation charge created in billing_provisional_items
↓
Reception chooses:
  Pay Now
  Send to Billing Counter
  Approve Due
↓
Pay Now / Due Approval creates official bill through billing service
↓
Payment/cash drawer/accounting/audit are posted centrally
↓
Doctor queue allows only Paid, Due Approved, or No Charge
```

Important accounting boundary:

- Pending charge = provisional operational item, no journal.
- Invoice = official patient receivable/revenue event.
- Payment = cash/bank/mobile collection event.
- Journal = generated from accounting posting events.

## Gaps Filled In This Pass

- Appointment creation now stores `billing_status` as `unpaid` or `no_charge`.
- Appointment creation now creates a `billing_provisional_items` consultation charge linked by `appointment_id`.
- Check-in no longer creates a duplicate `visit_services` doctor fee.
- Check-in links the existing appointment provisional charge to the visit.
- Unpaid checked-in patients do not enter the doctor queue.
- Pay Now from appointment finalizes invoice, payment, cash drawer transaction, accounting events, audit log, and queue handoff if the visit already exists.
- Billing Counter now shows `Pending OPD / appointment charges`.
- Billing Master price categories now use the same `price_categories` and `billing_item_price_category_maps` tables used by the counter price lookup.
- Service item creation now guarantees a default price category map so lab/radiology/procedure prices auto-populate in reception and billing counter.

## First Hospital Setup Checklist

Configure these before UAT:

- Billing counters: Reception Counter 1, Main Billing Counter, IPD Billing Counter.
- Price category: Normal default; add Corporate/Insurance only when needed.
- Service departments: Doctor, Laboratory, Radiology, Procedure, OT, Admission, Bed/Nursing.
- Doctors: active doctor records with consultation fees in taka, not paisa/minor units.
- Service/test items: CBC, RBS, urine R/E, X-ray, USG, ECG, dressing, nebulization, injection, bed charge, nursing charge, OT charge.
- Each service/test item must have department, code, price, discount flag, tax flag, and active status.
- Reception users must activate a billing counter before Pay Now.
- Accountant/admin roles must approve due/credit where required.

## Reception UAT Script

1. Register a new patient.
2. Book OPD appointment with a doctor fee of BDT 500.
3. Confirm appointment list shows fee BDT 500 and billing status `Unpaid`.
4. Click Pay Now from appointment screen with active counter.
5. Confirm invoice/receipt created and appointment shows `Paid`.
6. Check in the patient and confirm doctor dashboard queue shows the patient.
7. Book another appointment and click Send to Billing.
8. Open Billing Counter and confirm it appears in Pending OPD / appointment charges.
9. Pay from Billing Counter and confirm it disappears from pending queue.
10. Try check-in before payment and confirm no doctor queue entry is created.
11. Create a lab service item with price, then search it in reception/billing counter and confirm the price auto-fills from server catalog.
12. Change service item price and confirm the default price category map updates.

## Verification Added

- Appointment booking ignores client-sent fee and uses server doctor fee.
- Appointment booking creates pending consultation charge.
- Unpaid checked-in appointments do not enter queue.
- Pay Now posts bill, invoice items, payment, cash drawer, accounting event, and queue handoff.
- Billing counter pending appointment charge queue returns appointment charges.
- Billing master service item creation creates default price-category mapping.
- TypeScript checks passed for the Worker and web app.
- Focused reception/billing tests passed: appointment fee pricing, appointment billing handoff, billing master service items, billing counter, and reception routes.
- Production D1 migrations `0227_appointment_billing_handoff.sql` and `0228_unify_billing_price_categories.sql` were applied successfully.
- Production deploy completed on 2026-05-11 with Worker version `4595e18d-4f30-46bd-8608-a01bb4ebebdc`.
- Production smoke test passed 12/12 checks against `https://hms-saas-production.rahmatullahzisan.workers.dev`.

## Remaining Manual Signoff

- Print format for appointment payment receipt should be checked with the hospital header/template.
- Cashier closing must be tested by real users with opening cash, mixed cash/bKash/card, and closing variance.
- Role matrix should be signed off by management: who can approve due, refund, and cancel posted bills.
- Full authenticated browser UAT should be run on production using real hospital roles and test users.
