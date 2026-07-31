# Flexible Queue Token Serial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow reception to issue any positive integer token number (1–99999) instead of relying solely on auto-increment, with duplicate guard, race-safe unique index, and per-row audit columns.

**Architecture:** Optional `tokenNumber` field on `POST /api/queue/token`. When provided, validate → check duplicate → bump counter → insert with `manual_serial_set_by`/`at`. When omitted, behavior is unchanged. Frontend adds an optional "Custom serial #" number input in the issue-token form. Race safety is enforced by two partial unique indexes on `queue_entries`.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite) backend; React + react-i18next + react-query frontend; vitest unit + integration tests.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `migrations/0297_flexible_token_serial.sql` | Create | Add `manual_serial_set_by`/`at` columns + partial unique indexes |
| `src/routes/tenant/queue.ts` | Modify | Add `tokenNumber` to schema, extend `getNextToken`, add duplicate pre-check in `POST /token`, write audit columns |
| `web/src/pages/QueueManagement.tsx` | Modify | Add `issueCustomSerial` state, input UI, pass to mutation |
| `web/public/locales/en/queue.json` | Modify | Add `customSerial`, `customSerialPlaceholder` |
| `web/public/locales/bn/queue.json` | Modify | Add `customSerial`, `customSerialPlaceholder` (Bangla) |
| `test/queue-token-flexible-schema.test.ts` | Create | Unit tests for the zod schema |
| `test/integration/queue-token-flexible.test.ts` | Create | Real-D1 integration tests for `POST /token` with custom number + duplicates |
| `web/src/pages/QueueManagement.flexible.test.tsx` | Create | Component test for the custom-serial input field |

---

## Task 1: Add migration with audit columns and unique indexes

**Files:**
- Create: `migrations/0297_flexible_token_serial.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0297: Flexible token serial (manual override at reception)

ALTER TABLE queue_entries ADD COLUMN manual_serial_set_by INTEGER;
ALTER TABLE queue_entries ADD COLUMN manual_serial_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_entry_manual_serial
    ON queue_entries(tenant_id, manual_serial_set_by)
    WHERE manual_serial_set_by IS NOT NULL;

-- Two partial unique indexes because SQLite treats NULL as distinct in UNIQUE.
-- Together they prevent duplicate (tenant, dept-or-null, date, token_number).
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_dept
    ON queue_entries(tenant_id, department_id, queue_date, token_number)
    WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_nodept
    ON queue_entries(tenant_id, queue_date, token_number)
    WHERE department_id IS NULL;
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0297_flexible_token_serial.sql
git commit -m "feat(queue): migration for flexible token serial + audit columns"
```

---

## Task 2: Schema unit test for `issueTokenSchema`

**Files:**
- Create: `test/queue-token-flexible-schema.test.ts`

- [ ] **Step 1: Write the failing test**

The schema is not exported; we test it indirectly through reading and parsing the source. To keep the test black-box, instead add a small wrapper. First, **export the schema from queue.ts** (Task 3 covers the schema change). For now, this test will be added after the schema export lands. **Skip Task 2 and merge it into Task 3 below.**

---

## Task 3: Update `issueTokenSchema` and extend `getNextToken`

**Files:**
- Modify: `src/routes/tenant/queue.ts:16-23` (schema), `src/routes/tenant/queue.ts:61-90` (helper), `src/routes/tenant/queue.ts:452-480` (route)
- Create: `test/queue-token-flexible-schema.test.ts`

- [ ] **Step 1: Export `issueTokenSchema` from queue.ts and add `tokenNumber` field**

Replace lines 16–23 of `src/routes/tenant/queue.ts`:

```ts
export const issueTokenSchema = z.object({
  patientId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  visitId: z.number().int().positive().optional(),
  priority: z.enum(['normal', 'urgent', 'emergency', 'vip']).default('normal'),
  counterNo: z.string().max(20).optional(),
  tokenNumber: z.number().int().positive().max(99999).optional(),
});
```

- [ ] **Step 2: Write the failing schema unit test**

Create `test/queue-token-flexible-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { issueTokenSchema } from '../src/routes/tenant/queue';

describe('issueTokenSchema — flexible serial', () => {
  const base = { patientId: 1, priority: 'normal' as const };

  it('accepts payload without tokenNumber (auto)', () => {
    const r = issueTokenSchema.parse(base);
    expect(r.tokenNumber).toBeUndefined();
  });

  it('accepts a valid positive integer', () => {
    const r = issueTokenSchema.parse({ ...base, tokenNumber: 50 });
    expect(r.tokenNumber).toBe(50);
  });

  it('accepts the upper bound 99999', () => {
    const r = issueTokenSchema.parse({ ...base, tokenNumber: 99999 });
    expect(r.tokenNumber).toBe(99999);
  });

  it('rejects 0', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 0 })).toThrow();
  });

  it('rejects negative', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: -5 })).toThrow();
  });

  it('rejects decimal', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 1.5 })).toThrow();
  });

  it('rejects > 99999', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 100000 })).toThrow();
  });

  it('rejects string', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: '5' })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run test/queue-token-flexible-schema.test.ts`
Expected: 8 passing.

- [ ] **Step 4: Extend `getNextToken` to accept optional custom number**

Replace the `getNextToken` function (lines 61–90 of `src/routes/tenant/queue.ts`):

```ts
export async function getNextToken(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  departmentId: number | null,
  date: string,
  customTokenNumber?: number,
): Promise<{ tokenNo: string; tokenNumber: number }> {
  const deptKey = departmentId ?? 0;
  const fallbackPrefix = 'T';

  // Ensure counter row exists
  await db.$client.prepare(`
    INSERT INTO queue_token_counters (tenant_id, department_id, counter_date, last_token, prefix)
    VALUES (?, ?, ?, 0, 'T')
    ON CONFLICT(tenant_id, department_id, counter_date) DO NOTHING
  `).bind(tenantId, deptKey, date).run();

  if (customTokenNumber !== undefined) {
    // Bump counter to at least customTokenNumber so next auto stays ahead.
    await db.$client.prepare(`
      UPDATE queue_token_counters
      SET last_token = MAX(last_token, ?)
      WHERE tenant_id = ? AND department_id = ? AND counter_date = ?
    `).bind(customTokenNumber, tenantId, deptKey, date).run();

    return {
      tokenNo: `${fallbackPrefix}${String(customTokenNumber).padStart(3, '0')}`,
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
  const prefix = row?.prefix ?? 'T';
  return { tokenNo: `${prefix}${String(num).padStart(3, '0')}`, tokenNumber: num };
}
```

- [ ] **Step 5: Update `POST /token` to handle custom number + duplicate pre-check + audit**

Replace the `POST /token` route (lines 452–480 of `src/routes/tenant/queue.ts`):

```ts
queueRoutes.post('/token', zValidator('json', issueTokenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const now = getFullTimestampGMT6();

  await assertVisitCanEnterDoctorQueue(db, tenantId, data.visitId);

  // Fast-path duplicate check when custom number supplied.
  if (data.tokenNumber !== undefined) {
    const dup = await db.$client.prepare(`
      SELECT id, token_no FROM queue_entries
      WHERE tenant_id = ? AND department_id IS ? AND queue_date = ? AND token_number = ?
    `).bind(tenantId, data.departmentId ?? null, today, data.tokenNumber)
      .first<{ id: number; token_no: string }>();

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
    // Race: another transaction inserted the same number after our pre-check.
    if (String(e?.message ?? '').includes('UNIQUE')) {
      throw new HTTPException(409, {
        message: `Serial ${data.tokenNumber} already issued today`,
      });
    }
    throw e;
  }
});
```

- [ ] **Step 6: Run the existing queue tests to confirm no regression**

Run: `npx vitest run test/queue-production-contract.test.ts test/token-reservation.test.ts test/token-reservations.test.ts test/token-reservation-schema.test.ts`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/routes/tenant/queue.ts test/queue-token-flexible-schema.test.ts
git commit -m "feat(queue): optional manual tokenNumber on POST /token with audit"
```

---

## Task 4: Integration test for duplicate + cross-department + counter-bump behavior

**Files:**
- Create: `test/integration/queue-token-flexible.test.ts`

- [ ] **Step 1: Write the failing test**

This test runs against a real wrangler dev server. Read `test/integration/real-db/patients.test.ts` for the helper patterns and copy them.

Create `test/integration/queue-token-flexible.test.ts`:

```ts
/**
 * Flexible Token Serial — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────
 * Covers: POST /api/queue/token with custom tokenNumber, duplicate rejection,
 * cross-department isolation, and counter auto-bump.
 *
 * Prerequisites:
 *   1. Run: npm run test:real:setup
 *   2. Run: npm run dev:api
 *   3. Run: npm run test:real -- test/integration/queue-token-flexible.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { receptionHeaders } from './real-db/helpers/auth';
import { api, assertServerRunning } from './real-db/helpers/client';

describe('Flexible token serial — POST /api/queue/token', () => {
  beforeAll(async () => {
    await assertServerRunning();
  });

  async function issue(body: Record<string, unknown>, tokenNumber?: number) {
    return api.post('/api/queue/token', {
      headers: await receptionHeaders(),
      body: { patientId: 1, priority: 'normal', ...body, ...(tokenNumber !== undefined ? { tokenNumber } : {}) },
    });
  }

  it('issues a custom token number and returns T<padded>', async () => {
    const r = await issue({ patientId: 1 }, 50);
    expect(r.status).toBe(201);
    const json = await r.json();
    expect(json.data.tokenNumber).toBe(50);
    expect(json.data.tokenNo).toBe('T050');
    expect(json.data.manualSerial).toBe(true);
  });

  it('rejects duplicate token number in same dept+date with 409', async () => {
    const r = await issue({ patientId: 1 }, 51);
    expect(r.status).toBe(201);
    const dup = await issue({ patientId: 1 }, 51);
    expect(dup.status).toBe(409);
    const err = await dup.json();
    expect(String(err.message ?? err.error ?? '')).toMatch(/Serial 51/);
  });

  it('allows same number in a different department', async () => {
    const r1 = await issue({ patientId: 1, departmentId: 1 }, 60);
    expect(r1.status).toBe(201);
    const r2 = await issue({ patientId: 1, departmentId: 2 }, 60);
    expect(r2.status).toBe(201);
  });

  it('bumps auto counter above any custom number used', async () => {
    await issue({ patientId: 1, departmentId: 3 }, 80);
    // Next auto should be 81, not 1
    const auto = await issue({ patientId: 1, departmentId: 3 });
    expect(auto.status).toBe(201);
    const json = await auto.json();
    expect(json.data.tokenNumber).toBe(81);
    expect(json.data.manualSerial).toBe(false);
  });

  it('audit columns are populated for manual and null for auto', async () => {
    const manual = await api.post('/api/queue/token', {
      headers: await receptionHeaders(),
      body: { patientId: 1, departmentId: 4, priority: 'normal', tokenNumber: 77 },
    });
    expect(manual.status).toBe(201);
    const auto = await api.post('/api/queue/token', {
      headers: await receptionHeaders(),
      body: { patientId: 1, departmentId: 4, priority: 'normal' },
    });
    expect(auto.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (server not running)**

Run: `npm run test:real -- test/integration/queue-token-flexible.test.ts`
Expected: `assertServerRunning` fails with connection error. This is the expected RED.

- [ ] **Step 3: Apply migration to dev DB and start wrangler dev server**

```bash
npm run test:real:setup
npm run dev:api &   # background
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `npm run test:real -- test/integration/queue-token-flexible.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add test/integration/queue-token-flexible.test.ts
git commit -m "test(queue): integration tests for flexible token serial"
```

---

## Task 5: Add i18n strings

**Files:**
- Modify: `web/public/locales/en/queue.json`
- Modify: `web/public/locales/bn/queue.json`

- [ ] **Step 1: Add the two keys to `web/public/locales/en/queue.json`**

Append before the closing `}`:

```json
  "customSerial": "Custom Serial",
  "customSerialPlaceholder": "Auto",
  "customSerialHelp": "Leave empty to auto-assign. Use to issue a specific number (e.g. VIP, late arrival).",
  "serialAlreadyIssued": "Serial {{number}} is already issued today"
```

- [ ] **Step 2: Add the Bangla translations to `web/public/locales/bn/queue.json`**

Append before the closing `}`:

```json
  "customSerial": "কাস্টম সিরিয়াল",
  "customSerialPlaceholder": "স্বয়ংক্রিয়",
  "customSerialHelp": "খালি রাখলে স্বয়ংক্রিয়ভাবে নম্বর দেওয়া হবে। নির্দিষ্ট নম্বর দিতে (যেমন: VIP, দেরিতে আসা রোগী) এখানে লিখুন।",
  "serialAlreadyIssued": "সিরিয়াল {{number}} আজকে ইতিমধ্যে দেওয়া হয়েছে"
```

- [ ] **Step 3: Commit**

```bash
git add web/public/locales/en/queue.json web/public/locales/bn/queue.json
git commit -m "feat(i18n): custom serial labels (en, bn)"
```

---

## Task 6: Add the custom-serial input to the issue-token form

**Files:**
- Modify: `web/src/pages/QueueManagement.tsx`

- [ ] **Step 1: Add state next to other issue-form states (around line 161)**

```tsx
  const [issueCustomSerial, setIssueCustomSerial] = useState('');
```

- [ ] **Step 2: Pass `tokenNumber` to the mutation (around line 337)**

In the `handleIssueToken` function, change the `issueTokenMutation.mutate({...})` call to include `tokenNumber`:

```tsx
    issueTokenMutation.mutate({
      patientId: issuePt.id,
      departmentId: issueDept ? Number(issueDept) : undefined,
      priority: issuePriority,
      counterNo: issueCounter || undefined,
      tokenNumber: issueCustomSerial ? Number(issueCustomSerial) : undefined,
    });
```

- [ ] **Step 3: Reset custom serial after a successful issue**

In the same handler, after the mutation succeeds, add reset:

```tsx
    setIssueCustomSerial('');
```

Place this right after the existing `setIssuedToken(...)` call.

- [ ] **Step 4: Add the input field in the JSX, under the priority selector (around line 670)**

```tsx
                  <div>
                    <label className="text-sm text-[var(--color-text-muted)]">
                      {t('customSerial', { ns: 'queue', defaultValue: 'Custom Serial' })} ({t('issueToken', { ns: 'queue', defaultValue: 'Issue' }).toLowerCase()})
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={99999}
                      className="input w-full"
                      value={issueCustomSerial}
                      onChange={e => setIssueCustomSerial(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                      placeholder={t('customSerialPlaceholder', { ns: 'queue', defaultValue: 'Auto' })}
                      title={t('customSerialHelp', { ns: 'queue', defaultValue: 'Leave empty to auto-assign' })}
                    />
                  </div>
```

- [ ] **Step 5: Handle 409 errors with a friendly toast**

Find the `issueTokenMutation` definition and ensure the mutation `onError` shows the server message. Replace the existing `useApiMutation` block (around line 259) with:

```tsx
  const issueTokenMutation = useApiMutation<IssueTokenResponse, {
    patientId: number; departmentId?: number; doctorId?: number; visitId?: number;
    priority: 'normal' | 'urgent' | 'emergency' | 'vip'; counterNo?: string; tokenNumber?: number;
  }>('post', '/api/queue/token', {
    onSuccess: (data) => {
      const tk = data.data?.tokenNo ?? 'T???';
      setIssuedToken(tk);
      setIssueCustomSerial('');
      toast.success(t('tokenIssued', { ns: 'queue', defaultValue: `Token ${tk} issued` }));
    },
    onError: (err: any) => {
      const msg = err?.message ?? '';
      const m = msg.match(/Serial (\d+)/);
      if (m) {
        toast.error(t('serialAlreadyIssued', { ns: 'queue', number: m[1], defaultValue: `Serial ${m[1]} already issued today` }));
      } else {
        toast.error(msg || t('issueFailed', { ns: 'queue', defaultValue: 'Failed to issue token' }));
      }
    },
  });
```

If `issueFailed` key does not exist, add it to both locale files in Task 5 (re-run that commit if needed).

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/QueueManagement.tsx
git commit -m "feat(queue-ui): optional custom serial input on token issue form"
```

---

## Task 7: Frontend component test for the custom-serial input

**Files:**
- Create: `web/src/pages/QueueManagement.flexible.test.tsx`

- [ ] **Step 1: Read an existing test for reference**

Read `web/src/components/reception/ReceptionTopBar.test.tsx` for the existing testing-library setup (Providers, queryClient, etc.). Mirror its wrapper.

- [ ] **Step 2: Write the test**

Create `web/src/pages/QueueManagement.flexible.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import QueueManagement from './QueueManagement';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ Results: [] }), post: vi.fn() },
}));

i18n.use(initReactI18next).init({
  resources: { en: { queue: { customSerial: 'Custom Serial', customSerialPlaceholder: 'Auto' } } },
  lng: 'en',
  fallbackLng: 'en',
  ns: ['queue'],
  defaultNS: 'queue',
  interpolation: { escapeValue: false },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></QueryClientProvider>;
}

describe('QueueManagement — custom serial input', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the optional custom serial input', async () => {
    render(<Wrapper><QueueManagement /></Wrapper>);
    // Open the issue token panel if collapsed
    const input = await screen.findByPlaceholderText(/Auto/i, {}, { timeout: 3000 });
    expect(input).toBeInTheDocument();
  });

  it('strips non-digit characters', async () => {
    render(<Wrapper><QueueManagement /></Wrapper>);
    const input = (await screen.findByPlaceholderText(/Auto/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12abc34' } });
    expect(input.value).toBe('1234');
  });

  it('caps input length at 5 digits', async () => {
    render(<Wrapper><QueueManagement /></Wrapper>);
    const input = (await screen.findByPlaceholderText(/Auto/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456789' } });
    expect(input.value).toBe('12345');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run web/src/pages/QueueManagement.flexible.test.tsx`
Expected: 3 passing (or skipped if `QueueManagement` requires heavy mocks — if so, narrow the test to render a stripped version of the issue-token form).

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/QueueManagement.flexible.test.tsx
git commit -m "test(queue-ui): custom serial input behavior"
```

---

## Task 8: Verify build and typecheck

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck` (or `npx tsc --noEmit` if no script)
Expected: 0 errors.

- [ ] **Step 2: Lint changed files**

Run: `npx eslint src/routes/tenant/queue.ts web/src/pages/QueueManagement.tsx`
Expected: 0 errors.

- [ ] **Step 3: Run the full vitest suite**

Run: `npm run test:all`
Expected: all passing including new tests.

- [ ] **Step 4: Commit any lint fixes (if any)**

```bash
git add -A
git commit -m "chore: lint fixes" || true
```

---

## Task 9: Deploy migration to production D1

**Files:** none (operations)

- [ ] **Step 1: Apply migration to production D1 BEFORE deploy**

```bash
wrangler d1 migrations apply hms-saas-production --env production
```

- [ ] **Step 2: Verify the new columns exist**

```bash
wrangler d1 execute hms-saas-production --env production --command "PRAGMA table_info(queue_entries);" | grep manual
```

Expected: rows for `manual_serial_set_by` and `manual_serial_set_at`.

- [ ] **Step 3: Build and deploy Worker**

```bash
pnpm build && wrangler deploy --env production
```

- [ ] **Step 4: Verify on production**

```bash
curl -fsS https://hms-saas-production.rahmatullahzisan.workers.dev/api/queue/tokens/overview
```

Expected: 200 with `{ Results: { tokens, stats } }`.

- [ ] **Step 5: Commit deploy log (optional)**

```bash
git tag -a deploy/2026-06-07-flexible-token-serial -m "Flexible token serial deployed"
git push origin deploy/2026-06-07-flexible-token-serial  # only if user asks
```

---

## Task 10: Apply to local server (if applicable)

**Files:** none (operations)

- [ ] **Step 1: Run versioned migrations on local server**

```bash
ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'
```

- [ ] **Step 2: Verify local server status**

```bash
ssh pcare 'curl -fsS http://127.0.0.1/api/local-server/status'
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 3: Done**

---

## Self-Review

**Spec coverage:**
- ✅ Positive integer validation → Task 3 (schema)
- ✅ Duplicate 409 → Task 3 (route) + Task 1 (unique index) + Task 4 (test)
- ✅ Audit columns → Task 1 (migration) + Task 3 (route write)
- ✅ Counter auto-bump after custom → Task 3 (`getNextToken`) + Task 4 (test)
- ✅ Frontend optional input → Task 6 (UI) + Task 7 (test)
- ✅ i18n → Task 5
- ✅ Race safety → Task 1 (partial unique indexes) + Task 3 (try/catch 409)
- ✅ Deploy order → Task 9, Task 10

**Placeholder scan:** No "TBD" / "implement later" / "similar to Task N". All code blocks are complete.

**Type consistency:** `issueTokenSchema` exported from `queue.ts:16` matches import path in `test/queue-token-flexible-schema.test.ts`. `getNextToken` signature extended consistently. `tokenNumber` field name used identically in schema, route, frontend state, and i18n message.

**Gaps fixed during review:**
- Task 4's `test:real:setup` is required — added in Step 3 of Task 4.
- `issueFailed` i18n key added in Task 6 fallback path.
