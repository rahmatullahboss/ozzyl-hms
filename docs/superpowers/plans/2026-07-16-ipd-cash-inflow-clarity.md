# IPD Cash Inflow Clarity Implementation Plan

## Goal

Make the IPD dashboard financially complete and unambiguous by treating today's total IPD money received as direct IPD bill payments plus new IPD deposits received today, while keeping deposit adjustments separate as settlement events.

## Scope

Files expected to change:

- `src/lib/ipd-finance-reporting.ts`
- `src/routes/tenant/ipBilling.ts`
- `test/integration/routes/ip-billing.test.ts`
- `web/src/pages/admin/widgets/IPDBillingOverview.tsx`
- `web/src/pages/admin/widgets/IPDBillingOverview.test.tsx`
- `web/src/pages/admin/widgets/ipdBillingCopy.ts`

## Tasks

### 1. Add backend failing tests

Add assertions that the stats response exposes:

- new deposits received today
- deposit receipt count
- deposit cash/non-cash split
- total IPD money received today
- per-activity-row deposit received today
- per-activity-row total money received today

Assert the SQL/reporting logic:

- includes only `transaction_type = 'deposit'` for new money received
- excludes `adjustment` from cash inflow
- associates admission deposits using tenant, patient and the standard admission-number remark
- does not fabricate invoice rows for unmatched deposits

### 2. Extend canonical IPD reporting

In `getIpdDailySnapshot`:

- query today's active deposit receipts using Bangladesh date handling
- calculate deposit received total, cash, non-cash and receipt count
- calculate total IPD money received as direct payment total plus new deposit total
- create a deposit-by-admission CTE from the standard `Admission deposit for <admission_no>` remark
- attach deposit received to invoice/admission activity rows
- expose row-level total money received as payment amount plus new deposit received

Keep deposit adjustments and settlement reconciliation unchanged.

### 3. Extend the stats API

Expose the new canonical fields from `/api/ip-billing/stats`, including zero-value fallbacks and existing backward-compatible direct-payment fields.

### 4. Add frontend failing tests

Verify that:

- the main collection card shows combined total money received
- the detail line shows direct bill payment and new deposit separately
- a deposit-only row shows the deposit as money received today instead of an apparently complete zero
- deposit applied remains a separate column/value

### 5. Update the IPD dashboard UI

- Rename the main collection card to “আজ IPD মোট টাকা গ্রহণ” or equivalent.
- Use total money received as the card value.
- Show direct bill payment, new deposit, cash and non-cash in the supporting line.
- Replace the table's ambiguous “আজ পরিশোধ” presentation with “আজ টাকা গ্রহণ”.
- Show total received prominently, with direct bill payment and new deposit as sub-lines.
- Keep “ডিপোজিট সমন্বয়” separate.

### 6. Verification

Run:

- targeted backend tests
- targeted frontend tests
- TypeScript typecheck
- full production build
- diff whitespace check

### 7. Review and integration

- Review the final diff for double counting, date handling, admission matching and backward compatibility.
- Commit the isolated branch.
- Update local `main` only with a clean fast-forward or cherry-pick.
- Never reset, force-push, delete or overwrite unrelated local main work.
