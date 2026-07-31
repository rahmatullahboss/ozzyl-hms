# Token Reservation System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow receptionists to reserve a range of appointment token numbers per doctor per day, so reserved patients (VIPs, staff, referrals) get specific token numbers while regular patients are auto-assigned tokens that skip reserved ranges.

**Architecture:** New `token_reservations` table stores reserved ranges per doctor per day. Token generation in `appointments.ts` is modified to skip reserved numbers. New API endpoints in `reception.ts` manage reservations. Frontend in `ReceptionDashboard.tsx` gets a reservation management panel and a "book with reserved token" option.

**Tech Stack:** D1 (SQLite), Drizzle ORM, Hono + zValidator, React + TanStack Query, Tailwind CSS

---

## How It Works (User Flow)

1. **Receptionist sets reservation:** "Doctor A — today — tokens 1-10 reserved"
2. **Regular patient books appointment:** System auto-assigns token 11, 12, 13... (skips 1-10)
3. **VIP patient arrives:** Receptionist picks "Book with reserved token" → selects token 3 from the reserved range → patient gets token 3
4. **Reserved tokens can be released:** If a reserved slot isn't used by end of day, receptionist can release it back to the pool

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0287_token_reservations.sql` | Create | New table for token reservations |
| `src/routes/tenant/reception.ts` | Modify | Add CRUD endpoints for token reservations |
| `src/routes/tenant/appointments.ts` | Modify | Token generation skips reserved numbers |
| `web/src/pages/ReceptionDashboard.tsx` | Modify | Reservation management UI + book-with-reserved-token |
| `web/src/lib/queryKeys.ts` | Modify | Add query keys for token reservations |

---

## Task 1: Database Migration — `token_reservations` Table

**Files:**
- Create: `migrations/0287_token_reservations.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Token Reservations: Reserve specific token number ranges per doctor per day
-- Receptionists can pre-reserve tokens 1-10 for VIPs, staff, etc.
-- Regular auto-assigned tokens skip reserved ranges.

CREATE TABLE IF NOT EXISTS token_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER,
  reservation_date TEXT NOT NULL,
  token_from INTEGER NOT NULL,
  token_to INTEGER NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, doctor_id, reservation_date, token_from, token_to)
);

CREATE INDEX IF NOT EXISTS idx_token_reservations_lookup
  ON token_reservations(tenant_id, doctor_id, reservation_date, is_active);

CREATE INDEX IF NOT EXISTS idx_token_reservations_date
  ON token_reservations(tenant_id, reservation_date);
```

- [ ] **Step 2: Verify migration file exists**

Run: `ls -la migrations/0287_token_reservations.sql`
Expected: File exists with correct content

- [ ] **Step 3: Commit**

```bash
git add migrations/0287_token_reservations.sql
git commit -m "feat: add token_reservations table migration"
```

---

## Task 2: Backend — Token Reservation API Endpoints

**Files:**
- Modify: `src/routes/tenant/reception.ts`

- [ ] **Step 1: Add Zod schemas for token reservations**

Add after the existing `doctorBulkStatusSchema` (around line 118) in `src/routes/tenant/reception.ts`:

```typescript
const createTokenReservationSchema = z.object({
  doctorId: z.number().int().positive().nullable().optional(),
  reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tokenFrom: z.number().int().min(1),
  tokenTo: z.number().int().min(1),
  label: z.string().trim().max(200).optional().nullable(),
}).refine(d => d.tokenTo >= d.tokenFrom, {
  message: 'tokenTo must be >= tokenFrom',
  path: ['tokenTo'],
});

const updateTokenReservationSchema = z.object({
  tokenFrom: z.number().int().min(1).optional(),
  tokenTo: z.number().int().min(1).optional(),
  label: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
}).refine(d => {
  if (d.tokenFrom !== undefined && d.tokenTo !== undefined) return d.tokenTo >= d.tokenFrom;
  return true;
}, {
  message: 'tokenTo must be >= tokenFrom',
  path: ['tokenTo'],
});
```

- [ ] **Step 2: Add `ensureTokenReservationsTable` helper**

Add before the route definitions in `src/routes/tenant/reception.ts`:

```typescript
async function ensureTokenReservationsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS token_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER,
      reservation_date TEXT NOT NULL,
      token_from INTEGER NOT NULL,
      token_to INTEGER NOT NULL,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
      UNIQUE(tenant_id, doctor_id, reservation_date, token_from, token_to)
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_token_reservations_lookup
      ON token_reservations(tenant_id, doctor_id, reservation_date, is_active)
  `).run();
}
```

- [ ] **Step 3: Add GET endpoint — list reservations**

```typescript
receptionRoutes.get('/token-reservations', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const doctorId = c.req.query('doctorId');
  await ensureTokenReservationsTable(c.env.DB);

  let query = `
    SELECT tr.*, d.name AS doctor_name
    FROM token_reservations tr
    LEFT JOIN doctors d ON d.id = tr.doctor_id AND d.tenant_id = tr.tenant_id
    WHERE tr.tenant_id = ? AND tr.reservation_date = ?
  `;
  const params: (string | number)[] = [tenantId, date];

  if (doctorId) {
    query += ' AND tr.doctor_id = ?';
    params.push(Number(doctorId));
  }

  query += ' ORDER BY tr.token_from ASC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ date, reservations: results });
});
```

- [ ] **Step 4: Add GET endpoint — reserved token ranges for a doctor**

This endpoint returns just the reserved ranges (used by token generation logic):

```typescript
receptionRoutes.get('/token-reservations/ranges', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const doctorId = c.req.query('doctorId');
  await ensureTokenReservationsTable(c.env.DB);

  if (!doctorId) throw new HTTPException(400, { message: 'doctorId is required' });

  const { results } = await c.env.DB.prepare(`
    SELECT token_from, token_to FROM token_reservations
    WHERE tenant_id = ? AND reservation_date = ? AND doctor_id = ? AND is_active = 1
    ORDER BY token_from ASC
  `).bind(tenantId, date, Number(doctorId)).all();

  return c.json({ date, doctorId: Number(doctorId), ranges: results });
});
```

- [ ] **Step 5: Add GET endpoint — available reserved tokens**

Returns which specific tokens in reserved ranges are still unassigned (not yet booked):

```typescript
receptionRoutes.get('/token-reservations/available', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const doctorId = c.req.query('doctorId');
  await ensureTokenReservationsTable(c.env.DB);

  if (!doctorId) throw new HTTPException(400, { message: 'doctorId is required' });

  // Get all reserved ranges
  const { results: ranges } = await c.env.DB.prepare(`
    SELECT token_from, token_to, label FROM token_reservations
    WHERE tenant_id = ? AND reservation_date = ? AND doctor_id = ? AND is_active = 1
  `).bind(tenantId, date, Number(doctorId)).all();

  // Get already-booked token numbers for this doctor+date
  const { results: booked } = await c.env.DB.prepare(`
    SELECT token_no FROM appointments
    WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ?
      AND status NOT IN ('cancelled', 'no_show')
  `).bind(tenantId, date, Number(doctorId)).all();

  const bookedSet = new Set(booked.map((r: any) => r.token_no));

  // Build list of available reserved tokens
  const available: Array<{ token: number; label: string | null }> = [];
  for (const range of ranges as any[]) {
    for (let t = range.token_from; t <= range.token_to; t++) {
      if (!bookedSet.has(t)) {
        available.push({ token: t, label: range.label ?? null });
      }
    }
  }

  return c.json({ date, doctorId: Number(doctorId), available });
});
```

- [ ] **Step 6: Add POST endpoint — create reservation**

```typescript
receptionRoutes.post('/token-reservations', zValidator('json', createTokenReservationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await ensureTokenReservationsTable(c.env.DB);

  // Check for overlapping reservations
  const { results: overlapping } = await c.env.DB.prepare(`
    SELECT id, token_from, token_to FROM token_reservations
    WHERE tenant_id = ? AND reservation_date = ? AND is_active = 1
      AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
      AND token_from <= ? AND token_to >= ?
  `).bind(
    tenantId, data.reservationDate,
    data.doctorId ?? null, data.doctorId ?? null,
    data.tokenTo, data.tokenFrom
  ).all();

  if (overlapping.length > 0) {
    throw new HTTPException(409, {
      message: `Overlaps with existing reservation (tokens ${(overlapping[0] as any).token_from}-${(overlapping[0] as any).token_to})`,
    });
  }

  // Check for existing appointments in the range
  const { results: existingAppts } = await c.env.DB.prepare(`
    SELECT token_no FROM appointments
    WHERE tenant_id = ? AND appt_date = ?
      AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
      AND token_no >= ? AND token_no <= ?
      AND status NOT IN ('cancelled', 'no_show')
  `).bind(
    tenantId, data.reservationDate,
    data.doctorId ?? null, data.doctorId ?? null,
    data.tokenFrom, data.tokenTo
  ).all();

  if (existingAppts.length > 0) {
    throw new HTTPException(409, {
      message: `Token(s) ${(existingAppts as any[]).map(r => r.token_no).join(', ')} already have appointments in this range`,
    });
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO token_reservations (tenant_id, doctor_id, reservation_date, token_from, token_to, label, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.doctorId ?? null, data.reservationDate,
    data.tokenFrom, data.tokenTo, data.label ?? null, userId
  ).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'token_reservations', result.meta.last_row_id, null, data);

  return c.json({ id: result.meta.last_row_id, ...data }, 201);
});
```

- [ ] **Step 7: Add PATCH endpoint — update reservation**

```typescript
receptionRoutes.patch('/token-reservations/:id', zValidator('json', updateTokenReservationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  await ensureTokenReservationsTable(c.env.DB);

  const existing = await c.env.DB.prepare(`
    SELECT * FROM token_reservations WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Reservation not found' });

  const tokenFrom = data.tokenFrom ?? (existing as any).token_from;
  const tokenTo = data.tokenTo ?? (existing as any).token_to;
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing as any).is_active;
  const label = data.label !== undefined ? data.label : (existing as any).label;

  await c.env.DB.prepare(`
    UPDATE token_reservations
    SET token_from = ?, token_to = ?, label = ?, is_active = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(tokenFrom, tokenTo, label, isActive, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'token_reservations', id, existing, data);

  return c.json({ id, tokenFrom, tokenTo, label, isActive: Boolean(isActive) });
});
```

- [ ] **Step 8: Add DELETE endpoint — remove reservation**

```typescript
receptionRoutes.delete('/token-reservations/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  await ensureTokenReservationsTable(c.env.DB);

  const existing = await c.env.DB.prepare(`
    SELECT * FROM token_reservations WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Reservation not found' });

  await c.env.DB.prepare('DELETE FROM token_reservations WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'token_reservations', id, existing, null);

  return c.json({ deleted: true });
});
```

- [ ] **Step 9: Commit**

```bash
git add src/routes/tenant/reception.ts
git commit -m "feat: add token reservation CRUD API endpoints"
```

---

## Task 3: Backend — Modify Token Generation to Skip Reserved Ranges

**Files:**
- Modify: `src/routes/tenant/appointments.ts` (lines 1304-1314)

- [ ] **Step 1: Add `getNextAvailableToken` helper function**

Add this helper function in `src/routes/tenant/appointments.ts` after the imports (around line 50):

```typescript
async function getNextAvailableToken(
  db: D1Database,
  tenantId: string,
  doctorId: number | null,
  apptDate: string,
): Promise<number> {
  // Get reserved ranges for this doctor+date
  const { results: ranges } = await db.prepare(`
    SELECT token_from, token_to FROM token_reservations
    WHERE tenant_id = ? AND reservation_date = ? AND is_active = 1
      AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
    ORDER BY token_from ASC
  `).bind(tenantId, apptDate, doctorId ?? null, doctorId ?? null).all();

  // Get current max token
  const tokenRow = await db.prepare(`
    SELECT COALESCE(MAX(token_no), 0) AS max_token
    FROM appointments
    WHERE tenant_id = ? AND appt_date = ? AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
  `).bind(tenantId, apptDate, doctorId ?? null, doctorId ?? null).first<{ max_token: number }>();

  const currentMax = tokenRow?.max_token ?? 0;
  let candidate = currentMax + 1;

  // If no reservations, return next sequential
  if (ranges.length === 0) return candidate;

  // Build reserved set for quick lookup
  const reservedRanges = ranges as Array<{ token_from: number; token_to: number }>;

  // Find next available token that doesn't fall in any reserved range
  while (true) {
    const isReserved = reservedRanges.some(r => candidate >= r.token_from && candidate <= r.token_to);
    if (!isReserved) return candidate;
    candidate++;
  }
}
```

- [ ] **Step 2: Replace token generation in appointment creation**

Replace the token calculation block (lines 1308-1314) from:

```typescript
      const tokenRow = await db.$client.prepare(`
        SELECT COALESCE(MAX(token_no), 0) + 1 AS next_token
        FROM appointments
        WHERE tenant_id = ? AND appt_date = ? AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
      `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.doctorId ?? null).first<{ next_token: number }>();

      const tokenNo = tokenRow?.next_token ?? 1;
```

To:

```typescript
      const tokenNo = await getNextAvailableToken(c.env.DB, tenantId!, data.doctorId ?? null, data.apptDate);
```

- [ ] **Step 3: Add `requestedTokenNo` field to create appointment schema**

In `src/schemas/appointment.ts`, add to `createAppointmentSchema`:

```typescript
  requestedTokenNo: z.number().int().min(1).optional(),
```

- [ ] **Step 4: Handle requested token in appointment creation**

In `src/routes/tenant/appointments.ts`, modify the token logic to support explicit token requests. Replace the `tokenNo` assignment with:

```typescript
      let tokenNo: number;

      if (data.requestedTokenNo) {
        // Validate the requested token is in a reserved range and not already taken
        const { results: ranges } = await c.env.DB.prepare(`
          SELECT token_from, token_to FROM token_reservations
          WHERE tenant_id = ? AND reservation_date = ? AND is_active = 1
            AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
            AND token_from <= ? AND token_to >= ?
        `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.doctorId ?? null, data.requestedTokenNo, data.requestedTokenNo).all();

        if (ranges.length === 0) {
          throw new HTTPException(400, { message: `Token ${data.requestedTokenNo} is not in any reserved range` });
        }

        // Check not already taken
        const taken = await c.env.DB.prepare(`
          SELECT id FROM appointments
          WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ? AND token_no = ?
            AND status NOT IN ('cancelled', 'no_show')
        `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.requestedTokenNo).first();

        if (taken) {
          throw new HTTPException(409, { message: `Token ${data.requestedTokenNo} is already assigned` });
        }

        tokenNo = data.requestedTokenNo;
      } else {
        tokenNo = await getNextAvailableToken(c.env.DB, tenantId!, data.doctorId ?? null, data.apptDate);
      }
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/appointments.ts src/schemas/appointment.ts
git commit -m "feat: token generation skips reserved ranges + support requestedTokenNo"
```

---

## Task 4: Frontend — Query Keys

**Files:**
- Modify: `web/src/lib/queryKeys.ts`

- [ ] **Step 1: Add token reservation query keys**

Add after the `queue` section (around line 150):

```typescript
  tokenReservations: {
    all: ['tokenReservations'] as const,
    list: (filters: Record<string, string>) => ['tokenReservations', 'list', filters] as const,
    ranges: (filters: Record<string, string>) => ['tokenReservations', 'ranges', filters] as const,
    available: (filters: Record<string, string>) => ['tokenReservations', 'available', filters] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/queryKeys.ts
git commit -m "feat: add token reservation query keys"
```

---

## Task 5: Frontend — Reservation Management UI in ReceptionDashboard

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx`

- [ ] **Step 1: Add token reservation types**

Add after the existing interface definitions (around line 137):

```typescript
interface TokenReservation {
  id: number;
  doctor_id: number | null;
  doctor_name?: string | null;
  reservation_date: string;
  token_from: number;
  token_to: number;
  label?: string | null;
  is_active: number;
}
```

- [ ] **Step 2: Add state variables for reservation management**

Add inside the ReceptionDashboard component (near other useState declarations):

```typescript
const [showReservationPanel, setShowReservationPanel] = useState(false);
const [reservationDate, setReservationDate] = useState(getTodayGMT6());
const [reservationDoctorId, setReservationDoctorId] = useState<number | ''>('');
const [reservationFrom, setReservationFrom] = useState<number>(1);
const [reservationTo, setReservationTo] = useState<number>(10);
const [reservationLabel, setReservationLabel] = useState('');
```

- [ ] **Step 3: Add API queries for reservations**

Add after existing query definitions:

```typescript
const { data: reservationsData } = useApiQuery<{ reservations: TokenReservation[] }>(
  queryKeys.tokenReservations.list({ date: reservationDate, doctorId: reservationDoctorId ? String(reservationDoctorId) : '' }),
  `/api/reception/token-reservations?date=${reservationDate}${reservationDoctorId ? `&doctorId=${reservationDoctorId}` : ''}`,
  { enabled: showReservationPanel }
);

const createReservationMutation = useApiMutation<any, any>(
  (data) => api.post('/api/reception/token-reservations', data),
  {
    onSuccess: () => {
      toast.success('Token reservation created');
      queryClient.invalidateQueries({ queryKey: queryKeys.tokenReservations.all });
    },
  }
);

const deleteReservationMutation = useApiMutation<any, { id: number }>(
  ({ id }) => api.delete(`/api/reception/token-reservations/${id}`),
  {
    onSuccess: () => {
      toast.success('Reservation removed');
      queryClient.invalidateQueries({ queryKey: queryKeys.tokenReservations.all });
    },
  }
);
```

- [ ] **Step 4: Add reservation management panel UI**

Add a "Token Reservations" button near the doctor status section that opens a slide-over panel. The panel should show:
1. Date picker + Doctor filter
2. List of current reservations (token range, label, delete button)
3. "Add Reservation" form (from-to range, label, doctor)
4. Summary showing reserved vs available tokens

- [ ] **Step 5: Add "Book with Reserved Token" option in appointment booking**

When booking an appointment for a doctor with reserved tokens, show a dropdown/select allowing the receptionist to pick a specific reserved token number instead of auto-assigning. Pass `requestedTokenNo` in the booking API call.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "feat: add token reservation management UI in reception dashboard"
```

---

## Task 6: Verification

- [ ] **Step 1: Run TypeScript check**

```bash
pnpm typecheck
```

Expected: No errors

- [ ] **Step 2: Run linter**

```bash
pnpm lint
```

Expected: No errors

- [ ] **Step 3: Manual verification flow**

1. Login as reception
2. Go to Reception Dashboard
3. Open Token Reservations panel
4. Create a reservation: Doctor X, today, tokens 1-5, label "VIP"
5. Book an appointment for Doctor X → token should auto-assign as 6 (skipping 1-5)
6. Book another appointment with "Reserved Token" → select token 3 → should succeed
7. Try booking with token 3 again → should fail (already taken)
8. Delete reservation → book again → token should auto-assign normally

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete token reservation system for appointment tokens"
```
