# Smart Discount Policy Engine — Spec

Date: 2026-06-27
Status: Draft for implementation
Scope: Reception billing, visit service billing, appointment billing, IPD discharge billing, settlements, accounting, audit, and reporting.

## 1. Why this spec exists

The current discount allocation foundation is useful: the patient sees one total discount, while the system can internally split that discount into sources such as hospital discount, charity, management approved, reference discount, and doctor commission waiver. However, the current UI still feels manual and heavy for reception users. A final-grade hospital system should not force the receptionist to think like an accountant.

The next version should be policy-driven:

- Simple by default.
- Smart suggestions when discount is entered.
- Manual allocation only when required.
- Strict accounting and audit alignment.
- Separate benefit schemes for owner, VIP, staff, shareholder, charity, and doctor waiver.

## 2. Industry pattern summary

Across mature billing and ERP systems, discounts are usually not just free-text manual entries. They are governed by a combination of:

- Discount/coupon/promotion definitions.
- Eligibility rules.
- Effective dates.
- Customer/member/affiliation groups.
- Item/category applicability.
- Redemption or usage limits.
- Stacking/combinability rules.
- Approval thresholds.
- Accounting source mapping.

Healthcare also adds financial assistance/charity policies, eligibility documentation, and auditability. This means owner/VIP/staff/shareholder discounts should normally be modeled as benefit schemes or entitlement rules, not as random manual discount text.

## 3. Current system review

### Already good

- `bill_discount_allocations` table exists.
- Reception/service/final bill flows can send internal allocation rows.
- Print can remain clean and show only total discount.
- Accounting posting can split doctor waiver away from hospital discount expense.
- High discount reference name requirement already exists.
- Manager full reception access is supported.

### Gaps

- Advanced discount UI starts too manually.
- Empty allocation rows confuse receptionists.
- No auto-fill for remaining amount.
- No doctor waiver max cap from actual available doctor commission.
- Doctor waiver is not always linked to a specific doctor commission accrual row.
- Owner/VIP/staff/shareholder benefits are not yet linked to existing Billing Master schemes and patient/member eligibility rules.
- No source-wise approval matrix.
- No source-wise budget/cap controls.
- No reconciliation screen: bill discount total vs allocation total vs GL voucher.

## 4. Core design principle

The system should separate three concepts:

1. **Price entitlement / scheme**
   - A patient is eligible because of membership, owner relation, staff relation, shareholder relation, VIP status, corporate contract, campaign, charity approval, or doctor waiver.

2. **Discount application**
   - A specific bill receives a discount amount.

3. **Accounting funding source**
   - Who bears the cost: hospital, doctor commission payable, charity budget, management fund, staff welfare, owner/VIP benefit, shareholder benefit, corporate contract adjustment, etc.

The UI should show the minimum needed for the user, while the backend records all three layers.

## 5. Recommended discount sources

Keep source types controlled, not free text.

Required source types:

- `hospital_discount`
- `charity_discount`
- `doctor_commission_waiver`
- `management_discount`
- `reference_discount`
- `staff_benefit_discount`
- `vip_benefit_discount`
- `owner_benefit_discount`
- `shareholder_benefit_discount`
- `corporate_contract_discount`
- `campaign_discount`
- `rounding_adjustment`

Each source must have settings:

- Display name.
- Is active.
- Funding account / GL mapping.
- Requires approval.
- Requires reference name.
- Requires note.
- Requires attachment/document.
- Allowed roles.
- Max percent without approval.
- Max amount without approval.
- Applies to OPD / IPD / lab / radiology / pharmacy / procedure / consultation.
- Show on print? Default: false for internal sources.
- Counts as charity? Default: only `charity_discount`.
- Affects doctor commission? Only `doctor_commission_waiver`.
- Budget source, if any.

## 6. Benefit schemes: owner / VIP / staff / shareholder

Important current-system finding: Billing Master already has `billing_schemes`, `billing_sub_schemes`, `billing_price_categories`, and `billing_scheme_price_category_map`. Therefore, do not create a duplicate generic scheme module for pricing. Reuse Billing Master scheme as the **tariff/price entitlement layer**.

Best-practice split:

1. **Billing Master Scheme** = which tariff/price category or default discount rule applies.
   - Examples: General, Corporate, Insurance, Government, Staff, Shareholder, VIP, Owner, Charity.
2. **Scheme Membership / Eligibility** = which patient/person is allowed to use that scheme.
   - Examples: staff family member, shareholder family, VIP approved patient, corporate employee.
3. **Discount Allocation Source** = who funds the discount in accounting.
   - Examples: staff welfare, doctor commission payable, management concession, charity care.

So owner/VIP/staff/shareholder should not be typed manually on every bill. They should be connected to Billing Master schemes plus eligibility/member records, then the billing screen should suggest/apply them.

### 6.1 Scheme examples

#### Staff benefit scheme

- Eligible person: staff member and optionally spouse/children/parents.
- Eligibility source: linked staff profile + patient relationship.
- Discount: fixed percent or fixed amount.
- Department scope: OPD/lab/radiology/IPD/pharmacy configurable.
- Monthly/yearly cap: optional.
- Requires HR/admin approval above cap.
- Accounting source: staff welfare / employee benefit expense.

#### Shareholder benefit scheme

- Eligible person: shareholder and optionally family.
- Eligibility source: shareholder profile + patient relationship.
- Discount/cap controlled by board policy.
- Accounting source: shareholder benefit / management discount, depending on policy.
- Approval: usually management/MD approval above threshold.

#### Owner benefit scheme

- Eligible person: owner/director/family/approved guests.
- Should be rare and audited.
- Must never silently reduce revenue without source tag.
- Accounting source: owner benefit / director concession / management discount.
- Approval: owner/MD only or pre-approved whitelist.

#### VIP benefit scheme

- Eligible person: tagged VIP patient, partner, donor, special guest.
- Must have start/end date and approver.
- Optional per-service category rules.
- Accounting source: VIP benefit / management discount.
- Approval: required when manual override exceeds scheme.

#### Charity scheme

- Eligibility from charity application or one-time emergency approval.
- May include income/document/committee review fields.
- Can be presumptive for selected cases if hospital policy allows.
- Accounting source: charity care / social welfare.
- Should have report separate from normal discounts.

### 6.2 Data model extension using existing Billing Master schemes

Do not duplicate `billing_schemes`. Extend or attach policy/membership data to it.

Existing useful tables:

```sql
billing_schemes
- scheme_name
- scheme_code
- scheme_type
- default_discount_percent

billing_sub_schemes
- scheme_id
- sub_scheme_name
- discount_percent

billing_price_categories
- category_name
- category_code

billing_scheme_price_category_map
- scheme_id
- price_category_id
```

Recommended additions:

```sql
billing_scheme_policies
- id
- tenant_id
- scheme_id
- funding_source_type
- default_allocation_type
- discount_mode -- percent | fixed_amount | price_override | free
- discount_value
- max_amount_per_bill
- max_amount_per_month
- max_amount_per_year
- allowed_service_categories_json
- allowed_departments_json
- requires_approval_above_amount
- requires_approval_above_percent
- requires_note
- requires_document
- valid_from
- valid_until
- is_active
- created_by
- created_at
```

```sql
billing_scheme_members
- id
- tenant_id
- scheme_id
- sub_scheme_id
- patient_id
- staff_id
- shareholder_id
- relation_type
- eligible_person_name
- eligible_mobile
- starts_at
- ends_at
- approved_by
- status
- metadata_json
```

```sql
billing_scheme_usage
- id
- tenant_id
- scheme_id
- sub_scheme_id
- member_id
- bill_id
- allocation_id
- amount
- used_at
- created_by
```

This keeps Billing Master as the source of truth for schemes, while adding the missing hospital-grade eligibility, cap, approval, and usage tracking layers.

## 7. UI behavior — final design

### 7.1 Default simple mode

When receptionist enters a discount:

- Do not open multi-row editor automatically unless policy requires it.
- Show a compact source summary:

```text
Discount source: Hospital discount ৳50,000
[Advanced / Split]
```

If a patient has an eligible scheme:

```text
Eligible benefit found: Staff benefit — 25% up to ৳5,000
[Apply benefit]
```

### 7.2 Scheme selection and scheme code UI

Every payment/billing modal that accepts a discount must include a compact **Scheme / Benefit** panel above the discount input or directly below patient/doctor context.

Required UI elements:

```text
Scheme / Benefit
[Eligible scheme dropdown]  [Apply]
[Enter scheme/code/member ID] [Check]
```

Behavior:

- If patient has eligible schemes, show them first as cards/dropdown options.
- If patient is not pre-linked, allow manual scheme/code/member lookup.
- `Apply` calculates discount from Billing Master scheme/sub-scheme/default percent or mapped price category.
- Show a preview before applying:

```text
Staff Family Benefit
Eligible: Yes
Discount: 25%, max ৳5,000
Will apply: ৳5,000
Funding source: Staff welfare
[Apply benefit]
```

- If scheme/code is invalid, expired, inactive, not applicable to selected service category, or cap exceeded, block and explain.
- If a scheme requires approval, allow `Request approval` instead of direct apply.
- Manual discount can still exist, but scheme discount must be tagged with `scheme_id/sub_scheme_id/member_id` and allocation source.

Required coverage: this Scheme / Benefit panel must exist consistently in:

- Quick service bill modal.
- Visit service Pay Now/Create Bill modal.
- Final visit bill generation modal.
- Appointment booking/payment modal.
- IPD provisional/running bill payment modal.
- IPD discharge bill modal.
- Patient settlement/payment modal.
- Any future pharmacy/OT/procedure billing payment modal.

### 7.3 Advanced mode

Only show existing rows, not empty rows.

When advanced opens for the first time:

- Create one row with full discount amount.
- Default source should be suggested by context:
  - If doctor selected and doctor commission available: show quick action `Use doctor waiver`.
  - If patient has staff scheme: default source `staff_benefit_discount`.
  - If patient has shareholder scheme: default source `shareholder_benefit_discount`.
  - If patient has VIP tag: default source `vip_benefit_discount`.
  - Otherwise `hospital_discount`.

### 7.4 Add source behavior

`+ Add source` should auto-fill remaining amount.

Example:

- Discount total: 50,000
- Row 1: Hospital discount 20,000
- Click `+ Add source`
- New row amount auto-fills 30,000

### 7.5 Validation behavior

- Allocated total must equal total discount.
- Over-allocation is blocked.
- Negative or zero rows are ignored or blocked before submit.
- Doctor waiver cannot exceed available unpaid doctor commission.
- Scheme discount cannot exceed scheme cap.
- Manual source changes above threshold create approval request.

### 7.6 Print behavior

Patient copy/invoice should show only:

```text
Discount: ৳50,000
```

Do not show:

- Doctor waiver amount.
- Owner/VIP/staff/shareholder breakdown.
- Internal source notes.
- Approval metadata.

Internal admin/audit reports can show breakdown.

## 8. Backend rules

### 8.1 Allocation validation

For every bill or settlement with discount:

- If no allocation sent, auto-create one `hospital_discount` row for backward compatibility.
- If allocation sent, sum must equal discount amount.
- Each allocation type must be active and allowed for that workflow.
- The source may require reference/note/approval/document.

### 8.2 Doctor waiver validation

Doctor waiver should be valid only if:

- Bill has selected doctor or line item references doctor.
- Doctor has an eligible commission accrual or expected commission.
- Waiver amount <= available unpaid commission.
- Allocation row stores doctor_id and preferably commission_accrual_id.

Recommended behavior when waiver exceeds commission:

```text
Doctor waiver available: ৳8,000
Requested doctor waiver: ৳15,000
System blocks submit and suggests:
- Doctor waiver ৳8,000
- Remaining ৳7,000 hospital/management/charity discount
```

### 8.3 Scheme validation

For scheme-based discounts:

- Check patient membership eligibility.
- Check scheme validity date.
- Check service category applicability.
- Check per-bill/month/year cap.
- Create `benefit_scheme_usage` row.
- Create `bill_discount_allocations` row with scheme_id/member_id in metadata or real columns.

## 9. Accounting alignment

### 9.1 Recommended GL mapping

- `hospital_discount` -> Dr Discount Allowed / Sales Discount Expense
- `charity_discount` -> Dr Charity Care / Social Welfare Expense
- `management_discount` -> Dr Management Concession Expense
- `reference_discount` -> Dr Reference/Marketing Discount Expense
- `staff_benefit_discount` -> Dr Employee Benefit / Staff Welfare Expense
- `vip_benefit_discount` -> Dr VIP/Relationship Concession Expense
- `owner_benefit_discount` -> Dr Owner/Director Benefit or Management Concession Expense
- `shareholder_benefit_discount` -> Dr Shareholder Benefit / Management Concession Expense
- `corporate_contract_discount` -> Dr Contractual Allowance / Corporate Discount
- `doctor_commission_waiver` -> Dr Doctor Commission Payable
- Total discount -> Cr Accounts Receivable

### 9.2 Example voucher

Bill discount: ৳50,000

```text
Dr Staff Welfare Expense             10,000
Dr Doctor Commission Payable         15,000
Dr Management Concession Expense     25,000
Cr Accounts Receivable               50,000
```

### 9.3 Reconciliation requirement

Every finalized bill/settlement must pass:

```text
bill.discount_amount = SUM(bill_discount_allocations.amount)
SUM(discount-related GL debits) = total discount credited to A/R
```

Add admin report:

- Bill discount total.
- Allocation total.
- GL voucher total.
- Difference.
- Status: balanced/unbalanced.

## 10. Approval matrix

Suggested defaults:

| Source | Reception allowed | Manager allowed | Admin/MD approval |
| --- | --- | --- | --- |
| Hospital discount | up to configured threshold | higher threshold | above threshold |
| Doctor waiver | only up to available commission + doctor confirmation | same | above configured amount |
| Charity | small emergency only | yes with reason | above threshold |
| Management | no or small only | yes | above threshold |
| Reference | yes with reference name | yes | above threshold |
| Staff benefit | if scheme eligible | yes | over cap |
| Shareholder benefit | if scheme eligible | yes | over cap |
| Owner/VIP | if pre-approved | yes | usually required |

## 11. Audit events

Create audit log for:

- Discount entered.
- Advanced allocation opened.
- Allocation source changed.
- Scheme applied.
- Doctor waiver applied.
- Approval requested.
- Approval approved/rejected.
- Allocation edited after bill creation.
- Bill canceled/refunded and discount reversed.

## 12. Reports

Required reports:

- Daily discount by source.
- Discount by user/receptionist.
- High discount approval queue.
- Doctor waived commission report.
- Staff benefit usage report.
- Shareholder benefit usage report.
- VIP/owner concession report.
- Charity discount report.
- Discount reconciliation report.

## 13. Implementation recommendation

Do not make every discount source a manual dropdown only. Use this hierarchy:

1. Automatic scheme eligibility.
2. Suggested allocation.
3. Manual split only for advanced/exception cases.
4. Approval engine for policy exceptions.
5. Accounting reconciliation after finalization.

This will keep reception fast while keeping accounting and audit strong.

## 14. Billing Master enterprise review

Current Billing Master page already contains these modules:

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

This is a good foundation, but the current implementation is mostly basic CRUD. Enterprise billing master should act as a **billing control center / charge master / pricing engine**, not only a settings list.

### 14.1 Enterprise design principle

Billing Master should control:

1. What can be billed.
2. How much it costs.
3. Which tariff/scheme applies.
4. Which counter/department can bill it.
5. Whether discount/tax/commission applies.
6. Which GL account receives revenue.
7. Which approval rules apply.
8. How changes are versioned/audited.
9. How prices are imported/exported and reviewed.
10. How billing errors are prevented at reception.

Industry pattern: hospital systems treat the chargemaster/charge description master as the central billing catalog. It contains billable items/services, codes, list prices, and revenue-cycle controls. Modern pricing systems also separate list price, negotiated/corporate price, discount/promotion rules, eligibility, effective dates, and approval/validation layers.

### 14.2 Current gaps in Billing Master

#### Schemes

Current:

- Name, code, type, default discount percent.

Needs:

- Scheme class: general, insurance, government, corporate, staff, shareholder, owner, VIP, charity, campaign.
- Valid from/to.
- Default price category.
- Default allocation/funding source.
- Cap per bill/month/year.
- Applicable service departments/categories.
- Approval rules.
- Member eligibility rules.
- Scheme code/member ID validation.
- Usage report.

#### Price Categories

Current:

- Name, code, default flag.

Needs:

- Tariff level: general, cash, corporate, insurance, VIP, staff, emergency, night/weekend.
- Effective dates.
- Price priority.
- Price override rules.
- Rounding rules.
- Linked GL/revenue policy.
- Compare category prices.

#### Service Departments

Current:

- Name, code.

Needs:

- Department type: lab, radiology, consultation, procedure, OT, IPD, pharmacy, emergency, other.
- Revenue center / cost center.
- Default GL account.
- Counter visibility.
- Print group.
- Report group.
- Order/result workflow flags.
- Active/inactive with usage protection.

#### Service Items

Current:

- Name, code, department, price, allow discount, tax, description.

Needs:

- Item category/subcategory.
- Billing code / internal code / external code.
- Lab/radiology/procedure/consultation flags.
- Unit, quantity rules, min/max quantity.
- Price by price category/scheme.
- Effective date/versioned price history.
- Discount policy per item.
- Commission policy per item/doctor/referrer.
- Tax/VAT policy.
- Revenue GL account.
- Cost center.
- Package eligibility.
- Doctor-required flag.
- Report delivery/result required flag.
- Duplicate bill guard rules.
- Sample type and LIS mapping for lab items.
- Machine code / test code / specimen / container for diagnostics.
- Print name vs internal name.
- Bengali/English display names.
- Deactivation blocked if used in active package/order.

#### Fiscal Years

Current:

- Name, start/end/current.

Needs:

- Period locking.
- Month/quarter close.
- Backdated posting rules.
- Cashbook/accounting lock integration.
- Audit reason for reopening.
- Fiscal year tied to voucher numbering and reports.

#### Credit Organizations

Current:

- Organization name, code, contact, credit limit.

Needs:

- Corporate/insurance/government payer type.
- Agreement start/end.
- Allowed schemes/price categories.
- Credit limit and outstanding balance check.
- Claim submission workflow.
- Due aging policy.
- Co-pay/deductible/covered percentage.
- Pre-authorization requirement.
- Excluded services.
- Billing address/tax ID/contact persons.
- Contract documents.
- Auto-block when credit limit exceeded.

#### Packages

Current:

- Package name/code, total price, discount, type, description.

Needs:

- Package components/items.
- Included/excluded services.
- Included quantities.
- Bed days and extra day rules.
- OT/procedure/anesthesia/nursing/medicine inclusion rules.
- Package variance tracking.
- Package breakage/upgrade/cancel policy.
- Revenue allocation across departments.
- Package-specific doctor commission rules.
- Scheme/category-specific package price.
- Effective date/versioning.
- Print-friendly package summary.

#### Memberships

Current:

- Name/code/discount percent/description.

Needs:

- Decide relationship with Billing Master schemes: memberships should either become scheme members or be mapped to schemes.
- Patient membership enrollment.
- Member ID/card number.
- Validity period.
- Family/dependent rules.
- Usage cap.
- Renewal/expiry.
- Approval and document requirements.
- Benefit usage report.

#### Deposit Heads

Current:

- Name/code/description.

Needs:

- Deposit type: IPD advance, surgery advance, package advance, corporate advance, refundable security, non-refundable booking.
- Refund rules.
- Adjustment priority.
- GL mapping: liability vs income.
- Minimum required amount by workflow.
- Auto-suggest deposit during admission/procedure/package.
- Settlement and refund audit.

#### Counters

Current:

- Name/code/type/location/cash visibility mode.

Needs:

- Allowed departments/services.
- Allowed payment methods.
- Allowed users/roles.
- Shift rules.
- Opening/closing cash rules.
- Blind close vs normal close.
- Cash transfer/handover route.
- Max cash holding alert.
- Receipt numbering prefix.
- Printer/template mapping.
- Offline/local sync mode.

#### Referral Hospitals

Current:

- Hospital name/short code/status.

Needs:

- Referral type: referring hospital, partner center, collection center, corporate partner.
- Commission/discount/referral policy.
- Contact/address.
- Billing/settlement terms.
- Due/payout tracking.
- Allowed service categories.
- Agreement validity.
- Referral analytics.

### 14.3 New enterprise Billing Master modules to add

Add these tabs or submodules:

1. **Charge Master Dashboard**
   - total active items, inactive items, items missing GL, items missing category price, duplicate codes, high-risk changes.

2. **Price Matrix**
   - service item x price category x scheme price.
   - bulk edit/import/export.
   - effective date/versioning.

3. **Discount & Scheme Policy**
   - source-wise discount rules.
   - approval thresholds.
   - allowed roles.
   - scheme code/member validation.

4. **Commission Rules**
   - doctor commission by service/item/department/package.
   - referrer commission.
   - waiver policy.

5. **Tax/VAT Rules**
   - tax groups, item applicability, effective dates.

6. **GL Mapping**
   - revenue account, discount account, tax payable, deposit liability, package revenue allocation.

7. **Numbering Series**
   - invoice, receipt, refund, credit note, package, deposit, counter-wise prefix.

8. **Import/Export & Bulk Update**
   - CSV/Excel import with validation preview.
   - rollback support.

9. **Approval & Version Control**
   - draft -> review -> approved -> active.
   - maker-checker for price changes.
   - future-effective price changes.

10. **Audit & Impact Analysis**
   - who changed what.
   - before/after values.
   - affected open packages/schemes/orders.
   - usage count before deactivation.

### 14.4 Functional useability rule

Every Billing Master option must be connected to actual billing workflows:

- If a scheme exists, billing screens must allow scheme/member/code apply.
- If a price category exists, service price lookup must use it.
- If package exists, IPD/admission/package bill must consume package components.
- If credit org exists, patient/corporate bill must check credit limit and due aging.
- If deposit head exists, deposit/refund/settlement must map to it.
- If counter exists, receipts/cash drawer/shift close must use it.
- If referral hospital exists, discount/referral/commission reports must use it.
- If service item exists, it must carry revenue/discount/commission/tax/LIS metadata.

A setting that is not used in billing, accounting, audit, or reporting should not be exposed as a final feature.

### 14.5 Billing Master UI recommendation

Replace the flat tab-only page with a control-center layout:

```text
Billing Master
├── Overview / Health Check
├── Charge Master
│   ├── Departments
│   ├── Service Items
│   ├── Price Matrix
│   └── Import/Export
├── Pricing & Schemes
│   ├── Price Categories
│   ├── Schemes
│   ├── Sub-schemes
│   ├── Scheme Members
│   └── Discount Policies
├── Packages & Deposits
│   ├── Packages
│   ├── Package Components
│   └── Deposit Heads
├── Payers & Referrals
│   ├── Credit Organizations
│   ├── Insurance/Corporate Agreements
│   └── Referral Hospitals
├── Financial Controls
│   ├── GL Mapping
│   ├── Tax Rules
│   ├── Commission Rules
│   └── Numbering Series
└── Operations
    ├── Counters
    ├── Receipt Templates
    └── Audit / Version History
```

### 14.6 Enterprise validation rules

Before saving any Billing Master record:

- Code uniqueness per tenant.
- Required GL mapping for billable items before activation.
- Required department/category for service items.
- No negative price.
- Discount percent 0-100.
- Effective date cannot overlap for same item/category/scheme.
- One default price category only.
- Cannot deactivate an item used in active package or open order.
- Cannot activate package with no components unless explicitly marked fixed-price manual package.
- Cannot activate scheme without policy/mapping if it gives discount.
- Cannot exceed credit organization limit unless override approved.
- Every master change must create audit log.

### 14.7 Billing Master reports

Add reports:

- Charge master export.
- Missing GL mapping report.
- Price change history.
- Price matrix by scheme/category.
- Package profitability/variance.
- Corporate/credit utilization.
- Deposit liability report.
- Counter-wise billing controls report.
- Scheme usage report.
- Service item usage and revenue report.
- Inactive/unused items report.

### 14.8 Implementation priority

1. Billing Master overview/health-check.
2. Service item enterprise fields: category, GL, discount policy, commission policy, LIS/test metadata.
3. Price matrix by price category/scheme.
4. Scheme member/code apply flow in all billing screens.
5. Package components and package billing engine.
6. Credit org agreement/limit enforcement.
7. Deposit head GL/refund/adjustment logic.
8. Counter rules and receipt numbering.
9. GL/tax/commission mappings.
10. Import/export/versioning/audit.
