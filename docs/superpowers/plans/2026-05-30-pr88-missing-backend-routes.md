# Implementation Plan: Missing Backend Routes for Settings Pages

**PR #88 Review Issues:**
1. `/api/departments` - No backend route (frontend expects CRUD)
2. `/api/payment-methods` - No backend route (frontend expects CRUD)
3. `/api/import/*` and `/api/export/*` - No backend routes (frontend expects import/export)

---

## Issue 1: `/api/departments` Route

**Current State:**
- `billing_service_departments` table exists with: `id`, `department_name`, `department_code`, `parent_id`, `is_active`, `tenant_id`, `created_by`, `created_at`, `updated_at`
- Frontend expects: `{ id, name, code, opd, ipd, status }` where `status` is 'active' | 'inactive'
- Existing read-only endpoint at `/api/billing/departments` (line 678 of billing.ts)

**Solution:** Create new route file `src/routes/tenant/departments.ts` with full CRUD.

**Files to Create:**
- `src/routes/tenant/departments.ts`

**Files to Modify:**
- `src/index.ts` - Add import and mount at `/api/departments`

**Schema Mapping:**
| Frontend Field | Database Column | Transform |
|---------------|----------------|-----------|
| `id` | `id` | Direct |
| `name` | `department_name` | Rename |
| `code` | `department_code` | Rename |
| `opd` | N/A | Not in DB - skip for now (frontend can add later) |
| `ipd` | N/A | Not in DB - skip for now |
| `status` | `is_active` | Map: 1 → 'active', 0 → 'inactive' |

**Endpoints:**
- `GET /api/departments` - List all departments for tenant
- `POST /api/departments` - Create department
- `PUT /api/departments` - Update department (with `id` in body)
- `PUT /api/departments/status` - Toggle status (with `id` and `status` in body)

**Template:** Use `src/routes/tenant/priceCategories.ts` pattern (lines 1-7 show imports and structure)

---

## Issue 2: `/api/payment-methods` Route

**Current State:**
- No `payment_methods` table exists
- Payment methods are hardcoded strings in code: `['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other']`
- Frontend expects: `{ id, name, code, active, transaction_id_required, charge_applicable }`

**Solution:** Create migration for new table + route file.

**Files to Create:**
- `migrations/XXXX_payment_methods_table.sql`
- `src/routes/tenant/payment-methods.ts`

**Files to Modify:**
- `src/index.ts` - Add import and mount at `/api/payment-methods`

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  transaction_id_required INTEGER NOT NULL DEFAULT 0,
  charge_applicable INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_payment_methods_tenant ON payment_methods(tenant_id, active);
```

**Endpoints:**
- `GET /api/payment-methods` - List all payment methods for tenant
- `POST /api/payment-methods` - Create payment method
- `PUT /api/payment-methods` - Update payment method (with `id` in body)
- `PUT /api/payment-methods/status` - Toggle status (with `id` and `active` in body)

**Template:** Use `src/routes/tenant/priceCategories.ts` pattern

---

## Issue 3: `/api/import/*` and `/api/export/*` Routes

**Current State:**
- Inventory import/export exists at `/api/inventory/import-export/` (file: `src/routes/tenant/inventory/importExport.ts`)
- Frontend expects:
  - `POST /api/import/services` - Import services from CSV/Excel
  - `POST /api/import/medicines` - Import medicines from CSV/Excel
  - `POST /api/import/patients` - Import patients from CSV/Excel
  - `POST /api/export/patients?format={format}` - Export patients
  - `POST /api/export/billing?format={format}` - Export billing data
  - `POST /api/export/lab?format={format}` - Export lab reports
  - `GET /api/import/{type}/sample` - Download sample CSV template

**Solution:** Create new route file `src/routes/tenant/settings-import-export.ts` with all import/export endpoints.

**Files to Create:**
- `src/routes/tenant/settings-import-export.ts`

**Files to Modify:**
- `src/index.ts` - Add import and mount at `/api`

**Endpoints:**
- `POST /api/import/services` - Parse CSV, validate, insert into `billing_service_items`
- `POST /api/import/medicines` - Parse CSV, validate, insert into pharmacy items
- `POST /api/import/patients` - Parse CSV, validate, insert into `patients` table
- `POST /api/export/patients` - Query patients, return CSV/JSON
- `POST /api/export/billing` - Query invoices, return CSV/JSON
- `POST /api/export/lab` - Query lab tests, return CSV/JSON
- `GET /api/import/:type/sample` - Return sample CSV template

**Template:** Use `src/routes/tenant/inventory/importExport.ts` pattern (lines 1-257 show CSV parsing, import, export patterns)

**CSV Parsing:** Reuse the `parseCsv` and `toCsv` helper functions from inventory importExport.ts

---

## Implementation Order

1. **Create `/api/departments` route** (simplest - uses existing table)
2. **Create `/api/payment-methods` route** (requires migration + new table)
3. **Create `/api/import/*` and `/api/export/*` routes** (most complex - multiple endpoints)

---

## Testing

After implementation:
1. Run `pnpm build` to verify TypeScript compilation
2. Run `pnpm dev` to test locally
3. Test each endpoint manually or with curl
4. Verify frontend pages load data correctly

---

## Risk Assessment

- **Low Risk:** Departments route (existing table, simple CRUD)
- **Medium Risk:** Payment methods route (new table, needs migration)
- **Medium Risk:** Import/export routes (complex parsing, multiple tables)

---

## References

- Existing CRUD pattern: `src/routes/tenant/priceCategories.ts`
- Import/export pattern: `src/routes/tenant/inventory/importExport.ts`
- Tenant scoping: `src/lib/context-helpers.ts` (requireTenantId)
- DB access: `src/db/index.ts` (getDb)
- Route mounting: `src/index.ts` lines 591-630
