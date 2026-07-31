# IPD Credit Discharge Approval and Complete Financial Clearance Design

**Date:** 2026-07-19  
**Branch:** `feature/ipd-credit-discharge-approval`  
**Base:** `main@a4fc9e9ac`

## Goal

Make discharge financial clearance truthful and operationally safe:

1. Show the current IPD settlement and every other open patient invoice in the same discharge modal.
2. Keep normal discharge blocked while unresolved services or financial dues remain.
3. Allow an explicitly confirmed **credit discharge** that clinically discharges the patient immediately while financial approval remains pending.
4. Route the executed-pending request to the existing Approval Center for manager/admin/director/MD review.
5. Preserve the receivable after discharge and keep the action auditable; rejection must not reverse the clinical discharge.
6. Add a separate IPD laboratory-test print so paper requisitions can still be sent to the lab.

## Source-of-truth decisions

### Financial balance

The discharge screen must use the existing receivable authority layer:

- `legacy`: `bills` is authoritative.
- `shadow`: legacy remains authoritative while canonical projections are compared.
- `canonical`: `canonical_invoices.net_due_minor` is authoritative.

No new due ledger or duplicate invoice balance table will be introduced. The feature reuses:

- `resolveReceivableAuthority`
- legacy/canonical receivable adapters
- `canonical_source_mappings` when available
- existing settlement and collection workflows

### Clinical versus financial state

Clinical discharge and financial approval are separate:

- `admissions.status = 'discharged'` means the patient has left and the bed is released.
- `admissions.bill_status_on_discharge` records financial clearance:
  - `paid`
  - `credit_pending`
  - `credit_approved`
  - `credit_rejected`

A rejected post-facto request does not reactivate the bed or admission. It remains a management exception and open receivable.

### Approval authority

Use the existing `approval_requests` and `approval_events` tables with a new canonical type:

- `credit_discharge`

Review roles remain the current Approval Center roles:

- hospital admin
- manager
- director
- MD
- accountant

The requester cannot approve their own request.

## Discharge modal model

### Section A — Current IPD settlement

Show:

- provisional/package/bed charges
- discount
- available deposit
- deposit applied
- current IPD net payable/refund

### Section B — Other open invoices

Show each open invoice:

- invoice number
- invoice date
- source/category breakdown
- total
- paid/credited
- due
- canonical/legacy source identity internally

Source labels are derived from legacy bill category columns when mapped:

- laboratory/test
- consultation/OPD
- admission/IPD
- operation
- pharmacy
- other/mixed

Canonical-only invoices without a legacy mapping use canonical line/catalog classification when available; otherwise they are labelled `Other invoice` rather than guessed.

### Section C — Final patient position

Show separately:

- current IPD payable
- other invoice outstanding
- total payable before full clearance
- unresolved service amount

The header must never show `Ready` when other outstanding invoices exist.

## Actions

### Normal settlement and discharge

Normal discharge is permitted only when:

- unresolved visit-service amount is zero
- existing patient outstanding amount is zero at submission time
- the current final IPD bill is fully paid/deposit-adjusted or valid refund controls pass

When external dues exist, the UI exposes a collection action. Legacy/shadow tenants may use the existing patient settlement command for mapped legacy invoices. Canonical-only authority must fail closed until the canonical collect-payment command is mounted in main; the UI must not mutate legacy invoices behind canonical authority.

### Credit discharge

Credit discharge requires:

- explicit `discharge_mode = credit_pending`
- server-calculated due greater than zero
- reason
- expected payment date
- confirmation checkbox
- current due snapshot calculated again on the server

The atomic discharge batch must:

1. create the final IPD bill
2. record any current payment/deposit application
3. discharge the admission
4. release the bed to cleaning
5. set `bill_status_on_discharge = 'credit_pending'`
6. create one pending `credit_discharge` approval request
7. create an approval event
8. create in-app notifications for higher-authority users

The approval request snapshot includes:

- patient and admission
- current discharge invoice number and current bill due
- all other outstanding invoice identities and amounts
- total due
- reason and expected payment date
- requester/counter details
- confirmation acknowledgement

### Approval

Approve:

- approval request becomes approved
- admission financial status becomes `credit_approved`
- open invoices remain open until collected

Reject:

- approval request becomes rejected
- admission financial status becomes `credit_rejected`
- clinical discharge and bed release remain unchanged
- collection/action-center receivables remain open
- requester and management retain the audit trail for recovery/follow-up

## Package-covered tests

A package-covered item incorrectly billed as patient due is not a credit-discharge case. The modal exposes the invoice/category details so staff can identify it. Package reconciliation or an approved credit-note/billing correction must reduce the receivable before normal discharge.

This slice does not create automatic package credits because package eligibility and utilization must remain a separate, explicit billing correction workflow.

## Print behavior

### Normal discharge

Print the final discharge clearance showing fully settled status.

### Credit discharge

Print a discharge clearance with a prominent banner:

- `CREDIT APPROVAL PENDING`
- total outstanding across current and other invoices
- approval request number/id
- expected payment date
- not a fully settled receipt

### IPD laboratory test print

Add a dedicated running-IPD laboratory requisition print that includes only laboratory/test items, patient/admission/doctor details, and no unrelated bed/package/financial rows. It must remain usable before the LIS workflow is fully digital.

## Safety and concurrency

- All due values are recomputed on submit; UI values are informational only.
- Normal discharge fails if any due appears between modal load and submit.
- Credit request amount is the server snapshot, not a client-entered amount.
- Discharge bill, admission state, approval request, event, and notifications are committed in one D1 batch.
- Duplicate submission is prevented by active-admission state and one pending approval per admission.
- Approval review preserves separation of duties.
- Canonical authority never silently falls back to a legacy write.

## Non-goals

- Automatic write-off or credit note creation
- Automatic package-coverage adjudication
- Reversing a clinical discharge after approval rejection
- Replacing the canonical payment command being built in the canonical-data program
