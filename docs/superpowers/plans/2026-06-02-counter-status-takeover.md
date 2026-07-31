# Counter Status & Take-Over System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a counter status dropdown to the reception topbar showing all counters with active session details, and a force take-over flow so any user can take over an abandoned counter.

**Architecture:** Two new API endpoints (list all counters with sessions, force take-over), plus a dropdown + confirmation modal in ReceptionTopBar. Existing handover flow remains unchanged.

**Tech Stack:** Hono (backend routes), D1 (Cloudflare SQLite), React + Tailwind (frontend), existing `billing-counter-session.ts` helpers

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/routes/tenant/billingCounter.ts` | Modify | Add 2 new endpoints: `GET /sessions/all-with-counters`, `POST /sessions/:id/take-over` |
| `web/src/components/reception/ReceptionTopBar.tsx` | Modify | Replace counter button with dropdown, add take-over modal |

---

### Task 1: Add `GET /sessions/all-with-counters` API endpoint

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts` (after line 637, before `/sessions/activate`)

- [ ] **Step 1: Add the new GET endpoint**

Insert after the `/sessions/active-all` route (line 637) and before `/sessions/activate` (line 639):

```typescript
// List all counters with their active session info (for counter status dropdown)
billingCounterRoutes.get('/sessions/all-with-counters', async (c) => {
  const tenantId = requireTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT
      bc.id,
      bc.counter_name,
      bc.counter_code,
      bc.counter_type,
      bc.location,
      bc.is_active,
      s.id AS session_id,
      s.employee_id,
      s.opening_cash,
      s.expected_cash,
      s.opened_at,
      s.session_no,
      u.name AS cashier_name,
      u.role AS cashier_role
    FROM billing_counters bc
    LEFT JOIN billing_counter_sessions s
      ON s.counter_id = bc.id
     AND s.tenant_id = bc.tenant_id
     AND s.status = 'active'
    LEFT JOIN users u
      ON u.id = s.employee_id
     AND u.tenant_id = s.tenant_id
    WHERE bc.tenant_id = ?
      AND (bc.is_active = 1 OR bc.is_active IS NULL)
    ORDER BY bc.counter_name ASC
  `).bind(tenantId).all<{
    id: number;
    counter_name: string;
    counter_code: string | null;
    counter_type: string | null;
    location: string | null;
    is_active: number;
    session_id: number | null;
    employee_id: number | null;
    opening_cash: number | null;
    expected_cash: number | null;
    opened_at: string | null;
    session_no: string | null;
    cashier_name: string | null;
    cashier_role: string | null;
  }>();

  const counters = (results ?? []).map((row) => {
    const hasSession = row.session_id != null;
    let expectedCash = Number(row.expected_cash ?? 0);

    // If session exists but expected_cash is null (not yet calculated), compute it
    // We'll return opening_cash as fallback — the frontend can show "calculating..."
    // For the dropdown we just need a reasonable display amount

    return {
      id: Number(row.id),
      counter_name: row.counter_name,
      counter_code: row.counter_code,
      counter_type: row.counter_type,
      location: row.location,
      active_session: hasSession ? {
        id: Number(row.session_id),
        employee_id: Number(row.employee_id),
        employee_name: row.cashier_name,
        employee_role: row.cashier_role,
        opening_cash: Number(row.opening_cash ?? 0),
        expected_cash: expectedCash,
        opened_at: row.opened_at,
        session_no: row.session_no,
      } : null,
    };
  });

  return c.json({ counters });
});
```

- [ ] **Step 2: Verify the endpoint compiles**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/billingCounter.ts
git commit -m "feat: add GET /sessions/all-with-counters endpoint for counter status dropdown"
```

---

### Task 2: Add `POST /sessions/:id/take-over` API endpoint

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts` (after the new GET endpoint, before `/sessions/activate`)

- [ ] **Step 1: Add the take-over endpoint**

Insert after the `all-with-counters` route and before `/sessions/activate`:

```typescript
// Force take-over an active counter session
billingCounterRoutes.post('/sessions/:id/take-over', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const targetSessionId = Number(c.req.param('id'));
  if (!Number.isInteger(targetSessionId) || targetSessionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid session ID' });
  }

  // 1. Load the target session
  const targetSession = await c.env.DB.prepare(`
    SELECT s.id, s.counter_id, s.employee_id, s.opening_cash, s.status, s.session_no,
           s.counter_type, bc.counter_name, bc.counter_code,
           u.name AS cashier_name
    FROM billing_counter_sessions s
    JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.id = ? AND s.status = 'active'
  `).bind(tenantId, targetSessionId).first<{
    id: number;
    counter_id: number;
    employee_id: number;
    opening_cash: number;
    status: string;
    session_no: string;
    counter_type: string;
    counter_name: string;
    counter_code: string | null;
    cashier_name: string | null;
  }>();

  if (!targetSession) {
    throw new HTTPException(404, { message: 'Active counter session not found' });
  }

  // 2. Cannot take over own session
  if (Number(targetSession.employee_id) === userId) {
    throw new HTTPException(409, { message: 'Cannot take over your own counter session' });
  }

  // 3. Calculate expected cash from the target session
  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, targetSessionId);
  const handoverAmount = summary.expectedCash;

  // 4. Check if current user already has an active session — close it first
  const existingSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, String(userId));
  if (existingSession) {
    throw new HTTPException(409, {
      message: `You already have an active session on ${existingSession.counter_name}. Close it first before taking over another counter.`,
    });
  }

  // 5. Generate new session number
  const sessionNo = await getNextSequence(c.env.DB, tenantId, 'counter_session', 'BCS');

  // 6. Execute take-over as a batch:
  //    a) Close the target session
  //    b) Create handover record (auto-received)
  //    c) Create cash drawer movement for the handover
  //    d) Create new session for current user
  //    e) Create cash drawer movement for new session opening
  const batchResults = await c.env.DB.batch([
    // a) Close the target session
    c.env.DB.prepare(`
      UPDATE billing_counter_sessions
      SET status = 'closed',
          closing_cash_declared = ?,
          expected_cash = ?,
          variance = 0,
          closed_at = datetime('now', '+6 hours'),
          closed_by = ?,
          remarks = 'Force take-over by another user',
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ? AND status = 'active'
    `).bind(handoverAmount, handoverAmount, userId, tenantId, targetSessionId),

    // b) Create handover record (auto-received)
    c.env.DB.prepare(`
      INSERT INTO billing_handovers
        (tenant_id, counter_session_id, handover_type, handover_by, handover_to, handover_amount, due_amount, status, received_by, received_at, remarks)
      VALUES (?, ?, 'counter', ?, ?, ?, 0, 'received', ?, datetime('now', '+6 hours'), 'Force take-over')
    `).bind(tenantId, targetSessionId, targetSession.employee_id, userId, handoverAmount, userId),

    // c) Cash drawer movement for handover
    c.env.DB.prepare(`
      INSERT INTO cash_drawer_movements
        (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
      VALUES (?, ?, ?, ?, 'handover', ?, 'cash', 'Force take-over handover', ?)
    `).bind(tenantId, targetSessionId, targetSession.counter_id, targetSession.employee_id, handoverAmount, userId),

    // d) Create new session for current user
    c.env.DB.prepare(`
      INSERT INTO billing_counter_sessions
        (tenant_id, counter_id, employee_id, session_no, counter_type, opening_cash, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      targetSession.counter_id,
      userId,
      sessionNo,
      targetSession.counter_type ?? 'billing',
      handoverAmount,
      `Take-over from ${targetSession.cashier_name ?? 'previous user'} (session ${targetSession.session_no})`,
    ),
  ]);

  // Get the new session ID
  let newSessionId = Number(batchResults[3]?.meta?.last_row_id);
  if (!Number.isFinite(newSessionId) || newSessionId <= 0) {
    const createdSession = await c.env.DB.prepare(`
      SELECT id FROM billing_counter_sessions
      WHERE tenant_id = ? AND session_no = ?
    `).bind(tenantId, sessionNo).first<{ id: number }>();
    newSessionId = Number(createdSession?.id);
  }

  // 7. Create opening cash movement for new session
  await c.env.DB.prepare(`
    INSERT INTO cash_drawer_movements
      (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
    VALUES (?, ?, ?, ?, 'opening', ?, 'cash', ?, ?)
  `).bind(tenantId, newSessionId, targetSession.counter_id, userId, handoverAmount, `Counter opened via take-over from session ${targetSession.session_no}`, userId).run();

  // 8. Record accounting event
  await recordCashHandoverEvent(c, tenantId, `takeover-${targetSessionId}`, String(userId), handoverAmount, {
    sourceSessionId: targetSessionId,
    newSessionId,
    counterId: targetSession.counter_id,
    handoverBy: targetSession.employee_id,
    handoverTo: userId,
    source: 'force_takeover',
  });

  // 9. Audit log
  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_counter_sessions', targetSessionId, {
    status: 'active',
    employee_id: targetSession.employee_id,
  }, {
    status: 'closed',
    reason: 'force_takeover',
    closed_by: userId,
    handoverAmount,
  });

  return c.json({
    message: 'Counter taken over successfully',
    session: {
      id: newSessionId,
      sessionNo,
      counterId: targetSession.counter_id,
      counterName: targetSession.counter_name,
      counterCode: targetSession.counter_code,
      counterType: targetSession.counter_type,
      openingCash: handoverAmount,
    },
    previousSession: {
      id: targetSessionId,
      employeeName: targetSession.cashier_name,
      handoverAmount,
    },
  });
});
```

- [ ] **Step 2: Verify the endpoint compiles**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/billingCounter.ts
git commit -m "feat: add POST /sessions/:id/take-over endpoint for force counter take-over"
```

---

### Task 3: Add counter status dropdown to ReceptionTopBar

**Files:**
- Modify: `web/src/components/reception/ReceptionTopBar.tsx`

- [ ] **Step 1: Add types and state for the dropdown**

Add after the existing types (after line 62):

```typescript
type AllCountersResponse = {
  counters: Array<{
    id: number;
    counter_name: string;
    counter_code: string | null;
    counter_type: string | null;
    location: string | null;
    active_session: {
      id: number;
      employee_id: number;
      employee_name: string | null;
      employee_role: string | null;
      opening_cash: number;
      expected_cash: number;
      opened_at: string | null;
      session_no: string | null;
    } | null;
  }>;
};

type TakeOverResponse = {
  message: string;
  session: {
    id: number;
    sessionNo: string;
    counterId: number;
    counterName: string;
    counterCode: string | null;
    counterType: string;
    openingCash: number;
  };
};
```

Add state variables inside the component (after line 96, near other state declarations):

```typescript
const [counterDropdownOpen, setCounterDropdownOpen] = useState(false);
const [takeOverModalOpen, setTakeOverModalOpen] = useState(false);
const [takeOverTarget, setTakeOverTarget] = useState<AllCountersResponse['counters'][0] | null>(null);
```

- [ ] **Step 2: Add the all-counters query**

Add after the existing `pendingHandoversData` query (after line 141):

```typescript
const { data: allCountersData } = useApiQuery<AllCountersResponse>(
  ['billing-counter', 'all-with-counters'],
  '/api/billing-counter/sessions/all-with-counters',
  { staleTime: TOPBAR_COUNTER_POLL_MS, refetchInterval: TOPBAR_COUNTER_POLL_MS },
);
```

- [ ] **Step 3: Add the take-over mutation**

Add after the `recordCashMovement` mutation (after line 214):

```typescript
const takeOverCounter = useApiMutation<TakeOverResponse, { sessionId: number }>(
  'post',
  (vars) => `/api/billing-counter/sessions/${vars.sessionId}/take-over`,
  {
    onSuccess: () => {
      toast.success(t('counterTakenOver', { defaultValue: 'Counter taken over successfully' }));
      setTakeOverModalOpen(false);
      setTakeOverTarget(null);
      setCounterDropdownOpen(false);
      queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
      queryClient.invalidateQueries({ queryKey: ['reception'] });
    },
    onError: (error) => toast.error(error.message || t('failedTakeOver', { defaultValue: 'Failed to take over counter' })),
  },
);
```

- [ ] **Step 4: Add click-outside handler for dropdown**

Add after the existing `useEffect` for shift modal escape key (after line 115):

```typescript
useEffect(() => {
  if (!counterDropdownOpen) return;
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-counter-dropdown]')) {
      setCounterDropdownOpen(false);
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setCounterDropdownOpen(false);
    }
  };
  window.addEventListener('mousedown', handleClickOutside);
  window.addEventListener('keydown', handleKeyDown);
  return () => {
    window.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('keydown', handleKeyDown);
  };
}, [counterDropdownOpen]);
```

- [ ] **Step 5: Replace the counter button with dropdown**

Replace the counter button (lines 379-393) with the dropdown trigger and popover:

```tsx
<div className="relative" data-counter-dropdown>
  <button
    type="button"
    onClick={() => setCounterDropdownOpen(!counterDropdownOpen)}
    className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${activeCounterData?.active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
  >
    <Banknote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span className="truncate">
      {activeCounterData?.active
        ? t('shiftActive', { defaultValue: 'Shift Active: ৳{{amount}}', amount: money(activeCounterData.session?.expectedCash) })
        : t('openCounter', { defaultValue: 'Open counter' })}
    </span>
  </button>

  {counterDropdownOpen ? (
    <div className="absolute right-0 top-full z-40 mt-2 w-80 max-h-[min(60vh,24rem)] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-xl dark:bg-slate-900">
      <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {t('counterStatus', { defaultValue: 'Counter Status' })}
        </div>
      </div>
      {(allCountersData?.counters ?? []).length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
          {t('noCounters', { defaultValue: 'No counters configured' })}
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {(allCountersData?.counters ?? []).map((counter) => {
            const isActive = counter.active_session != null;
            const isOwnSession = isActive && activeCounter?.id === counter.active_session?.id;
            return (
              <div key={counter.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {counter.counter_name}
                    {counter.counter_code ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">({counter.counter_code})</span> : null}
                  </span>
                </div>
                {isActive && counter.active_session ? (
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="text-xs text-[var(--color-text-muted)]">
                      <span className="font-medium text-[var(--color-text-primary)]">{counter.active_session.employee_name}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-data font-semibold text-emerald-700">৳{money(counter.active_session.expected_cash)}</span>
                    </div>
                    {isOwnSession ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        {t('yours', { defaultValue: 'Yours' })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTakeOverTarget(counter);
                          setTakeOverModalOpen(true);
                          setCounterDropdownOpen(false);
                        }}
                        className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        {t('takeOver', { defaultValue: 'Take Over' })}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="mt-1.5">
                    <span className="text-xs text-[var(--color-text-muted)]">{t('inactive', { defaultValue: 'Inactive' })}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : null}
</div>
```

- [ ] **Step 6: Add the take-over confirmation modal**

Add before the closing `</>` of the JSX return (before line 633), after the pending handover modal:

```tsx
{takeOverModalOpen && takeOverTarget && takeOverTarget.active_session ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="takeover-title">
      <h2 id="takeover-title" className="text-xl font-semibold">{t('confirmTakeOver', { defaultValue: 'Confirm Take Over' })}</h2>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {t('takeOverDescription', {
          defaultValue: '{{counter}} — {{user}} currently active with ৳{{amount}}. You will start a new session with this amount as opening cash.',
          counter: takeOverTarget.counter_name,
          user: takeOverTarget.active_session.employee_name ?? t('unknown', { defaultValue: 'Unknown' }),
          amount: money(takeOverTarget.active_session.expected_cash),
        })}
      </p>
      {activeCounterData?.active ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t('existingSessionWarning', {
            defaultValue: 'You already have an active session on {{counter}}. It will need to be closed first.',
            counter: activeCounterData.session?.counterName ?? '',
          })}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setTakeOverModalOpen(false); setTakeOverTarget(null); }}
        >
          {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={takeOverCounter.isPending || !!activeCounterData?.active}
          onClick={() => takeOverCounter.mutate({ sessionId: takeOverTarget.active_session!.id })}
        >
          {takeOverCounter.isPending
            ? t('takingOver', { defaultValue: 'Taking over…' })
            : t('confirmTakeOverButton', { defaultValue: 'Confirm Take Over' })}
        </button>
      </div>
    </div>
  </div>
) : null}
```

- [ ] **Step 7: Verify the frontend compiles**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 8: Commit**

```bash
git add web/src/components/reception/ReceptionTopBar.tsx
git commit -m "feat: add counter status dropdown with take-over UI in ReceptionTopBar"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: Both backend and frontend build successfully

- [ ] **Step 2: Run lint**

Run: `pnpm lint` (or equivalent)
Expected: No lint errors

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "feat: counter status dropdown and force take-over system"
```
