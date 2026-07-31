# Configurable Executive Inventory Dashboard Design

## Goal

Turn the executive dashboard into a tenant-configurable control panel that combines finance, cash, approvals, inventory, laboratory reagent monitoring, and radiology/X-ray consumable stock monitoring without allowing tenants to define arbitrary SQL or financial formulas.

## Design Principles

1. **Server-whitelisted registry:** Every section and widget is declared in code with a stable key, title, value type, permitted roles, drilldown metric, and data source. Tenant configuration can only change presentation settings.
2. **Single source of truth:** Card totals, section summaries, and drilldowns use the same backend helper. No client-side financial or inventory formulas.
3. **Section-aware configuration:** A section master switch updates all widgets in the section. Individual widgets can also be enabled, disabled, renamed, and reordered.
4. **No mixed-unit totals:** Quantities such as tests, pieces, millilitres, and packs are never summed into a misleading universal stock number. Summary cards use counts or clearly named canonical quantities; item drilldowns retain quantity and unit.
5. **Tenant and role isolation:** Configuration and metrics are tenant-scoped. Hospital Admin, MD, and Director can edit; viewers only receive widgets allowed by their role.
6. **Operational performance:** Summary queries are batched and source-only. Full item, lot, invoice, or movement rows are fetched only when a user opens a drilldown.

## Sections and Widgets

### Management

- Total Collection
- Total Expense
- Net Income
- Lab Income
- Other Income
- Total Commission
- Total Visits
- Pending Approvals

### Cash Control

- Physical Cash In
- Net Cash Movement
- Available Drawer Cash

### Inventory Control

- Active Stock SKUs
- Low-stock SKUs
- Out-of-stock SKUs
- Expiring-soon lots
- Expired lots
- Pending Purchase Requests

### Laboratory Reagent Control

- Tests Completed Today
- Reagents Used Today (distinct SKUs; exact quantity and unit remain item-wise in drilldown)
- Available Reagent SKUs
- Low-stock Reagent SKUs
- Out-of-stock Reagent SKUs
- Reagent Lots Near Expiry
- Reagent QC Exceptions

The reagent drilldown shows item, code, lot, expiry, QC state, available quantity, issue unit, reorder level, consumed quantity for the selected period, and linked test activity where available.

### Radiology / X-ray Stock Control

- Imaging Exams Completed Today
- Available Radiology Stock SKUs
- Low-stock Radiology SKUs
- Out-of-stock Radiology SKUs
- Radiology Lots Near Expiry
- Radiology Issue Transactions Today

Radiology stock includes explicit `ItemType = radiology_consumable` records and backward-compatible items whose active category, subcategory, or store identifies them as radiology, imaging, or X-ray stock. Drilldown shows item, batch, expiry, quantity, unit, store, reorder level, and issue movements.

## Configuration Model

The existing `dashboard_kpi_config` table remains the authoritative tenant presentation store. Its whitelist expands from finance-only KPI keys to all supported dashboard widgets. Section definitions remain server-side. A section is enabled when one or more child widgets are enabled; the editor exposes a master section switch that atomically changes all child widget settings in one validated PUT request.

Tenant-editable fields:

- enabled
- position
- label override

Server-controlled fields:

- section key
- widget type
- value type
- query/calculation
- drilldown endpoint
- permitted roles
- default refresh interval

## Inventory Classification

Add `radiology_consumable` to the inventory item-type validation and item editor. Existing records remain compatible through category/store fallback matching. No automatic rewriting of existing item types is performed.

Laboratory reagent records continue to use `lab_reagent`. Lot, expiry, QC, and stock data come from the existing Inventory and lab-consumable bridge tables.

## API Contract

- `GET /api/dashboard/kpi-config`: returns all section-aware widget definitions with tenant overrides.
- `PUT /api/dashboard/kpi-config`: accepts only whitelisted widget keys and bounded presentation fields.
- `GET /api/dashboard/kpi-summary`: returns all enabled-capable widget totals in one source-only response.
- `GET /api/dashboard/kpi-breakdown`: supports inventory, reagent, and radiology metrics with server pagination and item/lot/unit details.

## Error Handling

- Missing optional inventory/lab tables return zero-value metrics rather than failing the entire executive dashboard.
- Invalid widget keys, labels, positions, dates, and roles are rejected.
- Empty sections are hidden.
- Drilldown rows expose source status and unit rather than coercing incompatible quantities.

## Testing

- Registry and configuration whitelist tests
- Tenant isolation and role-permission tests
- Section master-toggle tests
- Inventory low/out/expiry reconciliation tests
- Lab test/reagent consumption/stock reconciliation tests
- Radiology item classification and stock tests
- Summary total equals drilldown total tests
- Source-only summary performance test
- React rendering, configuration, accessibility, and stale-test updates
- Full backend unit/integration, full web suite, TypeScript, migration manifest, and production build
