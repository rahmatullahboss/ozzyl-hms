# Reception Finance Controls Worklist

## Scope

Improve the Bangladesh reception cash-counter workflow without replacing the existing Cloudflare/D1 architecture.

## Work Items

1. Unify Billing Handover with the home-page Shift Handover flow.
   - Remove free-form user-id/amount modal from Billing Handover.
   - Reuse billing counter session close, recipient selection, pending accept, and dispute handling.

2. Fix Add Provisional Items patient lookup.
   - Search by patient name, mobile, or patient code.
   - Store the selected patient ID internally, not as a raw numeric field the operator must know.

3. Fix reception reports data and role behavior.
   - Use Bangladesh business-date filtering consistently for payments and cash ledger data.
   - If the role can only deliver test reports, hide finance/doctor-finance panels from the UI.

4. Harden leakage controls.
   - Ensure zero-taka/report-show visits still create printable proof.
   - Keep cancel/refund behind request/approval where backend support exists.
   - Keep lab/service work tied to bill/provisional order records.
   - Audit payment, discount, free visit, handover, and edit-sensitive events.

5. Review doctor-wise reporting and payable logic.
   - Daily patients, visits, visit fee, test orders, test amount, commission.
   - Print/PDF output must match table totals.

6. Add compact appointment ticket printing beside full invoice.

7. Improve IPD bed KPI filtering.
   - Clicking occupied/free/other KPI filters the bed grid.

8. Improve billing/deposit context.
   - Show due, deposits, deposit use, and ledger history from one place.

9. Improve OPD serial sync and sorting.
   - Dashboard-created appointments must show in OPD.
   - Recent entries should appear near the top.

10. Fix admin invitation UI.

11. Keep new patient minimum required fields but show optional fields.

12. Improve audit log detail and edit auditing.
   - Include before/after values for sensitive edits.
   - Cover receptionist edits for patient details and payment amount where allowed.

## Execution Notes

- Prefer existing endpoints and tables over parallel workflows.
- Do not touch unrelated diagnostic catalog/radiology/lab dirty files.
- Run targeted type checks/tests before production deploy.
