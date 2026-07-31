# Reagent Control UX Simplification Report

Date: 2026-07-10
Branch: `feat/reagent-control-ux-simplification`

## Executive result

The dedicated `/reagent-control` workspace was redesigned from a capability-heavy monitoring screen into a task-oriented hospital workflow.

The backend, database, reagent deduction engine and production soft-mode policy were not changed.

The dedicated workspace now has four primary sections:

1. Overview
2. Stock
3. Test Recipes
4. Issues

Policy controls, strict-mode activation, bulk import, technical logs, LIS monitoring and machine configuration remain available through advanced tools instead of competing with daily work.

## Problems addressed

The previous screen exposed all of the following at once:

- reagent status command center;
- LIS readiness;
- analyzer health;
- six primary tabs;
- policy configuration;
- strict-mode activation;
- manual mapping;
- bulk CSV import;
- stock operations;
- exception queues;
- reconciliation;
- operation logs.

This made a powerful system difficult to learn because daily tasks, initial setup and rare administration were visually equal.

## Implemented UX

### Overview

The dedicated route opens on Overview.

It explains the current policy in operational language:

- when stock is deducted;
- whether billing and results continue;
- what happens when a recipe is missing.

It shows no more than three prioritized next actions and a four-step guided setup when configuration is incomplete.

A healthy installation shows a calm no-action-required state.

The date filter is hidden on routine Overview, Stock and Test Recipes screens. It appears where it is relevant for Issues or advanced logs.

### Primary navigation

The six technical tabs were replaced with four task-oriented sections.

Navigation includes:

- semantic tab roles;
- `aria-selected` and `aria-controls`;
- Arrow Left/Right navigation;
- Home and End navigation;
- focus movement to the newly selected tab;
- horizontal overflow handling on small screens.

### Test Recipes

“Mapping” is presented as “Test Recipes”.

The normal form asks only:

- Lab test
- Reagent or consumable
- Quantity per test

Mandatory/optional status and notes are behind “More recipe options”.

Starter catalog loading and CSV import are behind “Advanced recipe tools”.

Existing multi-item recipes, editing and removal remain supported.

### Stock

The default Stock screen focuses on:

- Add stock;
- reagent selection;
- lot quantity;
- expiry;
- QC and usable status.

Locations, open-vial expiry, machine assignment, manual usage, transfer, waste requests and approvals are behind “Stock setup & advanced actions”.

### Issues

Technical exceptions are grouped into actionable categories:

- Missing recipe
- Stock shortage
- QC or blocked lot
- Reconciliation mismatch

Direct actions include:

- Set up recipe
- Add stock
- Review lot
- Retry deduction
- Mark resolved

Source event, order IDs and reason codes remain in collapsed technical details.

The classifier covers the production backend reasons `missing_test_mapping`, `insufficient_stock`, `missing_stock`, `qc_failed_lot` and `qc_failed_usable_lot`.

### Advanced settings and capability preservation

Advanced settings contains:

- current policy summary;
- automation policy controls;
- strict-mode readiness checks;
- safe-rollout preset;
- strict-mode activation;
- operation logs;
- custom reagent and consumable catalog access;
- links to full Lab Monitoring and Lab Machine Settings.

The custom catalog utility preserves create/edit and stock-in capability that previously existed under the Consumables tab.

### Query loading

The dedicated workspace no longer loads every heavy dataset on initial entry.

Section-specific loading includes:

- recipe list and lab tests only for Test Recipes;
- reconciliation detail only for Issues;
- logs and detailed readiness only for Advanced settings;
- stock detail and waste workflows only for Stock.

Core policy, mapping coverage, alerts and open exceptions remain available for the Overview action summary.

Generic `lab-monitoring` mode keeps its existing broader monitoring behavior.

## Soft-mode clarification

This UX work did not change soft-mode values or write policy on page load.

Soft mode continues to mean:

- deduction is attempted at the configured timing;
- missing stock or recipes create warnings/exceptions;
- normal billing/result flow continues when `allow_result_without_stock` is enabled;
- strict blocking is not enabled automatically.

The summary text now reflects both billing-time and result-time soft policy accurately.

## Adversarial review findings and fixes

The merge review found and fixed these Important issues:

1. Custom consumable creation/editing became hard to reach after removing the primary Consumables tab.
   - Fixed with an Advanced “Manage reagent catalog” utility view and Back to Stock action.
2. Detailed lab and analyzer tools were no longer obvious from the dedicated workspace.
   - Fixed with links to full Lab Monitoring and Machine Settings.
3. The new issue grouping missed existing backend codes `missing_stock` and `qc_failed_usable_lot`.
   - Fixed and covered by tests.
4. Soft mode with result-time deduction displayed billing-time explanatory text.
   - Fixed and covered by a policy-summary test.
5. Keyboard tab navigation changed selection but did not move focus.
   - Fixed with controlled focus transfer and a real focus assertion.

No Critical issue remained after review.

## Verification evidence

### Migration manifest

Command:

```bash
pnpm build:migrations
```

Result:

- exit code 0;
- 413 migrations generated;
- no migration was added or applied by this UX work.

### TypeScript

Command:

```bash
pnpm exec tsc --noEmit
```

Result: exit code 0.

### Inventory and reagent regression

Command:

```bash
pnpm test:inventory
```

Result:

- backend: 74 files, 523 tests passed;
- frontend inventory/reagent UX: 39 files, 210 tests passed;
- total: 113 files, 733 tests passed;
- failures: 0.

The command now permanently includes the dedicated Reagent Control UX suite.

### Production web build

Command:

```bash
pnpm --filter web build
```

Result:

- TypeScript passed;
- Vite production bundle passed;
- PWA generation passed.

## Scope verification

Changed areas are limited to:

- Reagent Control frontend components and tests;
- Lab Monitoring dedicated-mode integration;
- inventory/reagent test command;
- design, plan, QA and report documentation.

Not changed:

- backend routes;
- database schema;
- migrations;
- inventory transaction engine;
- reagent deduction logic;
- production tenant policy rows;
- generic Lab Monitoring workflow behavior.

## Remaining technical debt

`LabMonitoringDashboard.tsx` still owns a broad amount of data and mutation state because the generic Lab Monitoring page remains large. Dedicated presentation and decision logic are now extracted, but a future P2 refactor could separate generic monitoring data orchestration into domain hooks.

This is maintainability work, not a current rollout blocker.

## Go-live assessment

The dedicated Reagent Control workflow now follows progressive disclosure and task-based navigation while preserving advanced capabilities.

It is suitable for the current soft-mode hospital rollout after the frontend code is deployed. No database migration or policy update is required for this UX release.
