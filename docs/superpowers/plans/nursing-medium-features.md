# Nursing Module — Medium Priority Features

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 medium-priority features to reach ~95% parity with DanpheEMR: Patient Transfer, Nursing Orders, Drug Requisition, Ward Billing.

**Architecture:** Follows existing nursing module patterns — Hono routes, Zod schemas, D1 tables, multi-tenant.

**Tech Stack:** Hono + Zod + Cloudflare D1 + React (shadcn/ui)

---

## Feature 1: Patient Transfer

### Database

```sql
-- File: migrations/0193_nursing_patient_transfer.sql

CREATE TABLE IF NOT EXISTS nur_patient_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  from_ward_id INTEGER NOT NULL,
  from_bed_id INTEGER,
  to_ward_id INTEGER NOT NULL,
  to_bed_id INTEGER,
  transfer_reason TEXT,
  transferred_by TEXT,
  transferred_on TEXT DEFAULT (datetime('now', '+6 hours')),
  received_by TEXT,
  received_on TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'received', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX idx_patient_transfers_visit ON nur_patient_transfers(tenant_id, visit_id, status);
CREATE INDEX idx_patient_transfers_pending ON nur_patient_transfers(tenant_id, to_ward_id, status);
```

### Schemas

Add to `src/schemas/nursing.ts`:

```typescript
// ─── 17. Patient Transfer ───────────────────────────────────────────────────
export const createTransferSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  from_ward_id: z.number().int(),
  from_bed_id: z.number().int().optional(),
  to_ward_id: z.number().int(),
  to_bed_id: z.number().int().optional(),
  transfer_reason: z.string().max(1000).optional(),
});

export const receiveTransferSchema = z.object({
  received_by: z.string().min(1),
});

export const transferQuerySchema = z.object({
  visit_id: z.coerce.number().int().positive().optional(),
  to_ward_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

### Routes

Create `src/routes/tenant/nursing/patient-transfer.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createTransferSchema, receiveTransferSchema, transferQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const patientTransferRoutes = new Hono<NursingEnv>();

// GET /patient-transfer — list transfers
patientTransferRoutes.get('/', zValidator('query', transferQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { visit_id, to_ward_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT t.*, fw.name AS from_ward_name, tw.name AS to_ward_name,
           p.name AS patient_name, p.patient_code
    FROM nur_patient_transfers t
    JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
    LEFT JOIN beds fb ON fb.id = t.from_bed_id
    LEFT JOIN beds tb ON tb.id = t.to_bed_id
    LEFT JOIN (
      SELECT DISTINCT ward_id, name FROM beds
    ) fw ON fw.ward_id = t.from_ward_id
    LEFT JOIN (
      SELECT DISTINCT ward_id, name FROM beds
    ) tw ON tw.ward_id = t.to_ward_id
    WHERE t.tenant_id = ? AND t.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (visit_id) { query += ' AND t.visit_id = ?'; params.push(visit_id); }
  if (to_ward_id) { query += ' AND t.to_ward_id = ?'; params.push(to_ward_id); }
  if (status) { query += ' AND t.status = ?'; params.push(status); }

  query += ' ORDER BY t.transferred_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results, pagination: { page, limit, total: results.length } });
});

// GET /patient-transfer/pending — pending receives for a ward
patientTransferRoutes.get('/pending', zValidator('query', transferQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { to_ward_id } = c.req.valid('query');

  let query = `
    SELECT t.*, p.name AS patient_name, p.patient_code
    FROM nur_patient_transfers t
    JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND t.is_active = 1 AND t.status = 'pending'
  `;
  const params: (string | number)[] = [tenantId];
  if (to_ward_id) { query += ' AND t.to_ward_id = ?'; params.push(to_ward_id); }
  query += ' ORDER BY t.transferred_on DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// POST /patient-transfer — initiate transfer
patientTransferRoutes.post('/', zValidator('json', createTransferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_patient_transfers
      (tenant_id, patient_id, visit_id, from_ward_id, from_bed_id, to_ward_id, to_bed_id, transfer_reason, transferred_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.from_ward_id, data.from_bed_id ?? null,
    data.to_ward_id, data.to_bed_id ?? null,
    data.transfer_reason ?? null, userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /patient-transfer/:id/receive — receive transferred patient
patientTransferRoutes.put('/:id/receive', zValidator('json', receiveTransferSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_patient_transfers WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status !== 'pending') return c.json({ error: 'Transfer already processed' }, 400);

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE nur_patient_transfers
    SET status = 'received', received_by = ?, received_on = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.received_by, id, tenantId).run();

  return c.json({ Results: true });
});

// PUT /patient-transfer/:id/cancel — cancel transfer
patientTransferRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_patient_transfers WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status !== 'pending') return c.json({ error: 'Cannot cancel processed transfer' }, 400);

  await db.$client.prepare(`
    UPDATE nur_patient_transfers SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});
```

---

## Feature 2: Nursing Orders (Lab/Radiology/Procedure)

### Database

```sql
-- File: migrations/0194_nursing_orders.sql

CREATE TABLE IF NOT EXISTS nur_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  order_type TEXT NOT NULL CHECK(order_type IN ('lab', 'radiology', 'procedure', 'other')),
  item_name TEXT NOT NULL,
  item_id INTEGER,
  service_department_id INTEGER,
  quantity INTEGER DEFAULT 1,
  priority TEXT DEFAULT 'routine' CHECK(priority IN ('stat', 'urgent', 'routine')),
  instructions TEXT,
  ordered_by INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'completed', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX idx_nursing_orders_visit ON nur_orders(tenant_id, visit_id, is_active);
CREATE INDEX idx_nursing_orders_status ON nur_orders(tenant_id, status, is_active);
```

### Schemas

```typescript
// ─── 18. Nursing Orders ─────────────────────────────────────────────────────
export const createNursingOrderSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  order_type: z.enum(['lab', 'radiology', 'procedure', 'other']),
  item_name: z.string().min(1).max(200),
  item_id: z.number().int().optional(),
  service_department_id: z.number().int().optional(),
  quantity: z.number().int().min(1).default(1),
  priority: z.enum(['stat', 'urgent', 'routine']).default('routine'),
  instructions: z.string().max(2000).optional(),
  ordered_by: z.number().int(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['pending', 'accepted', 'completed', 'cancelled']),
});

export const nursingOrderQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'accepted', 'completed', 'cancelled']).optional(),
  order_type: z.enum(['lab', 'radiology', 'procedure', 'other']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

### Routes

Create `src/routes/tenant/nursing/nursing-orders.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createNursingOrderSchema, updateOrderStatusSchema, nursingOrderQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const nursingOrderRoutes = new Hono<NursingEnv>();

// GET /nursing-orders — list orders
nursingOrderRoutes.get('/', zValidator('query', nursingOrderQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, visit_id, status, order_type, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT o.*, d.name AS ordered_by_name
    FROM nur_orders o
    LEFT JOIN doctors d ON d.id = o.ordered_by
    WHERE o.tenant_id = ? AND o.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND o.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND o.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND o.status = ?'; params.push(status); }
  if (order_type) { query += ' AND o.order_type = ?'; params.push(order_type); }

  query += ' ORDER BY CASE o.priority WHEN \'stat\' THEN 1 WHEN \'urgent\' THEN 2 ELSE 3 END, o.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_orders o WHERE o.tenant_id = ? AND o.is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND o.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND o.visit_id = ?'; countParams.push(visit_id); }
  if (status) { countQuery += ' AND o.status = ?'; countParams.push(status); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// GET /nursing-orders/:id — single order
nursingOrderRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT o.*, d.name AS ordered_by_name
    FROM nur_orders o LEFT JOIN doctors d ON d.id = o.ordered_by
    WHERE o.id = ? AND o.tenant_id = ? AND o.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

// POST /nursing-orders — create order
nursingOrderRoutes.post('/', zValidator('json', createNursingOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_orders
      (tenant_id, patient_id, visit_id, order_type, item_name, item_id,
       service_department_id, quantity, priority, instructions, ordered_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.order_type,
    data.item_name, data.item_id ?? null, data.service_department_id ?? null,
    data.quantity, data.priority, data.instructions ?? null,
    data.ordered_by, userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /nursing-orders/:id/status — update status
nursingOrderRoutes.put('/:id/status', zValidator('json', updateOrderStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_orders WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  await db.$client.prepare(`
    UPDATE nur_orders SET status = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.status, id, tenantId).run();

  return c.json({ Results: true });
});

// DELETE /nursing-orders/:id — soft delete
nursingOrderRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_orders WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_orders SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();
  return c.json({ Results: true });
});
```

---

## Feature 3: Drug Requisition to Pharmacy

### Database

```sql
-- File: migrations/0195_nursing_drug_requisition.sql

CREATE TABLE IF NOT EXISTS nur_drug_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER,
  visit_id INTEGER,
  ward_id INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'dispensed', 'cancelled')),
  remarks TEXT,
  requested_by TEXT,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  dispensed_by TEXT,
  dispensed_on TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS nur_drug_requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  requisition_id INTEGER NOT NULL,
  drug_name TEXT NOT NULL,
  generic_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'tablets',
  remarks TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX idx_drug_requisitions_visit ON nur_drug_requisitions(tenant_id, visit_id, is_active);
CREATE INDEX idx_drug_requisitions_status ON nur_drug_requisitions(tenant_id, ward_id, status);
CREATE INDEX idx_drug_requisition_items_req ON nur_drug_requisition_items(tenant_id, requisition_id);
```

### Schemas

```typescript
// ─── 19. Drug Requisition ───────────────────────────────────────────────────
export const drugRequisitionItemSchema = z.object({
  drug_name: z.string().min(1).max(200),
  generic_name: z.string().max(200).optional(),
  quantity: z.number().int().min(1).default(1),
  unit: z.string().max(50).default('tablets'),
  remarks: z.string().max(500).optional(),
});

export const createDrugRequisitionSchema = z.object({
  patient_id: z.number().int().optional(),
  visit_id: z.number().int().optional(),
  ward_id: z.number().int().optional(),
  remarks: z.string().max(1000).optional(),
  items: z.array(drugRequisitionItemSchema).min(1),
});

export const drugRequisitionQuerySchema = z.object({
  ward_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'dispensed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

### Routes

Create `src/routes/tenant/nursing/drug-requisition.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createDrugRequisitionSchema, drugRequisitionQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const drugRequisitionRoutes = new Hono<NursingEnv>();

// GET /drug-requisition — list requisitions
drugRequisitionRoutes.get('/', zValidator('query', drugRequisitionQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { ward_id, visit_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT r.*, p.name AS patient_name, p.patient_code
    FROM nur_drug_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (ward_id) { query += ' AND r.ward_id = ?'; params.push(ward_id); }
  if (visit_id) { query += ' AND r.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND r.status = ?'; params.push(status); }

  query += ' ORDER BY r.requested_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results, pagination: { page, limit, total: results.length } });
});

// GET /drug-requisition/:id — single requisition with items
drugRequisitionRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const requisition = await db.$client.prepare(`
    SELECT r.*, p.name AS patient_name, p.patient_code
    FROM nur_drug_requisitions r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ? AND r.is_active = 1
  `).bind(id, tenantId).first();

  if (!requisition) throw new HTTPException(404, { message: 'Not found' });

  const { results: items } = await db.$client.prepare(`
    SELECT * FROM nur_drug_requisition_items
    WHERE requisition_id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).all();

  return c.json({ Results: { ...requisition, items } });
});

// POST /drug-requisition — create requisition with items
drugRequisitionRoutes.post('/', zValidator('json', createDrugRequisitionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const reqResult = await db.$client.prepare(`
    INSERT INTO nur_drug_requisitions
      (tenant_id, patient_id, visit_id, ward_id, remarks, requested_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id ?? null, data.visit_id ?? null,
    data.ward_id ?? null, data.remarks ?? null, userId ?? 'system'
  ).run();

  const requisitionId = reqResult.meta.last_row_id;

  for (const item of data.items) {
    await db.$client.prepare(`
      INSERT INTO nur_drug_requisition_items
        (tenant_id, requisition_id, drug_name, generic_name, quantity, unit, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, requisitionId, item.drug_name,
      item.generic_name ?? null, item.quantity, item.unit, item.remarks ?? null
    ).run();
  }

  return c.json({ Results: { id: requisitionId } }, 201);
});

// PUT /drug-requisition/:id/dispense — mark as dispensed
drugRequisitionRoutes.put('/:id/dispense', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_drug_requisitions WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status !== 'pending') return c.json({ error: 'Already processed' }, 400);

  await db.$client.prepare(`
    UPDATE nur_drug_requisitions
    SET status = 'dispensed', dispensed_by = ?, dispensed_on = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId ?? 'system', id, tenantId).run();

  return c.json({ Results: true });
});

// PUT /drug-requisition/:id/cancel
drugRequisitionRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare(`
    UPDATE nur_drug_requisitions
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});
```

---

## Feature 4: Ward Billing (IP Provisional Billing)

### Database

```sql
-- File: migrations/0196_nursing_ward_billing.sql

CREATE TABLE IF NOT EXISTS nur_ward_billing_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_id INTEGER,
  service_department_id INTEGER,
  quantity INTEGER DEFAULT 1,
  price REAL,
  total_amount REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'billed', 'cancelled')),
  requested_by TEXT,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  approved_by TEXT,
  approved_on TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX idx_ward_billing_visit ON nur_ward_billing_requests(tenant_id, visit_id, is_active);
CREATE INDEX idx_ward_billing_status ON nur_ward_billing_requests(tenant_id, status, is_active);
```

### Schemas

```typescript
// ─── 20. Ward Billing ──────────────────────────────────────────────────────
export const createWardBillingRequestSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  item_name: z.string().min(1).max(200),
  item_id: z.number().int().optional(),
  service_department_id: z.number().int().optional(),
  quantity: z.number().int().min(1).default(1),
  price: z.number().min(0).optional(),
  total_amount: z.number().min(0).optional(),
});

export const wardBillingQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'approved', 'billed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

### Routes

Create `src/routes/tenant/nursing/ward-billing.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createWardBillingRequestSchema, wardBillingQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };
export const wardBillingRoutes = new Hono<NursingEnv>();

// GET /ward-billing — list billing requests
wardBillingRoutes.get('/', zValidator('query', wardBillingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, visit_id, status, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = `
    SELECT wb.*, p.name AS patient_name, p.patient_code
    FROM nur_ward_billing_requests wb
    JOIN patients p ON p.id = wb.patient_id AND p.tenant_id = wb.tenant_id
    WHERE wb.tenant_id = ? AND wb.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND wb.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND wb.visit_id = ?'; params.push(visit_id); }
  if (status) { query += ' AND wb.status = ?'; params.push(status); }

  query += ' ORDER BY wb.requested_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nur_ward_billing_requests wb WHERE wb.tenant_id = ? AND wb.is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND wb.patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND wb.visit_id = ?'; countParams.push(visit_id); }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /ward-billing — create billing request
wardBillingRoutes.post('/', zValidator('json', createWardBillingRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_ward_billing_requests
      (tenant_id, patient_id, visit_id, item_name, item_id, service_department_id,
       quantity, price, total_amount, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.item_name,
    data.item_id ?? null, data.service_department_id ?? null,
    data.quantity, data.price ?? null, data.total_amount ?? null,
    userId ?? 'system'
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /ward-billing/:id/approve — approve billing request
wardBillingRoutes.put('/:id/approve', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    "SELECT id, status FROM nur_ward_billing_requests WHERE id = ? AND tenant_id = ? AND is_active = 1"
  ).bind(id, tenantId).first<{ id: number; status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  if (existing.status !== 'pending') return c.json({ error: 'Already processed' }, 400);

  await db.$client.prepare(`
    UPDATE nur_ward_billing_requests
    SET status = 'approved', approved_by = ?, approved_on = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId ?? 'system', id, tenantId).run();

  return c.json({ Results: true });
});

// PUT /ward-billing/:id/cancel
wardBillingRoutes.put('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  await db.$client.prepare(`
    UPDATE nur_ward_billing_requests
    SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(id, tenantId).run();

  return c.json({ Results: true });
});
```

---

## Mount All Routes

Modify `src/routes/tenant/nursing/index.ts`:

```typescript
import { patientTransferRoutes } from './patient-transfer';
import { nursingOrderRoutes } from './nursing-orders';
import { drugRequisitionRoutes } from './drug-requisition';
import { wardBillingRoutes } from './ward-billing';

// ... existing code ...

nursing.route('/patient-transfer', patientTransferRoutes);
nursing.route('/nursing-orders', nursingOrderRoutes);
nursing.route('/drug-requisition', drugRequisitionRoutes);
nursing.route('/ward-billing', wardBillingRoutes);
```

---

## Unit Tests

Add to `test/nursing.test.ts`:

```typescript
describe('Patient Transfer', () => {
  it('should validate createTransferSchema', () => {
    const valid = createTransferSchema.safeParse({
      patient_id: 1, visit_id: 1, from_ward_id: 1, to_ward_id: 2,
    });
    expect(valid.success).toBe(true);
  });
});

describe('Nursing Orders', () => {
  it('should validate createNursingOrderSchema', () => {
    const valid = createNursingOrderSchema.safeParse({
      patient_id: 1, visit_id: 1, order_type: 'lab', item_name: 'CBC',
      ordered_by: 1,
    });
    expect(valid.success).toBe(true);
  });

  it('should reject invalid order_type', () => {
    const invalid = createNursingOrderSchema.safeParse({
      patient_id: 1, visit_id: 1, order_type: 'invalid', item_name: 'CBC',
      ordered_by: 1,
    });
    expect(invalid.success).toBe(false);
  });
});

describe('Drug Requisition', () => {
  it('should validate createDrugRequisitionSchema with items', () => {
    const valid = createDrugRequisitionSchema.safeParse({
      ward_id: 1,
      items: [{ drug_name: 'Paracetamol', quantity: 10 }],
    });
    expect(valid.success).toBe(true);
  });

  it('should reject empty items array', () => {
    const invalid = createDrugRequisitionSchema.safeParse({
      ward_id: 1, items: [],
    });
    expect(invalid.success).toBe(false);
  });
});

describe('Ward Billing', () => {
  it('should validate createWardBillingRequestSchema', () => {
    const valid = createWardBillingRequestSchema.safeParse({
      patient_id: 1, visit_id: 1, item_name: 'ECG',
    });
    expect(valid.success).toBe(true);
  });
});
```
