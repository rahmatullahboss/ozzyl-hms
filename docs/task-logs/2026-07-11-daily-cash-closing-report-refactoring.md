# Task: Executive Dashboard Financial Reconciliation and Configurable Operations Control Panel

## Objective

Correct the Daily Collection, executive KPI, cash-control, and PDF reconciliation logic; remove conflicting client-side formulas; add tenant-configurable dashboard sections; and surface inventory, laboratory reagent, and radiology/X-ray stock monitoring directly on the Admin, MD, and Director dashboards.

## Execution context

- Initial work date: 2026-07-11 Bangladesh Time (GMT+6)
- Extended review and inventory dashboard work: 2026-07-12 Bangladesh Time (GMT+6)
- Working branch: `review/all-branches-20260711`
- Commit before the original review: `8fd898837619f9ec1373eb170ea6a06bbbac3a93`
- Final commit/merge: not performed in this tool session because the available workspace tools are read/edit/verification-only for Git operations.

## Financial reconciliation changes

- `src/routes/tenant/dashboard.ts`
  - Card totals and drilldowns now use the same server-side helpers.
  - Total Expense includes paid operating expenses and doctor payouts.
  - Approved but unpaid expenses no longer reduce cash-basis Net Income.
  - Net Income subtracts refunds/sales returns and expenses without classifying refunds as operating expenses.
  - Physical cash includes cash payment methods only and is separated from accounting income.
  - Patient deposits remain cash inflows/liabilities but are excluded from income.
  - Mixed invoices allocate receipts to service categories proportionally from active invoice lines.
  - Added source-only KPI summary requests and correct merged drilldown pagination.

- `src/routes/tenant/dailyCollection.ts`
  - Separates Total Collection, Total Deposit, Total Expense, Net Income, and Physical Net Cash.
  - Includes doctor payouts in expense reconciliation.
  - Uses actual cash drawer movements for physical cash-out.
  - Non-cash paid expenses reduce Net Income but do not reduce drawer cash.
  - Refunds reduce Net Income without being double-counted as expenses.

- `web/src/pages/admin/DailyCollectionReport.tsx`
  - Uses Bangladesh local date.
  - Shows management reconciliation separately from physical cash reconciliation.
  - Clearly labels deposits as liabilities rather than income.
  - Does not hide negative cash balances.

- `web/src/pages/AdminPdfGenerationPage.tsx`
  - Removes duplicate/bypassing Daily Collection report paths.
  - Keeps deposit, Net Income, and Physical Net Cash separate.
  - Fixes Daily Discount memo dependencies and detail toggle behavior.
  - Uses compact A5 detail output with bounded rows.

## Configurable executive dashboard

- Added tenant-scoped migration `migrations/0416_dashboard_kpi_configuration.sql`.
- Added the `dashboard_kpi_config` schema to Drizzle and the baseline tenant schema.
- Dashboard configuration allows only presentation changes:
  - enabled/disabled
  - order
  - label override
- Calculations, SQL, metric definitions, data sources, and access rules remain server-controlled and whitelisted.
- Supported sections:
  - Management
  - Cash Control
  - Inventory Control
  - Laboratory Reagent Control
  - Radiology / X-ray Stock
- Hospital Admin, MD, and Director can configure the dashboard. Other roles cannot write configuration.
- Section master switches update all child cards; cards can also be controlled individually.
- Disabled cards are excluded from the KPI summary request, so their domain queries are not executed.

## Inventory, reagent, and radiology monitoring

- Added `src/lib/executive-inventory-kpis.ts` as an isolated inventory KPI module.
- Added inventory widgets for:
  - active stock SKUs
  - low-stock SKUs
  - out-of-stock SKUs
  - expiring-soon lots
  - expired lots
  - pending purchase requests
- Added laboratory widgets for:
  - tests completed
  - reagent SKUs used
  - available reagent SKUs
  - low/out-of-stock reagents
  - reagent expiry
  - reagent QC exceptions
- Added radiology/X-ray widgets for:
  - imaging exams completed
  - available radiology stock
  - low/out-of-stock radiology items
  - radiology expiry
  - radiology issue transactions
- Reagent usage never adds incompatible units such as millilitres, pieces, and test-equivalents. The card counts distinct used reagent SKUs, while drilldown rows retain exact quantity and unit.
- Explicit `radiology_consumable` inventory items are supported. Backward-compatible category/subcategory/store matching remains available for existing data.
- Store-based radiology fallback counts only stock in the matching radiology/imaging/X-ray store, avoiding accidental inclusion of the same generic item from other stores.
- Optional purchase, lab-workflow, or radiology-workflow table failures are isolated so unrelated stock sections continue to load.

## Inventory drilldown UX

Inventory, reagent, and radiology drilldowns show:

- item name and code
- stock or used quantity with its unit
- reorder level
- store
- batch/lot
- expiry
- QC/status

Financial drilldowns retain their existing invoice/payment-oriented columns.

## Inventory master-data consistency

- Added `radiology_consumable` to backend inventory validation.
- Inventory item UI now exposes backend-supported values only:
  - medicine
  - consumable
  - lab_reagent
  - radiology_consumable
  - ot_item
  - ward_item
  - general
  - asset
  - equipment
- Removed unsupported UI-only `capital` and `service` values.

## Stale test updates

Updated stale tests for current centralized permission/workspace definitions, dashboard labels, report keys, navigation breadth, and safe discharge-refund controls:

- `web/src/App.inventory-permission-routes.test.ts`
- `web/src/components/dashboard/AdminKpiInvoiceModal.test.tsx`
- `web/src/components/dashboard/Header.test.tsx`
- `web/src/components/dashboard/adminSidebarConfig.test.ts`
- `web/src/components/reception/ReceptionPatientDrawer.test.tsx`
- `web/src/pages/ReceptionReportsPage.test.ts`

## Migration verification

The dashboard configuration migration was applied to the configured local D1 database:

```text
pnpm exec wrangler d1 execute DB --local --file=migrations/0416_dashboard_kpi_configuration.sql
```

The local SQLite schema was verified for:

- tenant-scoped composite primary key
- enabled boolean constraint
- position range 0–100
- label override maximum length 60

No remote/production database migration or deployment was performed in this session.

## Verification

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run` | PASS — 830 files, 15,254 tests |
| `pnpm test:integration` | PASS — 235 files, 5,943 tests |
| `pnpm --filter web test` | PASS — 519 files, 2,890 tests; 3 skipped files and 3 todo tests |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm --filter web exec tsc --noEmit` | PASS |
| `pnpm build:migrations` | PASS — 429 migrations in generated manifest |
| `pnpm --filter web build` | PASS |
| Local D1 migration apply/schema query | PASS |

Some existing test suites intentionally print simulated database errors, deprecation notices, React `act()` warnings, i18n notices, or chart warnings while still passing. No test failures remain.

## Remaining integration action

The code is verified on `review/all-branches-20260711`, but Git commit/merge to `main` was not possible with the available workspace interface. The working tree also contains pre-existing clinical/nursing changes that should not be swept into an unreviewed all-files commit. A Git-capable local executor must create scoped commits and merge them after confirming the intended file set.
