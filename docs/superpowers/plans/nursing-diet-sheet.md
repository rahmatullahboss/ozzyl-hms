# Diet Sheet Management — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add diet sheet management to the nursing module — assign diet types to IPD patients, view diet history, and manage diet master data.

**Architecture:** Follows existing nursing module patterns — Hono routes under `/api/nursing/diet-sheet`, Zod schemas, D1 tables with soft-delete, multi-tenant with `tenant_id`.

**Tech Stack:** Hono + Zod + Cloudflare D1 + React (shadcn/ui)

---

## Database Schema

### Table: `nur_diet_types` (Master)
```sql
CREATE TABLE nur_diet_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  diet_code TEXT NOT NULL,
  diet_name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);
CREATE UNIQUE INDEX idx_diet_types_code ON nur_diet_types(tenant_id, diet_code);
```

### Table: `nur_patient_diets` (Transaction)
```sql
CREATE TABLE nur_patient_diets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  diet_type_id INTEGER NOT NULL REFERENCES nur_diet_types(id),
  extra_diet TEXT,
  ward_id INTEGER,
  remarks TEXT,
  recorded_on TEXT DEFAULT (datetime('now', '+6 hours')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);
CREATE INDEX idx_patient_diets_visit ON nur_patient_diets(tenant_id, visit_id, is_active);
CREATE INDEX idx_patient_diets_patient ON nur_patient_diets(tenant_id, patient_id, is_active);
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `migrations/XXX_nursing_diet_sheet.sql` | Create | Database tables |
| `src/schemas/nursing.ts` | Modify | Add diet schemas |
| `src/routes/tenant/nursing/diet-sheet.ts` | Create | API routes |
| `src/routes/tenant/nursing/index.ts` | Modify | Mount diet-sheet routes |
| `web/src/components/nursing/DietSheetTab.tsx` | Create | Frontend component |

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/0190_nursing_diet_sheet.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Diet Sheet Management
-- Master table: diet types (Regular, Diabetic, Liquid, Soft, etc.)

CREATE TABLE IF NOT EXISTS nur_diet_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  diet_code TEXT NOT NULL,
  diet_name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_diet_types_code
  ON nur_diet_types(tenant_id, diet_code);

-- Transaction table: patient diet assignments

CREATE TABLE IF NOT EXISTS nur_patient_diets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  diet_type_id INTEGER NOT NULL,
  extra_diet TEXT,
  ward_id INTEGER,
  remarks TEXT,
  recorded_on TEXT DEFAULT (datetime('now', '+6 hours')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_patient_diets_visit
  ON nur_patient_diets(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_patient_diets_patient
  ON nur_patient_diets(tenant_id, patient_id, is_active);

-- Seed default diet types
INSERT INTO nur_diet_types (tenant_id, diet_code, diet_name, display_order, created_by)
VALUES
  (0, 'REG', 'Regular', 1, 'system'),
  (0, 'DIA', 'Diabetic', 2, 'system'),
  (0, 'LIQ', 'Liquid', 3, 'system'),
  (0, 'SFT', 'Soft', 4, 'system'),
  (0, 'RENAL', 'Renal', 5, 'system'),
  (0, 'LOW_SOD', 'Low Sodium', 6, 'system'),
  (0, 'HIGH_PROT', 'High Protein', 7, 'system'),
  (0, 'NPO', 'NPO (Nothing by Mouth)', 8, 'system');
```

- [ ] **Step 2: Run migration**

Run: `npx wrangler d1 execute hms-db --local --file=migrations/0190_nursing_diet_sheet.sql`

- [ ] **Step 3: Commit**

```bash
git add migrations/0190_nursing_diet_sheet.sql
git commit -m "feat(nursing): add diet sheet database migration"
```

---

### Task 2: Zod Schemas

**Files:**
- Modify: `src/schemas/nursing.ts`

- [ ] **Step 1: Add diet schemas at end of file**

Add after the existing `reconciliationQuerySchema` (line 283):

```typescript
// ─── 14. Diet Sheet ────────────────────────────────────────────────────────
export const createDietTypeSchema = z.object({
  diet_code: z.string().min(1).max(20),
  diet_name: z.string().min(1).max(100),
  display_order: z.number().int().default(0),
});

export const updateDietTypeSchema = createDietTypeSchema.partial();

export const createPatientDietSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  diet_type_id: z.number().int(),
  extra_diet: z.string().max(500).optional(),
  ward_id: z.number().int().optional(),
  remarks: z.string().max(1000).optional(),
});

export const dietSheetQuerySchema = z.object({
  ward_id: z.coerce.number().int().positive().optional(),
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/nursing.ts
git commit -m "feat(nursing): add diet sheet Zod schemas"
```

---

### Task 3: Diet Sheet API Routes

**Files:**
- Create: `src/routes/tenant/nursing/diet-sheet.ts`

- [ ] **Step 1: Create diet-sheet routes file**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createDietTypeSchema,
  updateDietTypeSchema,
  createPatientDietSchema,
  dietSheetQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const dietSheetRoutes = new Hono<NursingEnv>();

// ─── Diet Types (Master) ─────────────────────────────────────────────────

// GET /diet-sheet/types — list all diet types
dietSheetRoutes.get('/types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    `SELECT id, diet_code, diet_name, display_order, is_active
     FROM nur_diet_types
     WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
     ORDER BY display_order, diet_name`
  ).bind(tenantId).all();
  return c.json({ Results: results });
});

// POST /diet-sheet/types — create a diet type
dietSheetRoutes.post('/types', zValidator('json', createDietTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE tenant_id = ? AND diet_code = ?'
  ).bind(tenantId, data.diet_code).first();
  if (existing) return c.json({ error: 'Diet code already exists' }, 409);

  const result = await db.$client.prepare(
    `INSERT INTO nur_diet_types (tenant_id, diet_code, diet_name, display_order, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tenantId, data.diet_code, data.diet_name, data.display_order, userId ?? 'system').run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /diet-sheet/types/:id — update a diet type
dietSheetRoutes.put('/types/:id', zValidator('json', updateDietTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (data.diet_code !== undefined) { fields.push('diet_code = ?'); values.push(data.diet_code); }
  if (data.diet_name !== undefined) { fields.push('diet_name = ?'); values.push(data.diet_name); }
  if (data.display_order !== undefined) { fields.push('display_order = ?'); values.push(data.display_order); }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')");
    values.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE nur_diet_types SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }
  return c.json({ Results: true });
});

// DELETE /diet-sheet/types/:id — soft delete
dietSheetRoutes.delete('/types/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_diet_types SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  return c.json({ Results: true });
});

// ─── Patient Diet Assignments ────────────────────────────────────────────

// GET /diet-sheet — list patients with their current diet (for grid)
dietSheetRoutes.get('/', zValidator('query', dietSheetQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { ward_id, patient_id, visit_id, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT pd.id, pd.patient_id, pd.visit_id, pd.diet_type_id,
           pd.extra_diet, pd.ward_id, pd.remarks, pd.recorded_on,
           dt.diet_code, dt.diet_name,
           p.name AS patient_name, p.patient_code,
           a.ward_id AS admission_ward_id
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    JOIN patients p ON p.id = pd.patient_id AND p.tenant_id = pd.tenant_id
    LEFT JOIN admissions a ON a.patient_id = pd.patient_id AND a.visit_id = pd.visit_id AND a.tenant_id = pd.tenant_id
    WHERE pd.tenant_id = ? AND pd.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (ward_id) { query += ' AND a.ward_id = ?'; params.push(ward_id); }
  if (patient_id) { query += ' AND pd.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND pd.visit_id = ?'; params.push(visit_id); }

  query += ' ORDER BY pd.recorded_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = `
    SELECT COUNT(*) as total FROM nur_patient_diets pd
    LEFT JOIN admissions a ON a.patient_id = pd.patient_id AND a.visit_id = pd.visit_id AND a.tenant_id = pd.tenant_id
    WHERE pd.tenant_id = ? AND pd.is_active = 1
  `;
  const countParams: (string | number)[] = [tenantId];
  if (ward_id) { countQuery += ' AND a.ward_id = ?'; countParams.push(ward_id); }
  if (patient_id) { countQuery += ' AND pd.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND pd.visit_id = ?'; countParams.push(visit_id); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /diet-sheet/history/:patientId — diet history for a patient
dietSheetRoutes.get('/history/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const { results } = await db.$client.prepare(`
    SELECT pd.id, pd.visit_id, pd.diet_type_id, pd.extra_diet, pd.remarks,
           pd.recorded_on, dt.diet_code, dt.diet_name
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    WHERE pd.tenant_id = ? AND pd.patient_id = ? AND pd.is_active = 1
    ORDER BY pd.recorded_on DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

// GET /diet-sheet/:id — single diet assignment
dietSheetRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT pd.id, pd.patient_id, pd.visit_id, pd.diet_type_id,
           pd.extra_diet, pd.ward_id, pd.remarks, pd.recorded_on,
           dt.diet_code, dt.diet_name
    FROM nur_patient_diets pd
    JOIN nur_diet_types dt ON dt.id = pd.diet_type_id
    WHERE pd.id = ? AND pd.tenant_id = ? AND pd.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

// POST /diet-sheet — assign diet to patient
dietSheetRoutes.post('/', zValidator('json', createPatientDietSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Verify patient exists
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) return c.json({ error: 'Patient not found' }, 404);

  // Verify diet type exists
  const dietType = await db.$client.prepare(
    'SELECT id FROM nur_diet_types WHERE id = ? AND (tenant_id = ? OR tenant_id = 0) AND is_active = 1'
  ).bind(data.diet_type_id, tenantId).first();
  if (!dietType) return c.json({ error: 'Diet type not found' }, 404);

  const result = await db.$client.prepare(`
    INSERT INTO nur_patient_diets
      (tenant_id, patient_id, visit_id, diet_type_id, extra_diet, ward_id, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.diet_type_id,
    data.extra_diet ?? null, data.ward_id ?? null, data.remarks ?? null,
    userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// DELETE /diet-sheet/:id — soft delete
dietSheetRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_patient_diets WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_patient_diets SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  return c.json({ Results: true });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/nursing.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/nursing/diet-sheet.ts
git commit -m "feat(nursing): add diet sheet API routes"
```

---

### Task 4: Mount Routes

**Files:**
- Modify: `src/routes/tenant/nursing/index.ts`

- [ ] **Step 1: Add import and mount**

Add import (after line 25):
```typescript
import { dietSheetRoutes } from './diet-sheet';
```

Add mount (after line 168):
```typescript
nursing.route('/diet-sheet', dietSheetRoutes);
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/nursing/index.ts
git commit -m "feat(nursing): mount diet sheet routes"
```

---

### Task 5: Frontend Component

**Files:**
- Create: `web/src/components/nursing/DietSheetTab.tsx`

- [ ] **Step 1: Create DietSheetTab component**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

interface DietType {
  id: number;
  diet_code: string;
  diet_name: string;
  display_order: number;
}

interface PatientDiet {
  id: number;
  patient_id: number;
  visit_id: number;
  diet_type_id: number;
  extra_diet: string | null;
  ward_id: number | null;
  remarks: string | null;
  recorded_on: string;
  diet_code: string;
  diet_name: string;
  patient_name: string;
  patient_code: string;
}

interface DietSheetTabProps {
  patientId?: number;
  visitId?: number;
  wardId?: number;
}

export function DietSheetTab({ patientId, visitId, wardId }: DietSheetTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    patient_id: patientId || 0,
    visit_id: visitId || 0,
    diet_type_id: 0,
    extra_diet: '',
    ward_id: wardId,
    remarks: '',
  });

  // Fetch diet types
  const { data: dietTypes = [] } = useQuery<DietType[]>({
    queryKey: ['nursing-diet-types'],
    queryFn: async () => {
      const res = await api.get('/api/nursing/diet-sheet/types');
      return res.data.Results;
    },
  });

  // Fetch patient diets
  const { data: patientDiets = [], isLoading } = useQuery<PatientDiet[]>({
    queryKey: ['nursing-patient-diets', wardId, patientId, visitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (wardId) params.set('ward_id', String(wardId));
      if (patientId) params.set('patient_id', String(patientId));
      if (visitId) params.set('visit_id', String(visitId));
      const res = await api.get(`/api/nursing/diet-sheet?${params}`);
      return res.data.Results;
    },
  });

  // Fetch diet history
  const { data: dietHistory = [] } = useQuery<PatientDiet[]>({
    queryKey: ['nursing-diet-history', selectedPatientId],
    queryFn: async () => {
      if (!selectedPatientId) return [];
      const res = await api.get(`/api/nursing/diet-sheet/history/${selectedPatientId}`);
      return res.data.Results;
    },
    enabled: !!selectedPatientId && showHistoryModal,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.post('/api/nursing/diet-sheet', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nursing-patient-diets'] });
      toast({ title: 'Diet assigned successfully' });
      setShowAddModal(false);
      setFormData({ patient_id: patientId || 0, visit_id: visitId || 0, diet_type_id: 0, extra_diet: '', ward_id: wardId, remarks: '' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.response?.data?.error || 'Failed to assign diet', variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.diet_type_id) {
      toast({ title: 'Please select a diet type', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Diet Sheet</h3>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm">Assign Diet</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Diet to Patient</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!patientId && (
                <div>
                  <Label>Patient ID</Label>
                  <Input
                    type="number"
                    value={formData.patient_id || ''}
                    onChange={(e) => setFormData({ ...formData, patient_id: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
              )}
              {!visitId && (
                <div>
                  <Label>Visit ID</Label>
                  <Input
                    type="number"
                    value={formData.visit_id || ''}
                    onChange={(e) => setFormData({ ...formData, visit_id: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
              )}
              <div>
                <Label>Diet Type</Label>
                <Select
                  value={formData.diet_type_id ? String(formData.diet_type_id) : ''}
                  onValueChange={(v) => setFormData({ ...formData, diet_type_id: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select diet type" />
                  </SelectTrigger>
                  <SelectContent>
                    {dietTypes.map((dt) => (
                      <SelectItem key={dt.id} value={String(dt.id)}>
                        {dt.diet_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Extra Diet</Label>
                <Input
                  value={formData.extra_diet}
                  onChange={(e) => setFormData({ ...formData, extra_diet: e.target.value })}
                  placeholder="e.g., Extra rice, No spice"
                />
              </div>
              <div>
                <Label>Remarks</Label>
                <Textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Additional notes"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Patient Diet List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current Diet Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : patientDiets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No diet assignments found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Diet Type</TableHead>
                  <TableHead>Extra Diet</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Recorded On</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patientDiets.map((diet) => (
                  <TableRow key={diet.id}>
                    <TableCell>{diet.patient_name} ({diet.patient_code})</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                        {diet.diet_name}
                      </span>
                    </TableCell>
                    <TableCell>{diet.extra_diet || '-'}</TableCell>
                    <TableCell>{diet.remarks || '-'}</TableCell>
                    <TableCell>{new Date(diet.recorded_on).toLocaleString()}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedPatientId(diet.patient_id);
                          setShowHistoryModal(true);
                        }}
                      >
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Diet History Modal */}
      <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Diet History</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Diet Type</TableHead>
                <TableHead>Extra Diet</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dietHistory.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{new Date(h.recorded_on).toLocaleString()}</TableCell>
                  <TableCell>{h.diet_name}</TableCell>
                  <TableCell>{h.extra_diet || '-'}</TableCell>
                  <TableCell>{h.remarks || '-'}</TableCell>
                </TableRow>
              ))}
              {dietHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No history</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `cd web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/nursing/DietSheetTab.tsx
git commit -m "feat(nursing): add DietSheetTab frontend component"
```

---

### Task 6: Unit Tests

**Files:**
- Modify: `test/nursing.test.ts`

- [ ] **Step 1: Add diet sheet tests**

Add to the existing test file:

```typescript
describe('Diet Sheet', () => {
  it('should validate createPatientDietSchema', () => {
    const valid = createPatientDietSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      diet_type_id: 1,
    });
    expect(valid.success).toBe(true);
  });

  it('should reject diet type without code', () => {
    const invalid = createDietTypeSchema.safeParse({
      diet_name: 'Regular',
    });
    expect(invalid.success).toBe(false);
  });

  it('should accept diet type with all fields', () => {
    const valid = createDietTypeSchema.safeParse({
      diet_code: 'REG',
      diet_name: 'Regular',
      display_order: 1,
    });
    expect(valid.success).toBe(true);
  });

  it('should validate dietSheetQuerySchema defaults', () => {
    const result = dietSheetQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/nursing.test.ts`

- [ ] **Step 3: Commit**

```bash
git add test/nursing.test.ts
git commit -m "test(nursing): add diet sheet unit tests"
```
