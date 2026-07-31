# Flexible Queue Token Serial — Design

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Reception can issue any positive integer token number for today instead of relying on auto-increment.

---

## Problem

The current queue token system auto-generates serial numbers via a per-tenant/department/day counter (`queue_token_counters.last_token + 1`). Reception has no way to:

1. Issue a specific number to a VIP / walk-in / late patient who expects a particular slot
2. Re-issue a number that was cancelled and free up
3. Skip the auto-increment when counters are out of sync with physical tickets

This causes friction at reception desks that print physical serial slips matched to chair order.

## Solution

Make the token issue flow accept an optional `tokenNumber` (positive integer). When provided, the system uses it (after validation and duplicate check); when omitted, the existing auto-increment is preserved. All changes are backward-compatible.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Format | Positive integer only (1–99999) | Simplest UX, matches the numeric `token_number` column |
| Duplicate handling | Block + 409 error | Prevents display/queue confusion; reception picks a new number |
| Audit | `manual_serial_set_by` + `manual_serial_set_at` on `queue_entries` | Lightweight, queryable in admin views later |
| Race safety | Partial unique index on `(tenant_id, department_id, queue_date, token_number)` | DB-level guarantee, app-level check is best-effort |
| Frontend | Optional "Custom serial #" number input in token-issue form | Empty = auto (no behavior change for existing flow) |
| RBAC | Any role that can call `POST /api/queue/token` today | No new permission; reception role is the natural caller |

---

## Backend Changes

### 1. Schema validation (`src/routes/tenant/queue.ts:16-23`)

```ts
const issueTokenSchema = z.object({
  patientId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  visitId: z.number().int().positive().optional(),
  priority: z.enum(['normal', 'urgent', 'emergency', 'vip']).default('normal'),
  counterNo: z.string().max(20).optional(),
  tokenNumber: z.number().int().positive().max(99999).optional(),
});
```

### 2. `getNextToken()` helper (`src/routes/tenant/queue.ts:61-90`)

Add an optional `customTokenNumber` parameter. New behavior:

```ts
async function getNextToken(
  db, tenantId, departmentId, date,
  customTokenNumber?: number,
): Promise<{ tokenNo: string; tokenNumber: number }> {
  const deptKey = departmentId ?? 0;
  const prefix = 'T';

  // Ensure counter row exists
  await db.$client.prepare(`
    INSERT INTO queue_token_counters (tenant_id, department_id, counter_date, last_token, prefix)
    VALUES (?, ?, ?, 0, 'T')
    ON CONFLICT(tenant_id, department_id, counter_date) DO NOTHING
  `).bind(tenantId, deptKey, date).run();

  if (customTokenNumber !== undefined) {
    // Bump counter to at least customTokenNumber so next auto stays ahead
    await db.$client.prepare(`
      UPDATE queue_token_counters
      SET last_token = MAX(last_token, ?)
      WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
    `).bind(customTokenNumber, tenantId, deptKey, date).run();

    return {
      tokenNo: `${prefix}${String(customTokenNumber).padStart(3, '0')}`,
      tokenNumber: customTokenNumber,
    };
  }

  // Auto-increment path (unchanged)
  await db.$client.prepare(`
    UPDATE queue_token_counters SET last_token = last_token + 1
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(tenantId, deptKey, date).run();

  const row = await db.$client.prepare(`
    SELECT last_token, prefix FROM queue_token_counters
    WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
  `).bind(tenantId, deptKey, date).first<{ last_token: number; prefix: string }>();

  const num = row?.last_token ?? 1;
  const prefixOut = row?.prefix ?? 'T';
  return { tokenNo: `${prefixOut}${String(num).padStart(3, '0')}`, tokenNumber: num };
}
```

### 3. `POST /token` route (`src/routes/tenant/queue.ts:452-480`)

```ts
queueRoutes.post('/token', zValidator('json', issueTokenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = getFullTimestampGMT6();

  await assertVisitCanEnterDoctorQueue(db, tenantId, data.visitId);

  // Pre-check duplicate (fast path; DB index is final guard)
  if (data.tokenNumber !== undefined) {
    const dup = await db.$client.prepare(`
      SELECT id, patient_id, token_no FROM queue_entries
      WHERE tenant_id = ? AND department_id IS ? AND queue_date = ?
        AND token_number = ?
    `).bind(tenantId, data.departmentId ?? null, today, data.tokenNumber).first<{ id: number; patient_id: number; token_no: string }>();

    if (dup) {
      throw new HTTPException(409, {
        message: `Serial ${data.tokenNumber} already issued today (token ${dup.token_no})`,
      });
    }
  }

  const { tokenNo, tokenNumber } = await getNextToken(
    db, tenantId, data.departmentId ?? null, today, data.tokenNumber,
  );
  const estWait = await estimateWait(db, tenantId, data.departmentId ?? null, today);

  const manualSet = data.tokenNumber !== undefined;
  try {
    const result = await db.$client.prepare(`
      INSERT INTO queue_entries
        (tenant_id, visit_id, patient_id, department_id, doctor_id, token_no, token_number,
         queue_date, priority, status, check_in_time, counter_no, estimated_wait_minutes,
         manual_serial_set_by, manual_serial_set_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)
    `).bind(
      tenantId, data.visitId ?? null, data.patientId, data.departmentId ?? null,
      data.doctorId ?? null, tokenNo, tokenNumber, today, data.priority,
      now, data.counterNo ?? null, estWait,
      manualSet ? userId : null, manualSet ? now : null,
    ).run();

    return c.json({
      message: 'Token issued',
      data: {
        id: result.meta.last_row_id, tokenNo, tokenNumber,
        estimatedWait: estWait, priority: data.priority,
        manualSerial: manualSet,
      },
    }, 201);
  } catch (e: any) {
    // Race: another transaction inserted same number after our pre-check
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(409, {
        message: `Serial ${data.tokenNumber} already issued today`,
      });
    }
    throw e;
  }
});
```

### 4. Tenant read-only audit endpoint (no — out of scope)

No GET endpoint for the audit columns in this iteration. The columns are queryable via existing `/api/queue/tokens` if a future need arises.

---

## Database Migration

`migrations/0297_flexible_token_serial.sql`:

```sql
-- Migration 0297: Flexible token serial (manual override at reception)

-- Audit columns for manual serial assignments
ALTER TABLE queue_entries ADD COLUMN manual_serial_set_by INTEGER;
ALTER TABLE queue_entries ADD COLUMN manual_serial_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_entry_manual_serial
    ON queue_entries(tenant_id, manual_serial_set_by)
    WHERE manual_serial_set_by IS NOT NULL;

-- Race-safe duplicate guard for manual serials (and auto, but auto is sequential so no conflict).
-- Two partial indexes because SQLite treats NULL as distinct in UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_dept
    ON queue_entries(tenant_id, department_id, queue_date, token_number)
    WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_nodept
    ON queue_entries(tenant_id, queue_date, token_number)
    WHERE department_id IS NULL;
```

---

## Frontend Changes

### Issue token form (`web/src/pages/QueueManagement.tsx`)

Add an optional number input under the priority selector. Empty = auto.

```tsx
// Add state
const [issueCustomSerial, setIssueCustomSerial] = useState('');

// In mutation
issueTokenMutation.mutate({
  patientId: issuePt.id,
  departmentId: issueDept ? Number(issueDept) : undefined,
  priority: issuePriority,
  counterNo: issueCounter || undefined,
  tokenNumber: issueCustomSerial ? Number(issueCustomSerial) : undefined,
});

// In JSX (under priority select)
<div>
  <label className="text-sm">Custom serial # (optional)</label>
  <input
    type="number"
    min={1}
    max={99999}
    className="input w-full"
    value={issueCustomSerial}
    onChange={e => setIssueCustomSerial(e.target.value.replace(/[^0-9]/g, ''))}
    placeholder="Auto"
  />
</div>
```

Toast handling: 409 errors already surface via the mutation's `onError`; ensure the message shows the duplicate.

### i18n keys (en + bn)

- `customSerial`: "Custom Serial" / "কাস্টম সিরিয়াল"
- `customSerialPlaceholder`: "Auto" / "স্বয়ংক্রিয়"

---

## Error Handling

| HTTP | Trigger | Message |
|---|---|---|
| 400 | `tokenNumber` is 0, negative, > 99999, or non-integer | zod validation message |
| 409 | Same `tokenNumber` already issued for the same `departmentId` + `queue_date` | "Serial X already issued today (token TXXX)" |
| 409 (race) | Unique index violation on concurrent insert | "Serial X already issued today" |

## Testing

### Unit
- `issueTokenSchema` rejects: `-1`, `0`, `1.5`, `100000`, `"abc"`, `null`
- `issueTokenSchema` accepts: `undefined`, `1`, `99999`

### Integration (`test/queue-token-flexible.test.ts`)
- POST `/api/queue/token` with `tokenNumber: 50` → 201, returns `T050`
- POST same again with `tokenNumber: 50` → 409
- POST with `tokenNumber: 49` (free) → 201, returns `T049`
- After custom 50, auto next → `T051` (counter bumped)
- Cross-department: same `tokenNumber: 50` to different `departmentId` → 201
- NULL `departmentId` (campus-wide) + same number twice → 409

### Frontend
- Input renders
- Typing non-digit is stripped
- Empty submit behaves as before (auto)
- 409 surfaces as toast with the duplicate number

---

## Out of Scope (YAGNI)

- No "reorder" / drag-drop of existing tokens
- No bulk renumber
- No admin UI to view the `manual_serial_set_by` audit (data is queryable)
- No "skip" / "reserve" ranges (already exists via `queue_token_reservations` migration 0290)
- No email/SMS notification when manual serial used
- No "reason" field — counter bump + user_id is enough forensic info

---

## Files Touched

- `migrations/0297_flexible_token_serial.sql` (new)
- `src/routes/tenant/queue.ts` (edit: schema, helper, route)
- `web/src/pages/QueueManagement.tsx` (edit: state, JSX, mutation call)
- `web/src/i18n/en.json` and `bn.json` (add 2 keys each)
- `test/queue-token-flexible.test.ts` (new)
- `test/queue-token-flexible.test.tsx` (frontend, if separate)

## Deploy Order

1. Apply migration to production D1 BEFORE deploy:
   ```bash
   wrangler d1 migrations apply hms-saas-production --env production
   ```
2. `pnpm build && wrangler deploy --env production`
3. For local server: `HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh`
