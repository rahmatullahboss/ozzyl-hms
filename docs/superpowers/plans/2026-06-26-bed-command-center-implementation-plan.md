# Bed Command Center Implementation Plan

Date: 2026-06-26

Objective: Upgrade Bed Management from a basic grid into a command-center page with richer patient context, right-side bed drawer, better filters, and future equipment tracking.

Phase 0: Fix contracts

- Fix ward rename payload to use new_name.
- Keep backend compatible with old name payload.
- Support both available and available_count in ward data.
- Add reserved KPI.
- Keep existing add, edit, delete, reserve, deposit, and feature flows working.

Phase 1: UI upgrade

- Improve header and action area.
- Add KPI cards with percentages.
- Add search, ward, floor, bed type, status, and feature filters.
- Add ward sections with status summaries.
- Add richer bed cards with patient, doctor, rate, and feature data.
- Replace old bed detail modal with a right-side drawer.

Phase 2: Backend enrichment

- Enrich ward bed overview with patient, admission, and doctor fields.
- Add a command detail endpoint for selected bed drawer data.
- Return simple timeline data.
- Return latest housekeeping task where possible.
- Use current bed features as an equipment-readiness placeholder.

Phase 3: Equipment integration

- Add a bed equipment mapping table. Done in migrations/0385_bed_equipment_map.sql.
- Link bed equipment to inventory fixed assets or ward supply stock. First slice supports fixed_asset_stock_id and manual equipment readiness.
- Add equipment read and update APIs. Done with GET and PUT /api/admissions/beds/:id/equipment.
- Show equipment details in the drawer. Done with editable Room Assets / Bedside Equipment rows.
- Equipment/maintenance attention warning appears on the bed card when bed is under maintenance or feature text indicates faulty equipment.
- Inventory fixed-asset picker is now available inside each equipment row, using `/api/inventory/assets` search.
- Faulty/maintenance equipment rows can create a linked asset maintenance log through `/api/inventory/assets/maintenance`.
- Bed overview now returns `equipment_count` and `equipment_issue_count`; bed cards show equipment issue counts.
- Bed drawer timeline now includes recent linked asset maintenance logs from equipment assets.
- Top KPI row includes an Equipment Issues card that filters beds with faulty/missing/maintenance equipment.
- Drawer shows an auto bed maintenance suggestion when a bed has equipment issues but the bed status is not maintenance.
- Maintenance timeline rows include a deep link to the asset maintenance page.
- Asset Management now reads `tab`/`log` query params, opens the maintenance tab, scrolls to the selected maintenance log, and highlights it.
- Asset Management tab changes keep the URL query state in sync.
- Next slice: add stronger bed command-center polish and route-level smoke tests for Bed Management + Asset Management deep links.

Files touched in this slice:

- web/src/pages/BedManagement.tsx
- src/routes/tenant/admissions.ts
- migrations/0385_bed_equipment_map.sql
- docs/superpowers/specs/2026-06-26-bed-command-center-design.md
- docs/superpowers/plans/2026-06-26-bed-command-center-implementation-plan.md

Verification:

- Build the web app.
- Run focused bed overview and BedManagement tests.
- Check KPI filters, search, drawer, reserve modal, add/edit/delete bed, feature assignment, and ward rename.
