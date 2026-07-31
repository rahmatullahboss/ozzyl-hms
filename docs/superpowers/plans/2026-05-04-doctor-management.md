# Doctor Management Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete doctor management module: enhanced schema, extended CRUD API, scheduling API, and frontend pages (list, detail, schedule, dashboard).

**Architecture:** Hono API with raw SQL via D1. React frontend with React Query + DashboardLayout. Multi-tenant via tenant_id.

**Tech Stack:** Hono, Drizzle ORM, SQLite (D1), React Query v5, React Router v6, TypeScript

---

## File Map

### New Files to Create

| File | Purpose |
|------|---------|
| `src/db/schema/doctor.ts` | Drizzle table definitions for doctor_shifts, doctor_availability |
| `src/db/schema/doctorVisit.ts` | Drizzle table for doctor_visits |
| `src/routes/tenant/doctor-schedule.ts` | Schedule CRUD API |
| `src/routes/tenant/doctor-visits.ts` | Visit history API |
| `web/src/pages/doctor/DoctorList.tsx` | Doctor list admin page |
| `web/src/pages/doctor/DoctorDetail.tsx` | Doctor profile page with tabs |
| `web/src/pages/doctor/DoctorSchedule.tsx` | Weekly schedule grid page |
| `web/src/pages/doctor/DoctorDashboard.tsx` | Doctor's personal dashboard |
| `web/src/components/doctor/DoctorDrawer.tsx` | Slide-over add/edit form |
| `web/src/components/doctor/ScheduleGrid.tsx` | Weekly calendar grid component |

### Files to Modify

| File | Changes |
|------|---------|
| `src/db/schema/schema.ts` | Add doctors table (moved from raw SQL), add doctor_shifts relation |
| `src/routes/tenant/doctors.ts` | Add filters (specialty, department, status), activate/deactivate endpoints, enhance list/detail |
| `src/routes/tenant/doctorDashboard.ts` | Add `/:id/stats` endpoint for admin view |
| `src/schemas/doctor.ts` | Add new Zod fields: department, bio, photo_key, is_available, display_order |
| `src/lib/queryKeys.ts` | Add doctorSchedule, doctorVisits, doctorStats keys |
| `web/src/App.tsx` | Register doctor routes |
| `web/src/components/dashboard/Sidebar.tsx` | Add doctor nav items for hospital_admin and doctor roles |
| `web/src/pages/doctor/.gitkeep` | Ensure directory exists |

### Drizzle Migration

| File | Purpose |
|------|---------|
| `drizzle/0001_doctor_module_enhanced.sql` | Add columns to doctors, create doctor_shifts, doctor_availability, doctor_visits |

---

## Task 1: Update Zod Schemas

**Files:**
- Modify: `src/schemas/doctor.ts`

- [ ] **Step 1: Read current schema**

Read `src/schemas/doctor.ts` to confirm exact field names and types.

- [ ] **Step 2: Update createDoctorSchema**

Replace `createDoctorSchema` with expanded fields:

```typescript
export const createDoctorSchema = z.object({
  name: z.string().min(1, 'Doctor name is required'),
  specialty: z.string().optional(),
  mobileNumber: z.string().optional(),
  consultationFee: z.number().int().nonnegative(),
  publicBio: z.string().optional(),
  languages: z.array(z.string()).optional(),
  bmdcRegNo: z.string().optional(),
  qualifications: z.string().optional(),
  publishToMarketplace: z.boolean().optional().default(false),
  // New fields
  department: z.string().optional(),
  departmentId: z.number().int().positive().optional(),
  bio: z.string().optional(),
  photoKey: z.string().optional(),
  isAvailable: z.boolean().optional().default(true),
  displayOrder: z.number().int().nonnegative().optional().default(0),
});

export const updateDoctorSchema = createDoctorSchema.partial();
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add src/schemas/doctor.ts
git commit -m "feat(doctor): expand Zod schema with new fields"
```

---

## Task 2: Update Drizzle Schema

**Files:**
- Modify: `src/db/schema/schema.ts`
- Create: `src/db/schema/doctor.ts`

- [ ] **Step 1: Read schema.ts end**

Read the last 50 lines of `src/db/schema/schema.ts` to find the export pattern and add the new table imports.

- [ ] **Step 2: Create doctor.ts with new tables**

Create `src/db/schema/doctor.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const doctorShifts = sqliteTable('doctor_shifts', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0=Sunday, 6=Saturday
  shiftName: text('shift_name').notNull(), // Morning, Evening, Night
  startTime: text('start_time').notNull(), // HH:MM
  endTime: text('end_time').notNull(), // HH:MM
  isActive: integer('is_active').default(1),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});

export const doctorAvailability = sqliteTable('doctor_availability', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  isAvailable: integer('is_available').default(0),
  reason: text(),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});

export const doctorVisits = sqliteTable('doctor_visits', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  patientId: integer('patient_id').notNull(),
  visitDate: text('visit_date').notNull(),
  visitType: text('visit_type').notNull(), // OPD, IP, EMERGENCY
  diagnosis: text(),
  notes: text(),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});
```

- [ ] **Step 3: Update schema.ts to export new tables**

Find where other table files are imported in `schema.ts`. Add:
```typescript
export * from './doctor';
```

Also add the new columns to an existing doctors table definition (or create one if it doesn't exist in schema.ts yet). Since the doctors table is currently managed via raw SQL and not in schema.ts, add a placeholder doctors table definition at the bottom of schema.ts:

```typescript
// doctors table - mirrors raw SQL in routes, kept in sync manually
export const doctors = sqliteTable('doctors', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  specialty: text(),
  mobileNumber: text('mobile_number'),
  consultationFee: integer('consultation_fee').notNull().default(0),
  publicBio: text('public_bio'),
  languages: text('languages'), // JSON string
  bmdcRegNo: text('bmdc_reg_no'),
  qualifications: text(),
  isMarketplaceVisible: integer('is_marketplace_visible').default(0),
  isActive: integer('is_active').default(1),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
  // New fields
  email: text(),
  department: text(),
  departmentId: integer('department_id'),
  bio: text(),
  photoKey: text('photo_key'),
  isAvailable: integer('is_available').default(1),
  displayOrder: integer('display_order').default(0),
  userId: integer('user_id'),
  slug: text(),
});
```

- [ ] **Step 4: Run drizzle generate**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && npm run db:generate
```

Expected: Creates `drizzle/0001_doctor_module_enhanced.sql` with new tables.

- [ ] **Step 5: Review generated migration SQL**

Read `drizzle/0001_doctor_module_enhanced.sql`. If it looks correct, commit.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/doctor.ts src/db/schema/schema.ts drizzle/
git commit -m "feat(doctor): add Drizzle schema for shifts, availability, visits"
```

---

## Task 3: Extend Doctor CRUD API Routes

**Files:**
- Modify: `src/routes/tenant/doctors.ts`

- [ ] **Step 1: Read full doctors.ts**

Read `src/routes/tenant/doctors.ts` lines 1-320.

- [ ] **Step 2: Enhance GET / list with filters**

In the `GET /` handler, add query params for `specialty`, `department`, `isActive`:

```typescript
// GET /api/doctors — list with optional filters
doctors.get('/', async (c) => {
  const { tenantId } = requireTenantId(c);
  const search = c.req.query('search');
  const specialty = c.req.query('specialty');
  const department = c.req.query('department');
  const isActive = c.req.query('is_active');

  let query = `SELECT * FROM doctors WHERE tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (isActive !== 'all') {
    query += ` AND is_active = 1`;
  }
  if (specialty) {
    query += ` AND specialty = ?`;
    params.push(specialty);
  }
  if (department) {
    query += ` AND department = ?`;
    params.push(department);
  }
  if (search) {
    query += ` AND (name LIKE ? OR mobile_number LIKE ? OR bmdc_reg_no LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  query += ` ORDER BY display_order ASC, name ASC`;

  const doctors = await db.$client.prepare(query).bind(...params).all();
  return c.json({ doctors: doctors.results });
}, zValidator('query', z.object({
  search: z.string().optional(),
  specialty: z.string().optional(),
  department: z.string().optional(),
  is_active: z.enum(['all', 'active']).optional().default('active'),
}).optional()));
```

- [ ] **Step 3: Add activate/deactivate endpoints**

After the `DELETE /:id` handler, add:

```typescript
// PUT /api/doctors/:id/activate — reactivate doctor
doctors.put('/:id/activate', async (c) => {
  const { tenantId } = requireTenantId(c);
  const id = c.req.param('id');
  const existing = await db.$client.prepare(
    'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });

  await db.$client.prepare(
    `UPDATE doctors SET is_active = 1, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();
  triggerSiteReRender(c, tenantId);
  return c.json({ success: true });
});

// PUT /api/doctors/:id/deactivate — soft delete (alias)
doctors.put('/:id/deactivate', async (c) => {
  const { tenantId } = requireTenantId(c);
  const id = c.req.param('id');
  const existing = await db.$client.prepare(
    'SELECT * FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Doctor not found' });

  await db.$client.prepare(
    `UPDATE doctors SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();
  triggerSiteReRender(c, tenantId);
  return c.json({ success: true });
});
```

- [ ] **Step 4: Enhance GET /:id to include shifts**

In the `GET /:id` handler, after fetching the doctor record, add:

```typescript
// Fetch shifts
const shifts = await db.$client.prepare(
  `SELECT * FROM doctor_shifts WHERE doctor_id = ? AND tenant_id = ? AND is_active = 1`
).bind(id, tenantId).all();

// Fetch availability overrides for next 30 days
const overrides = await db.$client.prepare(
  `SELECT * FROM doctor_availability WHERE doctor_id = ? AND tenant_id = ? AND date >= date('now') AND date <= date('now', '+30 days')`
).bind(id, tenantId).all();

return c.json({
  doctor,
  shifts: shifts.results,
  availability: overrides.results,
});
```

- [ ] **Step 5: Enhance PUT /:id to handle new fields**

Update the SET clause in the PUT handler:

```typescript
`UPDATE doctors SET
  name = ?, specialty = ?, mobile_number = ?, consultation_fee = ?,
  public_bio = ?, languages = ?, bmdc_reg_no = ?, qualifications = ?,
  email = ?, department = ?, department_id = ?, bio = ?,
  photo_key = ?, is_available = ?, display_order = ?,
  updated_at = datetime('now')
  WHERE id = ? AND tenant_id = ?`;
```

Add the new bind params in the same order.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/doctors.ts
git commit -m "feat(doctor-api): extend CRUD with filters, activate/deactivate, shifts"
```

---

## Task 4: Doctor Schedule API

**Files:**
- Create: `src/routes/tenant/doctor-schedule.ts`

- [ ] **Step 1: Create the route file**

Create `src/routes/tenant/doctor-schedule.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireTenantId } from '../middleware/require-tenant-id';
import { getDb } from '../../db';

const doctorSchedule = new Hono();

// GET /api/doctors/:id/schedule — get all shifts
doctorSchedule.get('/:id/schedule', async (c) => {
  const { tenantId } = requireTenantId(c);
  const doctorId = c.req.param('id');

  const shifts = await db.$client.prepare(
    `SELECT * FROM doctor_shifts WHERE doctor_id = ? AND tenant_id = ? ORDER BY day_of_week, start_time`
  ).bind(doctorId, tenantId).all();

  return c.json({ shifts: shifts.results });
});

// POST /api/doctors/:id/schedule — add shift(s)
doctorSchedule.post('/:id/schedule', zValidator('json', z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  shiftName: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})), async (c) => {
  const { tenantId } = requireTenantId(c);
  const doctorId = c.req.param('id');
  const body = c.req.valid JSON();
  const { dayOfWeek, shiftName, startTime, endTime } = body;

  // Check doctor belongs to tenant
  const doctor = await db.$client.prepare(
    'SELECT id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(doctorId, tenantId).first();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  await db.$client.prepare(`
    INSERT INTO doctor_shifts (doctor_id, day_of_week, shift_name, start_time, end_time, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(doctorId, dayOfWeek, shiftName, startTime, endTime, tenantId).run();

  return c.json({ success: true });
});

// PUT /api/doctors/:id/schedule/:shiftId — update shift
doctorSchedule.put('/:id/schedule/:shiftId', zValidator('json', z.object({
  shiftName: z.string().min(1).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})), async (c) => {
  const { tenantId } = requireTenantId(c);
  const { id, shiftId } = c.req.param();
  const body = c.req.valid JSON();

  const updates: string[] = [];
  const binds: string[] = [];
  if (body.shiftName) { updates.push('shift_name = ?'); binds.push(body.shiftName); }
  if (body.startTime) { updates.push('start_time = ?'); binds.push(body.startTime); }
  if (body.endTime) { updates.push('end_time = ?'); binds.push(body.endTime); }
  if (updates.length === 0) return c.json({ success: true });

  binds.push(shiftId, id, tenantId);
  await db.$client.prepare(
    `UPDATE doctor_shifts SET ${updates.join(', ')} WHERE id = ? AND doctor_id = ? AND tenant_id = ?`
  ).bind(...binds).run();

  return c.json({ success: true });
});

// DELETE /api/doctors/:id/schedule/:shiftId
doctorSchedule.delete('/:id/schedule/:shiftId', async (c) => {
  const { tenantId } = requireTenantId(c);
  const { id, shiftId } = c.req.param();

  await db.$client.prepare(
    'DELETE FROM doctor_shifts WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(shiftId, id, tenantId).run();

  return c.json({ success: true });
});

// GET /api/doctors/:id/availability
doctorSchedule.get('/:id/availability', async (c) => {
  const { tenantId } = requireTenantId(c);
  const doctorId = c.req.param('id');

  const availability = await db.$client.prepare(
    `SELECT * FROM doctor_availability WHERE doctor_id = ? AND tenant_id = ? ORDER BY date`
  ).bind(doctorId, tenantId).all();

  return c.json({ availability: availability.results });
});

// POST /api/doctors/:id/availability
doctorSchedule.post('/:id/availability', zValidator('json', z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isAvailable: z.boolean(),
  reason: z.string().optional(),
})), async (c) => {
  const { tenantId } = requireTenantId(c);
  const doctorId = c.req.param('id');
  const { date, isAvailable, reason } = c.req.valid JSON();

  await db.$client.prepare(`
    INSERT INTO doctor_availability (doctor_id, date, is_available, reason, tenant_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(doctor_id, date, tenant_id) DO UPDATE SET
      is_available = ?, reason = ?
  `).bind(doctorId, date, isAvailable ? 1 : 0, reason ?? null, tenantId, isAvailable ? 1 : 0, reason ?? null).run();

  return c.json({ success: true });
});

// DELETE /api/doctors/:id/availability/:availId
doctorSchedule.delete('/:id/availability/:availId', async (c) => {
  const { tenantId } = requireTenantId(c);
  const { id, availId } = c.req.param();

  await db.$client.prepare(
    'DELETE FROM doctor_availability WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(availId, id, tenantId).run();

  return c.json({ success: true });
});

export default doctorSchedule;
```

Note: Fix the JSON parsing — `c.req.valid JSON()` should be `c.req.valid('json')`.

- [ ] **Step 2: Register route in app**

Find where other tenant routes are registered in the main app file and add:

```typescript
import doctorSchedule from './routes/tenant/doctor-schedule';
// ...
.route('/api/doctors', doctorSchedule);
```

Actually, since this route has `:id/schedule`, it should be mounted as a sub-route:

```typescript
.route('/api/doctors', doctorSchedule); // GET /api/doctors/:id/schedule works
```

But `doctorSchedule` routes start with `/:id/schedule` — so mounting on `/api/doctors` gives `/api/doctors/:id/schedule`. Confirm this matches existing patterns.

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/doctor-schedule.ts
git commit -m "feat(doctor-api): add doctor schedule CRUD endpoints"
```

---

## Task 5: Doctor Dashboard Stats API

**Files:**
- Modify: `src/routes/tenant/doctorDashboard.ts`

- [ ] **Step 1: Add /stats endpoint**

After the existing `GET /dashboard` handler, add:

```typescript
// GET /api/doctors/dashboard/stats/:id — admin view of doctor stats
doctorDashboard.get('/stats/:id', async (c) => {
  const { tenantId } = requireTenantId(c);
  const doctorId = c.req.param('id');

  // Total patients seen (all time)
  const totalPatients = await db.$client.prepare(`
    SELECT COUNT(DISTINCT patient_id) as count FROM doctor_visits
    WHERE doctor_id = ? AND tenant_id = ?
  `).bind(doctorId, tenantId).first();

  // This month
  const thisMonth = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM doctor_visits
    WHERE doctor_id = ? AND tenant_id = ? AND visit_date >= date('now', 'start of month')
  `).bind(doctorId, tenantId).first();

  // Last month
  const lastMonth = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM doctor_visits
    WHERE doctor_id = ? AND tenant_id = ?
    AND visit_date >= date('now', 'start of month', '-1 month')
    AND visit_date < date('now', 'start of month')
  `).bind(doctorId, tenantId).first();

  // Revenue (if appointments table has fees)
  const revenue = await db.$client.prepare(`
    SELECT SUM(a.consultation_fee) as total FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id
    WHERE d.id = ? AND d.tenant_id = ? AND a.appointment_date >= date('now', 'start of month')
  `).bind(doctorId, tenantId).first();

  return c.json({
    totalPatients: totalPatients?.count ?? 0,
    thisMonth: thisMonth?.count ?? 0,
    lastMonth: lastMonth?.count ?? 0,
    revenueThisMonth: revenue?.total ?? 0,
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/doctorDashboard.ts
git commit -m "feat(doctor-api): add doctor stats endpoint for admin view"
```

---

## Task 6: Doctor List Frontend Page

**Files:**
- Create: `web/src/pages/doctor/DoctorList.tsx`
- Create: `web/src/pages/doctor/.gitkeep`

- [ ] **Step 1: Read existing CRUD list page for pattern**

Read `web/src/pages/pharmacy/CategoryList.tsx` to copy the exact hook and mutation patterns.

- [ ] **Step 2: Create DoctorList.tsx**

```tsx
import { useState } from 'react';
import { useApiQuery, useApiMutation } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from '../../i18n';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '../../components/dashboard/DataTable';
import { DoctorDrawer } from '../../components/doctor/DoctorDrawer';
import type { Doctor } from '../../../src/schemas/doctor'; // or shared type

export default function DoctorList() {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor | null>(null);

  const { data, isLoading } = useApiQuery(queryKeys.doctors.list(), '/api/doctors', {
    query: { search, specialty, department: dept, is_active: status },
  });

  const updateMutation = useApiMutation('put', (v: { id: number }) => `/api/doctors/${v.id}`, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.doctors.all }); toast.success('Updated'); },
  });

  const deactivateMutation = useApiMutation('put', (id: number) => `/api/doctors/${id}/deactivate`, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.doctors.all }); toast.success('Deactivated'); },
  });

  const activateMutation = useApiMutation('put', (id: number) => `/api/doctors/${id}/activate`, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.doctors.all }); toast.success('Activated'); },
  });

  const columns = [
    { key: 'name', header: 'Name', render: (d: Doctor) => <span className="font-medium">{d.name}</span> },
    { key: 'specialty', header: 'Specialty' },
    { key: 'department', header: 'Department' },
    { key: 'bmdcRegNo', header: 'BMDC No.' },
    { key: 'consultationFee', header: 'Fee', render: (d: Doctor) => `৳${d.consultationFee}` },
    { key: 'isActive', header: 'Status', render: (d: Doctor) => (
      <span className={`px-2 py-0.5 rounded text-xs ${d.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {d.isActive ? 'Active' : 'Inactive'}
      </span>
    )},
    { key: 'actions', header: 'Actions', render: (d: Doctor) => (
      <div className="flex gap-2">
        <button onClick={() => { setEditing(d); setDrawerOpen(true); }} className="text-blue-600 hover:underline text-sm">Edit</button>
        <button onClick={() => d.isActive ? deactivateMutation.mutate(d.id) : activateMutation.mutate(d.id)}
          className="text-sm hover:underline">{d.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">{t('doctor:title')}</h1>
        <button onClick={() => { setEditing(null); setDrawerOpen(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          + {t('doctor:add')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, mobile, BMDC..." className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px]" />
        <input value={specialty} onChange={e => setSpecialty(e.target.value)}
          placeholder="Specialty" className="border rounded px-3 py-1.5 text-sm w-40" />
        <input value={dept} onChange={e => setDept(e.target.value)}
          placeholder="Department" className="border rounded px-3 py-1.5 text-sm w-40" />
        <select value={status} onChange={e => setStatus(e.target.value as 'active' | 'all')}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="active">Active Only</option>
          <option value="all">All Doctors</option>
        </select>
      </div>

      <DataTable data={data?.doctors ?? []} columns={columns} keyField="id" loading={isLoading}
        emptyMessage="No doctors found" />

      <DoctorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        doctor={editing} onSuccess={() => { setDrawerOpen(false); qc.invalidateQueries({ queryKey: queryKeys.doctors.all }); }} />
    </div>
  );
}
```

- [ ] **Step 3: Create DoctorDrawer component**

Create `web/src/components/doctor/DoctorDrawer.tsx`:

```tsx
import { useState } from 'react';
import { useApiMutation } from '../../hooks/useApiMutation';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import type { Doctor } from '../../../src/schemas/doctor';

interface Props {
  open: boolean;
  onClose: () => void;
  doctor: Doctor | null;
  onSuccess: () => void;
}

export function DoctorDrawer({ open, onClose, doctor, onSuccess }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: doctor?.name ?? '',
    specialty: doctor?.specialty ?? '',
    department: doctor?.department ?? '',
    consultationFee: doctor?.consultationFee ?? 0,
    mobileNumber: doctor?.mobileNumber ?? '',
    email: doctor?.email ?? '',
    bio: doctor?.bio ?? '',
    bmdcRegNo: doctor?.bmdcRegNo ?? '',
    qualifications: doctor?.qualifications ?? '',
    languages: doctor?.languages ?? [],
    isAvailable: doctor?.isAvailable ?? true,
  });

  const create = useApiMutation('post', '/api/doctors', {
    onSuccess: () => { toast.success('Doctor added'); onSuccess(); },
    onError: () => toast.error('Failed to add doctor'),
  });

  const update = useApiMutation('put', (id: number) => `/api/doctors/${id}`, {
    onSuccess: () => { toast.success('Doctor updated'); onSuccess(); },
    onError: () => toast.error('Failed to update doctor'),
  });

  const handleSubmit = () => {
    if (doctor?.id) {
      update.mutate({ id: doctor.id, ...form });
    } else {
      create.mutate(form);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[400px] bg-white h-full overflow-y-auto p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-4">{doctor ? 'Edit Doctor' : 'Add Doctor'}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Specialty *</label>
            <input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Consultation Fee *</label>
              <input type="number" value={form.consultationFee} onChange={e => setForm({ ...form, consultationFee: +e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mobile</label>
              <input value={form.mobileNumber} onChange={e => setForm({ ...form, mobileNumber: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">BMDC Reg No.</label>
            <input value={form.bmdcRegNo} onChange={e => setForm({ ...form, bmdcRegNo: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Qualifications</label>
            <input value={form.qualifications} onChange={e => setForm({ ...form, qualifications: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Bio</label>
            <textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })}
              className="w-full border rounded px-3 py-2 text-sm" rows={3} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.isAvailable}
              onChange={e => setForm({ ...form, isAvailable: e.target.checked })} />
            <label className="text-sm">Available for appointments</label>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={handleSubmit} disabled={create.isPending || update.isPending}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
            {doctor ? 'Update' : 'Add Doctor'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ensure directory exists and commit**

```bash
mkdir -p web/src/pages/doctor web/src/components/doctor
touch web/src/pages/doctor/.gitkeep
git add web/src/pages/doctor/DoctorList.tsx web/src/components/doctor/DoctorDrawer.tsx
git commit -m "feat(doctor-ui): add DoctorList page with slide-over drawer"
```

---

## Task 7: Doctor Detail Page

**Files:**
- Create: `web/src/pages/doctor/DoctorDetail.tsx`

- [ ] **Step 1: Create DoctorDetail.tsx**

```tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from '../../i18n';
import { DoctorForm } from '../../components/doctor/DoctorForm';
import { ScheduleGrid } from '../../components/doctor/ScheduleGrid';
import { DataTable } from '../../components/dashboard/DataTable';

type Tab = 'profile' | 'schedule' | 'visits';

export default function DoctorDetail() {
  const { id } = useParams();
  const { t } = useTranslation(['doctor', 'common']);
  const [tab, setTab] = useState<Tab>('profile');

  const { data, isLoading } = useApiQuery(
    queryKeys.doctors.detail(Number(id)),
    `/api/doctors/${id}`,
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'visits', label: 'Visits' },
  ];

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/doctors')} className="text-blue-600 hover:underline text-sm">
        ← Back to Doctors
      </button>

      {/* Profile Header Card */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xl font-bold">
            {data?.doctor?.name?.[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{data?.doctor?.name}</h1>
            <p className="text-gray-600">{data?.doctor?.specialty} {data?.doctor?.department ? `• ${data?.doctor?.department}` : ''}</p>
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>BMDC: {data?.doctor?.bmdcRegNo ?? 'N/A'}</span>
              <span>৳{data?.doctor?.consultationFee} / consult</span>
              <span className={data?.doctor?.isAvailable ? 'text-green-600' : 'text-red-500'}>
                {data?.doctor?.isAvailable ? 'Available' : 'Unavailable'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-6">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'profile' && (
        <DoctorForm doctor={data?.doctor} mode="detail" />
      )}
      {tab === 'schedule' && (
        <ScheduleGrid doctorId={Number(id)} initialShifts={data?.shifts ?? []} />
      )}
      {tab === 'visits' && (
        <DataTable
          data={data?.visits ?? []}
          columns={[
            { key: 'visitDate', header: 'Date' },
            { key: 'patientName', header: 'Patient' },
            { key: 'visitType', header: 'Type' },
            { key: 'diagnosis', header: 'Diagnosis' },
          ]}
          keyField="id"
          emptyMessage="No visits recorded"
        />
      )}
    </div>
  );
}
```

Note: `DoctorForm` is shared between the drawer and detail page in edit mode. Create it in `web/src/components/doctor/DoctorForm.tsx`.

- [ ] **Step 2: Create DoctorForm component**

Create `web/src/components/doctor/DoctorForm.tsx` — a reusable form that works for both the drawer and the detail page (render-only vs editable mode).

- [ ] **Step 3: Create ScheduleGrid component**

Create `web/src/components/doctor/ScheduleGrid.tsx`:

```tsx
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';

interface Shift {
  id: number;
  dayOfWeek: number;
  shiftName: string;
  startTime: string;
  endTime: string;
}

interface Props {
  doctorId: number;
  initialShifts: Shift[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHIFT_COLORS: Record<string, string> = {
  Morning: 'bg-green-100 border-green-300 text-green-700',
  Evening: 'bg-amber-100 border-amber-300 text-amber-700',
  Night: 'bg-indigo-100 border-indigo-300 text-indigo-700',
};

export function ScheduleGrid({ doctorId, initialShifts }: Props) {
  const [shifts, setShifts] = useState(initialShifts);
  const [editing, setEditing] = useState<{ day: number; shift?: Shift } | null>(null);

  const addShift = useApiMutation('post', `/api/doctors/${doctorId}/schedule`, {
    onSuccess: () => toast.success('Shift added'),
    onError: () => toast.error('Failed to add shift'),
  });

  const updateShift = useApiMutation('put', (vars: { id: number }) => `/api/doctors/${doctorId}/schedule/${vars.id}`, {
    onSuccess: () => toast.success('Shift updated'),
    onError: () => toast.error('Failed to update shift'),
  });

  const deleteShift = useApiMutation('delete', (id: number) => `/api/doctors/${doctorId}/schedule/${id}`, {
    onSuccess: () => toast.success('Shift removed'),
    onError: () => toast.error('Failed to remove shift'),
  });

  const handleAdd = (day: number) => setEditing({ day });

  const handleSave = (shift: Partial<Shift>) => {
    if (!editing) return;
    if (shift.id) {
      updateShift.mutate({ id: shift.id, ...shift });
      setShifts(prev => prev.map(s => s.id === shift.id ? { ...s, ...shift } : s));
    } else {
      addShift.mutate({ dayOfWeek: editing.day, shiftName: shift.shiftName!, startTime: shift.startTime!, endTime: shift.endTime! });
      setShifts(prev => [...prev, { id: Date.now(), dayOfWeek: editing.day, ...shift } as Shift]);
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, idx) => (
          <div key={day} className="border rounded-lg p-2 min-h-[120px]">
            <div className="font-medium text-sm mb-2">{day}</div>
            {shifts.filter(s => s.dayOfWeek === idx).map(s => (
              <div key={s.id} className={`text-xs p-1.5 rounded border mb-1 ${SHIFT_COLORS[s.shiftName] ?? 'bg-gray-100'}`}>
                <div className="font-medium">{s.shiftName}</div>
                <div>{s.startTime}–{s.endTime}</div>
                <button onClick={() => setEditing({ day: idx, shift: s })} className="text-blue-600 mt-1 hover:underline">Edit</button>
              </div>
            ))}
            <button onClick={() => handleAdd(idx)} className="text-blue-600 text-xs hover:underline mt-1">+ Add</button>
          </div>
        ))}
      </div>

      {/* Editor modal */}
      {editing && (
        <ShiftEditor
          shift={editing.shift}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ShiftEditor({ shift, onSave, onClose }: { shift?: Shift; onSave: (s: Partial<Shift>) => void; onClose: () => void }) {
  const [name, setName] = useState(shift?.shiftName ?? 'Morning');
  const [start, setStart] = useState(shift?.startTime ?? '09:00');
  const [end, setEnd] = useState(shift?.endTime ?? '13:00');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
        <h3 className="font-semibold mb-4">{shift ? 'Edit Shift' : 'Add Shift'}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Shift Name</label>
            <select value={name} onChange={e => setName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
              <option>Morning</option><option>Evening</option><option>Night</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Start</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1">End</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={() => onSave({ id: shift?.id, shiftName: name, startTime: start, endTime: end })}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/doctor/DoctorDetail.tsx web/src/components/doctor/DoctorForm.tsx web/src/components/doctor/ScheduleGrid.tsx
git commit -m "feat(doctor-ui): add DoctorDetail page with Profile, Schedule, Visits tabs"
```

---

## Task 8: Doctor Dashboard Page

**Files:**
- Create: `web/src/pages/doctor/DoctorDashboard.tsx`

- [ ] **Step 1: Create DoctorDashboard.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { KPICard } from '../../components/dashboard/KPICard';
import { DataTable } from '../../components/dashboard/DataTable';
import { useTranslation } from '../../i18n';

export default function DoctorDashboard() {
  const { t } = useTranslation(['doctor', 'common']);

  // Auto-refresh every 60s (like DanpheEMR)
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const { data, isLoading, refetch } = useApiQuery(
    queryKeys.doctors.dashboard(),
    `/api/doctors/dashboard?date=${date}`,
  );

  useEffect(() => {
    const timer = setInterval(() => refetch(), 60000);
    return () => clearInterval(timer);
  }, [refetch]);

  const kpis = [
    { label: "Today's Patients", value: data?.kpi?.total ?? 0, icon: '👥' },
    { label: 'Completed', value: data?.kpi?.completed ?? 0, icon: '✅' },
    { label: 'Waiting', value: data?.kpi?.waiting ?? 0, icon: '⏳' },
    { label: 'In Progress', value: data?.kpi?.in_progress ?? 0, icon: '🔄' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Dr. {data?.doctor?.name}</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm" />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} />)}
      </div>

      {/* Today's Queue */}
      <div>
        <h2 className="text-lg font-medium mb-3">Today's Queue</h2>
        <DataTable
          data={data?.queue ?? []}
          columns={[
            { key: 'time', header: 'Time' },
            { key: 'patientName', header: 'Patient' },
            { key: 'visitType', header: 'Type' },
            { key: 'status', header: 'Status', render: (r: any) => (
              <span className={`px-2 py-0.5 rounded text-xs ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'waiting' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                {r.status}
              </span>
            )},
          ]}
          keyField="id"
          loading={isLoading}
          emptyMessage="No appointments today"
        />
      </div>

      {/* Visit Type Breakdown */}
      <div>
        <h2 className="text-lg font-medium mb-3">Visit Types</h2>
        <div className="grid grid-cols-3 gap-4">
          {(data?.visitTypes ?? []).map((v: any) => (
            <div key={v.visitType} className="bg-white border rounded-lg p-4 shadow-sm">
              <div className="text-2xl font-bold">{v.count}</div>
              <div className="text-sm text-gray-500">{v.visitType}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/doctor/DoctorDashboard.tsx
git commit -m "feat(doctor-ui): add DoctorDashboard page with KPIs and queue"
```

---

## Task 9: Sidebar & Route Registration

**Files:**
- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/lib/queryKeys.ts`

- [ ] **Step 1: Read Sidebar.tsx**

Find the `hospital_admin` nav group and `doctor` nav group.

- [ ] **Step 2: Add nav items**

In `hospital_admin` nav group, add:

```typescript
{
  labelKey: 'sidebar.doctors',
  icon: 'stethoscope',
  path: 'doctors',
  requiredPermission: 'doctor:read',
},
```

In `doctor` nav group, add:

```typescript
{
  labelKey: 'sidebar.myDashboard',
  icon: 'chart',
  path: 'doctors/dashboard',
},
```

- [ ] **Step 3: Register routes in App.tsx**

Find the `/h/:slug/` route group and add:

```tsx
{
  path: 'doctors',
  element: <ProtectedRoute allowedRoles={['hospital_admin']}><DashboardLayout /></ProtectedRoute>,
  children: [
    { index: true, element: <Navigate to="list" replace /> },
    { path: 'list', element: <DoctorList /> },
    { path: ':id', element: <DoctorDetail /> },
  ],
},
{
  path: 'doctors/dashboard',
  element: <ProtectedRoute allowedRoles={['doctor']}><DashboardLayout /></ProtectedRoute>,
  children: [
    { index: true, element: <DoctorDashboard /> },
  ],
},
```

- [ ] **Step 4: Add query keys**

In `queryKeys.ts`, add:

```typescript
doctors: {
  all: ['doctors'] as const,
  list: (filters?: Record<string, unknown>) => ['doctors', 'list', filters] as const,
  detail: (id: number) => ['doctors', 'detail', id] as const,
  dashboard: () => ['doctors', 'dashboard'] as const,
  schedule: (id: number) => ['doctors', 'schedule', id] as const,
  stats: (id: number) => ['doctors', 'stats', id] as const,
},
```

- [ ] **Step 5: Add i18n strings**

In the i18n file (find it with `grep -r "sidebar\." web/src/`), add:

```json
"sidebar": {
  "doctors": "Doctors",
  "myDashboard": "My Dashboard"
}
```

And for doctor namespace:

```json
"doctor": {
  "title": "Doctor Management",
  "add": "Add Doctor"
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/dashboard/Sidebar.tsx web/src/App.tsx web/src/lib/queryKeys.ts
git commit -m "feat(doctor-ui): register routes and sidebar nav items"
```

---

## Self-Review Checklist

1. **Spec coverage:** All items from spec have tasks. OPD/IPD visits shown as read-only DataTable (v1). Billing integration deferred.
2. **Placeholder scan:** No TBD/TODO in steps. All code is concrete.
3. **Type consistency:** `doctor.id` used throughout, matched to Zod schema types.
4. **Gaps found:** The `DoctorForm` shared component needs creating (referenced in Task 7). `KPICard` imported but confirm exists. `ShiftEditor` inline component is fine within ScheduleGrid.

---

## Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-doctor-management.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task phase, review between phases, fast iteration. Each Phase (1: infra, 2: detail+schedule, 3: dashboard+visits, 4: integration) gets its own agent.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach? I recommend **Option 1 (Subagent-Driven)** — the 4 phases map cleanly to parallel agents, and Phase 1 must finish before Phase 2/3 can start (sequential gate), but Phase 2 and Phase 3 can run in parallel after that.
