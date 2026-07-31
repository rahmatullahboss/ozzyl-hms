# Implementation Plan: Missing Backend Routes for PR #88

**PR #88 Review Issues:**
1. `/api/departments` - Missing backend route for DepartmentsSettings.tsx
2. `/api/payment-methods` - Missing backend route for PaymentMethodsSettings.tsx
3. `/api/import/*` and `/api/export/*` - Missing backend routes for ImportExportSettings.tsx

---

## Issue 1: `/api/departments` Route

**Current State:**
- `billing_service_departments` table exists with columns: `id`, `department_name`, `department_code`, `parent_id`, `is_active`, `tenant_id`, `created_by`, `created_at`, `updated_at`
- Frontend expects: `{ departments: Department[] }` where Department has `{ id, name, code, opd, ipd, status }`
- Existing read-only endpoint at `/api/billing/departments` (line 678 of billing.ts) but it only returns departments with active service items

**Solution:** Create new route file `src/routes/tenant/departments.ts` with full CRUD operations.

**Files to Create:**
- `src/routes/tenant/departments.ts`

**Files to Modify:**
- `src/index.ts` - Add import and mount at `/api/departments`

**Implementation:**

```typescript
// src/routes/tenant/departments.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const departments = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / - List all departments
departments.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  
  const { results } = await db.$client.prepare(
    `SELECT id, department_name as name, department_code as code, 
     CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END as status
     FROM billing_service_departments 
     WHERE tenant_id = ? 
     ORDER BY department_name`
  ).bind(tenantId).all();
  
  return c.json({ departments: results });
});

// POST / - Create or update department
departments.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json();
  
  if (body.id) {
    // Update existing
    await db.$client.prepare(
      `UPDATE billing_service_departments 
       SET department_name = ?, department_code = ?, updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`
    ).bind(body.name, body.code, body.id, tenantId).run();
    return c.json({ message: 'Department updated' });
  } else {
    // Create new
    const result = await db.$client.prepare(
      `INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id)
       VALUES (?, ?, 1, ?)`
    ).bind(body.name, body.code, tenantId).run();
    return c.json({ message: 'Department created', id: result.meta.last_row_id }, 201);
  }
});

// PUT / - Toggle department status
departments.put('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json();
  
  const isActive = body.status === 'active' ? 1 : 0;
  
  await db.$client.prepare(
    `UPDATE billing_service_departments 
     SET is_active = ?, updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(isActive, body.id, tenantId).run();
  
  return c.json({ message: 'Department status updated' });
});

export default departments;
```

**Registration in `src/index.ts`:**
```typescript
import departmentRoutes from './routes/tenant/departments';
// ... after line 593
app.route('/api/departments', departmentRoutes);
```

---

## Issue 2: `/api/payment-methods` Route

**Current State:**
- No `payment_methods` table exists
- Payment methods are hardcoded strings in the codebase: `['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other']`
- Frontend expects: `{ methods: PaymentMethod[] }` where PaymentMethod has `{ id, name, code, active, transaction_id_required, charge_applicable }`

**Solution:** Create migration for new table, add schema, create route file.

**Files to Create:**
- `migrations/XXXX_payment_methods_table.sql`
- `src/routes/tenant/payment-methods.ts`

**Files to Modify:**
- `src/db/schema/schema.ts` - Add paymentMethods table schema
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

**Schema addition to `src/db/schema/schema.ts`:**
```typescript
export const paymentMethods = sqliteTable("payment_methods", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  code: text().notNull(),
  active: integer().notNull().default(1),
  transactionIdRequired: integer("transaction_id_required").notNull().default(0),
  chargeApplicable: integer("charge_applicable").notNull().default(0),
  tenantId: text("tenant_id").notNull(),
  createdBy: integer("created_by"),
  createdAt: text("created_at").default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index("idx_payment_methods_tenant").on(table.tenantId, table.active),
]);
```

**Route Implementation:**
```typescript
// src/routes/tenant/payment-methods.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const paymentMethods = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET / - List all payment methods
paymentMethods.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  
  const { results } = await db.$client.prepare(
    `SELECT id, name, code, 
     CASE WHEN active = 1 THEN true ELSE false END as active,
     CASE WHEN transaction_id_required = 1 THEN true ELSE false END as transaction_id_required,
     CASE WHEN charge_applicable = 1 THEN true ELSE false END as charge_applicable
     FROM payment_methods 
     WHERE tenant_id = ? 
     ORDER BY name`
  ).bind(tenantId).all();
  
  return c.json({ methods: results });
});

// POST / - Create or update payment method
paymentMethods.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json();
  
  if (body.id) {
    // Update existing
    await db.$client.prepare(
      `UPDATE payment_methods 
       SET name = ?, code = ?, active = ?, transaction_id_required = ?, charge_applicable = ?,
           updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`
    ).bind(
      body.name, body.code, 
      body.active ? 1 : 0,
      body.transaction_id_required ? 1 : 0,
      body.charge_applicable ? 1 : 0,
      body.id, tenantId
    ).run();
    return c.json({ message: 'Payment method updated' });
  } else {
    // Create new
    const result = await db.$client.prepare(
      `INSERT INTO payment_methods (name, code, active, transaction_id_required, charge_applicable, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      body.name, body.code,
      body.active ? 1 : 0,
      body.transaction_id_required ? 1 : 0,
      body.charge_applicable ? 1 : 0,
      tenantId
    ).run();
    return c.json({ message: 'Payment method created', id: result.meta.last_row_id }, 201);
  }
});

// PUT / - Toggle payment method status
paymentMethods.put('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json();
  
  await db.$client.prepare(
    `UPDATE payment_methods 
     SET active = ?, updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(body.active ? 1 : 0, body.id, tenantId).run();
  
  return c.json({ message: 'Payment method status updated' });
});

export default paymentMethods;
```

**Registration in `src/index.ts`:**
```typescript
import paymentMethodRoutes from './routes/tenant/payment-methods';
// ... after department routes
app.route('/api/payment-methods', paymentMethodRoutes);
```

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

**Implementation:**

```typescript
// src/routes/tenant/settings-import-export.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const settingsImportExport = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper functions (reuse from inventory/importExport.ts)
function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(',')),
  ].join('\n');
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ─── Import Services ────────────────────────────────────────────────
settingsImportExport.post('/import/services', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  
  const body = await c.req.json();
  const csvText = body.csv || body.file;
  
  if (!csvText) {
    throw new HTTPException(400, { message: 'CSV data is required' });
  }
  
  const rows = parseCsv(csvText);
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const row of rows) {
    try {
      const name = row.name || row.service_name || row.ServiceName;
      const code = row.code || row.service_code || row.ServiceCode;
      const departmentCode = row.department || row.department_code || 'GENERAL';
      
      if (!name) {
        failed++;
        errors.push(`Row ${success + failed}: Missing service name`);
        continue;
      }
      
      // Find department
      const dept = await db.$client.prepare(
        `SELECT id FROM billing_service_departments WHERE department_code = ? AND tenant_id = ?`
      ).bind(departmentCode, tenantId).first();
      
      if (!dept) {
        failed++;
        errors.push(`Row ${success + failed}: Department '${departmentCode}' not found`);
        continue;
      }
      
      // Insert service item
      await db.$client.prepare(
        `INSERT INTO billing_service_items (service_name, service_code, service_department_id, is_active, tenant_id)
         VALUES (?, ?, ?, 1, ?)`
      ).bind(name, code || null, dept.id, tenantId).run();
      
      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${success + failed}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  
  return c.json({ success, failed, errors: errors.slice(0, 20) });
});

// ─── Import Medicines ───────────────────────────────────────────────
settingsImportExport.post('/import/medicines', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  
  const body = await c.req.json();
  const csvText = body.csv || body.file;
  
  if (!csvText) {
    throw new HTTPException(400, { message: 'CSV data is required' });
  }
  
  const rows = parseCsv(csvText);
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const row of rows) {
    try {
      const name = row.name || row.medicine_name || row.ItemName;
      const generic = row.generic || row.generic_name || row.GenericName;
      const company = row.company || row.manufacturer || row.CompanyName;
      
      if (!name) {
        failed++;
        errors.push(`Row ${success + failed}: Missing medicine name`);
        continue;
      }
      
      await db.$client.prepare(
        `INSERT INTO InventoryItem (ItemName, GenericName, BrandName, ItemType, IsActive, tenant_id)
         VALUES (?, ?, ?, 'medicine', 1, ?)`
      ).bind(name, generic || null, company || null, tenantId).run();
      
      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${success + failed}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  
  return c.json({ success, failed, errors: errors.slice(0, 20) });
});

// ─── Import Patients ────────────────────────────────────────────────
settingsImportExport.post('/import/patients', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  
  const body = await c.req.json();
  const csvText = body.csv || body.file;
  
  if (!csvText) {
    throw new HTTPException(400, { message: 'CSV data is required' });
  }
  
  const rows = parseCsv(csvText);
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  
  for (const row of rows) {
    try {
      const name = row.name || row.patient_name || row.PatientName;
      const phone = row.phone || row.mobile || row.PhoneNumber;
      const gender = row.gender || row.Gender || 'other';
      const dob = row.dob || row.date_of_birth || row.DateOfBirth;
      
      if (!name) {
        failed++;
        errors.push(`Row ${success + failed}: Missing patient name`);
        continue;
      }
      
      await db.$client.prepare(
        `INSERT INTO patients (name, phone, gender, date_of_birth, tenant_id, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).bind(name, phone || null, gender, dob || null, tenantId).run();
      
      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${success + failed}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  
  return c.json({ success, failed, errors: errors.slice(0, 20) });
});

// ─── Export Patients ────────────────────────────────────────────────
settingsImportExport.post('/export/patients', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';
  
  const { results } = await db.$client.prepare(
    `SELECT id, name, phone, gender, date_of_birth, email, address, created_at
     FROM patients WHERE tenant_id = ? ORDER BY name`
  ).bind(tenantId).all();
  
  if (format === 'json') {
    return c.json({ data: results });
  }
  
  return new Response(toCsv(results || []), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="patients-export.csv"',
    },
  });
});

// ─── Export Billing ─────────────────────────────────────────────────
settingsImportExport.post('/export/billing', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';
  
  const { results } = await db.$client.prepare(
    `SELECT b.id, b.invoice_no, p.name as patient_name, b.total_amount,
            b.discount, b.net_amount, b.payment_status, b.created_at
     FROM billing b
     LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
     WHERE b.tenant_id = ?
     ORDER BY b.created_at DESC`
  ).bind(tenantId).all();
  
  if (format === 'json') {
    return c.json({ data: results });
  }
  
  return new Response(toCsv(results || []), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="billing-export.csv"',
    },
  });
});

// ─── Export Lab Reports ─────────────────────────────────────────────
settingsImportExport.post('/export/lab', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';
  
  const { results } = await db.$client.prepare(
    `SELECT t.id, p.name as patient_name, t.test_name, t.status,
            t.result, t.created_at, t.completed_at
     FROM tests t
     LEFT JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
     WHERE t.tenant_id = ?
     ORDER BY t.created_at DESC`
  ).bind(tenantId).all();
  
  if (format === 'json') {
    return c.json({ data: results });
  }
  
  return new Response(toCsv(results || []), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="lab-reports-export.csv"',
    },
  });
});

// ─── Sample Templates ───────────────────────────────────────────────
const SAMPLE_TEMPLATES: Record<string, string> = {
  services: 'name,code,department\nGeneral Consultation,CONSULT-001,OPD\nBlood Test,LAB-001,LAB',
  medicines: 'name,generic,company\nParacetamol 500mg,Paracetamol,Square\nAmoxicillin 250mg,Amoxicillin,Renata',
  patients: 'name,phone,gender,dob\nJohn Doe,01712345678,male,1990-01-15\nJane Doe,01812345679,female,1985-05-20',
};

settingsImportExport.get('/import/:type/sample', async (c) => {
  const type = c.req.param('type');
  const template = SAMPLE_TEMPLATES[type];
  
  if (!template) {
    throw new HTTPException(404, { message: 'Sample template not found' });
  }
  
  return new Response(template, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${type}-sample.csv"`,
    },
  });
});

export default settingsImportExport;
```

**Registration in `src/index.ts`:**
```typescript
import settingsImportExportRoutes from './routes/tenant/settings-import-export';
// ... after payment method routes
app.route('/api', settingsImportExportRoutes);
```

---

## Summary of Changes

| File | Action | Purpose |
|------|--------|---------|
| `src/routes/tenant/departments.ts` | Create | CRUD for departments |
| `src/routes/tenant/payment-methods.ts` | Create | CRUD for payment methods |
| `src/routes/tenant/settings-import-export.ts` | Create | Import/export endpoints |
| `migrations/XXXX_payment_methods_table.sql` | Create | New table for payment methods |
| `src/db/schema/schema.ts` | Modify | Add paymentMethods schema |
| `src/index.ts` | Modify | Register 3 new route modules |

---

## Testing Checklist

- [ ] `GET /api/departments` returns department list
- [ ] `POST /api/departments` creates new department
- [ ] `PUT /api/departments` updates department
- [ ] `PUT /api/departments` with status toggle works
- [ ] `GET /api/payment-methods` returns methods list
- [ ] `POST /api/payment-methods` creates new method
- [ ] `PUT /api/payment-methods` toggles status
- [ ] `POST /api/import/services` imports CSV
- [ ] `POST /api/import/medicines` imports CSV
- [ ] `POST /api/import/patients` imports CSV
- [ ] `POST /api/export/patients?format=csv` exports CSV
- [ ] `POST /api/export/billing?format=csv` exports CSV
- [ ] `POST /api/export/lab?format=csv` exports CSV
- [ ] `GET /api/import/services/sample` downloads sample
- [ ] All endpoints require authentication (tenant middleware)
- [ ] All endpoints are tenant-scoped

---

## Deployment

After implementation:
1. Run `pnpm build` to verify TypeScript compilation
2. Run migration for payment_methods table
3. Deploy with `pnpm build && wrangler deploy --env production`
