# Shareholder Profit Distribution Spec

Status: backend baseline in progress.

## Goal

The shareholder module should calculate monthly distributable profit from GL totals, approve one auditable distribution, create per-shareholder payout rows, and post balanced accounting vouchers.

## Core rules

1. Use verified GL income and expense totals.
2. Do not use the legacy profit distribution route for approval because it creates only a header row.
3. Declaration is gross-first: debit retained earnings by gross dividend, credit shareholder payable by net payable, and credit a separate withholding liability for withheld amounts.
4. Eligible shareholders are controlled by tenant policy and should not include every active row automatically.
5. Rounding must reconcile so approved gross pool equals the sum of shareholder gross rows.
6. Sensitive routes must be tenant-scoped, role-protected, and auditable.

## Roles

- Read: hospital admin, director, accountant.
- Write/settings/import: hospital admin, director.
- Approve distribution: hospital admin, director.
- Pay dividend: hospital admin, director, accountant.
- Self-service: linked shareholder user only.

## Tenant settings

- `profit_percentage`
- `retained_earnings_percent`
- `tds_applicable`
- `tax_rate`
- `share_value_per_share`
- `dividend_eligible_types`

## Accounting entries

Declaration:

- Dr Retained Earnings: gross dividend.
- Cr Shareholder Dividend Payable: net payable.
- Cr Dividend Withholding Payable: withheld amount.

Payment:

- Dr Shareholder Dividend Payable.
- Cr selected cash/bank/mobile asset.

## Acceptance criteria

- Legacy profit approval is disabled.
- Withholding payable mapping exists.
- Dividend declaration accounting supports gross, net, and withheld split.
- Shareholder and accounting posting tests pass.
