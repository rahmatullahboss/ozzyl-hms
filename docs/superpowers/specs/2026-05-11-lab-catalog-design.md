# Lab Test Catalog - Design Specification

**Date:** 2026-05-11
**Status:** Draft

---

## Problem Statement

1. **Missing Admin UI**: LabSettingsPage has Categories, Templates, Vendors tabs but no Test Catalog management
2. **API Exists**: `/api/lab` already has GET/POST/PUT/DELETE for `lab_test_catalog`
3. **Data Discrepancy**: Reception dashboard reads from `lab_test_catalog` but admins have no UI to manage it

---

## Design Overview

Following DanpheEMR patterns, we add a **Catalog** tab in LabSettingsPage with:

1. **List View** - Table showing all tests with filters
2. **Add/Edit Modal** - Form for creating/updating tests
3. **Soft Delete** - Toggle is_active instead of hard delete
4. **Category Integration** - Reuses existing Categories tab data

---

## Tab Position

New "Catalog" tab placed after "Categories" (2nd position):
- Logical flow: Create Categories first → then add tests to Catalog
- TABS array order: categories → **catalog** → templates → vendors → ...

---

## Data Model

**lab_test_catalog table fields:**
- `id` - primary key
- `code` - test code (e.g., "CBC001")
- `name` - test name (e.g., "Complete Blood Count")
- `category` - category name (links to lab_settings_categories)
- `price` - price in paisa
- `unit` - measurement unit (optional)
- `normal_range` - reference range text (optional)
- `method` - testing method (optional)
- `is_active` - 1 = active, 0 = inactive
- `tenant_id` - multi-tenant support

---

## Features

### 1. List View (CatalogTab)

**Table Columns:**
| Column | Description |
|--------|-------------|
| Test Name | Full name of the test |
| Code | Short code (e.g., CBC001) |
| Category | Category from categories table |
| Price | Formatted price (৳500) |
| Status | Active/Inactive badge |
| Actions | Edit button, Delete toggle |

**Filters:**
- Search bar (filters by name, code, category)
- Status filter: All / Active / Inactive
- Category dropdown filter

**Empty State:**
- Icon + "No tests found" message
- "Add Test" call-to-action button

### 2. Add/Edit Modal

**Fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Test Name | text input | Yes | Max 200 chars |
| Code | text input | Yes | Unique per tenant |
| Category | dropdown | Yes | From lab_settings_categories |
| Price | number input | Yes | In local currency (Taka) |
| Unit | text input | No | e.g., "mg/dL" |
| Normal Range | text input | No | e.g., "70-100" |
| Method | text input | No | e.g., "Automated" |

**Validation:**
- Name: required, max 200 chars
- Code: required, unique check
- Price: required, must be > 0
- Category: required, must exist

**Actions:**
- Cancel button (closes modal)
- Save button (creates/updates test)

### 3. Soft Delete (Deactivate)

- Delete button sets `is_active = 0` (not hard delete)
- Confirmation dialog before deactivation
- Inactive tests can be reactivated via edit
- Inactive tests hidden by default in list (filter)

### 4. API Integration

**Existing Endpoints (already in `/api/lab`):**
- `GET /` - list all tests (with search)
- `POST /` - create new test
- `PUT /:id` - update test
- `DELETE /:id` - soft delete (sets is_active=0)

**Required for Categories dropdown:**
- `GET /api/lab-settings/categories` - existing endpoint

---

## UI/UX Patterns

### Consistent with Existing Tabs

Following existing patterns in LabSettingsPage:
- Same Modal structure (Modal component)
- Same table styling (table-base class)
- Same empty state pattern (EmptyState component)
- Same filter UI (dropdown + search)
- Same skeleton loading

### Color Scheme
- Primary: cyan/teal gradient
- Active status: green badge (badge-success)
- Inactive status: yellow badge (badge-warning)

---

## Component Structure

```tsx
// New: CatalogTab component in LabSettingsPage.tsx

function CatalogTab() {
  // State: showForm, editingTest, filters, search
  // Fetch: /api/lab (with search/filter params)
  // Render: table + filters + modal
}
```

**Reuses existing:**
- `Modal` component (already in file)
- `SkeletonRows` helper
- `useApiQuery`, `useApiMutation` hooks
- `queryKeys` for cache invalidation
- `toast` for feedback

---

## Implementation Files

1. **Backend**: No new files needed
   - `/api/lab` endpoints already exist
   - May need schema update if not complete

2. **Frontend**:
   - `web/src/pages/LabSettingsPage.tsx` - add CatalogTab component + tab

---

## Migration

If `lab_test_catalog` table has missing columns, run migration:

```sql
-- Ensure table has all required columns
ALTER TABLE lab_test_catalog ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN IF NOT EXISTS normal_range TEXT;
ALTER TABLE lab_test_catalog ADD COLUMN IF NOT EXISTS method TEXT;
```

---

## Testing Checklist

1. Add new test with all fields
2. Edit existing test
3. Deactivate/reactivate test
4. Search functionality
5. Filter by status/category
6. Category dropdown populated from API
7. Empty state shown when no tests
8. Loading state (skeleton) shown

---

## Success Criteria

- Admin can view all lab tests in Catalog tab
- Admin can add new lab test
- Admin can edit existing lab test
- Admin can deactivate/reactivate test (soft delete)
- Changes reflect immediately in Reception/Lab modules
- All existing functionality (Categories, Templates, etc.) remains working