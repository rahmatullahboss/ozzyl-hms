# Shareholder Profit Distribution Implementation Plan

Status: implementation started on branch `codex/shareholder-profit-distribution-best-practice`.

## Implemented in this branch

- Added spec document.
- Disabled legacy `POST /api/profit/distribute` so it cannot create orphan distribution headers.
- Added `withholding_payable` semantic mapping support in accounting posting.
- Updated dividend declaration posting to debit retained earnings by gross amount and credit shareholder payable plus withholding payable.
- Added migration `0391_shareholder_dividend_withholding_payable.sql`.
- Added accounting unit test for gross/net/withholding declaration posting.
- Added shareholder settings schema support for `dividend_eligible_types`.
- Added helper functions for eligible shareholder types and deterministic whole-taka allocation.
- Added partial RBAC hardening to shareholder settings/list/create routes.

## Remaining implementation steps

1. Finish RBAC guards for bulk import, update, calculate, distribution history, details, and OCR upload.
2. Wire `getDividendEligibleTypes` and `allocateWholeTaka` into `/api/shareholders/calculate` and `/api/shareholders/distribute`.
3. Change shareholder distribution accounting payload to send gross amount, withheld amount, and net payable.
4. Add UI for eligible type settings, distribution detail, payment voucher, and withholding summary.
5. Add D1 integration test for calculate to distribute to pay lifecycle.

## Test plan

- `pnpm vitest run test/shareholders.test.ts`
- `pnpm vitest run test/shareholder-accounting-posting.test.ts`
- `pnpm test` after the blocked route patches are completed.
- Build migration manifest after final SQL changes.
