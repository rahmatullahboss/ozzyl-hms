# Bed Command Center / Bed Management Redesign Spec

Date: 2026-06-26
Status: Approved for phased implementation
Owner: HMS Admin/IPD module

## 1. Problem

The current Bed Management page is functional but still behaves like a basic bed grid. It can show beds grouped by ward, filter by status/ward/feature, reserve a bed, collect a reservation deposit, edit bed metadata, manage wards, and assign bed features.

Hospital users need a command-center style page where an admin, reception user, nurse, or manager can understand bed availability, occupancy, cleaning, maintenance, reservations, patient context, and bedside equipment in one screen.

The target UX is inspired by a premium hospital bed-management dashboard:

- KPI cards for total, occupied, available, cleaning, reserved, and maintenance beds.
- Powerful search and filters.
- Ward/room grouped visual bed cards.
- A right-side drawer for the selected bed.
- Patient details, admission timeline, housekeeping status, and room/bedside equipment in the drawer.
- Quick actions: admit, reserve, transfer, discharge, mark cleaning, mark clean, block bed, and open inventory.

## 2. Current implementation snapshot

Frontend:

- `web/src/pages/BedManagement.tsx`
- Uses `/api/admissions/ward-bed-overview` as the visual bed-map source.
- Supports add/edit/delete bed, reserve bed + deposit, ward management, bed feature assignment, KPI filters, quick status update for reception.

Backend:

- `src/routes/tenant/admissions.ts`
- Existing endpoints include:
  - `GET /api/admissions/ward-bed-overview`
  - `GET /api/admissions/beds`
  - `GET /api/admissions/beds/:id`
  - `POST /api/admissions/beds`
  - `PUT /api/admissions/beds/:id`
  - `DELETE /api/admissions/beds/:id`
  - `GET /api/admissions/wards`
  - `PUT /api/admissions/wards/:name`
  - `GET /api/admissions/bed-features`
  - `PUT /api/admissions/beds/:id/features`
  - `POST /api/admissions/bed-reservations`
  - `PUT /api/admissions/beds/:id/clear-cleaning`

Known defects found during review:

- Ward rename frontend sends `{ name }`, but backend expects `{ new_name }`.
- Ward list frontend expects `available_count`, but backend returns `available`.
- Reserved KPI is not included in the KPI row.
- Detail modal is not enough for command-center workflow.
- Bed cards show patient name only, not enough patient/admission context.
- Bed features are displayed, but physical bedside equipment is not modeled as inventory-linked assets yet.

## 3. Goals

### 3.1 Business goals

- Make bed availability instantly understandable for reception/admin/nursing.
- Reduce time to find a suitable bed for admission/transfer.
- Reduce operational gaps after discharge by exposing cleaning state and overdue cleaning tasks.
- Improve asset awareness by making bed/cabin equipment visible from the bed screen.
- Make the page premium enough to demo to hospitals.

### 3.2 Product goals

- Replace modal-based bed details with a right-side selected-bed drawer.
- Add search and richer filters.
- Display a clear, card-based ward map.
- Show patient context directly on occupied bed cards.
- Show a richer selected-bed drawer with patient, timeline, housekeeping, equipment, and actions.
- Keep existing workflows compatible.

### 3.3 Technical goals

- Reuse existing `/ward-bed-overview` endpoint for the first UI slice.
- Enrich `/ward-bed-overview` with patient/admission/doctor fields that are safe to display on cards.
- Add `GET /api/admissions/beds/:id/command-detail` for drawer-level data.
- Keep the old add/edit/reserve/ward/feature flows working.
- Avoid introducing a large inventory migration in this first slice; model physical equipment as a second phase.

## 4. Non-goals for the first implementation slice

The first implementation slice will not fully implement physical asset lifecycle management inside Bed Management. It will show equipment readiness from existing bed features and a future-compatible placeholder structure.

The full inventory-linked equipment model will be implemented later using a dedicated table such as `bed_equipment_map` linked to fixed assets / ward supply stock.

## 5. UX requirements

### 5.1 Page header

Header must show:

- Breadcrumb: Dashboard / Admissions / Bed Management
- Page title: Bed Management
- Small description: Real-time overview of beds across wards and units
- Actions: refresh, manage wards, add bed, help, WhatsApp

### 5.2 KPI cards

KPI cards:

- Total Beds
- Occupied
- Available
- Cleaning
- Reserved
- Maintenance

Each card should show:

- Count
- Percentage of total
- Status-specific visual style
- Click-to-filter behavior

### 5.3 Filters

Primary filters:

- Search bed/patient/UHID/admission/mobile/doctor
- Ward
- Floor
- Bed type / room type
- Status
- Feature/equipment capability

Clear filter button must reset all filters.

### 5.4 Ward sections

Each ward section must show:

- Ward name
- Total beds count
- Occupied count
- Available count
- Cleaning count
- Reserved count
- Maintenance count
- Collapsible visual bed cards

### 5.5 Bed card

Each card must show:

- Bed number
- Room/floor/bed type
- Status badge
- Rate per day
- Feature/equipment chips
- Patient details if occupied:
  - Name
  - Patient code/UHID
  - Age/gender/mobile where available
  - Attending doctor
  - Admission date/length of stay
  - Risk/action chips such as bill review, care plan, discharge initiated
- Quick action button depending on status:
  - Available: Reserve
  - Cleaning: Mark clean
  - Non-occupied: quick status selector for reception

### 5.6 Right-side drawer

When clicking a bed card, a right-side drawer opens. The drawer must show:

- Bed title and status
- Patient card if occupied
- Alert chips
- Occupancy timeline
- Housekeeping status
- Room assets / bedside equipment readiness
- Action bar
- Feature assignment section for admin users

For the first slice, the drawer can use:

- Current bed overview row
- `GET /api/admissions/beds/:id/command-detail` if available
- Existing feature assignment APIs

### 5.7 Empty state

If no beds match filters, show a helpful empty state and a clear-filter action.

## 6. Backend requirements

### 6.1 Enrich ward-bed overview

`GET /api/admissions/ward-bed-overview` should include these fields where available:

- `bed_id`
- `ward_name`
- `bed_number`
- `bed_type`
- `status`
- `floor`
- `rate_per_day`
- `effective_rate`
- `feature_names`
- `admission_id`
- `admission_no`
- `admission_date`
- `admission_status`
- `patient_id`
- `patient_name`
- `patient_code`
- `patient_age`
- `patient_gender`
- `patient_mobile`
- `patient_blood_group`
- `doctor_id`
- `doctor_name`
- `discharge_initiated`
- `discharge_approved`

### 6.2 Command detail endpoint

Add:

`GET /api/admissions/beds/:id/command-detail`

Response shape:

```json
{
  "bed": {},
  "activeAdmission": {},
  "features": [],
  "housekeeping": null,
  "timeline": [],
  "equipment": []
}
```

First-slice data sources:

- `beds`
- `bed_feature_map` + `bed_features`
- `admissions`
- `patients`
- `doctors`
- `housekeeping_tasks` when available

### 6.3 Ward rename contract fix

Frontend should send:

```json
{ "new_name": "New Ward Name" }
```

Backend can optionally accept both `new_name` and legacy `name` for safety.

### 6.4 Ward list contract fix

Frontend should accept both:

- `available`
- `available_count`

## 7. Bedside equipment model

Implemented first slice: `migrations/0385_bed_equipment_map.sql` creates this table. The current UI supports manual per-bed equipment readiness. Future work should connect `fixed_asset_stock_id` to a proper inventory asset picker.

Table:

```sql
CREATE TABLE bed_equipment_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_id INTEGER NOT NULL,
  fixed_asset_stock_id INTEGER,
  equipment_name TEXT NOT NULL,
  required_qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'in_use', 'faulty', 'maintenance', 'missing')),
  last_checked_at TEXT,
  checked_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bed_equipment_bed ON bed_equipment_map(tenant_id, bed_id);
CREATE INDEX idx_bed_equipment_asset ON bed_equipment_map(tenant_id, fixed_asset_stock_id);
```

Next integrations:

- `InventoryFixedAssetStock` picker
- `ward_supply_location_stock` links
- maintenance/fault log
- inventory traceability

## 8. Permissions

- Admin/director/MD: full bed metadata, ward management, feature assignment, bed delete if not occupied.
- Reception: read bed grid, reserve bed, update non-occupied status, collect deposit.
- Nurse: read bed grid, mark cleaning complete, view patient/bed drawer.
- Doctor: read occupied patient bed context where assigned.

## 9. Acceptance criteria

- Bed page has screenshot-style KPI row, filters, ward sections, visual cards, and right drawer.
- Search can find by bed number, ward, patient name, patient code, admission no, mobile, and doctor.
- Reserved count appears in KPI row.
- Ward rename works with backend contract.
- Occupied bed card shows patient/admission/doctor context when available.
- Selected-bed drawer shows patient, timeline, housekeeping, and equipment/feature readiness.
- Drawer can edit and save real per-bed equipment rows through `/api/admissions/beds/:id/equipment`.
- Drawer can link a bed equipment row to an inventory fixed asset from `/api/inventory/assets`.
- Faulty/maintenance linked equipment can create an asset maintenance log through `/api/inventory/assets/maintenance`.
- KPI row includes Equipment Issues and filters beds with faulty/missing/maintenance equipment.
- Drawer suggests marking a bed under maintenance when equipment issues exist.
- Maintenance timeline rows deep link to the asset maintenance page.
- Asset Management supports maintenance deep links and highlights the selected maintenance log.
- Existing add/edit/delete/reserve/deposit/feature assignment flows still work.
- `npm --filter web run build` passes.
- Relevant backend tests for bed overview pass or compile remains clean.
