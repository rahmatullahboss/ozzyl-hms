# IPD Module Gap-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the remaining gaps in the IPD/Admission module — bed/ward management UI, admission form improvements, IPD reports page, and discharge summary polish.

**Architecture:** Extend existing Hono routes in `admissions.ts` + create new `ipdReports.ts` for reports. Frontend follows existing React + TanStack Query + Tailwind patterns. No new DB tables except 2 ALTER TABLE columns.

**Tech Stack:** Hono, Drizzle ORM, D1 (SQLite), React 19, TanStack Query, Tailwind CSS, Zod, Lucide icons

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `src/routes/tenant/ipdReports.ts` | IPD report API endpoints |
| `web/src/pages/IPDReports.tsx` | IPD reports frontend page |
| `web/src/lib/print/dischargeSummaryTemplate.ts` | Discharge summary print template |
| `migrations/0262_ipd_gap_fill.sql` | Migration: add columns |

### Modified Files
| File | Changes |
|------|---------|
| `src/routes/tenant/admissions.ts` | Add ward endpoints, bed DELETE, transfer history |
| `src/schemas/admission.ts` | Add `admission_date`, `department` to createAdmissionSchema |
| `src/index.ts` | Register `ipdReports` route |
| `web/src/pages/BedManagement.tsx` | Ward UI, bed form improvements, edit/delete, feature mgmt |
| `web/src/pages/AdmissionIPD.tsx` | Admission date override, department, transfer history |
| `web/src/pages/DischargeSummary.tsx` | PDF download button fix |
| `web/src/App.tsx` | Add IPDReports route |
| `web/src/lib/queryKeys.ts` | Add ipdReports query keys |

---

## Phase 1: Bed & Ward Management

### Task 1: Migration — Add columns

**Files:**
- Create: `migrations/0262_ipd_gap_fill.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migrations/0262_ipd_gap_fill.sql
-- Add department to admissions
ALTER TABLE admissions ADD COLUMN department TEXT;

-- Add signature_url to discharge_summary_consultants
-- (only if table exists)
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas --local --file=migrations/0262_ipd_gap_fill.sql
```

- [ ] **Step 3: Commit**

```bash
git add migrations/0262_ipd_gap_fill.sql
git commit -m "feat: add department and signature_url columns for IPD gap-fill"
```

---

### Task 2: Schema — Add admission_date and department to createAdmissionSchema

**Files:**
- Modify: `src/schemas/admission.ts:5-20`

- [ ] **Step 1: Update createAdmissionSchema**

In `src/schemas/admission.ts`, add two optional fields to `createAdmissionSchema`:

```ts
export const createAdmissionSchema = z.object({
  patient_id: z.number().int().positive('Patient ID required'),
  bed_id: z.number().int().positive().optional(),
  doctor_id: z.number().int().positive().optional(),
  admission_type: z.enum(['general', 'emergency', 'planned', 'transfer']).default('planned'),
  admit_source: z.enum(['opd_referral', 'emergency', 'planned', 'doctor_referral', 'self', 'transfer', 'walk_in', 'other']).optional(),
  referral_doctor: z.string().max(200).optional(),
  admission_reason: z.string().max(1000).optional(),
  is_emergency: z.boolean().default(false),
  provisional_diagnosis: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  care_of_name: z.string().max(200).optional(),
  care_of_phone: z.string().max(20).optional(),
  care_of_relation: z.string().max(50).optional(),
  admission_date: z.string().max(30).optional(),   // NEW: ISO datetime override
  department: z.string().max(100).optional(),       // NEW: department name
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/admission.ts
git commit -m "feat: add admission_date and department to admission schema"
```

---

### Task 3: Backend — Ward endpoints in admissions.ts

**Files:**
- Modify: `src/routes/tenant/admissions.ts`

- [ ] **Step 1: Add GET /wards endpoint**

Insert after the `/occupancy` endpoint (around line 175):

```ts
// GET /api/admissions/wards — list distinct wards with bed counts
app.get('/wards', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT 
      ward_name,
      COUNT(*) as total_beds,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
      SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
      SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
    FROM beds
    WHERE tenant_id = ?
    GROUP BY ward_name
    ORDER BY ward_name
  `).bind(tenantId).all();
  return c.json({ wards: results });
});
```

- [ ] **Step 2: Add PUT /wards/:name endpoint (rename)**

```ts
// PUT /api/admissions/wards/:name — rename ward
app.put('/wards/:name', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const oldName = c.req.param('name');
  const body = await c.req.json<{ new_name: string }>();
  if (!body.new_name?.trim()) throw new HTTPException(400, { message: 'New name required' });
  
  const role = c.get('role');
  if (!['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  await db.$client.prepare(
    'UPDATE beds SET ward_name = ? WHERE ward_name = ? AND tenant_id = ?'
  ).bind(body.new_name.trim(), oldName, tenantId).run();

  await createAuditLog(c.env, tenantId, requireUserId(c), 'UPDATE', 'wards', oldName, null, { new_name: body.new_name });
  return c.json({ success: true });
});
```

- [ ] **Step 3: Add DELETE /wards/:name endpoint**

```ts
// DELETE /api/admissions/wards/:name — delete ward (only if no beds)
app.delete('/wards/:name', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const name = c.req.param('name');

  const role = c.get('role');
  if (!['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  const bedCount = await db.$client.prepare(
    'SELECT COUNT(*) as cnt FROM beds WHERE ward_name = ? AND tenant_id = ?'
  ).bind(name, tenantId).first<{ cnt: number }>();

  if (bedCount && bedCount.cnt > 0) {
    throw new HTTPException(400, { message: `Cannot delete ward: ${bedCount.cnt} beds still assigned` });
  }

  // Ward is virtual — no actual delete needed, just confirm it's empty
  return c.json({ success: true, message: 'Ward has no beds, effectively removed' });
});
```

- [ ] **Step 4: Add DELETE /beds/:id endpoint**

```ts
// DELETE /api/admissions/beds/:id — delete bed
app.delete('/beds/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const bedId = Number(c.req.param('id'));

  const role = c.get('role');
  if (!['hospital_admin', 'director', 'md'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  const bed = await db.$client.prepare(
    'SELECT * FROM beds WHERE id = ? AND tenant_id = ?'
  ).bind(bedId, tenantId).first();

  if (!bed) throw new HTTPException(404, { message: 'Bed not found' });
  if ((bed as any).status === 'occupied') {
    throw new HTTPException(400, { message: 'Cannot delete occupied bed' });
  }

  await db.$client.prepare(
    'DELETE FROM beds WHERE id = ? AND tenant_id = ?'
  ).bind(bedId, tenantId).run();

  await createAuditLog(c.env, tenantId, requireUserId(c), 'DELETE', 'beds', String(bedId), bed, null);
  return c.json({ success: true });
});
```

- [ ] **Step 5: Add GET /:id/transfers endpoint**

```ts
// GET /api/admissions/:id/transfers — transfer history for an admission
app.get('/:id/transfers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const admissionId = Number(c.req.param('id'));

  const { results } = await db.$client.prepare(`
    SELECT pbi.*, b.ward_name, b.bed_number, b.bed_type
    FROM patient_bed_infos pbi
    LEFT JOIN beds b ON pbi.bed_id = b.id
    WHERE pbi.admission_id = ? AND pbi.tenant_id = ?
    ORDER BY pbi.check_in ASC
  `).bind(admissionId, tenantId).all();

  return c.json({ transfers: results });
});
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/admissions.ts
git commit -m "feat: add ward CRUD, bed delete, transfer history endpoints"
```

---

### Task 4: Backend — Use admission_date and department in create admission

**Files:**
- Modify: `src/routes/tenant/admissions.ts` (POST `/` handler, around line 177-215)

- [ ] **Step 1: Update POST / handler to use admission_date and department**

Find the admission creation logic. The current code uses `datetime('now', '+6 hours')` for admission_date. Update to use the provided date if present:

In the INSERT statement for admissions, add `department` column, and change the admission_date logic:

```ts
// Find this pattern in the POST / handler:
// admission_date: datetime('now', '+6 hours')
// Change to:
const admissionDate = data.admission_date || new Date().toISOString().replace('T', ' ').substring(0, 19);
```

Add `department` to the INSERT columns and values.

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/admissions.ts
git commit -m "feat: support manual admission_date and department in admission creation"
```

---

### Task 5: Frontend — BedManagement improvements

**Files:**
- Modify: `web/src/pages/BedManagement.tsx`

- [ ] **Step 1: Add rate_per_day and status to Add Bed form**

Update `addForm` state (line 72) to include `rate_per_day` and `status`:

```ts
const [addForm, setAddForm] = useState({ 
  ward_name: '', bed_number: '', bed_type: 'general', floor: '', 
  rate_per_day: '', status: 'available' 
});
```

Update the `AddBedPayload` interface (line 43):

```ts
interface AddBedPayload {
  ward_name: string;
  bed_number: string;
  bed_type: string;
  floor?: string;
  rate_per_day?: number;
  status?: string;
}
```

Update the Add Bed modal form to include these fields:

```tsx
{/* Rate per day */}
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">{t('beds.dailyCharge')}</label>
  <input
    type="number"
    value={addForm.rate_per_day}
    onChange={(e) => setAddForm({ ...addForm, rate_per_day: e.target.value })}
    className="w-full border rounded-lg px-3 py-2"
    placeholder="0"
    min="0"
  />
</div>
```

- [ ] **Step 2: Add Edit Bed modal**

Add state for editing bed:

```ts
const [editBed, setEditBed] = useState<BedInfo | null>(null);
const [editForm, setEditForm] = useState({ 
  ward_name: '', bed_number: '', bed_type: 'general', floor: '',
  rate_per_day: '', status: 'available' 
});
```

Add edit mutation:

```ts
const editBedMutation = useApiMutation('put', `/api/admissions/beds/${editBed?.id}`, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
    toast.success(t('beds.bedUpdated'));
    setEditBed(null);
  },
});
```

Add edit button to each bed card and an edit modal similar to add modal but pre-filled.

- [ ] **Step 3: Add Delete Bed functionality**

Add delete mutation:

```ts
const deleteBedMutation = useApiMutation('delete', `/api/admissions/beds/${deleteBedId}`, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
    toast.success(t('beds.bedDeleted'));
    setDeleteBedId(null);
  },
});
```

Add delete button on bed cards (only when status is `available`), with confirmation dialog.

- [ ] **Step 4: Add Ward Management panel**

Add a "Manage Wards" button that opens a panel/modal listing all wards with:
- Ward name, total beds, available count
- Rename button (inline edit)
- Delete button (only if 0 beds)

Use the new `/api/admissions/wards` endpoints.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/BedManagement.tsx
git commit -m "feat: add bed edit/delete, rate_per_day field, ward management UI"
```

---

### Task 6: Frontend — Bed Feature Management UI

**Files:**
- Modify: `web/src/pages/BedManagement.tsx`

- [ ] **Step 1: Add feature assignment to bed detail**

When clicking a bed card, show a detail panel/modal with:
- Current features as tags
- "Add Feature" dropdown (from `GET /api/admissions/bed-features`)
- Remove feature button per tag

Add mutations:
```ts
const assignFeatureMutation = useApiMutation('put', `/api/admissions/beds/${selectedBed?.id}/features`, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
    toast.success('Features updated');
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/BedManagement.tsx
git commit -m "feat: add bed feature management UI"
```

---

## Phase 2: Admission Form Improvements

### Task 7: Frontend — Admission date override and department selector

**Files:**
- Modify: `web/src/pages/AdmissionIPD.tsx`

- [ ] **Step 1: Add admission date/time field to admit form**

In the admit form section, add a collapsible "Custom Date/Time" toggle:

```tsx
const [customAdmitDate, setCustomAdmitDate] = useState(false);
const [admitDateValue, setAdmitDateValue] = useState('');

// In the form, after patient search:
<div className="mt-3">
  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
    <input
      type="checkbox"
      checked={customAdmitDate}
      onChange={(e) => setCustomAdmitDate(e.target.checked)}
      className="rounded"
    />
    {t('admissions.customAdmitDate')}
  </label>
  {customAdmitDate && (
    <input
      type="datetime-local"
      value={admitDateValue}
      onChange={(e) => setAdmitDateValue(e.target.value)}
      className="mt-1 w-full border rounded-lg px-3 py-2"
    />
  )}
</div>
```

Include `admission_date` in the admit payload when `customAdmitDate` is true.

- [ ] **Step 2: Add department selector**

Fetch departments from existing API (or use `billing_service_departments`):

```ts
const { data: departments } = useApiQuery<{ departments: any[] }>(
  ['departments'],
  '/api/billing/departments'
);
```

Add department dropdown in admit form:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">{t('admissions.department')}</label>
  <select
    value={admitForm.department}
    onChange={(e) => setAdmitForm({ ...admitForm, department: e.target.value })}
    className="w-full border rounded-lg px-3 py-2"
  >
    <option value="">{t('common.select')}</option>
    {departments?.departments?.map((d: any) => (
      <option key={d.id} value={d.department_name}>{d.department_name}</option>
    ))}
  </select>
</div>
```

Add `department` to the admit form state and mutation payload.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/AdmissionIPD.tsx
git commit -m "feat: add admission date override and department selector"
```

---

### Task 8: Frontend — Transfer history view

**Files:**
- Modify: `web/src/pages/AdmissionIPD.tsx`

- [ ] **Step 1: Add transfer history section**

When viewing an admission's details, add a "Transfer History" tab/section:

```ts
const { data: transferHistory } = useApiQuery<{ transfers: any[] }>(
  ['admissions', selectedAdmission?.id, 'transfers'],
  `/api/admissions/${selectedAdmission?.id}/transfers`,
  { enabled: !!selectedAdmission?.id }
);
```

Display as a timeline:

```tsx
{transferHistory?.transfers?.map((t, i) => (
  <div key={t.id} className="flex gap-3 items-start">
    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
    <div>
      <p className="font-medium">{t.ward_name} — {t.bed_number}</p>
      <p className="text-sm text-gray-500">
        {t.check_in} → {t.check_out || t('admissions.current')}
      </p>
      <p className="text-xs text-gray-400">{t.bed_type} • {t.days ?? '?'} days</p>
    </div>
  </div>
))}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/AdmissionIPD.tsx
git commit -m "feat: add transfer history view per admission"
```

---

## Phase 3: IPD Reports

### Task 9: Backend — IPD Reports route

**Files:**
- Create: `src/routes/tenant/ipdReports.ts`

- [ ] **Step 1: Create ipdReports.ts**

```ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

// Helper: parse date range
function getDateRange(c: any): { from: string; to: string } {
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
  const to = c.req.query('to') || new Date().toISOString().substring(0, 10);
  return { from, to };
}

// GET /api/ipd-reports/admissions — admission report with date range
app.get('/admissions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const perPage = Math.min(100, Math.max(10, parseInt(c.req.query('perPage') || '50', 10)));
  const offset = (page - 1) * perPage;

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM admissions a
    WHERE a.tenant_id = ? AND DATE(a.admission_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number, d.name AS doctor_name
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN beds b ON a.bed_id = b.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    WHERE a.tenant_id = ? AND DATE(a.admission_date) BETWEEN ? AND ?
    ORDER BY a.admission_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  // Summary
  const summary = await db.$client.prepare(`
    SELECT 
      COUNT(*) as total_admissions,
      SUM(CASE WHEN is_emergency = 1 THEN 1 ELSE 0 END) as emergency_count,
      SUM(CASE WHEN admission_type = 'planned' THEN 1 ELSE 0 END) as planned_count
    FROM admissions
    WHERE tenant_id = ? AND DATE(admission_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  return c.json({ admissions: results, total: countRow?.total ?? 0, page, perPage, summary });
});

// GET /api/ipd-reports/discharges — discharge report with date range
app.get('/discharges', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const perPage = Math.min(100, Math.max(10, parseInt(c.req.query('perPage') || '50', 10)));
  const offset = (page - 1) * perPage;

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM admissions a
    WHERE a.tenant_id = ? AND a.status = 'discharged' AND DATE(a.discharge_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number, d.name AS doctor_name
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN beds b ON a.bed_id = b.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    WHERE a.tenant_id = ? AND a.status = 'discharged' AND DATE(a.discharge_date) BETWEEN ? AND ?
    ORDER BY a.discharge_date DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  const summary = await db.$client.prepare(`
    SELECT 
      COUNT(*) as total_discharges,
      AVG(julianday(discharge_date) - julianday(admission_date)) as avg_stay_days
    FROM admissions
    WHERE tenant_id = ? AND status = 'discharged' AND DATE(discharge_date) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first();

  return c.json({ discharges: results, total: countRow?.total ?? 0, page, perPage, summary });
});

// GET /api/ipd-reports/transfers — bed transfer report
app.get('/transfers', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const perPage = Math.min(100, Math.max(10, parseInt(c.req.query('perPage') || '50', 10)));
  const offset = (page - 1) * perPage;

  const countRow = await db.$client.prepare(`
    SELECT COUNT(*) as total FROM patient_bed_infos pbi
    WHERE pbi.tenant_id = ? AND DATE(pbi.check_in) BETWEEN ? AND ?
  `).bind(tenantId, from, to).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT pbi.*, p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number, b.bed_type,
           a.admission_no
    FROM patient_bed_infos pbi
    LEFT JOIN beds b ON pbi.bed_id = b.id
    LEFT JOIN admissions a ON pbi.admission_id = a.id
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE pbi.tenant_id = ? AND DATE(pbi.check_in) BETWEEN ? AND ?
    ORDER BY pbi.check_in DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, from, to, perPage, offset).all();

  return c.json({ transfers: results, total: countRow?.total ?? 0, page, perPage });
});

// GET /api/ipd-reports/revenue — IPD revenue report
app.get('/revenue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { from, to } = getDateRange(c);

  // Revenue by charge type
  const { results: byType } = await db.$client.prepare(`
    SELECT charge_type, SUM(amount) as total
    FROM ipd_charges
    WHERE tenant_id = ? AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY charge_type
    ORDER BY total DESC
  `).bind(tenantId, from, to).all();

  // Revenue by ward
  const { results: byWard } = await db.$client.prepare(`
    SELECT b.ward_name, SUM(ic.amount) as total
    FROM ipd_charges ic
    LEFT JOIN admissions a ON ic.admission_id = a.id
    LEFT JOIN beds b ON a.bed_id = b.id
    WHERE ic.tenant_id = ? AND DATE(ic.created_at) BETWEEN ? AND ?
    GROUP BY b.ward_name
    ORDER BY total DESC
  `).bind(tenantId, from, to).all();

  // Daily trend
  const { results: daily } = await db.$client.prepare(`
    SELECT DATE(created_at) as date, SUM(amount) as total
    FROM ipd_charges
    WHERE tenant_id = ? AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at)
    ORDER BY date
  `).bind(tenantId, from, to).all();

  const totalRevenue = byType.reduce((sum: number, r: any) => sum + (r.total || 0), 0);

  return c.json({ byType, byWard, daily, totalRevenue });
});

// GET /api/ipd-reports/ward-patients — ward-wise patient count
app.get('/ward-patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT 
      b.ward_name,
      COUNT(DISTINCT b.id) as total_beds,
      COUNT(DISTINCT CASE WHEN b.status = 'occupied' THEN b.id END) as occupied_beds,
      COUNT(DISTINCT a.id) as admitted_patients
    FROM beds b
    LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'admitted' AND a.tenant_id = ?
    WHERE b.tenant_id = ?
    GROUP BY b.ward_name
    ORDER BY b.ward_name
  `).bind(tenantId, tenantId).all();

  return c.json({ wards: results });
});

export default app;
```

- [ ] **Step 2: Register route in src/index.ts**

Add import:
```ts
import ipdReportRoutes from './routes/tenant/ipdReports';
```

Add route registration (near line 668, after admissions route):
```ts
app.route('/api/ipd-reports', ipdReportRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/ipdReports.ts src/index.ts
git commit -m "feat: add IPD report endpoints (admissions, discharges, transfers, revenue, ward-patients)"
```

---

### Task 10: Frontend — IPD Reports page

**Files:**
- Create: `web/src/pages/IPDReports.tsx`

- [ ] **Step 1: Create IPDReports.tsx**

Full page component with tab-based reports. Key structure:

```tsx
import { useState } from 'react';
import { useParams } from 'react-router';
import { FileText, Download, Printer, BarChart3, TrendingUp, Users, ArrowRightLeft, BedDouble } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';

type ReportTab = 'admitted' | 'occupancy' | 'admissions' | 'discharges' | 'transfers' | 'revenue';

export default function IPDReports({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ipd', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = useState<ReportTab>('admitted');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().substring(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().substring(0, 10));

  const tabs = [
    { key: 'admitted' as const, label: t('reports.currentAdmitted'), icon: Users },
    { key: 'occupancy' as const, label: t('reports.bedOccupancy'), icon: BedDouble },
    { key: 'admissions' as const, label: t('reports.admissions'), icon: FileText },
    { key: 'discharges' as const, label: t('reports.discharges'), icon: FileText },
    { key: 'transfers' as const, label: t('reports.transfers'), icon: ArrowRightLeft },
    { key: 'revenue' as const, label: t('reports.revenue'), icon: TrendingUp },
  ];

  return (
    <DashboardLayout>
      <div className="p-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{t('reports.ipdReports')}</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <span className="text-gray-400">—</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Report content */}
        {activeTab === 'admitted' && <AdmittedPatientsReport />}
        {activeTab === 'occupancy' && <BedOccupancyReport />}
        {activeTab === 'admissions' && <AdmissionReport from={dateFrom} to={dateTo} />}
        {activeTab === 'discharges' && <DischargeReport from={dateFrom} to={dateTo} />}
        {activeTab === 'transfers' && <TransferReport from={dateFrom} to={dateTo} />}
        {activeTab === 'revenue' && <RevenueReport from={dateFrom} to={dateTo} />}
      </div>
    </DashboardLayout>
  );
}
```

Each report sub-component:
- `AdmittedPatientsReport` — fetches `/api/admissions?status=admitted`, table with print/export
- `BedOccupancyReport` — fetches `/api/ipd-reports/ward-patients`, bar chart + table
- `AdmissionReport` — fetches `/api/ipd-reports/admissions?from=&to=`, table + summary cards
- `DischargeReport` — fetches `/api/ipd-reports/discharges?from=&to=`, table + summary
- `TransferReport` — fetches `/api/ipd-reports/transfers?from=&to=`, table
- `RevenueReport` — fetches `/api/ipd-reports/revenue?from=&to=`, charts + breakdown tables

Add CSV export helper:
```ts
function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Add route to App.tsx**

Add lazy import:
```ts
const IPDReports = lazy(() => import('./pages/IPDReports'));
```

Add route (near other IPD routes):
```tsx
<Route path="ipd-reports" element={<IPDReports role="hospital_admin" />} />
```

- [ ] **Step 3: Add query keys**

In `web/src/lib/queryKeys.ts`, add to the reports object:

```ts
ipdReports: {
  admissions: (from: string, to: string) => ['ipdReports', 'admissions', from, to] as const,
  discharges: (from: string, to: string) => ['ipdReports', 'discharges', from, to] as const,
  transfers: (from: string, to: string) => ['ipdReports', 'transfers', from, to] as const,
  revenue: (from: string, to: string) => ['ipdReports', 'revenue', from, to] as const,
  wardPatients: () => ['ipdReports', 'wardPatients'] as const,
},
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/IPDReports.tsx web/src/App.tsx web/src/lib/queryKeys.ts
git commit -m "feat: add IPD reports page with 6 report tabs"
```

---

## Phase 4: Discharge Summary Polish

### Task 11: Discharge summary print template

**Files:**
- Create: `web/src/lib/print/dischargeSummaryTemplate.ts`

- [ ] **Step 1: Create print template**

Follow the pattern from `admissionSlipTemplate.ts`:

```ts
import { printHtml, formatDate } from './printUtils';

export interface DischargeSummaryPrintData {
  hospital?: { name?: string; address?: string; phone?: string; logo_url?: string };
  patientName: string;
  patientCode: string;
  admissionDate: string;
  dischargeDate: string;
  wardName: string;
  bedNumber: string;
  doctorName: string;
  diagnosis: string;
  treatmentSummary: string;
  investigationSummary: string;
  medicines: Array<{ name: string; dose: string; frequency: string; duration: string }>;
  followUpDate: string;
  followUpInstructions: string;
  consultants: Array<{ name: string; role: string }>;
}

export function printDischargeSummary(data: DischargeSummaryPrintData): void {
  const html = `
    <div style="text-align:center;margin-bottom:20px;">
      ${data.hospital?.logo_url ? `<img src="${data.hospital.logo_url}" style="height:60px;margin-bottom:8px;" />` : ''}
      <h1 style="margin:0;font-size:20px;">${data.hospital?.name ?? 'Hospital'}</h1>
      <p style="margin:2px 0;color:#666;font-size:12px;">${data.hospital?.address ?? ''} ${data.hospital?.phone ? '• ' + data.hospital.phone : ''}</p>
      <h2 style="margin:10px 0;font-size:16px;border-bottom:2px solid #333;padding-bottom:5px;">DISCHARGE SUMMARY</h2>
    </div>

    <div style="display:flex;justify-content:space-between;margin-bottom:15px;font-size:13px;">
      <div>
        <strong>Patient:</strong> ${data.patientName} (${data.patientCode})<br/>
        <strong>Ward/Bed:</strong> ${data.wardName} / ${data.bedNumber}<br/>
        <strong>Doctor:</strong> ${data.doctorName}
      </div>
      <div style="text-align:right;">
        <strong>Admission:</strong> ${formatDate(data.admissionDate)}<br/>
        <strong>Discharge:</strong> ${formatDate(data.dischargeDate)}<br/>
        <strong>Duration:</strong> ${Math.ceil((new Date(data.dischargeDate).getTime() - new Date(data.admissionDate).getTime()) / 86400000)} days
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <h3 style="font-size:14px;margin-bottom:5px;">Diagnosis</h3>
      <p style="font-size:13px;">${data.diagnosis || '-'}</p>
    </div>

    <div style="margin-bottom:12px;">
      <h3 style="font-size:14px;margin-bottom:5px;">Treatment Summary</h3>
      <p style="font-size:13px;white-space:pre-wrap;">${data.treatmentSummary || '-'}</p>
    </div>

    <div style="margin-bottom:12px;">
      <h3 style="font-size:14px;margin-bottom:5px;">Investigation Summary</h3>
      <p style="font-size:13px;white-space:pre-wrap;">${data.investigationSummary || '-'}</p>
    </div>

    ${data.medicines.length ? `
    <div style="margin-bottom:12px;">
      <h3 style="font-size:14px;margin-bottom:5px;">Medicines on Discharge</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="background:#f3f4f6;">
          <th style="border:1px solid #ddd;padding:5px;text-align:left;">Medicine</th>
          <th style="border:1px solid #ddd;padding:5px;">Dose</th>
          <th style="border:1px solid #ddd;padding:5px;">Frequency</th>
          <th style="border:1px solid #ddd;padding:5px;">Duration</th>
        </tr>
        ${data.medicines.map(m => `
        <tr>
          <td style="border:1px solid #ddd;padding:5px;">${m.name}</td>
          <td style="border:1px solid #ddd;padding:5px;text-align:center;">${m.dose}</td>
          <td style="border:1px solid #ddd;padding:5px;text-align:center;">${m.frequency}</td>
          <td style="border:1px solid #ddd;padding:5px;text-align:center;">${m.duration}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${data.followUpDate || data.followUpInstructions ? `
    <div style="margin-bottom:12px;">
      <h3 style="font-size:14px;margin-bottom:5px;">Follow-up</h3>
      ${data.followUpDate ? `<p style="font-size:13px;"><strong>Date:</strong> ${formatDate(data.followUpDate)}</p>` : ''}
      ${data.followUpInstructions ? `<p style="font-size:13px;white-space:pre-wrap;">${data.followUpInstructions}</p>` : ''}
    </div>` : ''}

    <div style="margin-top:40px;display:flex;justify-content:space-between;">
      ${data.consultants.map(c => `
      <div style="text-align:center;">
        <div style="border-top:1px solid #333;width:150px;margin:0 auto;padding-top:5px;">
          <strong>${c.name}</strong><br/>
          <span style="font-size:12px;color:#666;">${c.role}</span>
        </div>
      </div>`).join('')}
    </div>
  `;
  printHtml(html);
}
```

- [ ] **Step 2: Wire up in DischargeSummary.tsx**

Find the PDF download handler (line ~347) that shows "coming soon" toast. Replace with:

```ts
import { printDischargeSummary } from '../lib/print/dischargeSummaryTemplate';

// In the handler:
printDischargeSummary({
  hospital: hospitalInfo,
  patientName: summary.patient_name,
  patientCode: summary.patient_code,
  admissionDate: summary.admission_date,
  dischargeDate: summary.discharge_date,
  wardName: summary.ward_name,
  bedNumber: summary.bed_number,
  doctorName: summary.doctor_name,
  diagnosis: summary.final_diagnosis || summary.provisional_diagnosis || '',
  treatmentSummary: summary.treatment_summary || '',
  investigationSummary: summary.investigation_summary || '',
  medicines: dischargeMedicines || [],
  followUpDate: summary.follow_up_date || '',
  followUpInstructions: summary.follow_up_instructions || '',
  consultants: consultants || [],
});
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/print/dischargeSummaryTemplate.ts web/src/pages/DischargeSummary.tsx
git commit -m "feat: add discharge summary print template, replace coming-soon toast"
```

---

### Task 12: Final verification

- [ ] **Step 1: Build check**

```bash
cd web && pnpm build
```

Expected: No errors.

- [ ] **Step 2: Type check**

```bash
cd web && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "chore: final fixes for IPD gap-fill"
```
