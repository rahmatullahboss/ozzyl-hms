# IPD Accounting Hardening Review — 2026-06-15

## Scope

This review covers the IPD/manual provisional billing accounting hardening branch:

- `migrations/0299_ipd_accounting_hardening.sql`
- `test/unit/ipd-accounting-hardening.test.ts`
- `package.json` production unit test script inclusion

The goal is to reduce financial-data risk around manual IPD charges, accounting idempotency, voucher numbering, and journal-line validity without performing a large route refactor.

## Problems reviewed

### 1. Duplicate accounting posting / voucher risk

The accounting posting code already uses source-event style idempotency, but database-level enforcement is still necessary because retries, concurrent posting, or future code changes can bypass application assumptions.

Hardening added:

- `ux_accounting_posting_events_tenant_source_event_key`
- `ux_accounting_vouchers_tenant_source_event_key`

Both are partial unique indexes with `WHERE source_event_key IS NOT NULL` so null legacy rows are not affected.

### 2. Voucher numbering race risk

Voucher numbers are application-generated. If two posting jobs read/increment the sequence concurrently, duplicate voucher numbers can silently slip through unless the database enforces uniqueness.

Hardening added:

- `ux_accounting_vouchers_tenant_fiscal_voucher_number`
- `ux_voucher_numbering_tenant_type_fiscal`

The voucher index uses `COALESCE(fiscal_year_id, 0)` so even unexpected null fiscal-year values are protected.

### 3. Manual IPD charge drift risk

Manual provisional billing already has route-level validation, but database-level protection is important for future route changes, imports, local-server sync issues, or direct writes.

Hardening added:

- insert trigger: `trg_billing_provisional_manual_category_insert`
- update trigger: `trg_billing_provisional_manual_category_update`

Manual rows are detected as `reference_id IS NULL` and active billable statuses. These rows must have:

- item description length >= 3
- controlled item category
- unit price > 0
- quantity > 0
- `created_by` present

Controlled categories currently allowed:

- `admission`
- `bed_charge`
- `consultation`
- `doctor_fee`
- `doctor_visit`
- `lab`
- `medicine`
- `operation`
- `pharmacy`
- `procedure`
- `radiology`
- `service`
- `test`
- `other`

### 4. Invalid journal-line risk

Application-level `validateJournalLines` already rejects unbalanced or double-sided lines, but the database should also reject invalid line rows.

Hardening added:

- insert trigger: `trg_accounting_journal_lines_amount_insert`
- update trigger: `trg_accounting_journal_lines_amount_update`

Each journal line must have exactly one positive side:

- debit > 0 and credit = 0
- or credit > 0 and debit = 0

## Test coverage added

`test/unit/ipd-accounting-hardening.test.ts` covers:

1. Migration filename/order safety
   - verifies `0299_ipd_accounting_hardening.sql`
   - verifies migration order `299`
   - verifies migration is classified as safe

2. Professional fee accounting
   - bill created lines remain balanced
   - doctor payable is credited
   - discount allowed is debited
   - receivable is debited
   - doctor-visit revenue is net of doctor payable

3. Payment/deposit accounting
   - cash payment reduces accounts receivable
   - deposit receipt credits patient-deposit liability
   - deposit adjustment debits liability and credits receivable

4. Journal validation
   - rejects unbalanced lines
   - rejects double-sided lines

5. Migration hardening checks
   - source-event unique indexes
   - voucher number unique indexes
   - manual IPD charge completeness triggers
   - journal-line database-boundary triggers

The new test is included in `test:production:unit`.

## Commands to run

```bash
pnpm test:production:unit
pnpm build:migrations
```

For a broader check:

```bash
pnpm test
pnpm test:integration
```

## Remaining recommendations

These are not included in this safe hardening patch, but should be considered next:

1. Move manual charge categories into a versioned control table instead of a trigger hard-coded list.
2. Add an admin UI/settings page for manual charge category mapping to accounting heads.
3. Add an integration test using an actual D1/local SQLite-compatible database if the project test stack supports it.
4. Add recovery tooling for partially posted vouchers if a runtime failure happens between voucher insert and journal-line insert.
5. Add concurrency/retry tests around voucher numbering once a D1 test harness is available.

## Review conclusion

The branch is safer now than the first patch:

- migration numbering follows the existing sequence
- manual charge validation is not category-only anymore
- database guards protect against duplicate source events, duplicate voucher numbers, invalid manual rows, and invalid journal rows
- tests now verify accounting behavior and migration guard structure

This should be reviewed and run in CI before merge.
