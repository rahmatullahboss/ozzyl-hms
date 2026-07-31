# Paid Returning-Patient Eligibility and Patient Age Labels

## Scope

1. Returning-patient (`old_patient`) eligibility must be based on a real positive payment against a previous doctor-visit/OPD consultation bill within the configured eligibility window.
2. Visit completion, prescription creation, clinical note completion, or doctor workflow status must not be required for returning-patient eligibility.
3. Unpaid, zero-payment, credit-only, due-approved, or cancelled-bill records must not qualify.
4. Report-show eligibility remains unchanged and continues to require the configured same-doctor completed-visit rule.
5. Reception and Billing Counter patient search/selection rows must show age alongside name, patient code/number, and mobile wherever patient identity is presented for OPD serial, test/service billing, admission selection, billing-counter selection, and top-bar search.

## Backend Design

For `old_patient`, query prior appointments/bills/payments rather than completed visits. A qualifying event is a non-cancelled doctor-visit/consultation bill for the same tenant and patient, dated inside the configured window, with at least one positive payment amount. The returned `lastVisitDate` is the bill/appointment service date and `lastDoctorId` is the linked appointment/visit doctor when available.

`report_show` keeps the existing completed-visit query and same-doctor constraint.

## Frontend Design

Use the shared patient identity utility backed by the existing date-of-birth age calculation. Add age to every reception and Billing Counter patient result row that currently shows name plus patient code/mobile, including local and global results.

Age should be rendered as compact identity metadata, for example:

`P-000001 · 32y · 017...`

When age or date of birth is missing, omit only the age segment without showing a placeholder.

## Tests

- Positive payment within the configured window qualifies even when visit status is not completed.
- Multiple payments qualify when any positive payment exists.
- Zero payment, no payment, refunded/cancelled payment only, or credit/due-only records do not qualify.
- Payment outside the configured window does not qualify.
- Tenant and patient isolation are preserved.
- Report-show completed-visit behavior remains unchanged.
- Reception search/result tests verify age in OPD serial, test/service bill, admission, and top-bar patient search rows.
