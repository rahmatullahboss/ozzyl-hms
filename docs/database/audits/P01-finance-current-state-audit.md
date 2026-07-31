# P01 Finance Current-State Audit

**Program:** HMS canonical database redesign

**Task:** Finance current-state support audit

**Branch:** `support/cdb-finance-current-state-audit`

**Audited base:** `18d1b0b4c156d40a6bcdd84c54a7ca13ae00886a`

**Audit date:** 2026-07-13

**Change class:** Documentation only; no runtime, schema, migration, tracker, `.ai-bridge`, or Cloudflare changes

## 1. Scope and method

This audit covers:

- bills and invoice items;
- patient payments, gateway collections, payment allocation behavior, settlements, deposits, refunds, and credit notes;
- direct income and expenses;
- counter sessions, employee cash transactions, drawer movements, custody projections, and the shadow cash ledger;
- doctor commission rules/accruals/settlements and diagnostic performer reserves;
- accounting posting events, vouchers, journal lines, and the legacy journal table.

The review used the canonical design/specification/master plan, `task-progress.yaml`, the schema and finance schema, migrations, route and helper writers, analytics, reconciliation helpers, and finance-focused tests. Static searches covered direct `INSERT`, `UPDATE`, and `DELETE` statements against the scoped tables under `src/**/*.ts`, plus Drizzle writes that do not appear as literal SQL.

The canonical contract used for comparison is explicit:

- issued invoice lines, not category totals, are the billing authority;
- `reference_id` without a type is prohibited;
- payment receipts, tenders, and persisted allocations are separate facts;
- deposits are liabilities with separate receipt/application/refund/reversal records;
- role-based compensation accruals are line-linked and settlements allocate to accruals;
- cash custody is separate from revenue recognition;
- source mutation and outbox event belong in one D1 batch;
- posted vouchers balance exactly in integer minor units.

See `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-spec.md:330-433`, `:435-559`, and `:630-680`.

## 2. Executive conclusion

The current finance model is functional but does not have one financial source of truth. It has several overlapping operational authorities and projections:

1. `bills` stores mutable category totals, total, paid, due, and status.
2. `invoice_items` stores charge detail, but its generic `reference_id` has different meanings by route.
3. `payments` stores receipt-like rows but has no tender split or persisted allocation table.
4. `income` is both a direct-income record and a duplicated reporting mirror of collections, credits, cancellations, and gateway payments.
5. `billing_deposits` is an event-like balance table, while deposit application also mutates `bills.paid` and may create separate cash rows.
6. credit notes mutate historical bill totals and paid values and also insert negative `income`.
7. doctor payable facts are represented across performer reserves, commission accruals, settlement headers, settlement items, and voucher links.
8. physical cash is represented across `emp_cash_transactions`, `cash_drawer_movements`, transfers, handovers, expenses, payouts, bank requests, and a non-blocking shadow `cash_ledger_entries` table.
9. accounting uses a newer event/voucher/line engine while the mutable legacy `journal_entries` table remains readable and administrable.

The most consequential gaps are:

- **No persisted payment allocations.** Collection analytics reconstruct allocations proportionally at query time; the result can change when invoice lines change and cannot trace a refund to an original allocation.
- **Mixed and ambiguous money representation.** The same business amount is stored as `REAL`, INTEGER-affinity decimal values, and duplicated integer/REAL columns. There is no enforced minor-unit contract.
- **Split transaction boundaries.** Many operations commit the operational rows and then create commissions, reserves, accounting events, vouchers, cash-ledger shadows, or audit rows afterward. A request can therefore succeed operationally while one or more projections are absent.
- **Multiple write APIs for the same fact.** General billing, provisional billing, appointment billing, diagnostic billing, IPD billing, gateway verification, settlement, deposit application, approvals, and cancellation routes all mutate the same financial tables with different side-effect sets.
- **Polymorphic identifiers are not type-safe.** `invoice_items.reference_id`, `billing_provisional_items.reference_id`, cash `reference_id`, and accounting `source_id` cannot be resolved without route-specific knowledge.
- **Accounting posting is recoverable but not atomic as a whole.** Voucher header, lines, subledger rows, and event state are separate steps; partial vouchers are explicitly possible and require recovery/manual review.

The redesign should therefore treat existing tables as migration sources and compatibility surfaces, not as a schema to incrementally bless as canonical without consolidation.

## 3. Current financial sources of truth

The term **effective authority** below means “the table currently consulted or mutated as the operational fact,” even when another table duplicates it.

| Domain fact | Current effective authority | Competing copies/projections | Current-state conclusion |
|---|---|---|---|
| Invoice identity and lifecycle | `bills` | module-specific billing state, `billing_credit_bill_status`, provisional rows | `bills` is the operational header authority, but status and financial totals are mutable cached fields. |
| Invoice charge detail | `invoice_items` | `billing_provisional_items`, IPD charge/ledger sources, diagnostic/order rows, category columns on `bills` | Line detail is closest to charge truth, but source identity is untyped and money columns do not share one representation. |
| Invoice category totals | `bills.test_bill`, `doctor_visit_bill`, `admission_bill`, `operation_bill`, `medicine_bill` | sums of `invoice_items` | Category columns are maintained by writers and used in accounting/reporting, but are not derivable with one stable category taxonomy. They must not remain authoritative. |
| Invoice paid/due/status | mutable `bills.paid`, `bills.due`, `bills.status` | `payments`, deposit adjustments, settlement discounts, credit notes, `billing_credit_bill_status` | Header values are caches updated by many paths; no allocation ledger proves them. |
| Patient receipt | `payments` for bill-applied collections | `billing_settlements`, gateway logs, `emp_cash_transactions`, deposit rows | A payment row is simultaneously treated as receipt and application. There is no receipt header/tender/allocation separation. |
| Payment allocation | none persisted | proportional analytics CTEs and application-level settlement loops | There is no authoritative allocation fact. This is a P0 migration gap. |
| Patient deposit balance | signed interpretation of `billing_deposits.transaction_type` | `bills.paid`, settlement header deposit total, cash rows | Deposit balance is computed as deposits minus refunds/adjustments. Application is not a typed allocation entity. |
| Credit/refund document | `billing_credit_notes` and `billing_credit_note_items` | direct mutations to `bills`, negative `income`, `emp_cash_transactions`, refund holds | The document exists, but its economic effects are spread across mutable copies. |
| Refund cash hold/approval | `billing_refund_cash_holds` plus approval workflows | credit note status, cash movement, accounting event | Separate workflow state exists, but it is not the refund allocation/tender authority. |
| Multi-bill settlement command | `billing_settlements` | generated `payments`, deposit adjustments, discount allocations, mutated bills | Settlement header duplicates component detail and uses custom allocation order rather than a shared allocation engine. |
| Direct non-patient income | `income` | accounting event/voucher | For explicitly entered direct income, `income` is the operational source before posting. For bill collections it is a duplicate and must cease to be authority. |
| Expense workflow | `expenses` | `cash_drawer_movements`, `expense_recoveries`, accounting event/voucher, shadow cash ledger | `expenses` appropriately contains approval/payment/recovery workflow, but money and posting/cash state are duplicated. |
| Counter cash collections | `emp_cash_transactions` for many patient flows | `cash_drawer_movements`, session summaries, shadow cash ledger | It is a broad cash-event table, not a complete custody ledger, and its reference ID is polymorphic. |
| Manual/custody drawer movement | `cash_drawer_movements` | employee cash rows, transfers, handovers, expense/payout rows | It records opening/in/out/drop and domain-linked cash, but overlaps other cash facts. |
| Cash location/custody overview | computed union in `cash-ledger-service.ts` | source tables and `cash_ledger_entries` | The overview is a projection over heterogeneous sources; categorization and de-duplication are application heuristics. |
| Candidate canonical cash event | `cash_ledger_entries` | all legacy cash sources | Migration `0369` explicitly introduces it as additive shadow storage; shadow failures do not fail the source command. It is not yet authority. |
| Commission rule | `doctor_commission_rules` and `diagnostic_performer_payout_rules` | service/provisional payable fields | Two rule models overlap and encode fixed/percent values differently. |
| Performer amount before assignment | `diagnostic_performer_reserves` | provisional doctor payable, later commission accrual | Reserve is a useful line/unit-linked fact, but it is a separate lifecycle and uses REAL money. |
| Doctor commission payable | `doctor_commission_accruals` | reserve rows, settlement items, provisional payables | The table contains both new integer fields and legacy/current REAL fields for the same economic amount. |
| Doctor payout | `doctor_commission_settlements` | settlement items, accrual statuses/settlement IDs, reserve status, cash movement, voucher IDs | Header, item, accrual, reserve, cash, and accounting state can diverge because not all paths use one atomic batch. |
| Accounting intake | `accounting_posting_events` | operational source rows | Correct candidate outbox, but many source writers create it after the source transaction. |
| Posted accounting document | `accounting_vouchers` + `accounting_journal_lines` | legacy `journal_entries`, compatibility triggers/views | New engine is the intended accounting authority; amounts remain REAL and posting is multi-step. |
| Legacy manual journal workflow | `journal_entries` | accounting vouchers and lines | Read, pending, verify, reject, and soft-delete paths remain. It must be retired after migration/reconciliation. |

Primary schema evidence: `src/db/schema/schema.ts:1030-1339`, `:2248-2300`, `:2783-2895`, `:3129-3144`, `:3805-3825`; `src/db/schema/finance.ts`; `migrations/0201_accounting_posting_core.sql`; `migrations/0213_billing_counter_sessions.sql`; `migrations/0369_cash_ledger_entries.sql`.

## 4. Money representation audit

### 4.1 Current representation by table family

| Table/family | Monetary columns | Declared representation | Problem |
|---|---|---|---|
| `bills` | subtotal/category totals/discount/tax/total/paid/due | mostly `REAL`; `co_payment_amount` INTEGER | Same invoice mixes REAL and INTEGER. Header arithmetic uses JS `Number` and two-decimal rounding rather than minor units. |
| `invoice_items` | unit price, line total, tax | unit/line INTEGER; tax REAL | Writers pass decimal currency values. INTEGER affinity does not establish that values are minor units; line and header columns therefore have incompatible declared meaning. |
| `payments` | amount | `REAL` | No scale constraint; amount is reused as receipt and allocation. |
| `income`, `expenses` | amount and thresholds | `REAL` | Bill-derived mirrors and direct entries cannot be compared exactly without tolerance. |
| deposits, credit notes, refund holds, settlements, handovers | all principal amounts | `REAL` | Balance calculations rely on `ROUND(..., 2)`, tolerances, and repeated subtraction. |
| counter sessions, employee cash, drawer movements, transfers | opening/expected/closing/variance/movement amounts | `REAL` | Physical cash reconciliation is tolerance-based and split across tables. |
| `cash_ledger_entries` | amount/expected/received/due/variance | `REAL` | The proposed shadow ledger repeats the legacy representation instead of satisfying the canonical minor-unit contract. |
| commission rules | `rate_value` | INTEGER in `doctor_commission_rules`; REAL in performer payout rules | One column means basis points for percent or a currency amount for flat rules. The second rule table allows REAL while checking percent against 10000. |
| commission accruals | gross/rate/flat/commission plus earned/waiver/payable/paid/balance/reserve | mixed INTEGER and REAL | The same accrual has duplicate amount families. Writers and reports select different columns. |
| performer reserves | service, discount, net, rate, reserve | `REAL` | Unit-level reserve math is rounded but not exact minor-unit arithmetic. |
| commission settlements/items | total/gross/deductions/net/item values | `REAL` | Settlement totals can differ from item/accrual sums by rounding or partial updates. |
| accounting voucher lines | debit/credit | `REAL` | Balance validation uses an epsilon/tolerance rather than exact equality. |
| legacy journal | amount | `REAL` | Older mutable journal model remains incompatible with exact minor-unit posting. |
| IPD ledger | debit/credit | `REAL` | Financial projection repeats floating-point amounts and can diverge from invoice/payment state. |

### 4.2 Concrete symptoms in code

- Gateway initiation permits `outstanding + 0.01` as a floating tolerance (`src/routes/tenant/payments.ts:200-210`).
- Gateway verification and credit-note approval repeatedly use `Math.round(value * 100) / 100` (`payments.ts:311-318`; `creditNotes.ts:383-390`).
- settlement allocation rounds every step and compares rounded totals (`src/routes/tenant/settlements.ts:280-286`, `:344-369`).
- cash ledger writes normalize to two decimals but store the result in REAL (`src/lib/cash-ledger-writer.ts:54-65`, `:105-159`).
- accounting re-reads REAL journal sums and accepts a balance tolerance (`src/lib/accounting-posting.ts:2342-2347`).
- commission migration `0391` deliberately combines integer fields with legacy/current REAL amounts (`migrations/0391_provisional_doctor_payables.sql:44-90`).
- performer reserve migration `0422` stores every service/reserve amount as REAL (`migrations/0422_diagnostic_performer_reserve_payout.sql:33-68`).

### 4.3 Required transformation

1. Define one currency exponent per tenant/currency and convert every financial amount to `*_minor INTEGER`.
2. Do not infer that current INTEGER-affinity values are already minor units. Profile actual values and writer semantics first.
3. Separate percentage basis points from flat money:
   - `rate_bps INTEGER` for percent;
   - `flat_amount_minor INTEGER` for fixed amount;
   - a checked `rate_type` selects exactly one.
4. Backfill from a deterministic decimal parser, not binary floating multiplication in ad hoc route code.
5. Record conversion exceptions for:
   - more than two decimal places;
   - non-finite or text values;
   - header/detail disagreement;
   - amounts outside safe application integer range;
   - negative values not belonging to an approved signed event type.
6. During dual-write, compare exact minor-unit values; do not use `0.01` or epsilon success thresholds.

## 5. Polymorphic identifier audit

### 5.1 `invoice_items.reference_id`

`invoice_items` has `reference_id` but no `reference_type`. Its meaning depends on the writer:

| Writer/context | Observed meaning |
|---|---|
| general bill creation | supplied `referenceId`, otherwise a service item ID (`src/lib/billing-create-batch.ts`; `src/routes/tenant/billing.ts`) |
| appointment invoice | provisional item reference, otherwise doctor ID (`src/routes/tenant/appointments.ts:782-800`) |
| lab invoice | lab order item, test/catalog/service item depending the lab path (`src/routes/tenant/lab.ts:1023-1093`, plus Drizzle inserts around `:3278-3305`) |
| radiology invoice | imaging/requisition/service item depending route (`src/routes/tenant/radiology/orders.ts:272-300`) |
| provisional finalization | copied from `billing_provisional_items.reference_id` (`src/routes/tenant/billingProvisional.ts:660-755`) |
| IPD billing | bed/day/round/charge/provisional source depending item category (`src/routes/tenant/ipBilling.ts:1290-1474`) |

`item_category` cannot safely disambiguate all of these. A join such as `reference_id = doctor.id` or `reference_id = lab_order_item.id` is therefore context-dependent and may accidentally match an unrelated row with the same integer ID.

### 5.2 `billing_provisional_items.reference_id`

The provisional table also has no type discriminator. It is used for appointment fees, operations/procedures, IPD rounds/charges, lab/radiology items, and service items. Finalization copies this ambiguity into invoice items.

### 5.3 Cash references

- `emp_cash_transactions.reference_id` is INTEGER interpreted by `reference_type`. Observed financial meanings include `bill`/`bill_payment`, `deposit`, `deposit_refund`, `credit_note`, `settlement`, and `payment_gateway`. The referenced row may therefore be a bill ID, deposit row/receipt context, credit-note ID, settlement ID, or gateway-log ID.
- `cash_drawer_movements.reference_id` is TEXT interpreted by `reference_type`. Observed financial meanings/aliases include `expense`, `expense_pending`, `petty_cash_expense`, `expense_recovery`, `doctor_commission_settlement`, `doctor_payout`, `doctor_commission_settlement_reversal`, `bank_deposit`, `bank_deposit_request`, `cash_custody_transfer`, `cash_transfer`, `counter_cash_transfer`, `billing_counter_cash_transfer`, `accepted_cash_transfer`, and `billing_handover`.
- The alias sets are not centralized: reporting code explicitly accepts multiple names for the same conceptual flow (`src/routes/tenant/dailyCollection.ts:579-590`, `:658-765`; `src/routes/tenant/shiftHandoverReport.ts:334-338`).
- `cash_ledger_entries` has both a primary generic `source_type/source_id` pair and another generic `reference_type/reference_id` pair.
- cash aggregation joins accounting events using these polymorphic values (`src/lib/cash-ledger-service.ts:337-387`, `:399-447`).

### 5.4 Accounting references

`accounting_posting_events` and `accounting_vouchers` use TEXT `source_type/source_id`, and the idempotency key is composed from source type, source ID, and event type (`src/lib/accounting-posting.ts:1293-1319`). Source IDs include numeric primary keys, receipt numbers, settlement IDs, and composite strings.

### 5.5 Required transformation

- invoice lines must link to a typed canonical `service_event_id` and optional typed catalog item ID;
- cash and accounting events may retain a type + stable public ID pair, but each type must be registered and validated;
- all migrations must map `(legacy_table, legacy_id)` to a stable canonical public ID;
- ambiguous `reference_id` rows must enter an exception table; no role/service inference by numeric coincidence is permitted.

## 6. Direct write-path inventory

This is the static inventory of scoped runtime and maintenance writers found at the audited base. A future cutover gate must prove each path is disabled, redirected, or protected by the canonical command layer.

### 6.1 Bills, invoice items, payments, and deposit application

| Writer | Entry point / operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/routes/tenant/billing.ts:970` | `POST /billing` | bill/items through `billing-create-batch`; idempotency state | Core invoice batch commits before reserves, commissions, accounting event, and audit. |
| `src/routes/tenant/billing.ts:1218` | `POST /billing/pay` | `payments`, `bills`, `income`, `emp_cash_transactions` | Core batch has no persisted allocations. Accounting event and other side effects are post-commit. |
| `src/routes/tenant/billing.ts:1533` | `PUT /billing/:id` | delete/reinsert invoice items; update bill | Edits an invoice model that may already be financially referenced. |
| `src/lib/billing-create-batch.ts` | shared bill creation helper | `bills`, `invoice_items`, `visit_services` | Batches core rows, but not all finance side effects. |
| `src/lib/billing-payment-state.ts:80-164` | conditional payment helper | Drizzle update of `bills` | Serializes only the cached bill state, not payment/outbox/cash rows. |
| `src/routes/tenant/billingProvisional.ts:660-755` | provisional finalization | `bills`, `invoice_items`, optional `payments`, `emp_cash_transactions`, deposit adjustments | Independent invoice/payment implementation. |
| `src/routes/tenant/appointments.ts:717-980` | appointment pay-now/credit invoice | provisional item, bill, invoice items, payment, employee cash, appointment status | Core batch followed by commission/reserve/accounting side effects. |
| `src/routes/tenant/lab.ts:1023-1093`, `:3278-3305` | diagnostic bill creation | `bills`, `invoice_items` | More than one lab billing implementation; reference semantics differ. |
| `src/routes/tenant/radiology/orders.ts:272-300`, `:521-535` | radiology bill create/update | `bills`, `invoice_items` | Mutates bill/item totals from radiology workflow. |
| `src/routes/tenant/ipBilling.ts:1290-1474` | IPD bill finalization/payment/deposit | `bills`, items, deposits, employee cash, payments | Large independent batch and category-specific source mapping. |
| `src/routes/tenant/reception.ts` | reception bill/deposit flows | deposits, bills, invoice items, commission updates | Parallel reception implementation found by static write scan. |
| `src/routes/tenant/pharmacy/advanced.ts:261-291`, `:557-587` | pharmacy deposit use and compensation | insert/delete deposit adjustment | Uses deletion as rollback/compensation for deposit application. |
| `src/routes/tenant/payments.ts:190` | gateway initiate | `payment_gateway_logs` | Amount is reserved only in gateway log; bill can change before verify. |
| `src/routes/tenant/payments.ts:246` | gateway verify | payment, bill, income, optional deposit, employee cash, gateway log | Financial batch is atomic internally; payment/deposit accounting events are inserted afterward. |
| `src/routes/tenant/settlements.ts:232` | multi-bill settlement | settlement, bills, payments, deposit adjustments, discount allocations, employee cash, outbox | Custom FIFO-by-bill allocation; no generic allocation rows. |
| `src/routes/tenant/settlements.ts:619` | settlement cancel | restores bills; deletes payments, deposit adjustments, employee cash, outbox; deactivates settlement | Destructive rollback removes financial history rather than posting reversals. |
| `src/lib/lab-cancellation-operation.ts` | lab item cancellation | invoice item, bill, commission accrual | Recalculates/mutates header and cancels accrual. |
| `src/routes/tenant/billingCancellation.ts` | bill/item cancellation | bill, items, reserves, negative income | Several cancellation paths mutate totals/status and create reporting reversals. |

### 6.2 Deposits, refunds, credit notes, and approvals

| Writer | Entry point / operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/routes/tenant/deposits.ts:411` | collect deposit | deposit, employee cash, accounting event, audit in batch; shadow cash ledger later | Good core batching, but canonical cash shadow is non-blocking. |
| `src/routes/tenant/deposits.ts:582` | refund deposit | refund row, employee cash, accounting event, audit in batch | Balance check is repeated in SQL, but no original tender link. |
| `src/routes/tenant/deposits.ts:806` | apply deposit to bill | adjustment row, bill paid/due/status, accounting event, audit | Employee cash transaction is post-batch/best-effort. No allocation row. |
| `src/routes/tenant/creditNotes.ts:165` | create credit note | credit note and item rows | Correctly preserves requested item detail but no allocation/tender linkage. |
| `src/routes/tenant/creditNotes.ts:327` | approve/payout credit note | status, bill totals, negative income, reserve cancellation, employee cash, accounting event | Status transition is outside the effects batch; rollback is compensating SQL. |
| `src/routes/tenant/creditNotes.ts:590` | reject credit note | status | Separate workflow transition. |
| `src/routes/tenant/approvals.ts` | refund/credit approval variants | credit notes/items, bills, negative income, refund cash holds, reserves/cash/accounting effects | Parallel approval implementation must be consolidated with `creditNotes.ts`. |
| `src/lib/billing-refund-cash-hold.ts` | refund cash hold helper | insert/update refund holds | Workflow-specific state, not refund allocation authority. |
| `src/routes/tenant/pharmacyReturns.ts` | pharmacy return cash | employee cash transaction | Separate refund/cash path. |

### 6.3 Income and expenses

| Writer | Entry point / operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/routes/tenant/income.ts:61` | create direct income | `income`, then accounting event, then audit | Three separate commits. |
| `src/routes/tenant/income.ts:111` | reverse direct income | accounting event only | Operational `income` row remains positive; reversal exists only in accounting. |
| `src/routes/tenant/income.ts:281`, `:334` | update/delete unposted income | update/delete `income` | Allowed only while no active posting event is found. |
| `src/routes/tenant/expenses.ts:257` | create expense | expense; optional drawer movement and outbox; later duplicate event helper/audit/shadow | Drawer-paid branch batches source/cash/outbox but then calls the event helper again using idempotency. Other branches insert only expense first. |
| `src/routes/tenant/expenses.ts:581` | edit unposted expense | update expense | Mutable before posting. |
| `src/routes/tenant/expenses.ts:641`, `:740` | approve/reject | expense; optional recovery rows/drawer movement | Approval, payment, and recovery are separate states, but not every accounting reversal is co-committed. |
| `src/routes/tenant/expenses.ts:887` | recover rejected expense cash | drawer movement, recovery row, expense recovery totals | Batched operational cash recovery; accounting treatment is not in the same batch. |
| `src/routes/tenant/expenses.ts:934` | execute approved expense | expense, drawer movement, outbox | Core is batched; helper queues posting and shadow write afterward. |
| `src/routes/tenant/accounting.ts:207` | accounting expense entry | `expenses` | Additional expense creation surface. |
| `src/routes/tenant/recurring.ts:224` | recurring expense materialization | `expenses` | Background creation path. |
| `src/scheduled.ts:80` | scheduled expense generation | `expenses` | Background writer outside interactive expense workflow. |
| `src/routes/tenant/hr/payroll.ts` | payroll expense path | `expenses` | Payroll-to-expense duplication; payable and payment semantics need separation. |
| `src/routes/tenant/staff.ts:314` | staff-related expense | `expenses` | Additional source requiring canonical command routing. |
| `src/routes/seed.ts:315-330` | seed/demo data | `income`, `expenses` | Non-production writer, still relevant to schema tests and fresh environments. |

### 6.4 Commission, performer reserve, and payout

| Writer | Entry point / operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/lib/billing-finalization.ts:121-160` | post-invoice side effects | reserve helper, commission helper, accounting event | Sequential after bill commit. |
| `src/lib/diagnostic-performer-reserve.ts:314-457` | create/cancel/reverse reserve | performer reserves | Useful unit-level idempotency, but separate from invoice transaction. |
| `src/lib/lab-finance.ts:379-1122` | accrue/waive/cancel commissions | commission accruals | Several rule/source variants and duplicate amount columns. |
| `src/lib/provisional-doctor-payables.ts:67` | provisional payable accrual | commission accruals | Another accrual source before/around invoice finalization. |
| `src/routes/tenant/commissions.ts:410` | approve accruals | update accrual status | Standalone update. |
| `src/routes/tenant/commissions.ts:473` | pay one accrual | settlement insert, accrual update, synchronous accounting, voucher link | Not one batch; settlement can be orphaned or accrual marked paid without complete accounting. |
| `src/routes/tenant/commissions.ts:580` | bulk settle accruals | settlement insert, accrual update, synchronous accounting, voucher link | Same split boundary; settlement items are not written by this path. |
| `src/routes/tenant/commissions.ts:840`, `:902` | other commission create/pay workflow | legacy/agent commission records and payment state | Separate commission model remains in the route. |
| `src/routes/tenant/receptionDoctorPayouts.ts:848` | pay performer reserves | settlement, paid accruals, settlement items, reserve status, drawer movement; accounting and shadow later | Stronger core batch than `commissions.ts`, but accounting/canonical cash remain after commit. |
| `src/routes/tenant/receptionDoctorPayouts.ts:1263` | pay approved doctor accruals from counter | settlement/items, accruals, drawer movement; accounting later | Second payout implementation for similar facts. |
| `src/routes/tenant/receptionDoctorPayouts.ts:537` | reverse performer settlement | drawer movement, accrual/reserve/settlement reversal; accounting reversal and shadow later | Operational reversal can commit before reversal voucher. |
| `src/routes/tenant/creditNotes.ts`, `billingCancellation.ts`, `lab-cancellation-operation.ts` | service refund/cancellation | reserve/accrual cancellation | Compensation reversal behavior is spread across billing workflows. |

### 6.5 Cash and custody

| Writer | Operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/lib/emp-cash.ts` | generic employee cash recorder | employee cash transaction | Called after some source batches with `.catch`, so cash projection may be missing. |
| bill/payment/deposit/settlement/IPD routes | patient cash in/out | employee cash transaction | Multiple transaction type/reference conventions. |
| `src/routes/tenant/expenses.ts` | petty cash out/recovery in | drawer movements | Expense is linked by polymorphic text reference. |
| `src/routes/tenant/receptionDoctorPayouts.ts` | doctor payout/reversal | drawer movements | Separate from employee cash table. |
| `src/routes/tenant/receptionDrawerCustody.ts` | opening/transfer/acceptance/custody | drawer movements and custody records | Cash location state spans several source tables. |
| `src/routes/tenant/bank-book.ts` | bank deposit and accounting events | drawer movement and outbox | Bank custody and GL posting use separate steps/records. |
| `src/lib/cash-ledger-writer.ts` | shadow canonical cash event | `cash_ledger_entries`, shadow issue table | `shadowCreateCashLedgerEntry` deliberately swallows failure and records an issue. |
| `src/lib/cash-ledger-service.ts` | cash read model | no writes; unions legacy sources | Source exclusions and type mapping are application heuristics, not DB-enforced uniqueness. |

### 6.6 Accounting and journal

| Writer | Operation | Direct scoped writes | Boundary notes |
|---|---|---|---|
| `src/lib/accounting-posting.ts:1297` | record outbox event | accounting posting event | Idempotent key is good, but source transaction often already committed. |
| `src/lib/accounting-posting.ts:2172-2367` | post event | event state, voucher header, journal lines, subledgers | Claim, header, line batch, validation, subledger batch, and final status are separate. Partial voucher state is handled, not prevented. |
| `src/lib/direct-finance-accounting.ts` | direct income/expense posting | accounting event; queued poster | Event follows operational write except where route manually co-batches it. |
| `src/lib/accounting-backfill.ts` | historical event backfill | accounting events | Multiple source-table backfill paths; must be checkpointed and reconciled. |
| `src/lib/accounting-recovery.ts` | recovery/requeue | accounting events | Administrative repair path. |
| `src/routes/tenant/journal.ts:137` | manual journal creation | event/voucher/lines through posting engine | New writes use canonical-style engine. |
| `src/routes/tenant/journal.ts:304`, `:367`, `:411` | delete/verify/reject legacy journal | update `journal_entries` | Legacy mutable workflow remains active/readable. |
| `src/routes/tenant/prescriptionFulfilment.ts:343` | prescription fulfillment accounting | accounting event | Additional operational outbox source. |
| domain routes listed above | bill/payment/deposit/refund/expense/settlement events | accounting events | Some events are in source batch; others are post-commit or wait-until. |

## 7. Payment allocation finding

### 7.1 No persisted allocation model

There is no `payment_allocations` table in the current schema. `payments.bill_id` directly attaches the full amount to one bill, while settlements and deposits also modify `bills.paid` without a common allocation record.

Executive reporting reconstructs collection by multiplying each payment by each invoice line's proportion of the bill's active line amount:

```text
allocated_amount = payment_amount * line_amount / SUM(active line_amount)
```

This exists independently in income, doctor, and test analytics. Example: `src/lib/executive-income-analytics.ts:95-167`; matching CTEs occur in `executive-doctor-analytics.ts` and `executive-test-analytics.ts`.

### 7.2 Consequences

- allocation is not auditable at collection time;
- changing/cancelling invoice lines can change historical reported allocation;
- rounding residuals are aggregated rather than deterministically assigned to a persisted row;
- a payment cannot be split across invoice lines according to cashier/payer intent;
- a refund cannot identify the original receipt tender and allocation;
- commission bases using “collected” can be recomputed differently from the original payment state;
- settlement code uses a separate sorted-bill allocation algorithm, so analytics and operational allocation rules are not one system.

### 7.3 Required target

Introduce `payment_receipts`, `payment_tenders`, and `payment_allocations` with immutable/reversing rows. Backfill legacy `payments` as one receipt + one tender + one invoice allocation where unambiguous. Deposit applications and settlement components must create the same allocation entity, not mutate `bills.paid` independently.

## 8. Duplication and divergence map

### 8.1 Bill duplication

- `bills.total` duplicates invoice line totals.
- category totals duplicate category aggregation of lines.
- `bills.paid/due/status` duplicate payment/deposit/discount/credit effects.
- `billing_credit_bill_status` duplicates paid/due/settlement state.
- credit-note and cancellation routes mutate the original bill instead of preserving an issued invoice plus adjustment applications.

### 8.2 Payment and income duplication

- a patient collection creates `payments`, increments `bills.paid`, inserts one or more `income` rows, creates employee cash, and creates an accounting event.
- gateway verification repeats the same pattern and can additionally create a deposit.
- `income` therefore mixes direct revenue events with mirrors of cash collection and negative reversal rows.

### 8.3 Deposit duplication

- a deposit receipt is a `billing_deposits` row, an employee cash row, an accounting event, and optionally a shadow cash-ledger row.
- a deposit application is another `billing_deposits` row and a direct increase to `bills.paid`; some paths also create employee cash semantics that do not represent new external cash.
- settlement headers repeat total deposit deduction while detail is spread across generated adjustment rows.

### 8.4 Credit/refund duplication

- credit-note header and items record the business document;
- bill total/paid/due/status are rewritten;
- negative `income` records a second reversal representation;
- employee cash records cash payout;
- performer reserves are cancelled;
- accounting event records the GL effect;
- refund holds/approval state may add another workflow representation.

### 8.5 Commission duplication

A single performer/referrer amount can appear as:

- provisional `doctor_payable_amount`;
- a performer reserve;
- integer `commission_amount`;
- REAL `earned_commission_amount`, `payable_commission_amount`, `paid_amount`, and `balance_amount`;
- settlement item amount;
- settlement header total/gross/net;
- cash movement amount;
- accounting voucher lines.

The `commissions.ts` and `receptionDoctorPayouts.ts` settlement paths do not write identical detail sets.

### 8.6 Cash duplication

Patient cash and cash-equivalent activity may be represented in employee cash, drawer movement, source document, session summary, custody transfer/handover, bank request/transaction, shadow cash ledger, and voucher. `cash-ledger-service.ts` constructs a unified read model by excluding reference types from one source and remapping event types from another (`src/lib/cash-ledger-service.ts:258-305`, `:316-447`). This is a useful reconciliation layer but not a uniqueness guarantee.

### 8.7 Accounting duplication

- accounting posting events contain serialized financial payloads that duplicate source amounts and dimensions;
- vouchers and lines materialize those payloads;
- legacy `journal_entries` remains in reads and pending/verification routes;
- compatibility migration `0371_legacy_vouchers_compat.sql` further bridges old/new behavior.

## 9. Transaction-boundary failures

### 9.1 Invoice issue can commit without compensation or accounting facts

General billing commits bill and lines, then calls performer reserve creation, commission accrual, and accounting event creation sequentially (`billing.ts:1130-1188`; `billing-finalization.ts:121-160`). A failure after the core batch leaves an issued invoice with missing accrual/outbox state and may leave idempotency pending.

**Required boundary:** invoice + typed lines + service links + applicable accruals + outbox + idempotency claim in one D1 batch.

### 9.2 Payment can commit without accounting event or diagnostic state

The main payment batch writes payment, bill cache, income, and employee cash; accounting/audit/diagnostic side effects run after commit and are logged on failure (`billing.ts:1309-1515`). Gateway verify similarly batches operational rows and inserts accounting events afterward (`payments.ts:322-433`).

**Failure state:** money received and bill marked paid, but no posting event; retry may see the payment as already processed and not reconstruct the missing event automatically.

### 9.3 Deposit application has incomplete cash semantics

Deposit adjustment batches deposit row, bill cache, outbox, and audit, but employee cash recording occurs afterward with `.catch` (`deposits.ts:915-1045`). More importantly, applying a liability is not new cash and should not depend on a generic employee cash transaction.

### 9.4 Credit-note approval uses compensating rollback, not one transition

The route first changes status to approved, then executes a batch of bill, income, reserve, cash, outbox, and audit writes. If the batch fails it attempts to restore the status (`creditNotes.ts:559-581`). A process interruption between status update and batch, or between batch failure and compensation, creates an inconsistent state.

### 9.5 Direct income and many expense paths split source/outbox/audit

Direct income inserts the row, then records an event, then writes audit (`income.ts:61-108`). Expense code is improved in drawer-paid/execute branches by co-batching the outbox, but other creation paths insert the expense alone and then call the accounting helper (`expenses.ts:302-445`).

### 9.6 Commission settlement is non-atomic in `commissions.ts`

Single and bulk settlement create a settlement header, update accruals, synchronously post accounting, then attach the voucher ID (`commissions.ts:473-572`, `:580-712`). Failures can leave:

- a settlement header with no accruals;
- paid accruals with no voucher;
- a posted voucher not linked back to settlement;
- no settlement items for the selected accruals.

The reception payout route has a stronger operational batch, but still posts accounting afterward (`receptionDoctorPayouts.ts:1096-1188`).

### 9.7 Payout reversal can commit without reversal journal

Performer payout reversal batches cash, accrual, reserve, and settlement changes, then creates/posts the reversal accounting event separately (`receptionDoctorPayouts.ts:647-796`). Operational status may be reversed while accounting remains unreversed.

### 9.8 Accounting posting admits partial vouchers

`postAccountingEventBySourceKey` inserts the voucher header, then batches lines, validates balance, batches subledger transactions, and finally marks the event posted (`accounting-posting.ts:2251-2366`). The recovery branch explicitly detects an existing partial/unbalanced voucher and requires manual review (`:2201-2238`). Database triggers prevent marking an event posted without a balanced voucher, but do not make header + lines + subledgers one transaction (`migrations/0300_accounting_posting_db_guards.sql`; `0356_accounting_posting_events_status_check.sql`).

### 9.9 Shadow cash ledger is allowed to diverge

`shadowCreateCashLedgerEntry` catches any error, logs a warning/issue where possible, and returns success to the business command (`cash-ledger-writer.ts:164-223`). This is valid only during pre-cutover shadow mode. It cannot be treated as reconciled authority until unresolved issue count is zero and canonical-only writes become blocking.

### 9.10 Destructive cancellation removes audit history

Settlement cancellation deletes generated payments, deposit adjustments, employee cash transactions, and posting events (`settlements.ts:619-756`). Canonical finance requires immutable source facts and reversing allocations/events, not deletion of completed financial history.

## 10. Reconciliation invariants

### 10.1 Canonical invariants to enforce

The following are the mandatory target equations:

```text
invoice.net_minor = SUM(active invoice line net_minor)
invoice.paid_minor = SUM(active net payment allocations)
invoice.due_minor = invoice.net_minor - paid_minor - active credit applications

receipt.total_minor = SUM(active tender amount_minor)
receipt.total_minor = SUM(active allocation amount_minor) + unallocated_minor

deposit balance = receipts - applications - refunds - reversals

practitioner payable = active accruals + adjustments - settlement allocations - reversals

drawer expected = opening + cash in - cash out - handovers + accepted adjustments

SUM(journal debit_minor) = SUM(journal credit_minor) for every posted voucher
```

### 10.2 Current-state invariants required before backfill

These checks must produce either zero rows or an explicitly accepted exception set:

1. every bill belongs to one tenant and every invoice item/payment/deposit/credit note resolves to the same tenant;
2. active invoice-item totals reconcile to the intended bill net amount under a documented legacy rule;
3. `bills.due = MAX(0, bills.total - bills.paid)` for states where discounts/deposits are already included in paid;
4. cached paid values reconcile to payments + deposit applications + settlement discounts/other explicitly classified adjustments;
5. no payment exceeds the current invoice outstanding balance unless a corresponding patient deposit exists;
6. deposit balance per patient is non-negative;
7. credit-note header total equals active credit-note item total;
8. approved credit/refund cash effects have exactly one custody movement and one accounting event;
9. expense payment status, drawer movement, recovery state, and accounting event agree;
10. each paid commission accrual belongs to exactly one active settlement allocation/item;
11. reserve, accrual, settlement, and payout cash amounts reconcile exactly after minor-unit conversion;
12. every accounting event in `posted` state has one balanced voucher;
13. no balanced voucher is orphaned from its source event unless explicitly classified as manual/opening/migration;
14. no unresolved cash-ledger shadow issue or coverage difference is accepted at cutover;
15. legacy journal entries are mapped, reversed, archived, or explicitly excluded before retirement.

## 11. Keep / Transform / Merge / Replace / Archive matrix

`Keep` means retain the business concept/table with tightening; `Transform` means migrate shape/semantics; `Merge` means consolidate into another canonical model; `Replace` means cease authority and route writes to a new table; `Archive` means read-only historical source after reconciliation.

| Current table/model | Disposition | Canonical destination / rationale |
|---|---|---|
| `bills` | **Transform** | canonical `invoices`; keep legacy key mapping and compatibility view. Header totals become minor-unit caches derived from lines/allocations/credits. |
| `invoice_items` | **Replace** | typed `invoice_lines` linked to service events/catalog items; archive untyped reference semantics after mapping. |
| bill category total columns | **Archive** | retain temporarily for compatibility/report comparison; never authoritative. |
| `payments` | **Transform** | backfill into payment receipt, tender, and allocation tables; compatibility view after cutover. |
| payment gateway logs | **Keep + Transform** | retain external interaction/audit; link to stable receipt/tender IDs and canonical idempotency. |
| `billing_deposits` | **Transform** | deposit account plus separate receipt/application/refund/reversal entries in minor units. |
| `billing_credit_notes` | **Keep + Transform** | canonical credit document linked to immutable invoice/line/service facts. |
| `billing_credit_note_items` | **Transform** | typed credit lines and credit applications. |
| `billing_refund_cash_holds` | **Merge** | refund workflow/approval state linked to canonical refund and custody event, not a parallel amount authority. |
| `billing_settlements` | **Transform** | retain settlement document if operationally needed; component detail becomes canonical receipts/tenders/allocations/deposit applications/discount applications. |
| `billing_credit_bill_status` | **Replace** | derive from canonical invoice lifecycle and allocations; archive after readers migrate. |
| `billing_provisional_items` | **Replace** | un-invoiced service-event projection; do not use as source authority. |
| `income` | **Archive** as bill authority; **Transform** for direct income | bill-derived rows become compatibility/reporting only; direct income becomes a typed operational event feeding accounting. |
| `expenses` | **Keep + Transform** | preserve approval/payment/recovery workflow; convert money to minor units and enforce source/cash/outbox atomic commands. |
| `expense_recoveries` | **Keep + Transform** | typed recovery allocation/cash event; link to reversal/accounting state. |
| `emp_cash_transactions` | **Merge** | migrate into canonical cash custody events or compatibility view; stop direct writes. |
| `cash_drawer_movements` | **Transform** | candidate custody movement source; normalize event types, stable source IDs, minor units, and uniqueness. |
| billing counter sessions | **Keep + Transform** | retain session authority; convert balances to minor units and derive expected cash from custody events. |
| transfers/handovers/bank deposit requests | **Merge** | canonical custody transfer events with explicit from/to location and acceptance/variance lifecycle. |
| `cash_ledger_entries` | **Transform** | promote only after money conversion, full source coverage, strict event registry, blocking writes, and zero shadow issues. |
| `doctor_commission_rules` | **Merge** | canonical compensation rule/version table with role, basis, BPS/flat minor fields, and non-overlapping scope. |
| `diagnostic_performer_payout_rules` | **Merge** | same canonical rule model; diagnostic scope is a dimension, not a separate money engine. |
| `diagnostic_performer_reserves` | **Merge** | role-based compensation accrual with performer-reserve stage/type, retaining line/unit provenance. |
| `doctor_commission_accruals` | **Transform** | canonical accruals with one money field family, rule snapshot, role, service event/invoice line, reversal lifecycle. |
| `doctor_commission_settlements` | **Transform** | settlement header in minor units; no duplicate voucher/cash IDs without enforced links. |
| `doctor_commission_settlement_items` | **Transform** | canonical settlement allocations to accruals; unique active allocation per accrual. |
| provisional doctor payable fields | **Replace** | projection of canonical accrual eligibility; no separate payable authority. |
| `accounting_posting_events` | **Keep + Transform** | canonical outbox; require same-batch source insertion and stable typed source ID. |
| `accounting_vouchers` | **Keep + Transform** | canonical immutable voucher header; exact minor-unit validation. |
| `accounting_journal_lines` | **Keep + Transform** | canonical immutable lines with debit/credit minor integers and exact balance. |
| accounting subledgers | **Keep + Transform** | derive in same posting transaction/command and reconcile to voucher lines. |
| `journal_entries` | **Archive** | map/reconcile old rows, disable mutations, expose compatibility read only, then archive. |
| `ipd_ledger_entries` | **Replace** as authority | rebuild as projection from service events, invoices, allocations, deposits, credits, and accounting. |

## 12. Staging-data checks required later

Run these on a restricted production clone before designing backfill assumptions. Preserve tenant-level counts and aggregate amounts; avoid PHI in reports.

### 12.1 Structural and foreign-key checks

```sql
PRAGMA foreign_key_check;

SELECT 'invoice_item_without_bill' AS issue, ii.tenant_id, COUNT(*) AS row_count
FROM invoice_items ii
LEFT JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
WHERE b.id IS NULL
GROUP BY ii.tenant_id;

SELECT 'payment_without_bill' AS issue, p.tenant_id, COUNT(*) AS row_count
FROM payments p
LEFT JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
WHERE b.id IS NULL
GROUP BY p.tenant_id;

SELECT 'credit_note_item_without_header' AS issue, i.tenant_id, COUNT(*) AS row_count
FROM billing_credit_note_items i
LEFT JOIN billing_credit_notes n
  ON n.id = i.credit_note_id AND n.tenant_id = i.tenant_id
WHERE n.id IS NULL
GROUP BY i.tenant_id;
```

### 12.2 Money precision and invalid-value profiling

Run the following pattern for every money column, including all bill, line, payment, deposit, credit, expense, cash, commission, reserve, settlement, and journal amounts:

```sql
SELECT tenant_id, COUNT(*) AS rows_with_sub_cent_value
FROM payments
WHERE ABS(amount * 100 - ROUND(amount * 100)) > 0.000001
GROUP BY tenant_id;

SELECT tenant_id, COUNT(*) AS negative_amounts
FROM payments
WHERE amount < 0
GROUP BY tenant_id;
```

A generated audit script should enumerate all scoped money columns and report:

- storage class via `typeof(column)`;
- minimum/maximum;
- null count;
- negative count;
- more-than-two-decimal count;
- values that would overflow the chosen application integer type after conversion;
- aggregate original decimal versus aggregate converted minor units.

### 12.3 Bill header versus line detail

```sql
WITH line_totals AS (
  SELECT tenant_id, bill_id,
         ROUND(SUM(CASE WHEN COALESCE(status, 'active') <> 'cancelled'
                        THEN COALESCE(line_total, unit_price * COALESCE(quantity, 1))
                        ELSE 0 END), 2) AS active_line_total
  FROM invoice_items
  GROUP BY tenant_id, bill_id
)
SELECT b.tenant_id, b.id AS bill_id, b.invoice_no,
       b.total, lt.active_line_total, b.discount, b.tax_total,
       ROUND(b.total - COALESCE(lt.active_line_total, 0), 2) AS difference
FROM bills b
LEFT JOIN line_totals lt ON lt.tenant_id = b.tenant_id AND lt.bill_id = b.id
WHERE ABS(b.total - COALESCE(lt.active_line_total, 0)) > 0.01;
```

This query is diagnostic only until the legacy meaning of `line_total`, discount, and tax is classified per writer.

### 12.4 Bill paid/due versus component facts

```sql
WITH payment_sum AS (
  SELECT tenant_id, bill_id, ROUND(SUM(amount), 2) AS amount
  FROM payments
  GROUP BY tenant_id, bill_id
),
deposit_app AS (
  SELECT tenant_id, reference_bill_id AS bill_id, ROUND(SUM(amount), 2) AS amount
  FROM billing_deposits
  WHERE transaction_type = 'adjustment' AND COALESCE(is_active, 1) = 1
  GROUP BY tenant_id, reference_bill_id
),
discount_app AS (
  SELECT tenant_id, bill_id, ROUND(SUM(amount), 2) AS amount
  FROM bill_discount_allocations
  GROUP BY tenant_id, bill_id
)
SELECT b.tenant_id, b.id, b.total, b.paid, b.due,
       COALESCE(p.amount, 0) AS payment_amount,
       COALESCE(d.amount, 0) AS deposit_applied,
       COALESCE(x.amount, 0) AS discount_applied,
       ROUND(b.paid - COALESCE(p.amount, 0) - COALESCE(d.amount, 0) - COALESCE(x.amount, 0), 2) AS unexplained_paid
FROM bills b
LEFT JOIN payment_sum p ON p.tenant_id = b.tenant_id AND p.bill_id = b.id
LEFT JOIN deposit_app d ON d.tenant_id = b.tenant_id AND d.bill_id = b.id
LEFT JOIN discount_app x ON x.tenant_id = b.tenant_id AND x.bill_id = b.id
WHERE ABS(b.due - MAX(0, b.total - b.paid)) > 0.01
   OR ABS(b.paid - COALESCE(p.amount, 0) - COALESCE(d.amount, 0) - COALESCE(x.amount, 0)) > 0.01;
```

Classify differences caused by credit notes, cancellations, historical settlement logic, or direct header edits rather than force-balancing them.

### 12.5 Receipt and idempotency duplicates

```sql
SELECT tenant_id, receipt_no, COUNT(*) AS duplicate_count, ROUND(SUM(amount), 2) AS total_amount
FROM payments
WHERE receipt_no IS NOT NULL AND TRIM(receipt_no) <> ''
GROUP BY tenant_id, receipt_no
HAVING COUNT(*) > 1;

SELECT tenant_id, idempotency_key, COUNT(*) AS duplicate_count
FROM payments
WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> ''
GROUP BY tenant_id, idempotency_key
HAVING COUNT(*) > 1;

SELECT tenant_id, external_transaction_id, COUNT(*) AS duplicate_count
FROM payments
WHERE external_transaction_id IS NOT NULL AND TRIM(external_transaction_id) <> ''
GROUP BY tenant_id, external_transaction_id
HAVING COUNT(*) > 1;
```

### 12.6 Deposit balance and duplicate receipt checks

```sql
SELECT tenant_id, patient_id,
       ROUND(SUM(CASE WHEN transaction_type = 'deposit' THEN amount
                      WHEN transaction_type IN ('refund', 'adjustment') THEN -amount
                      ELSE 0 END), 2) AS balance
FROM billing_deposits
WHERE COALESCE(is_active, 1) = 1
GROUP BY tenant_id, patient_id
HAVING balance < -0.01;

SELECT tenant_id, deposit_receipt_no, COUNT(*) AS duplicate_count
FROM billing_deposits
GROUP BY tenant_id, deposit_receipt_no
HAVING COUNT(*) > 1;
```

Also identify unknown `transaction_type`, applications with no bill, and refunds with no traceable original receipt.

### 12.7 Credit-note and refund reconciliation

```sql
WITH item_sum AS (
  SELECT tenant_id, credit_note_id, ROUND(SUM(total_amount), 2) AS item_total
  FROM billing_credit_note_items
  GROUP BY tenant_id, credit_note_id
)
SELECT n.tenant_id, n.id, n.credit_note_no, n.status,
       n.total_amount, n.refund_amount, COALESCE(i.item_total, 0) AS item_total
FROM billing_credit_notes n
LEFT JOIN item_sum i ON i.tenant_id = n.tenant_id AND i.credit_note_id = n.id
WHERE ABS(n.total_amount - COALESCE(i.item_total, 0)) > 0.01
   OR ABS(n.refund_amount - n.total_amount) > 0.01;
```

For each approved credit note, verify one classified accounting event, expected reserve/accrual reversal, and exactly one cash custody outflow when cash refund is non-zero.

### 12.8 Expense/cash/accounting consistency

```sql
SELECT e.tenant_id, e.id, e.amount, e.payment_status, e.cash_movement_id
FROM expenses e
LEFT JOIN cash_drawer_movements m
  ON m.id = e.cash_movement_id AND m.tenant_id = e.tenant_id
WHERE COALESCE(e.payment_status, 'unpaid') = 'paid'
  AND (e.cash_movement_id IS NULL OR m.id IS NULL);

SELECT e.tenant_id, e.id, e.amount
FROM expenses e
LEFT JOIN accounting_posting_events a
  ON a.tenant_id = e.tenant_id
 AND a.source_type = 'direct_expense'
 AND CAST(a.source_id AS TEXT) = CAST(e.id AS TEXT)
 AND a.event_type = 'direct_expense_paid'
WHERE COALESCE(e.payment_status, 'unpaid') = 'paid'
  AND a.id IS NULL;
```

Separate cash-paid from bank/non-cash expenses before treating missing drawer movement as an error.

### 12.9 Cash duplication and shadow coverage

At minimum compare, per tenant/day/source/reference:

- employee cash transaction count/amount;
- drawer movement count/amount;
- source document count/amount;
- `cash_ledger_entries` count/amount;
- unresolved `cash_ledger_shadow_issues`.

The existing `cash-ledger-service.ts` shadow coverage/backfill/readiness reports should be run and persisted. Cutover requires zero unexplained amount difference and zero blocked flow.

### 12.10 Commission and performer reserve checks

```sql
SELECT tenant_id, doctor_id, lab_order_item_id, COUNT(*) AS duplicate_count
FROM doctor_commission_accruals
WHERE source_type = 'lab_test' AND lab_order_item_id IS NOT NULL
GROUP BY tenant_id, doctor_id, lab_order_item_id
HAVING COUNT(*) > 1;

SELECT tenant_id, performer_reserve_id, COUNT(*) AS duplicate_count
FROM doctor_commission_accruals
WHERE performer_reserve_id IS NOT NULL
GROUP BY tenant_id, performer_reserve_id
HAVING COUNT(*) > 1;

SELECT a.tenant_id, a.id, a.commission_amount, a.earned_commission_amount,
       a.payable_commission_amount, a.paid_amount, a.balance_amount
FROM doctor_commission_accruals a
WHERE ABS(COALESCE(a.payable_commission_amount, a.commission_amount)
        - COALESCE(a.paid_amount, 0)
        - COALESCE(a.balance_amount, 0)) > 0.01;

SELECT r.tenant_id, r.id, r.status, r.commission_accrual_id, r.settlement_id
FROM diagnostic_performer_reserves r
LEFT JOIN doctor_commission_accruals a
  ON a.id = r.commission_accrual_id AND a.tenant_id = r.tenant_id
LEFT JOIN doctor_commission_settlements s
  ON s.id = r.settlement_id AND s.tenant_id = r.tenant_id
WHERE (r.status = 'paid' AND (a.id IS NULL OR s.id IS NULL))
   OR (r.status = 'reserved' AND (r.commission_accrual_id IS NOT NULL OR r.settlement_id IS NOT NULL));
```

Also compare settlement header total/gross/net to settlement-item and linked-accrual sums, and flag any paid accrual with no settlement item.

### 12.11 Accounting integrity

```sql
SELECT v.tenant_id, v.id, v.voucher_number,
       COUNT(l.id) AS line_count,
       ROUND(COALESCE(SUM(l.debit_amount), 0), 2) AS debit_total,
       ROUND(COALESCE(SUM(l.credit_amount), 0), 2) AS credit_total
FROM accounting_vouchers v
LEFT JOIN accounting_journal_lines l
  ON l.voucher_id = v.id AND l.tenant_id = v.tenant_id
WHERE v.status = 'verified'
GROUP BY v.tenant_id, v.id, v.voucher_number
HAVING line_count < 2 OR ABS(debit_total - credit_total) > 0.000001;

SELECT e.tenant_id, e.id, e.source_event_key, e.status, e.posted_voucher_id
FROM accounting_posting_events e
LEFT JOIN accounting_vouchers v
  ON v.id = e.posted_voucher_id AND v.tenant_id = e.tenant_id
WHERE e.status = 'posted' AND v.id IS NULL;

SELECT v.tenant_id, v.id, v.source_event_key
FROM accounting_vouchers v
LEFT JOIN accounting_posting_events e
  ON e.tenant_id = v.tenant_id AND e.source_event_key = v.source_event_key
WHERE v.source_event_key IS NOT NULL AND e.id IS NULL;
```

Repeat the balance check after converting to minor units and require exact equality, not rounded equality.

### 12.12 Polymorphic ID classification

Produce a tenant-scoped mapping report for every non-null:

- `invoice_items.reference_id` grouped by writer/category/source module;
- `billing_provisional_items.reference_id`;
- `emp_cash_transactions(reference_type, reference_id)`;
- `cash_drawer_movements(reference_type, reference_id)`;
- `accounting_posting_events(source_type, source_id, event_type)`.

For each observed type, record target table, successful match count, no-match count, multi-match count, and cross-tenant match count. Rows with no deterministic mapping go to an exception table.

### 12.13 Replay and idempotency rehearsal

On the staging clone:

1. run each backfill once and record scanned/created/skipped/exception counts;
2. rerun it without clearing target data;
3. require zero duplicate business insertions and stable aggregate minor-unit totals;
4. deliberately interrupt bounded chunks and prove restart from checkpoint;
5. replay accounting and cash shadow events and prove one canonical event per idempotency key;
6. preserve the reports with the migration run record.

## 13. Test coverage assessment

Existing tests provide useful contracts for:

- payment routes and concurrency (`test/payments.test.ts`, `test/concurrency.test.ts`);
- refund/credit-note approval and bill guards (`test/billing-refund-approval.test.ts`);
- invoice printing and deposit display (`test/billing-invoice-print.test.ts`);
- cent-level due edge cases (`test/reception-finance-audit.test.ts`);
- lab cancellation and commission cancellation (`test/lab-cancellation-workflow.test.ts`);
- accounting event idempotency, balance checks, and partial-voucher behavior (`test/unit/accounting-posting.test.ts`, `test/unit/ipd-accounting-hardening.test.ts`);
- accounting backfill (`test/accounting-backfill.test.ts`);
- counter-session cash summaries (`test/unit/billing-counter-session.test.ts`);
- cash-ledger shadow writer failure handling (`test/unit/cash-ledger-writer.test.ts`);
- performer reserve lifecycle and route contracts (`test/unit/diagnostic-performer-reserve-lifecycle.test.ts`, `test/unit/performer-reserve-lifecycle-route-contract.test.ts`);
- legacy voucher compatibility (`test/migration-legacy-vouchers-compat.test.ts`).

Material gaps:

1. no persisted allocation tests because the entity does not exist;
2. no end-to-end D1 test proving source + allocation + cash + outbox are one atomic business command;
3. no failure injection after every statement boundary for invoice, payment, refund, expense, and payout commands;
4. no property tests for integer minor-unit arithmetic, deterministic residual allocation, extreme values, or repeated reversals;
5. no staging-clone test suite for orphan, tenant-cross-link, money-conversion, and aggregate reconciliation;
6. many route tests assert SQL shape against mocks rather than executing the complete multi-table invariant;
7. no test proving every direct legacy writer is disabled after a domain cutover flag;
8. no test proving cash-shadow coverage is complete and unresolved issue count is zero before authority switch.

## 14. Required sequencing implications

1. **Do not start finance cutover by renaming current tables.** First add canonical minor-unit structures, typed source registries, exception tables, and compatibility mappings.
2. **Build one command layer before dual-write.** Invoice issue, payment collection, deposit application, refund, expense execution, and practitioner settlement each need one server-side command that owns calculations and D1 batch construction.
3. **Persist allocations before changing reports.** Shadow allocation rows must be compared with current proportional reports, then reports switch to persisted allocations.
4. **Consolidate compensation before payout cutover.** Merge rule semantics, normalize roles, backfill one accrual per line/practitioner/role/rule version, and make settlements allocate to accruals.
5. **Promote cash ledger only after coverage proof.** Convert to minor units, register source types, reconcile every source, resolve all shadow issues, then make canonical write failure blocking.
6. **Keep accounting outbox, replace its boundary.** Source mutation must insert the event in the same batch. Posting should use a transactionally safe design or an append-only staged voucher state that cannot be mistaken for posted.
7. **Retire by evidence.** Legacy `income`, employee cash, category totals, old journal rows, and direct writers move through shadowed → backfilled → reconciled → read-only → compatibility view → archived.

## 15. Audit result

**Result: READY FOR INTEGRATION as a current-state evidence artifact.**

This audit does not authorize runtime or migration changes by itself. The implementation owner should use it to build the finance source-of-truth registry, canonical table design, backfill exception model, transaction command boundaries, and staging reconciliation suite. No scoped legacy table is safe to declare canonical in its current form without the transformations above.
