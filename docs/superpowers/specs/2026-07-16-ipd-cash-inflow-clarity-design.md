# IPD Cash Inflow Clarity Design

Date: 2026-07-16
Status: Approved direction — Option A

## Problem

The IPD dashboard currently treats direct bill payments as the only “IPD collection” amount. New admission deposits received on the same day are excluded from the headline amount, even though they are real cash inflow. In the invoice activity table, a patient can therefore have a new deposit received today but still show “Paid today = 0”, which is misleading.

Deposit receipt and deposit adjustment are also different financial events:

- A deposit receipt is new money received from the patient today.
- A deposit adjustment is previously received deposit applied against a finalized bill; it is not new cash inflow.

## Approved Financial Meaning

The primary IPD collection card will represent **total IPD money received today**:

`direct bill payments received today + new deposits received today`

For the production example on 2026-07-16:

- Direct IPD bill payment: ৳33,900
- New IPD deposits received: ৳600
- Total IPD money received today: ৳34,500

Deposit adjustments remain separate and do not increase total cash received.

## Dashboard Changes

### Primary card

Rename the headline to a meaning equivalent to “Today’s total IPD money received”.

The card value will be:

- Direct bill payments received today
- Plus new IPD deposits received today

The supporting line will show both components separately, including cash and non-cash details where available.

### Settlement reconciliation

Keep bill settlement reconciliation separate:

- Net bill
- Direct payment applied
- Deposit applied
- Settled amount

This section explains how a bill became settled, not how much new money was received today.

## Invoice Activity Table

Replace the single ambiguous “Paid today” meaning with a complete daily money-received view.

Each invoice/admission row will show:

- Total money received today for that admission
- Direct bill payment received today
- New deposit received today
- Deposit applied to the bill today

Examples:

- Parvin: total received today ৳300; bill payment ৳0; new deposit ৳300; deposit applied ৳300.
- Asma Akter: total received today ৳33,900; bill payment ৳33,900; new deposit ৳0; deposit applied ৳300 from a deposit received on an earlier date.

## Deposit-to-Admission Matching

Admission deposits do not currently store an admission ID. They contain an admission number in remarks such as `Admission deposit for ADM-000023`.

For reporting, the query will match a new deposit to an admission using:

1. The admission number embedded in the standard admission-deposit remark.
2. The same tenant and patient as the admission.
3. A report-date filter using Bangladesh time.

Unmatched deposits will still be included in the overall IPD cash-inflow total but will not be incorrectly attached to an invoice row.

## API Changes

Extend the canonical IPD daily snapshot with:

- New deposits received today
- Deposit receipt count
- Deposit cash and non-cash totals
- Total IPD money received today
- Per-activity-row new deposit received today
- Per-activity-row total money received today

Existing direct-payment fields remain available for backward compatibility.

## Testing

Backend tests will verify:

- Total IPD money received equals direct payments plus new deposits.
- Deposit adjustments are excluded from new cash inflow.
- Admission deposits are matched to the correct admission using tenant, patient, and admission number.
- Unmatched deposits do not create false invoice rows.

Frontend tests will verify:

- The headline displays combined daily IPD money received.
- The breakdown displays direct payment and new deposit separately.
- A deposit-only invoice row no longer shows a misleading zero as the complete daily received amount.
- Deposit applied remains visibly separate from new deposit received.

## Non-Goals

- No schema migration in this fix.
- No rewriting of historical deposit records.
- No change to accounting posting or cash-ledger behavior.
- No mixing deposit adjustments into cash received.
