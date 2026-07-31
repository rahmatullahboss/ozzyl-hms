# Consultation Requests — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inter-department consultation requests to the nursing module — nursing staff can request consultations from other departments/doctors, and consultants can respond.

**Architecture:** Follows existing nursing module patterns — Hono routes under `/api/nursing/consultation-requests`, Zod schemas, D1 tables with soft-delete, multi-tenant with `tenant_id`.

**Tech Stack:** Hono + Zod + Cloudflare D1 + React (shadcn/ui)

---

## Database Schema

### Table: `nur_consultation_requests`
```sql
CREATE TABLE nur_consultation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  ward_id INTEGER,
  bed_id INTEGER,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  requesting_doctor_id INTEGER NOT NULL,
  requesting_department_id INTEGER,
  purpose TEXT NOT NULL,
  consulting_doctor_id INTEGER NOT NULL,
  consulting_department_id INTEGER,
  consultant_response TEXT,
  consulted_on TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'responded', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);
CREATE INDEX idx_consultation_req_visit ON nur_consultation_requests(tenant_id, visit_id, is_active);
CREATE INDEX idx_consultation_req_consultant ON nur_consultation_requests(tenant_id, consulting_doctor_id, status);
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0192_nursing_consultation_requests.sql` | Create | Database table |
| `src/schemas/nursing.ts` | Modify | Add consultation schemas |
| `src/routes/tenant/nursing/consultation-requests.ts` | Create | API routes |
| `src/routes/tenant/nursing/index.ts` | Modify | Mount routes |
| `web/src/components/nursing/ConsultationRequestsTab.tsx` | Create | Frontend component |

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/0192_nursing_consultation_requests.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Consultation Requests (Inter-department)
CREATE TABLE IF NOT EXISTS nur_consultation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  ward_id INTEGER,
  bed_id INTEGER,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  requesting_doctor_id INTEGER NOT NULL,
  requesting_department_id INTEGER,
  purpose TEXT NOT NULL,
  consulting_doctor_id INTEGER NOT NULL,
  consulting_department_id INTEGER,
  consultant_response TEXT,
  consulted_on TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'responded', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_consultation_req_visit
  ON nur_consultation_requests(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_consultation_req_consultant
  ON nur_consultation_requests(tenant_id, consulting_doctor_id, status);
```

- [ ] **Step 2: Run migration**

Run: `npx wrangler d1 execute hms-db --local --file=migrations/0192_nursing_consultation_requests.sql`

- [ ] **Step 3: Commit**

```bash
git add migrations/0192_nursing_consultation_requests.sql
git commit -m "feat(nursing): add consultation requests database migration"
```

---

### Task 2: Zod Schemas

**Files:**
- Modify: `src/schemas/nursing.ts`

- [ ] **Step 1: Add consultation schemas**

```typescript
// ─── 16. Consultation Requests ──────────────────────────────────────────────
export const createConsultationRequestSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  ward_id: z.number().int().optional(),
  bed_id: z.number().int().optional(),
  requesting_doctor_id: z.number().int(),
  requesting_department_id: z.number().int().optional(),
  purpose: z.string().min(1).max(2000),
  consulting_doctor_id: z.number().int(),
  consulting_department_id: z.number().int().optional(),
});

export const respondConsultationSchema = z.object({
  consultant_response: z.string().min(1).max(2000),
  status: z.enum(['accepted', 'responded']).default('responded'),
});

export const consultationQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  consulting_doctor_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'accepted', 'responded', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/nursing.ts
git commit -m "feat(nursing): add consultation request Zod schemas"
```

---

### Task 3: Consultation Request API Routes

**Files:**
- Create: `src/routes/tenant/nursing/consultation-requests.ts`

- [ ] **Step 1: Create routes file**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createConsultationRequestSchema,
  respondConsultationSchema,
  consultationQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const consultationRequestRoutes = new Hono<NursingEnv>();

// GET /consultation-requests — list requests
consultationRequestRoutes.get('/', zValidator('query', consultationQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, visit_id, consulting_doctor_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT cr.id, cr.patient_id, cr.visit_id, cr.ward_id, cr.bed_id,
           cr.requested_on, cr.requesting_doctor_id, cr.requesting_department_id,
           cr.purpose, cr.consulting_doctor_id, cr.consulting_department_id,
           cr.consultant_response, cr.consulted_on, cr.status,
           rd.name AS requesting_doctor_name, cd.name AS consulting_doctor_name
    FROM nur_consultation_requests cr
    LEFT JOIN doctors rd ON rd.id = cr.requesting_doctor_id
    LEFT JOIN doctors cd ON cd.id = cr.consulting_doctor_id
    WHERE cr.tenant_id = ? AND cr.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND cr.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND cr.visit_id = ?'; params.push(visit_id); }
  if (consulting_doctor_id) { query += ' AND cr.consulting_doctor_id = ?'; params.push(consulting_doctor_id); }
  if (status) { query += ' AND cr.status = ?'; params.push(status); }

  query += ' ORDER BY cr.requested_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_consultation_requests cr WHERE cr.tenant_id = ? AND cr.is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND cr.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND cr.visit_id = ?'; countParams.push(visit_id); }
  if (consulting_doctor_id) { countQuery += ' AND cr.consulting_doctor_id = ?'; countParams.push(consulting_doctor_id); }
  if (status) { countQuery += ' AND cr.status = ?'; countParams.push(status); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /consultation-requests/:id — single request
consultationRequestRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT cr.*, rd.name AS requesting_doctor_name, cd.name AS consulting_doctor_name
    FROM nur_consultation_requests cr
    LEFT JOIN doctors rd ON rd.id = cr.requesting_doctor_id
    LEFT JOIN doctors cd ON cd.id = cr.consulting_doctor_id
    WHERE cr.id = ? AND cr.tenant_id = ? AND cr.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

// POST /consultation-requests — create request
consultationRequestRoutes.post('/', zValidator('json', createConsultationRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_consultation_requests
      (tenant_id, patient_id, visit_id, ward_id, bed_id,
       requesting_doctor_id, requesting_department_id, purpose,
       consulting_doctor_id, consulting_department_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.ward_id ?? null, data.bed_id ?? null,
    data.requesting_doctor_id, data.requesting_department_id ?? null,
    data.purpose, data.consulting_doctor_id,
    data.consulting_department_id ?? null, userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /consultation-requests/:id/respond — respond to request
consultationRequestRoutes.put('/:id/respond', zValidator('json', respondConsultationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_consultation_requests WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status === 'responded' || existing.status === 'cancelled') {
    return c.json({ error: `Cannot respond to a ${existing.status} request` }, 400);
  }

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE nur_consultation_requests
    SET consultant_response = ?, consulted_on = datetime('now', '+6 hours'),
        status = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.consultant_response, data.status, id, tenantId).run();

  return c.json({ Results: true });
});

// PUT /consultation-requests/:id/cancel — cancel request
consultationRequestRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_consultation_requests WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status === 'responded') {
    return c.json({ error: 'Cannot cancel a responded request' }, 400);
  }

  await db.$client.prepare(`
    UPDATE nur_consultation_requests
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});

// DELETE /consultation-requests/:id — soft delete
consultationRequestRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_consultation_requests WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_consultation_requests SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  return c.json({ Results: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/nursing/consultation-requests.ts
git commit -m "feat(nursing): add consultation request API routes"
```

---

### Task 4: Mount Routes

**Files:**
- Modify: `src/routes/tenant/nursing/index.ts`

- [ ] **Step 1: Add import and mount**

Add import:
```typescript
import { consultationRequestRoutes } from './consultation-requests';
```

Add mount:
```typescript
nursing.route('/consultation-requests', consultationRequestRoutes);
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/nursing/index.ts
git commit -m "feat(nursing): mount consultation request routes"
```

---

### Task 5: Frontend Component

**Files:**
- Create: `web/src/components/nursing/ConsultationRequestsTab.tsx`

- [ ] **Step 1: Create ConsultationRequestsTab component**

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

interface ConsultationRequest {
  id: number;
  patient_id: number;
  visit_id: number;
  requested_on: string;
  requesting_doctor_id: number;
  requesting_doctor_name: string;
  purpose: string;
  consulting_doctor_id: number;
  consulting_doctor_name: string;
  consultant_response: string | null;
  consulted_on: string | null;
  status: 'pending' | 'accepted' | 'responded' | 'cancelled';
}

interface Doctor {
  id: number;
  name: string;
  department_id?: number;
}

interface ConsultationRequestsTabProps {
  patientId?: number;
  visitId?: number;
  requestingDoctorId?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-blue-100 text-blue-800',
  responded: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export function ConsultationRequestsTab({ patientId, visitId, requestingDoctorId }: ConsultationRequestsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRespondModal, setShowRespondModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ConsultationRequest | null>(null);
  const [formData, setFormData] = useState({
    patient_id: patientId || 0,
    visit_id: visitId || 0,
    requesting_doctor_id: requestingDoctorId || 0,
    purpose: '',
    consulting_doctor_id: 0,
  });
  const [responseData, setResponseData] = useState({
    consultant_response: '',
    status: 'responded' as 'accepted' | 'responded',
  });

  // Fetch requests
  const { data: requests = [], isLoading } = useQuery<ConsultationRequest[]>({
    queryKey: ['nursing-consultation-requests', patientId, visitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (patientId) params.set('patient_id', String(patientId));
      if (visitId) params.set('visit_id', String(visitId));
      const res = await api.get(`/api/nursing/consultation-requests?${params}`);
      return res.data.Results;
    },
  });

  // Fetch doctors for dropdowns
  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ['doctors-list'],
    queryFn: async () => {
      const res = await api.get('/api/doctors');
      return res.data.Results || res.data;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return api.post('/api/nursing/consultation-requests', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nursing-consultation-requests'] });
      toast({ title: 'Consultation request sent' });
      setShowAddModal(false);
      setFormData({ patient_id: patientId || 0, visit_id: visitId || 0, requesting_doctor_id: requestingDoctorId || 0, purpose: '', consulting_doctor_id: 0 });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.response?.data?.error || 'Failed to create request', variant: 'destructive' });
    },
  });

  // Respond mutation
  const respondMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof responseData }) => {
      return api.put(`/api/nursing/consultation-requests/${id}/respond`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nursing-consultation-requests'] });
      toast({ title: 'Response submitted' });
      setShowRespondModal(false);
      setSelectedRequest(null);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.response?.data?.error || 'Failed to respond', variant: 'destructive' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.consulting_doctor_id || !formData.purpose) {
      toast({ title: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleRespond = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest || !responseData.consultant_response) {
      toast({ title: 'Please enter a response', variant: 'destructive' });
      return;
    }
    respondMutation.mutate({ id: selectedRequest.id, data: responseData });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Consultation Requests</h3>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm">New Request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Consultation</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              {!patientId && (
                <div>
                  <Label>Patient ID</Label>
                  <Input type="number" value={formData.patient_id || ''} onChange={(e) => setFormData({ ...formData, patient_id: parseInt(e.target.value) || 0 })} required />
                </div>
              )}
              {!visitId && (
                <div>
                  <Label>Visit ID</Label>
                  <Input type="number" value={formData.visit_id || ''} onChange={(e) => setFormData({ ...formData, visit_id: parseInt(e.target.value) || 0 })} required />
                </div>
              )}
              <div>
                <Label>Consulting Doctor</Label>
                <Select value={formData.consulting_doctor_id ? String(formData.consulting_doctor_id) : ''} onValueChange={(v) => setFormData({ ...formData, consulting_doctor_id: parseInt(v) })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Purpose of Consultation</Label>
                <Textarea value={formData.purpose} onChange={(e) => setFormData({ ...formData, purpose: e.target.value })} placeholder="Describe the reason for consultation..." required />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? 'Sending...' : 'Send Request'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Requests Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Consultation History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No consultation requests</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Requested To</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>{new Date(req.requested_on).toLocaleString()}</TableCell>
                    <TableCell>{req.consulting_doctor_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.purpose}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[req.status]}>{req.status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.consultant_response || '-'}</TableCell>
                    <TableCell>
                      {req.status === 'pending' && (
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedRequest(req); setShowRespondModal(true); }}>
                          Respond
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Respond Modal */}
      <Dialog open={showRespondModal} onOpenChange={setShowRespondModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Respond to Consultation</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-2 mb-4">
              <p className="text-sm"><strong>Purpose:</strong> {selectedRequest.purpose}</p>
              <p className="text-sm"><strong>Requested by:</strong> {selectedRequest.requesting_doctor_name}</p>
            </div>
          )}
          <form onSubmit={handleRespond} className="space-y-4">
            <div>
              <Label>Response</Label>
              <Textarea value={responseData.consultant_response} onChange={(e) => setResponseData({ ...responseData, consultant_response: e.target.value })} placeholder="Enter your consultation response..." required />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowRespondModal(false)}>Cancel</Button>
              <Button type="submit" disabled={respondMutation.isPending}>{respondMutation.isPending ? 'Submitting...' : 'Submit Response'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/ConsultationRequestsTab.tsx
git commit -m "feat(nursing): add ConsultationRequestsTab frontend component"
```

---

### Task 6: Unit Tests

**Files:**
- Modify: `test/nursing.test.ts`

- [ ] **Step 1: Add consultation request tests**

```typescript
describe('Consultation Requests', () => {
  it('should validate createConsultationRequestSchema', () => {
    const valid = createConsultationRequestSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      requesting_doctor_id: 1,
      purpose: 'Cardiology evaluation',
      consulting_doctor_id: 2,
    });
    expect(valid.success).toBe(true);
  });

  it('should reject empty purpose', () => {
    const invalid = createConsultationRequestSchema.safeParse({
      patient_id: 1,
      visit_id: 1,
      requesting_doctor_id: 1,
      purpose: '',
      consulting_doctor_id: 2,
    });
    expect(invalid.success).toBe(false);
  });

  it('should validate respondConsultationSchema', () => {
    const valid = respondConsultationSchema.safeParse({
      consultant_response: 'Patient needs echo, recommend cardiology follow-up',
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.status).toBe('responded');
  });

  it('should validate consultationQuerySchema defaults', () => {
    const result = consultationQuerySchema.safeParse({});
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
git commit -m "test(nursing): add consultation request unit tests"
```
