# Billing And Accounting Danphe Parity Audit

Date: 2026-05-10
Reference: `DanpheEMR reference`
Scope: billing, counter, deposits, settlement, IP billing, discharge billing, accounting, reports, and non-pharmacy money flows.

## Reference Map

DanpheEMR reference files reviewed for this pass:

- Billing transaction core: `Code/Websites/DanpheEMR/Controllers/Billing/BillingTransactionBL.cs`
- Billing API surface: `BillingController.cs`, `BillingMasterController.cs`, `IpBillingController.cs`
- Deposit and return: `BillingDepositController.cs`, `BillReturnController.cs`
- Settlement and discharge: `BillSettlementController.cs`, `BillingSettlementBL.cs`, `DischargeBillingController.cs`, `ProvisionalDischargeController.cs`
- Accounting: `AccountingController.cs`, `AccountingBL.cs`, `AccountingReportController.cs`
- Ledger mapping: `AccLedgerMappingController.cs`, `AccountingBillLedgerMappingModel.cs`
- Accounting models: `TransactionModel.cs`, `TransactionItemModel.cs`, `ReverseTransactionModel.cs`, `SubLedgerTransactionModel.cs`, `FiscalYearModel.cs`

Current HMS files mapped in this pass:

- Billing counter: `src/routes/tenant/billingCounter.ts`, `web/src/pages/BillingCounterPage.tsx`
- Direct billing: `src/routes/tenant/billing.ts`
- Provisional billing: `src/routes/tenant/billingProvisional.ts`
- IP billing: `src/routes/tenant/ipBilling.ts`, `src/routes/tenant/ipdCharges.ts`
- Deposits/payments/cancellation: `src/routes/tenant/deposits.ts`, `src/routes/tenant/payments.ts`, `src/routes/tenant/billingCancellation.ts`
- Accounting core: `src/lib/accounting-posting.ts`, `src/lib/accounting-invariants.ts`, `src/lib/accounting-backfill.ts`, `src/lib/accounting-hardening.ts`
- Reports: `src/lib/accounting-reporting.ts`, `src/routes/tenant/reports.ts`, `src/routes/tenant/reportLab.ts`, `src/routes/tenant/reportAppointment.ts`
- Non-pharmacy financial operations: `src/routes/tenant/income.ts`, `src/routes/tenant/expenses.ts`, `src/routes/tenant/accounting.ts`, `src/routes/tenant/payments.ts`, `src/routes/tenant/recurring.ts`, `src/routes/tenant/staff.ts`, `src/routes/tenant/hr/payroll.ts`

## Confirmed Fixes In This Pass

- Billing Counter now has Danphe-style activation before invoice creation.
- Active counter session is required server-side before billing.
- Cash drawer opening, expected cash, close/handover, and variance are tracked.
- Bills, payments, and employee cash transactions now carry counter and counter session linkage.
- Production DB has counter session tables and active-session uniqueness guards.
- Counter activation now rejects duplicate active cashier/counter sessions with HTTP 409.
- Direct `/api/billing` bill creation and payment collection now require an active billing counter session.
- Direct billing and direct payment rows now carry counter and counter session linkage.
- Provisional invoice conversion now requires an active billing counter session.
- Provisional-generated bills, payments, and employee cash rows now carry counter and counter session linkage.
- IP discharge bill creation now requires an active billing counter session.
- IP discharge bills, payments, deposit adjustments, and employee cash rows now carry counter and counter session linkage.
- IP discharge finalization now updates provisional items and bed-charge rows with tenant-scoped predicates.
- IP discharge finalization now accepts critical admissions, uses GMT+6 accounting period checks, blocks final bill creation while in-admission pending visit services or prior open bill dues remain, and writes a valid `CREATE` audit action with discharge-bill details.
- Patient deposit collection, refund, and adjustment now require an active billing counter session.
- `billing_deposits` now stores `counter_id` and `counter_session_id` so advance/refund/adjustment rows reconcile to cashier sessions.
- Deposit refunds now persist `payment_method` on the deposit ledger row.
- Direct billing, Billing Counter invoices, provisional invoice conversion, IP discharge bills, and deposit collect/refund/adjust routes now block writes into closed accounting periods.
- Accounting audit now includes a discharged-admission invariant for pending provisional items and financially pending unbilled bed charges.
- Legacy zero-charge discharged bed rows were reconciled with a no-journal migration because they had no financial amount to post.
- Settlement creation now requires an active billing counter session, blocks closed accounting periods, and links settlement cash/deposit rows to the counter session.
- Cash-refund credit notes now require an active billing counter session, block closed accounting periods, and link credit note cash movement to the counter session.
- Billing cancellation, item cancellation, batch item cancellation, and provisional item cancellation now block closed accounting periods.
- Unpaid item-level and batch invoice-item cancellations now create central accounting reversal events instead of only changing bill totals.
- Manual journal creation now blocks closed or audited accounting periods before account validation/posting.
- Pending legacy journal deletion now blocks closed or audited accounting periods, while verified journals remain immutable and require reversal.
- Fiscal year close now synchronizes monthly `accounting_period_closes` rows, and fiscal year reopen unlocks only non-audited periods.
- Fiscal year reopen no longer writes invalid lowercase actions into the general audit log; period close/reopen audit uses `accounting_audit_logs`.
- Closed fiscal year lock backfill is covered by migration `0218_fiscal_year_period_lock_sync.sql`.
- Legacy direct income create/update/delete now blocks closed or audited accounting periods.
- Expense create/update/approval/rejection now blocks closed or audited accounting periods.
- Vendor payment posting now blocks closed or audited accounting periods before writing approved expenses, vendor payment rows, GR paid status, or posting events.
- Gateway payment verification now blocks closed or audited accounting periods before locking the gateway log or writing payments/deposit rows.
- Recurring expense execution now blocks closed or audited accounting periods before writing approved expense rows or advancing the recurring schedule.
- Payroll run approval now blocks closed or audited accounting periods before posting salary expenses or marking the payroll run approved.
- Staff salary payment now blocks closed or audited accounting periods before writing salary payment and salary expense rows.
- Billing Counter deposit deductions now persist `counter_id` and `counter_session_id` on the `billing_deposits` adjustment row, matching the cashier session used for the invoice.
- Inventory goods receipt accounting posting now derives GR date, vendor, amount, and payment mode from `InventoryGoodsReceipt` instead of trusting request totals.
- Inventory goods receipt accounting posting and manual posted-sync now block closed or audited accounting periods.
- Inventory goods receipt manual posted-sync now requires a verified `inventory_gr` accounting voucher before mutating `IsPostedToAcc`.
- Doctor commission rule create/update/delete and commission payment routes now enforce backend accounting roles.
- Single doctor commission payment now creates a doctor commission settlement, posts a central `commission_settled` accounting event synchronously, links `voucher_id`, and then marks the accrual paid.
- Bulk doctor commission settlement now blocks closed or audited accounting periods and posts the settlement voucher synchronously before marking accruals paid.
- Doctor commission payment and settlement audit logs now use valid `PAYMENT` actions, and rule changes use valid `CREATE`/`UPDATE`/`DELETE` actions.
- Legacy marketing commission create/pay paths now block closed or audited accounting periods and write audit logs.
- Shareholder profit distribution now blocks closed or audited accounting periods before inserting distribution rows.
- Shareholder distribution approval now recalculates all income, expenses, retained earnings, TDS, and shareholder payout amounts server-side, requiring the request preview to match server-derived values.
- Shareholder distribution approval now requires every active shareholder exactly once and posts a central `profit_distribution_declared` accounting event.
- Shareholder dividend payment now requires backend accounting/admin roles, blocks closed or audited payment periods, posts a central `shareholder_dividend_paid` accounting event, and only then marks the shareholder distribution as paid.
- Shareholder dividend payable now maps to dedicated `8350 Shareholder Dividend Payable` instead of the existing salary payable account.
- Legacy `/profit/distribute` now enforces backend roles, uses GMT+6 timestamps, handles December month rollover correctly, and blocks closed or audited distribution periods.
- Daily collection report now calculates employee and payment-method totals from signed `emp_cash_transactions` ledger movements, including cash discount received and subtracting returns/refunds/discounts.
- Daily collection and billing handover reports now enforce backend report roles instead of relying only on frontend navigation.
- Billing handover daily report now uses cashier cash ledger movements rather than bill header totals, so due collections, refunds, returns, and non-cash/deposit adjustments do not distort cash handover variance.
- Accounting report endpoints now enforce backend finance/report roles.
- Monthly accounting summary now uses the actual month end date for GL totals and no longer includes the first day of the next month.
- Balance sheet now includes current-year earnings in equity and returns an explicit assets-vs-liabilities-plus-equity balance check.
- IPD provisional clearance, due-clearance, clinical discharge, billing discharge, and discharge-planning final discharge now block closed/audited accounting periods, refuse discharge clearance while provisional/service/due billing remains pending, close bed occupancy atomically, and write backend audit logs.
- Death-record discharge now validates admission/patient consistency, blocks closed/audited death-discharge periods, refuses admission discharge while billing remains pending, and audit-logs the clinical discharge mutation.
- Future audit log rows now use canonical general audit actions for provisional-to-invoice conversion, deposit collect/refund/adjustment, credit-note refund, OPD/IPD discharge, appointment check-in, and radiology scan/finalize events; specific business actions are preserved inside audit details.
- A source-level allow-list test now prevents new non-canonical general audit actions from being introduced.
- Patient chart quick lab/radiology orders, radiology module requisitions, main lab basic/extended orders, and reception visit-service bill generation now block closed accounting periods, use hospital accounting dates, and emit `bill_created` through the shared bill-finalization helper instead of route-local accounting payloads.
- Lab order-specific prescriber commissions remain on the lab commission flow, while shared finalization now covers route-level bill-created posting and consultation/referral commission side effects where those line types exist.
- Reception pending charge entry routes for visit services, lab tests, and procedures now block closed accounting periods before creating pending billable rows.
- OPD visit creation and appointment check-in now block closed accounting periods before auto-creating doctor consultation-fee pending service rows, and use GMT+6 visit/check-in timestamps.
- Appointment booking/editing now resolves consultation fee from the server-side doctor master instead of trusting client-entered fees, and the appointment scheduler no longer divides taka fees by 100.
- Doctor consultation fees now use one canonical unit across backend, frontend, marketplace, visits, billing counter, and patient portal flows: raw taka. Legacy minor-unit-style values are normalized server-side before writes and before billing calculations.
- Legacy scaled doctor consultation-fee production rows were corrected with migration `0222_normalize_doctor_consultation_fees.sql`; already-posted vouchers were not edited, and balancing correction vouchers were posted through central accounting events.
- Accounting period-lock detection now scopes closed period rows to the active fiscal year containing the transaction date, preventing inactive historical/test fiscal-year locks from blocking current open-period postings.
- Deposit collection/refund/adjustment, settlement, credit note, bill cancellation, and commission cancellation event dates now use GMT+6 hospital accounting dates for period locks and posting events.
- Fiscal-year lookup defaults, admission/IP billing daily KPIs, lab today queue/verification commission dates, and SSF invoice default dates now use the GMT+6 hospital date instead of UTC calendar date.
- Verified accounting voucher line update/delete immutability is now enforced by an idempotent migration and covered by the invariant suite, so posted voucher totals cannot be edited by changing journal lines.
- Direct lab-item cancellation now blocks closed accounting periods, records central item-cancellation accounting events, and audit-logs bill-affecting lab cancellations.
- Direct provisional billing item create/batch/cancel routes now block closed accounting periods and use GMT+6 timestamps/accounting dates.
- Billing Counter posts accounting events and commissions through the central accounting event flow.
- Settlement and credit-note money mutations now use shared request-hash idempotency controls, so a same-key replay returns the original receipt/credit-note response and a same-key different payload is rejected before duplicate financial rows are written.
- Credit-note creation UI now follows the backend contract by loading invoice items and submitting selected return quantities instead of sending an arbitrary refund amount. Admin settlement navigation now uses the working patient-settlement workflow.
- Credit-note refund issuance now requires finance roles on the backend, settlement creation is role guarded, and reception users cannot apply settlement discounts without finance approval.
- Direct income and direct expense entries now emit accounting posting events instead of staying only in report tables; posted direct income/expense sources are protected from direct edit/delete and must be corrected by reversal journal.
- Recurring expense execution, staff salary payment, and HR payroll approval now reuse the same direct-expense accounting posting helper instead of writing approved expense rows without GL posting events.
- Staff salary and payroll approval now reject zero or negative net-payable amounts before salary expense or accounting event writes.
- Legacy `/profit/calculate`, `/profit/distribute`, shareholder profit calculation/distribution, and dashboard daily/monthly finance summaries now read verified GL revenue/expense totals instead of the legacy `income` and `expenses` report tables.
- Legacy `/profit/distribute` now posts a central `profit_distribution_declared` accounting event when a positive distributable profit is finalized.
- Accounting backfill and invariant checks now handle legacy numeric-looking source IDs without editing immutable posted vouchers.
- Legacy Billing Dashboard direct bill creation no longer accepts arbitrary manual prices: every non-consultation line must resolve from `billing_service_items`, and uncatalogued consultation lines are priced from the selected active doctor on the server.
- Billing Dashboard create-bill UI now treats unit price as display-only and blocks submit when a row is neither catalog-backed nor a selected-doctor consultation.
- Patient due report now returns a reconciliation summary (`totalBills`, `totalDue`) using the same due formula as the accounting invariant check instead of relying only on bill status labels.
- Deposit listing now returns patient-advance summary totals for deposits, refunds, adjustments, and remaining advance balance.
- Deposit module now exposes a patient-wise advance report so unused patient advances can be reconciled against the patient deposit liability ledger.
- Credit note listing now supports date filters and returns refund reconciliation totals (`totalCreditNotes`, `totalCreditAmount`, `totalRefundAmount`) from the same filter set as the visible rows.
- Settlement listing now supports date filters and returns collection reconciliation totals for payable, cash paid, deposit deduction, discount, and returned amount.
- Billing cancellation listing now supports patient/date filters and returns both cancelled-bill totals and central accounting-event totals, including item-level cancellation reversals that are not represented by `bills.status='cancelled'`.
- Future invoice item cancellation accounting events now include `patientId` in the posting payload so patient-scoped cancellation reports can reconcile item cancellations as well as whole-bill cancellations.
- Department revenue report now uses bill-date financial source rows instead of visit-only rows, excludes cancelled/refunded/draft bills, returns net/gross/discount totals, and reports a GL revenue difference for reconciliation.
- Doctor performance report now uses the real `doctor_commission_accruals.commission_amount` field and real source types (`consultation_fee`, `lab_test`, `referral`), returning total commissions and net hospital income instead of silently undercounting doctor payouts.
- Direct billing, Billing Counter invoice creation, provisional invoice conversion, IP discharge billing, reception-generated OPD service bills, lab/radiology auto-bills, and patient-chart diagnostic quick bills now share one bill-finalization side-effect helper for commission accrual and `bill_created` accounting payloads, including patient, visit, referrer, counter, counter-session, admission/diagnostic context, and bill category totals where applicable.
- IP discharge-bill creation now uses the shared discharge billing guard for pending visit-service and due checks while still allowing provisional IP items to be swept into the discharge bill.
- The discharge billing guard now supports an explicit provisional-sweep mode and is covered by unit tests; the D1 test mock now calculates aggregate `SUM(total_amount)` and `SUM(due)` checks consistently.

## Production Verification Snapshot

- Production migration applied: `0213_billing_counter_sessions.sql`
- Production migration applied: `0214_billing_counter_active_session_guards.sql`
- Production migration applied: `0215_billing_deposit_counter_linkage.sql`
- Production migration applied: `0216_reconcile_zero_discharge_bed_charges.sql`
- Production migration applied: `0217_counter_link_settlements_credit_notes.sql`
- Production migration applied: `0218_fiscal_year_period_lock_sync.sql`
- Production migration applied: `0219_shareholder_dividend_accounting.sql`
- Production migration applied: `0220_repair_shareholder_payable_mapping.sql`
- Production migration applied: `0221_ensure_accounting_line_immutability.sql`
- Production migration applied: `0222_normalize_doctor_consultation_fees.sql`
- Production migration applied: `0223_billing_mutation_idempotency.sql`
- Production migration applied: `0224_direct_income_expense_accounting.sql`
- Production migration applied: `0225_reclassify_doctor_fee_normalization_dates.sql`
- Production migration applied: `0226_tenant_scoped_account_mappings.sql`
- Production deploy version: `030937e3-c9a9-4aef-b82c-3f8986e73a18`
- Automated tests: root 370 files, 10,740 tests passed; web 17 files, 76 tests passed
- Production build/deploy command: `pnpm build && wrangler deploy --env production` passed
- Focused direct-billing guard tests: direct billing and Billing Counter route suites passed; Billing Dashboard helper tests passed in the web package.
- Focused billing-finalization tests: shared bill-created accounting payload, admission extra payload, finalized commission item mapping, provisional invoice conversion, and IP discharge billing route coverage passed.
- Focused discharge billing guard tests: IP discharge, admission billing discharge, discharge planning, death discharge, and shared guard unit coverage passed.
- Focused diagnostic/reception finalization tests: lab order accounting, radiology order accounting, reception workflow, patient chart workspace, and bill-finalization unit coverage passed.
- Focused settlement/credit-note idempotency tests: stable request hashing, settlement replay/mismatch guards, and credit-note replay/mismatch guards passed.
- Focused financial UI contract tests: web TypeScript and web unit suites passed after credit-note and settlement page contract fixes.
- Focused refund/settlement authorization tests: receptionist credit-note refund denial, doctor settlement denial, reception discount denial, and existing settlement/credit-note regression tests passed.
- Focused direct income/expense posting tests: GL line builders, route event creation, and posted-income edit blocking passed.
- Focused non-pharmacy GL route tests: recurring expense, staff salary payment, HR payroll approval, legacy profit calculation, shareholder calculation, and dashboard monthly summary now pass against central accounting event/GL expectations.
- Production direct-billing manual-price smoke: authenticated direct bill creation with an uncatalogued manual line is rejected with HTTP 400 before bill mutation.
- Production active counter cleanup smoke: 0 active counter sessions remain after the direct-billing guard smoke.
- Focused patient financial report tests: patient due summary, deposit advance summary, and patient-wise advance report reconciliation surfaces passed.
- Focused refund/discount/cancellation report tests: credit note refund totals, settlement payment/deposit/discount totals, and cancellation event-vs-bill totals passed.
- Focused revenue report tests: department revenue GL reconciliation and doctor performance commission source/amount totals passed.
- Production department revenue smoke: `/api/reports/department-revenue` returned `totalGrossRevenue=3596336`, `glRevenue=3596336`, and `glDifference=0`.
- Production doctor performance smoke: `/api/reports/doctor-performance` returned `totalDoctors=29`, `totalVisits=39`, `totalRevenue=3527160`, and `totalCommissions=500`.
- Production credit-note report smoke: `/api/credit-notes?per_page=5` returned `totalCreditNotes=0`, `totalCreditAmount=0`, and `totalRefundAmount=0`.
- Production settlement report smoke: `/api/settlements?per_page=5` returned `totalSettlements=3`, `totalPayableAmount=191100`, `totalPaidAmount=181100`, and `totalDiscountAmount=10000`.
- Production cancellation report smoke: `/api/billing-cancellation` returned cancellation summary fields including accounting-event totals without 5xx errors.
- Production patient due report smoke: `/api/billing/due` returns `totalDue=890750`, matching the accounting audit patient receivable reconciliation.
- Production patient advance report smoke: `/api/deposits` and `/api/deposits/advance-report` both return `balance=115800`, matching the accounting audit deposit liability reconciliation.
- TypeScript check: `pnpm exec tsc --noEmit` passed
- Production billing-finalization deploy smoke: authenticated checks passed, 0 unbalanced verified accounting vouchers, 0 posted accounting events without voucher linkage, and all accounting posting events are posted.
- Production diagnostic/reception finalization deploy smoke: authenticated checks passed after deployment, 0 unbalanced verified accounting vouchers, and all accounting posting events are posted.
- Production settlement/credit-note idempotency deploy smoke: migration table exists, authenticated checks passed after deployment, 0 unbalanced verified accounting vouchers, and all accounting posting events are posted.
- Production financial UI contract deploy smoke: authenticated checks passed after deployment, 0 unbalanced verified accounting vouchers, and all accounting posting events are posted.
- Production refund/settlement authorization deploy smoke: authenticated checks passed after deployment, 0 unbalanced verified accounting vouchers, and all accounting posting events are posted.
- Production direct income/expense accounting migration: `0224_direct_income_expense_accounting.sql` applied successfully and seeded the `general_expense` mapping/event type support.
- Production doctor-fee normalization reclass migration: `0225_reclassify_doctor_fee_normalization_dates.sql` created immutable reversal/repost events so legacy migration adjustments no longer make today's accounting dashboard revenue negative.
- Production doctor-fee normalization reclass posting: 12/12 reclass events posted; `/api/accounting/audit-checks` returned `ok=true`.
- Production accounting dashboard revenue smoke after reclass: `/api/accounting/summary` returns today income `0`, today expense `0`, and MTD profit `30016`; `/api/accounting/income-breakdown` returns all non-negative MTD revenue source amounts.
- Production semantic mapping repair: `general_expense` now maps to `5990 General Operating Expense`; cross-tenant accounting mappings are 0 and verified vouchers remain balanced.
- Production non-pharmacy GL deploy smoke: authenticated checks passed after deployment, 0 unbalanced verified accounting vouchers, and all 187 accounting posting events are posted.
- Production finance endpoint smoke after GL report hardening: `/api/accounting/audit-checks` returned `ok=true`, `/api/accounting/summary` returned today income `0`, today expense `0`, today profit `0`, and MTD profit `30016`.
- Production GL report endpoint smoke after GL report hardening: `/api/dashboard/monthly-summary?month=2026-05`, `/api/profit/calculate?month=2026-05`, and `/api/shareholders/calculate?month=2026-05` all returned HTTP 200 using the same GL totals: income `40636`, expense `10620`, profit `30016`.
- Production ledger immutability trigger check: 4/4 required voucher/line triggers present
- Production doctor-fee normalization smoke: 0 scaled doctor master fees, 0 scaled appointment fees, 0 scaled marketplace booking fees, 0 scaled pending visit services, and 0 scaled doctor-visit invoice items remain.
- Production doctor-fee correction events: 6/6 `doctor_fee_normalization` events posted, 0 pending, 0 failed.
- Production accounting data integrity smoke: 0 unbalanced verified vouchers, 0 duplicate voucher numbers, 0 duplicate posting event keys, 0 orphan journal lines, and 0 posted events without voucher linkage.
- Production data cleanup: one stale discharged-patient pending `visit_services` row was cancelled with an audit log entry; discharge pending-service invariant is now 0.
- Production accounting audit: `/api/accounting/audit-checks` passed with `ok=true`; GL debit/credit stayed balanced at 7,128,702; patient receivable, deposit liability, doctor payable, and supplier payable subledgers match the GL.
- Production D1 accounting smoke: 0 unbalanced verified vouchers and 0 pending/failed accounting posting events.
- Production focused fiscal/accounting audit: 10/10 checks passed after allowing valid `PAYMENT`/`CANCEL`/`VIEW` general audit actions
- Production fiscal lock smoke: 33 closed fiscal years have 348 closed accounting period lock rows and 0 missing lock months
- Production authenticated role/browser smoke: passed
- Production inventory accounting smoke: 0 posted goods receipts without a verified accounting voucher
- Production doctor commission smoke: 0 paid doctor commission accruals without settlement journals, and 0 paid doctor commission accruals without settlement ids
- Production shareholder accounting smoke: event type CHECK includes shareholder events, 0 shareholder mappings missing, 0 shareholder payable mappings to salary payable, and 0 paid shareholder distributions without payment journals
- Production shareholder mapping smoke: `shareholder_payable` maps to `8350 Shareholder Dividend Payable`; `retained_earnings` maps to `9000 Retained Earnings`
- Production collection report smoke: authenticated accountant can load `/api/reports/daily-collection` and `/api/billing-handover/report/daily`, both return numeric reconciliation totals
- Production accounting report smoke: authenticated accountant can load `/api/reports/monthly-summary` and `/api/reports/balance-sheet`; unauthenticated report access is blocked by auth/role guard
- Production discharge billing smoke: 0 discharged admissions have in-admission pending provisional items, pending visit services, or open bill dues
- Production active counter smoke: no active session left after test
- Duplicate counter activation smoke: rejected with 409 and session was closed
- Direct billing bypass smoke: rejected with 409 when no active counter session exists
- Direct payment bypass smoke: rejected with 409 when no active counter session exists
- Billing Counter invoice bypass smoke: rejected with 409 when no active counter session exists
- Provisional invoice bypass smoke: rejected with 409 when no active counter session exists
- IP discharge bill bypass smoke: rejected with 409 when no active counter session exists
- Patient deposit collection bypass smoke: rejected with 409 when no active counter session exists
- Production schema smoke: `billing_deposits.counter_id` and `billing_deposits.counter_session_id` exist
- Settlement bypass smoke: rejected with 409 when no active counter session exists
- Cash-refund credit note bypass smoke: rejected with 409 when no active counter session exists
- Production schema smoke: `billing_settlements` and `billing_credit_notes` both contain `counter_id` and `counter_session_id`

## Remaining Gap Map

Priority P0 means real-hospital go-live blocker for non-pharmacy billing/accounting.

| Priority | Area | HMS state | Danphe parity target | Action |
|---|---|---|---|---|
| P0 | Billing flow consolidation | Counter, direct, provisional, IP discharge, reception OPD service bills, lab/radiology auto-bills, and patient-chart diagnostic quick bills now use the shared bill-finalization side-effect helper; counter/deposit cash flows enforce active counter sessions. Billing Counter invoices, payments, settlements, and credit notes now have retry idempotency. Each route still owns its own persistence batch. | Danphe-style transaction business layer for all invoice modes. | Continue toward a single invoice transaction contract for bill/items/payment/deposit/discharge writes. |
| P0 | Discharge billing sweep | IP discharge converts pending provisional items and financially pending bed segments, links deposits/payments to counter sessions, blocks due/provisional/service clearance bypasses including discharge-planning final discharge, and production audit checks no discharged pending billing rows. Shared discharge guard now covers both final-discharge blocking and IP discharge-bill provisional sweep mode. | Discharge bill must sweep all pending provisional/IP items, deposits, returns, and dues atomically. | Broaden return/refund/dues coverage and continue extracting remaining bed-close/discharge mutations into a shared reconciliation service. |
| P0 | Period lock enforcement | Main billing/counter/provisional/IP/deposit/settlement/credit-note/cancellation/manual-journal/direct-income/direct-expense/vendor-payment/gateway-verification/recurring-expense/staff-salary/payroll-approval/shareholder-dividend/admission-discharge/discharge-planning/death-discharge writes are guarded; fiscal close/reopen now syncs monthly lock rows. Remaining proof is final cross-route grep/audit for any obscure non-billing adjustment/admin path that can mutate money. | Posted/closed fiscal period cannot be mutated; reversals only. | Continue route-level grep audit for less-used adjustment paths, then add tests for any remaining writer found. |
| P0 | Report-to-ledger reconciliation | Accounting audit passes core ledgers; daily collection, handover, monthly GL summary, balance sheet, patient due, patient advance, credit note refund, settlement discount/payment, cancellation, department revenue, and doctor performance summary surfaces now have automated coverage. Remaining report work is broader UI drill-down QA and specialty reports outside the core non-pharmacy money flow. | Daily collection, due, advance, revenue, discount, refund totals match ledger/source journals. | Continue UI drill-down checks and specialty report reconciliation where real hospitals will use them operationally. |
| P1 | Ledger mapping by service item | Central event posting exists; mapping depth needs item/department parity review. | Billing item/service department maps to revenue ledger/subledger/cost center. | Compare `AccLedgerMappingController` and add missing mapping validation/UI if absent. |
| P1 | Counter handover reporting | Session tables exist; reporting UI may not expose cashier shift/handover detail fully. | Danphe cashier counter close and handover reports. | Add counter session report endpoint/page if not already reachable. |
| P1 | Refund/return approvals | Cancellation/credit note routes exist; credit-note UI now submits invoice-item returns against the backend contract. Credit-note refund issuance is finance-role guarded, while reception settlement discounts are blocked without finance approval. Remaining work is formal approval workflow UI/state if the hospital wants maker-checker instead of direct finance issuance. | Refunds and returns need permission, audit log, and reversal journals. | Add maker-checker approval workflow only if operationally required; continue reversal invariant tests. |
| P1 | Patient ledger UX | Patient ledger/report exists in accounting stack; billing screen may not expose complete patient financial history. | Danphe-style patient ledger with invoices, deposits, settlements, returns, credit. | Audit UI and add missing patient ledger drill-downs. |
| P2 | Pharmacy | Existing pharmacy is broad, but user marked it lower urgency. | Danphe pharmacy sales, purchase, return, supplier ledger, COGS parity. | Defer until non-pharmacy money flows are hardened. |

## Next Implementation Order

1. Broaden return/refund/dues coverage and continue extracting remaining bed-close/discharge mutations into a shared reconciliation service.
2. Continue toward a single invoice transaction contract for bill/items/payment/deposit/discharge writes.
3. Continue route-level period lock and reversal tests for any remaining less-used non-billing adjustment routes found by grep audit.
4. Add patient-ledger UI drill-down checks and specialty report reconciliation where real hospitals will use them operationally.

## Guardrail

Do not claim full Danphe parity from the current pass. The counter and accounting invariant slice is production-verified, but hospital-wide Danphe parity still needs the remaining P0/P1 work above.
