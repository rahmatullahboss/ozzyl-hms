# Blood Sugar Monitoring — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add blood sugar (RBS) monitoring to the nursing module — record random blood sugar values and insulin doses for IPD patients.

**Architecture:** Follows existing nursing module patterns — Hono routes under `/api/nursing/blood-sugar`, Zod schemas, D1 tables with soft-delete, multi-tenant with `tenant_id`.

**Tech Stack:** Hono + Zod + Cloudflare D1 + React (shadcn/ui)

---

## Database Schema

### Table: `nur_blood_sugar_monitoring`
```sql
CREATE TABLE nur_blood_sugar_monitoring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  entry_datetime TEXT DEFAULT (datetime('now', '+6 hours')),
  rbs_value REAL NOT NULL,
  insulin REAL,
  remarks TEXT,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);
CREATE INDEX idx_blood_sugar_visit ON nur_blood_sugar_monitoring(tenant_id, visit_id, is_active);
CREATE INDEX idx_blood_sugar_patient ON nur_blood_sugar_monitoring(tenant_id, patient_id, is_active);
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0191_nursing_blood_sugar.sql` | Create | Database table |
| `src/schemas/nursing.ts` | Modify | Add blood sugar schemas |
| `src/routes/tenant/nursing/blood-sugar.ts` | Create | API routes |
| `src/routes/tenant/nursing/index.ts` | Modify | Mount blood-sugar routes |
| `web/src/components/nursing/BloodSugarTab.tsx` | Create | Frontend component |

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/0191_nursing_blood_sugar.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Blood Sugar Monitoring for Nursing
CREATE TABLE IF NOT EXISTS nur_blood_sugar_monitoring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  entry_datetime TEXT DEFAULT (datetime('now', '+6 hours')),
  rbs_value REAL NOT NULL,
  insulin REAL,
  remarks TEXT,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_blood_sugar_visit
  ON nur_blood_sugar_monitoring(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_blood_sugar_patient
  ON nur_blood_sugar_monitoring(tenant_id, patient_id, is_active);
```

- [ ] **Step 2: Run migration**

Run: `npx wrangler d1 execute hms-db --local --file=migrations/0191_nursing_blood_sugar.sql`

- [ ] **Step 3: Commit**

```bash
git add migrations/0191_nursing_blood_sugar.sql
git commit -m "feat(nursing): add blood sugar monitoring database migration"
```

---

### Task 2: Zod Schemas

**Files:**
- Modify: `src/schemas/nursing.ts`

- [ ] **Step 1: Add blood sugar schemas**

Add after the diet sheet schemas:

```typescript
// ─── 15. Blood Sugar Monitoring ─────────────────────────────────────────────
export const createBloodSugarSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  rbs_value: z.number().min(0).max(1000),
  insulin: z.number().min(0).optional(),
  remarks: z.string().max(1000).optional(),
  entry_datetime: z.string().optional(),
});

export const updateBloodSugarSchema = createBloodSugarSchema.partial();

export const bloodSugarQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/nursing.ts
git commit -m "feat(nursing): add blood sugar Zod schemas"
```

---

### Task 3: Blood Sugar API Routes

**Files:**
- Create: `src/routes/tenant/nursing/blood-sugar.ts`

- [ ] **Step 1: Create blood-sugar routes file**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createBloodSugarSchema,
  updateBloodSugarSchema,
  bloodSugarQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const bloodSugarRoutes = new Hono<NursingEnv>();

// GET /blood-sugar — list blood sugar records
bloodSugarRoutes.get('/', zValidator('query', bloodSugarQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, visit_id, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT id, tenant_id, patient_id, visit_id, entry_datetime,
           rbs_value, insulin, remarks, created_by, created_at
    FROM nur_blood_sugar_monitoring
    WHERE tenant_id = ? AND is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND visit_id = ?'; params.push(visit_id); }

  query += ' ORDER BY entry_datetime DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_blood_sugar_monitoring WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /blood-sugar/:id — single record
bloodSugarRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT id, tenant_id, patient_id, visit_id, entry_datetime,
           rbs_value, insulin, remarks, created_by, created_at
    FROM nur_blood_sugar_monitoring
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

// POST /blood-sugar — create record
bloodSugarRoutes.post('/', zValidator('json', createBloodSugarSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_blood_sugar_monitoring
      (tenant_id, patient_id, visit_id, rbs_value, insulin, remarks, entry_datetime, created_by)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', '+6 hours')), ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.rbs_value, data.insulin ?? null, data.remarks ?? null,
    data.entry_datetime ?? null, userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /blood-sugar/:id — update record
bloodSugarRoutes.put('/:id', zValidator('json', updateBloodSugarSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_blood_sugar_monitoring WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.rbs_value !== undefined) { fields.push('rbs_value = ?'); values.push(data.rbs_value); }
  if (data.insulin !== undefined) { fields.push('insulin = ?'); values.push(data.insulin); }
  if (data.remarks !== undefined) { fields.push('remarks = ?'); values.push(data.remarks); }
  if (data.entry_datetime !== undefined) { fields.push('entry_datetime = ?'); values.push(data.entry_datetime); }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')");
    values.push(id, tenantId);
    await db.$client.prepare(
      `UPDATE nur_blood_sugar_monitoring SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }
  return c.json({ Results: true });
});

// DELETE /blood-sugar/:id — soft delete
bloodSugarRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_blood_sugar_monitoring WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_blood_sugar_monitoring SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  return c.json({ Results: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/nursing/blood-sugar.ts
git commit -m "feat(nursing): add blood sugar monitoring API routes"
```

---

### Task 4: Mount Routes

**Files:**
- Modify: `src/routes/tenant/nursing/index.ts`

- [ ] **Step 1: Add import and mount**

Add import:
```typescript
import { bloodSugarRoutes } from './blood-sugar';
```

Add mount:
```typescript
nursing.route('/blood-sugar', bloodSugarRoutes);
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/nursing/index.ts
git commit -m "feat(nursing): mount blood sugar routes"
```

---

### Task 5: Frontend Component

**Files:**
- Create: `web/src/components/nursing/BloodSugarTab.tsx`

- [ ] **Step 1: Create BloodSugarTab component**

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

interface BloodSugarRecord {
  id: number;
  patient_id: number;
  visit_id: number;
  entry_datetime: string;
  rbs_value: number;
  insulin: number | null;
  remarks: string | null;
  created_by: string;
}

interface BloodSugarTabProps {
  patientId?: number;
  visitId?: number;
}

function getRbsColor(value: number): string {
  if (value < 70) return 'bg-red-100 text-red-800';     // Hypoglycemia
  if (value <= 140) return 'bg-green-100 text-green-800'; // Normal
  if (value <= 200) return 'bg-yellow-100 text-yellow-800'; // Elevated
  return 'bg-red-100 text-red-800';                       // High
}

function getRbsLabel(value: number): string {
  if (value < 70) return 'Low';
  if (value <= 140) return 'Normal';
  if (value <= 200) return 'Elevated';
  return 'High';
}

export function BloodSugarTab({ patientId, visitId }: BloodSugarTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: patientId || 0,
    visit_id: visitId || 0,
    rbs_value: 0,
    insulin: 0,
    remarks: '',
  });

  // Fetch records
  const { data: records = [], isLoading } = useQuery<BloodSugarRecord[]>({
    queryKey: ['nursing-blood-sugar', patientId, visitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (patientId) params.set('patient_id', String(patientId));
      if (visitId) params.set('visit_id', String(visitId));
      const res = await api.get(`/api/nursing/blood-sugar?${params}`);
      return res.data.Results;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.post('/api/nursing/blood-sugar', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nursing-blood-sugar'] });
      toast({ title: 'Blood sugar recorded successfully' });
      setShowAddModal(false);
      setFormData({ patient_id: patientId || 0, visit_id: visitId || 0, rbs_value: 0, insulin: 0, remarks: '' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.response?.data?.error || 'Failed to record', variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.rbs_value <= 0) {
      toast({ title: 'Please enter a valid RBS value', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  // Summary stats
  const lastReading = records[0];
  const avgRbs = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + r.rbs_value, 0) / records.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Blood Sugar Monitoring</h3>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm">Record RBS</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Blood Sugar</DialogTitle>
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
                <Label>RBS Value (mg/dL)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.rbs_value || ''}
                  onChange={(e) => setFormData({ ...formData, rbs_value: parseFloat(e.target.value) || 0 })}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label>Insulin (units)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={formData.insulin || ''}
                  onChange={(e) => setFormData({ ...formData, insulin: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>Remarks</Label>
                <Textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Pre-meal, post-meal, fasting, etc."
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

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Latest Reading</CardTitle>
          </CardHeader>
          <CardContent>
            {lastReading ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.rbs_value}</span>
                <Badge className={getRbsColor(lastReading.rbs_value)}>
                  {getRbsLabel(lastReading.rbs_value)}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Average RBS</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{avgRbs || '-'}</span>
            {avgRbs > 0 && <span className="text-sm text-muted-foreground ml-1">mg/dL</span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Readings</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{records.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* Records Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Blood Sugar History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No readings recorded</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>RBS (mg/dL)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Insulin (units)</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Recorded By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.entry_datetime).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{r.rbs_value}</TableCell>
                    <TableCell>
                      <Badge className={getRbsColor(r.rbs_value)}>
                        {getRbsLabel(r.rbs_value)}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.insulin ?? '-'}</TableCell>
                    <TableCell>{r.remarks || '-'}</TableCell>
                    <TableCell>{r.created_by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `cd web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/nursing/BloodSugarTab.tsx
git commit -m "feat(nursing): add BloodSugarTab frontend component"
```

---

### Task 6: Unit Tests

**Files:**
- Modify: `test/nursing.test.ts`

- [ ] **Step 1: Add blood sugar tests**

```typescript
describe('Blood Sugar Monitoring', () => {
  it('should validate createBloodSugarSchema', () => {
    const valid = createBloodSugarSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      rbs_value: 120,
    });
    expect(valid.success).toBe(true);
  });

  it('should reject rbs_value of 0', () => {
    const invalid = createBloodSugarSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      rbs_value: 0,
    });
    expect(invalid.success).toBe(false);
  });

  it('should reject rbs_value over 1000', () => {
    const invalid = createBloodSugarSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      rbs_value: 1001,
    });
    expect(invalid.success).toBe(false);
  });

  it('should accept optional insulin', () => {
    const valid = createBloodSugarSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      rbs_value: 180,
      insulin: 4,
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.insulin).toBe(4);
  });

  it('should validate bloodSugarQuerySchema defaults', () => {
    const result = bloodSugarQuerySchema.safeParse({});
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
git commit -m "test(nursing): add blood sugar monitoring unit tests"
```
