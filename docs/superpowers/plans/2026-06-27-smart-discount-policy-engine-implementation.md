# Smart Discount Policy Engine — Implementation Plan

Date: 2026-06-27
Status: Ready for phased implementation
Related spec: `docs/superpowers/specs/2026-06-27-smart-discount-policy-engine.md`

## Goal

Upgrade discount handling from a manual allocation UI into a hospital-grade policy engine that supports:

- Smart default allocation.
- Remaining amount auto-fill.
- Doctor waiver max validation.
- Owner/VIP/staff/shareholder benefit schemes.
- Source-wise approval rules.
- Accounting-safe posting and reconciliation.
- Clean patient print output.

## Current files likely involved

### Frontend

- `web/src/components/reception/DiscountAllocationEditor.tsx`
- `web/src/pages/ReceptionDashboard.tsx`
- `web/src/components/reception/DischargeModal.tsx`
- `web/src/components/reception/ProvisionalBillingModal.tsx`
- appointment booking/payment modal components
- `web/src/lib/print/*`

### Backend

- `src/lib/discount_allocation.ts`
- `src/lib/accounting-posting.ts`
- `src/lib/billing-finalization.ts`
- `src/routes/tenant/billingCounter.ts`
- `src/routes/tenant/reception.ts`
- `src/routes/tenant/appointments.ts`
- `src/routes/tenant/ipBilling.ts`
- `src/routes/tenant/settlements.ts`
- `src/routes/tenant/receptionDoctorPayouts.ts`
- `src/db/schema/finance.ts`
- `tenant-schema.sql`

### Tests

- `test/discount_allocation.test.ts`
- `test/accounting-posting.test.ts`
- `test/integration/routes/billing-counter.test.ts`
- `test/integration/routes/reception.test.ts`
- `test/integration/routes/ip-billing.test.ts`
- `test/integration/routes/settlements.test.ts`
- new benefit scheme tests
- new doctor waiver cap tests
- new reconciliation tests

## Phase 1 — UI polish and smart allocation

### 1.1 DiscountAllocationEditor behavior

Change current editor behavior:

- Do not show multiple blank rows by default.
- When advanced opens, create one row with full discount amount.
- `+ Add source` must auto-fill remaining amount.
- Show quick summary when advanced is hidden:
  - `Discount source: Hospital discount ৳X`
  - or detected scheme/source if available.
- Add `Use remaining` button per row.
- Add source quick buttons:
  - Hospital
  - Doctor waiver
  - Management
  - Charity
  - Staff benefit
  - VIP/Owner/Shareholder if eligible.

Acceptance:

- A receptionist can enter discount and submit without touching allocation.
- Advanced split is optional and understandable.
- No empty pre-filled rows are shown.
- Allocation total mismatch blocks submit with clear message.

### 1.2 UI state model

Add helper functions:

```ts
createDefaultDiscountAllocation(totalDiscount, context)
appendDiscountAllocationWithRemaining(rows, totalDiscount)
getRemainingDiscountAmount(rows, totalDiscount)
suggestDiscountSource(context)
```

Context should include:

- selected doctor id
- doctor available waiver amount
- patient benefit eligibility
- selected services/categories
- billing workflow type

## Phase 2 — Doctor commission waiver hardening

### 2.1 Backend availability endpoint

Add endpoint:

```text
GET /api/tenant/discounts/doctor-waiver-availability?doctorId=&patientId=&billContext=
```

Return:

```json
{
  "doctorId": 12,
  "doctorName": "Dr. Aminul Islam",
  "availableWaiverAmount": 8000,
  "basis": "pending_commission_accruals",
  "accruals": [
    { "id": 101, "amount": 5000, "billId": 70 },
    { "id": 102, "amount": 3000, "billId": 71 }
  ]
}
```

### 2.2 Validation

In every backend bill finalization flow:

- If allocation type is `doctor_commission_waiver`:
  - require doctor id
  - calculate available commission
  - block if waiver > available
  - link allocation to doctor id and accrual id(s), or store accrual split metadata

### 2.3 Payout impact

Update doctor payout UI/API to show:

- earned commission
- waived commission
- payable commission
- paid
- balance

Acceptance:

- A doctor waiver cannot exceed unpaid commission.
- Doctor payout amount reduces correctly.
- Accounting voucher remains balanced.

## Phase 3 — Billing Master scheme policy and eligibility

Important: Billing Master already has `billing_schemes`, `billing_sub_schemes`, `billing_price_categories`, and `billing_scheme_price_category_map`. Do not create a duplicate scheme system. Reuse these tables as the core scheme/tariff source.

### 3.1 Migration

Add extension tables:

- `billing_scheme_policies`
- `billing_scheme_members`
- `billing_scheme_usage`

Optional additions to `bill_discount_allocations`:

- `scheme_id`
- `sub_scheme_id`
- `scheme_member_id`
- `policy_rule_id`
- `requires_approval`
- `approval_id`

If avoiding new columns initially, store scheme metadata in `metadata_json`, but real columns are better for reports.

### 3.2 Admin UI

Add discount/benefit settings page:

```text
Admin / Settings / Discount Policies
```

Sections:

- Discount sources
- Approval thresholds
- Benefit schemes
- Scheme members
- Budget/cap settings
- GL mappings

### 3.3 Benefit scheme types

Implement initial scheme types:

- staff
- shareholder
- owner
- vip
- charity
- corporate

### 3.4 Eligibility API

Add endpoint:

```text
GET /api/tenant/discount-policies/eligibility?patientId=&workflow=&serviceCategories=
```

Return:

```json
{
  "eligibleSchemes": [
    {
      "schemeId": 1,
      "type": "staff",
      "name": "Staff Family Benefit",
      "discountMode": "percent",
      "discountValue": 25,
      "maxAmountPerBill": 5000,
      "remainingMonthlyCap": 12000,
      "suggestedAmount": 5000,
      "allocationType": "staff_benefit_discount"
    }
  ]
}
```

### 3.5 Apply scheme UI

In every billing/payment modal that supports discount, add a `Scheme / Benefit` panel.

Required UI:

```text
Scheme / Benefit
[Eligible scheme dropdown] [Apply]
[Scheme/code/member ID input] [Check]
```

Behavior:

- Show compact card: `Eligible benefit found` when patient is already linked to a scheme.
- Button: `Apply benefit`.
- Manual lookup: receptionist can select a Billing Master scheme/sub-scheme or enter a scheme code/member ID.
- `Check` validates scheme status, patient eligibility, service category applicability, cap, and approval requirement.
- Show preview before applying: scheme name, discount percent/fixed amount, max cap, suggested amount, funding source.
- System calculates discount and allocation.
- If user manually changes discount above scheme cap, approval required.
- If scheme is not applicable, show a clear blocker message instead of silently applying hospital discount.

Required modal coverage:

- Quick service bill modal.
- Visit service Pay Now/Create Bill modal.
- Final visit bill generation modal.
- Appointment booking/payment modal.
- IPD provisional/running bill payment modal.
- IPD discharge bill modal.
- Patient settlement/payment modal.
- Future pharmacy/OT/procedure billing payment modal.

Acceptance:

- Staff/shareholder/VIP/owner discounts become auditable benefits.
- They are not mixed with generic hospital discount.
- Reports can show benefit usage.

## Phase 4 — Policy engine and approval workflow

### 4.1 Source policy engine

Create library:

```text
src/lib/discount-policy-engine.ts
```

Responsibilities:

- Resolve active source settings.
- Validate role and workflow permissions.
- Decide approval requirement.
- Validate reference/note/document requirements.
- Validate scheme caps.
- Return normalized allocation rows and approval state.

### 4.2 Approval states

Use states:

- `not_required`
- `pending`
- `approved`
- `rejected`
- `auto_approved`

### 4.3 Queue

Discount approval queue should show:

- bill no
- patient
- receptionist
- discount total
- allocation breakdown
- reason/source
- required approval reason
- approve/reject

Acceptance:

- Above-threshold discounts are not silently finalized unless policy allows.
- Manager/Admin can approve from a queue.

## Phase 5 — Accounting and reconciliation

### 5.1 GL source mapping

Extend accounting mappings for source-specific accounts:

- `discount_allowed`
- `charity_discount_expense`
- `management_discount_expense`
- `staff_benefit_expense`
- `shareholder_benefit_expense`
- `owner_vip_concession_expense`
- `corporate_contractual_allowance`
- `doctor_commission_payable`
- `accounts_receivable`

### 5.2 Posting behavior

For every finalized discount:

```text
Dr source-specific discount/benefit/commission account
Cr accounts receivable
```

For bill cancel/refund:

```text
Reverse same lines
```

### 5.3 Reconciliation job/report

Add report:

```text
Reports / Finance / Discount Reconciliation
```

Checks:

- bill.discount = allocation total
- allocation total = GL discount debit total
- doctor waiver total = doctor commission payable reduction
- scheme usage total = allocation scheme total

Acceptance:

- Admin can detect mismatches.
- No hidden discount leakage.

## Phase 6 — Appointment/IPD/settlement coverage

Apply the same policy engine to:

- appointment booking and payment
- IPD discharge billing
- IPD provisional/running bill settlement
- patient settlements
- credit/refund reversal

Acceptance:

- Same discount behavior everywhere.
- Print remains clean everywhere.
- Internal accounting remains source-wise.

## Phase 7 — Test plan

### Unit tests

- default allocation row
- remaining amount auto-fill
- source suggestion
- doctor waiver max validation
- scheme cap validation
- approval requirement decision
- GL mapping by source

### Integration tests

- billing counter with scheme discount
- visit service bill with split discount
- final bill with doctor waiver cap
- appointment discount with scheme
- IPD discharge discount with split source
- settlement discount with allocation
- cancel/refund reversal
- reconciliation report

### Build/tests

Run:

```bash
npm run build:migrations
npm run build:web
npm test -- test/discount_allocation.test.ts test/accounting-posting.test.ts
npm test -- test/integration/routes/billing-counter.test.ts test/integration/routes/reception.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/settlements.test.ts
npm test
```

## Deployment note

Do not deploy until:

- migration build passes
- web build passes
- full test suite passes
- demo hospital flow manually checked:
  - quick service bill
  - visit service pay now
  - final bill
  - discharge bill
  - print output
  - doctor payout impact

## Recommended immediate next implementation

Start with Phase 1 and 2 only:

1. Improve current `DiscountAllocationEditor` UX.
2. Add auto-fill remaining amount.
3. Add default single row only.
4. Add doctor waiver availability/cap endpoint.
5. Block doctor waiver above available commission.
6. Add tests.

Then move to benefit schemes as Phase 3.

## Phase 8 — Billing Master enterprise upgrade

### 8.1 Current Billing Master modules reviewed

Current page has:

- Schemes
- Price Categories
- Service Departments
- Service Items
- Fiscal Years
- Credit Organizations
- Packages
- Memberships
- Deposit Heads
- Counters
- Referral Hospitals

The implementation is mostly CRUD. Upgrade it into a Billing Master control center.

### 8.2 Phase 8A — Billing Master overview / health check

Add an overview dashboard at the top of Billing Master:

- active service items
- inactive service items
- duplicate item codes
- items missing department
- items missing GL mapping
- items missing price-category mapping
- packages missing components
- active schemes without policy
- credit orgs over limit
- counters without receipt series
- recent price changes

Implementation:

- Add backend endpoint: `GET /api/billing-master/health-check`.
- Add frontend `Overview` tab/card.
- Add quick links to fix each issue.

Acceptance:

- Admin can immediately see unsafe billing master configuration.

### 8.3 Phase 8B — Service Items / Charge Master hardening

Add fields to service items:

- item category/subcategory
- internal code, billing code, external code
- print name
- Bengali/English names
- unit and quantity rules
- minimum/maximum quantity
- default revenue GL account
- discount policy
- tax/VAT policy
- doctor commission policy
- referrer commission policy
- package eligibility
- doctor-required flag
- result/report-required flag
- LIS/test metadata: sample type, specimen, container, machine code, test code
- effective date and price versioning

Backend:

- Add migrations for missing fields or related tables.
- Add validation: cannot activate without required revenue/department mapping.
- Add usage protection: cannot deactivate if used in active order/package without replacement.

Frontend:

- Convert service item form to sections:
  - Basic Info
  - Pricing
  - Billing Rules
  - Accounting
  - Commission
  - Diagnostics/LIS
  - Print/Display
  - Audit

Tests:

- service item required fields
- duplicate code guard
- deactivate used item blocked
- LIS metadata saved

### 8.4 Phase 8C — Price Matrix engine

Add Price Matrix module:

```text
service item x price category x scheme/sub-scheme
```

Features:

- grid view
- bulk edit
- import/export CSV/Excel
- effective from/to
- future price changes
- rollback previous version
- comparison view

Backend tables:

- `billing_item_prices`
  - tenant_id
  - item_id
  - price_category_id
  - scheme_id
  - sub_scheme_id
  - price
  - effective_from
  - effective_to
  - status
  - approved_by
  - created_by

Pricing lookup order:

1. exact item + scheme + sub-scheme + price category
2. item + scheme + price category
3. item + price category
4. item base price

Acceptance:

- Billing screens no longer rely only on base `service_items.price` when category/scheme applies.

### 8.5 Phase 8D — Schemes, memberships, and policy integration

Unify current schemes and memberships:

- Billing Master `billing_schemes` remains source of truth.
- Memberships should map to scheme members or become a member type under schemes.
- Add member eligibility and code lookup.

Add tables:

- `billing_scheme_policies`
- `billing_scheme_members`
- `billing_scheme_usage`

Add UI:

- Scheme details page
- Sub-schemes
- Policy/cap rules
- Members
- Usage
- Apply/test simulator

Acceptance:

- Staff/VIP/owner/shareholder/corporate/charity scheme can be applied from payment modals.
- Manual code/member lookup works.
- Scheme usage is recorded.

### 8.6 Phase 8E — Package engine

Upgrade packages from fixed price only to component-based packages.

Add:

- package components
- included quantities
- excluded services
- bed-day rules
- extra day rules
- OT/procedure/anesthesia/medicine inclusion flags
- package upgrade/cancel/breakage rules
- revenue allocation rules
- package doctor commission policy
- package price by scheme/category

Backend tables:

- `billing_package_items`
- `billing_package_price_matrix`
- `billing_package_usage`
- `billing_package_variance`

Billing behavior:

- When package selected, included items should not double-charge.
- Extra quantity should bill at configured extra rate.
- Package variance report should compare package price vs consumed services.

Acceptance:

- IPD/admission package billing becomes predictable and auditable.

### 8.7 Phase 8F — Credit organizations / corporate agreements

Upgrade Credit Orgs to payer/contract management.

Add fields:

- payer type: corporate, insurance, government, NGO, panel
- agreement start/end
- allowed schemes/price categories
- credit limit
- outstanding balance
- due aging policy
- co-pay/deductible/covered percent
- pre-authorization requirement
- excluded services
- billing address and tax info
- contract attachment

Behavior:

- Block/approval when credit limit exceeded.
- Show outstanding balance when selecting credit org.
- Generate due/claim reports.

Acceptance:

- Corporate/credit billing cannot exceed policy silently.

### 8.8 Phase 8G — Deposit Heads

Upgrade deposit heads to financial-control records.

Add fields:

- deposit type
- refundable/non-refundable
- GL account: liability or income
- adjustment priority
- refund approval requirement
- minimum amount by admission/package/procedure

Behavior:

- IPD admission suggests required deposit.
- Settlement adjusts deposits by priority.
- Refund follows policy and approval.

Acceptance:

- Deposit ledger reconciles with accounting liability.

### 8.9 Phase 8H — Counters and receipt controls

Upgrade counters:

- allowed users/roles
- allowed departments/services
- allowed payment methods
- shift rules
- cash visibility mode
- cash holding limit
- receipt/invoice numbering prefix
- printer/template mapping
- offline/local sync mode

Acceptance:

- Counter settings actually control billing, cash drawer, receipt, shift close, and reports.

### 8.10 Phase 8I — Referral hospitals and referral policy

Upgrade referral hospitals:

- referral type
- agreement validity
- allowed service categories
- commission/discount policy
- settlement terms
- contact/address
- due/payout tracking

Acceptance:

- Referral hospital selection drives referral analytics, discount source, commission/payout, and reports.

### 8.11 Phase 8J — Financial controls inside Billing Master

Add submodules:

- GL Mapping
- Tax/VAT Rules
- Commission Rules
- Numbering Series
- Receipt/Print Template Mapping

Acceptance:

- Every billable service has revenue account.
- Every discount/benefit source has expense/payable account.
- Every deposit has liability/income mapping.
- Every receipt has correct numbering series.

### 8.12 Phase 8K — Import/export, audit, versioning

Add:

- CSV/Excel import/export
- validation preview before import
- dry-run mode
- rollback batch
- maker-checker approval for price changes
- future-effective price changes
- audit log with before/after values

Acceptance:

- Large hospitals can safely maintain thousands of charge items.

### 8.13 Billing Master implementation order

Recommended order:

1. Health-check dashboard.
2. Service item enterprise fields + validation.
3. GL mapping and discount/commission policy hooks.
4. Price Matrix.
5. Scheme/member/code apply integration.
6. Package components engine.
7. Credit org contract enforcement.
8. Deposit head financial policy.
9. Counter controls and numbering series.
10. Referral hospital policy.
11. Import/export + audit/versioning.

### 8.14 Extra test coverage

Add tests for:

- billing master health-check
- service item activation validation
- price matrix lookup fallback
- scheme/member/code application
- package included/excluded item billing
- credit limit blocking
- deposit liability mapping
- counter receipt prefix and payment method restriction
- referral hospital commission/discount policy
- audit log for every master change
