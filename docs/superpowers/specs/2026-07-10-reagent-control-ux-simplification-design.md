# Reagent Control UX Simplification Design

Date: 2026-07-10
Branch: `feat/reagent-control-ux-simplification`

## Goal

Make the dedicated `/reagent-control` workspace understandable for hospital administrators and lab staff without removing existing reagent-control capabilities, changing backend APIs, or changing tenant soft-mode policy.

## Current problem

The current dedicated Reagent Control page exposes setup, daily work, monitoring, LIS readiness, analyzer health, policy controls, strict-mode activation, manual mapping, bulk import, exceptions and logs at the same visual level.

The Mapping tab combines policy configuration and test-to-reagent setup in one screen. This creates high cognitive load and makes routine tasks feel technical and risky.

The page component is also very large and most data queries run regardless of which tab is active.

## Design principles

1. Show the next useful action before technical status detail.
2. Separate daily work, initial setup and advanced administration.
3. Use hospital-language labels rather than database or integration terminology.
4. Keep dangerous policy changes behind an explicit advanced section and readiness checks.
5. Preserve all current functionality and backend contracts.
6. Load tab-specific data only when the corresponding area is needed.
7. Keep generic `lab-monitoring` mode behavior compatible; simplify only dedicated `reagent-control` mode.
8. Maintain keyboard and screen-reader accessible navigation.

## Information architecture

The dedicated Reagent Control page will use four primary sections:

1. **Overview**
2. **Stock**
3. **Test Recipes**
4. **Issues**

The following capabilities become secondary or advanced:

- Readiness checklist
- Automation policy
- Strict-mode activation
- Bulk CSV import
- Operation logs
- LIS/analyzer detail

Generic `lab-monitoring` mode keeps its existing broader tabs and monitoring content.

## Default entry state

Dedicated `reagent-control` opens on **Overview**, not Consumables.

The first visible card communicates the current operating mode in plain language:

- Soft mode: billing continues; failures create warnings.
- Strict mode: unsafe stock conditions can block completion.
- Disabled: reagent deduction is not active.

The Overview then shows at most three action cards based on current state:

- Fix missing test recipes
- Add or review stock
- Review open issues

When there is no action needed, the page shows a simple healthy state.

## Setup journey

Incomplete installations show a four-step guided setup:

1. Load starter reagent catalog
2. Review missing test recipes
3. Add current stock and locations
4. Start safe soft-mode control

Each step routes to the relevant section or action. Setup details are not all expanded at once.

## Test Recipes section

The existing Mapping concept is renamed **Test Recipes** in the dedicated workspace.

The default view prioritizes missing recipes and answers one question:

> When this test is performed, which reagent or consumable is used and how much?

The primary recipe form includes only:

- Lab test
- Reagent or consumable
- Quantity per test

Advanced fields are hidden behind an expandable control:

- Mandatory or optional
- Notes

Existing edit, remove and multiple-consumable-per-test behavior remains available.

The recipe list groups rows by test visually and uses plain labels. Raw IDs remain secondary metadata.

## Advanced recipe tools

Bulk import is hidden under **Advanced tools**.

It retains current API behavior and CSV compatibility. The UI explains that bulk import is intended for administrators or large setup jobs.

Starter catalog loading is presented as a setup action, not as a normal mapping action.

## Policy placement

Policy controls are removed from the main Test Recipes workflow.

A compact read-only summary appears in Overview or the advanced panel:

- Deduction timing
- Current safety mode
- Whether missing stock can block results
- Whether test recipes are required

Changing policy requires opening **Advanced settings**.

Strict-mode activation retains the existing readiness blocker and cannot bypass mapping, stock, QC or exception requirements.

Soft-mode values are not automatically rewritten by this UI change.

## Issues section

Exceptions and reconciliation problems are combined into a task-oriented Issues experience.

Issues are summarized by actionable category:

- Missing recipe
- Stock shortage
- QC or expired lot
- Reconciliation mismatch

Each row exposes a direct action such as:

- Set up recipe
- Add stock
- Review lot
- Retry deduction

Technical source-event details remain available but are visually secondary.

## Stock section

Existing stock controls remain available.

The dedicated workspace emphasizes:

- Current usable stock
- Low stock
- Expiring or QC-blocked lots
- Stock-in action

Rare operations such as transfer, waste approval, machine assignment and manual usage remain available under advanced stock actions rather than dominating the default view.

## Logs and LIS/analyzer information

Operation logs move to Advanced settings/tools.

LIS readiness and analyzer health are collapsed into compact notices on Overview when attention is required. Detailed machine configuration continues to link to the existing Lab Machine Settings page.

## Component architecture

The current large page will be split incrementally.

Create focused reagent-control components under:

`web/src/pages/laboratory/reagent-control/`

Planned responsibilities:

- `reagentControlModel.ts`: labels, tab definitions, action-state helpers and query enablement rules
- `ReagentControlOverview.tsx`: status, next actions and setup journey
- `ReagentRecipeManager.tsx`: simplified recipe creation, list, editing and advanced tools
- `ReagentControlAdvancedPanel.tsx`: policy, readiness, logs and advanced controls
- `ReagentControlIssues.tsx`: actionable issue summaries and exception/reconciliation presentation
- `ReagentControlTabs.tsx`: accessible responsive primary navigation

`LabMonitoringDashboard.tsx` remains the data/mutation owner during this focused refactor and delegates rendering to extracted components. Backend endpoints remain unchanged.

## Query loading

Queries needed for the page shell and action summary may load on entry:

- inventory policy
- mapping coverage summary
- open exceptions
- alerts

Heavy or section-specific queries are enabled only when required:

- recipe list and lab tests: Test Recipes or setup action
- reconciliation detail: Issues
- operation logs: Advanced logs
- analyzer and LIS readiness detail: Advanced/readiness or when compact attention state requires it
- stock detail and waste requests: Stock

No API contract changes are required.

## Accessibility and responsive behavior

Primary navigation will use:

- `role="tablist"`
- `role="tab"`
- `aria-selected`
- `aria-controls`
- keyboard left/right navigation

On small screens, tabs remain horizontally scrollable and content tables use responsive cards or controlled overflow.

Expandable advanced controls use semantic buttons with `aria-expanded` and labelled regions.

## Testing strategy

Add tests for:

1. Dedicated mode has four primary sections and opens on Overview.
2. Generic lab-monitoring mode retains existing broader navigation.
3. Plain-language policy summary for soft, strict and disabled modes.
4. Next-action prioritization.
5. Advanced policy and bulk import are hidden by default.
6. Recipe basic fields are visible and advanced fields are progressively disclosed.
7. Accessible tab roles and keyboard navigation.
8. Section-specific query enablement helpers.
9. Existing mapping payload, readiness, exception and reconciliation helper tests remain green.
10. Full inventory/laboratory frontend regression and production build pass.

## Non-goals

- No backend or database migration.
- No changes to current production soft-mode values.
- No automatic strict-mode activation.
- No redesign of the generic Lab Monitoring workspace.
- No removal of manual, bulk, LIS, analyzer, stock or audit capabilities.

## Acceptance criteria

- A first-time administrator can identify the next setup action without opening technical tabs.
- A routine user can add or edit a test recipe without seeing policy or CSV controls.
- Strict-mode and blocking controls are not visible in the normal recipe form.
- All existing reagent-control capabilities remain reachable.
- Dedicated navigation contains exactly Overview, Stock, Test Recipes and Issues.
- Generic lab monitoring remains backward compatible.
- No production policy write occurs during page load or route entry.
- Relevant tests and production build pass.
