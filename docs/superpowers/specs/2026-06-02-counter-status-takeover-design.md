# Counter Status & Take-Over System — Design

**Date:** 2026-06-02  
**Status:** Approved  
**Scope:** ReceptionTopBar counter dropdown, force take-over flow, all-counter visibility

---

## Problem

Currently the counter button near the reception searchbar shows only the current user's active session ("Shift Active: ৳X") or "Open counter". There is no way to:

1. See which counters are active and who is working at each
2. See how much cash is at each counter
3. Take over a counter when the previous cashier left without handing over

## Solution

### 1. Counter Status Dropdown (ReceptionTopBar)

Replace the single counter button with a **dropdown/popover** that shows all counters:

```
┌─────────────────────────────────────────────┐
│  Counter Status                        [X]  │
├─────────────────────────────────────────────┤
│  🟢 Counter 1 (BILL-1)                      │
│     Active: Rahman │ ৳15,400                │
│     [Take Over]                             │
├─────────────────────────────────────────────┤
│  🟢 Counter 2 (BILL-2)                      │
│     Active: Karim  │ ৳8,200                 │
│     [Take Over]                             │
├─────────────────────────────────────────────┤
│  ⚪ Counter 3 (BILL-3)                      │
│     Inactive                                │
│     [Open Counter]                          │
└─────────────────────────────────────────────┘
```

- Green badge = active session, Grey badge = inactive
- Active counters show: employee name, expected cash amount
- "Take Over" button on active counters
- "Open Counter" button on inactive counters (existing flow)
- Dropdown closes when clicking outside or pressing Escape

### 2. Force Take-Over Flow

When a user clicks "Take Over" on an active counter:

1. **Confirmation modal** appears:
   - "Counter 1 er kache ৳15,400 ache. Rahman currently active. Apni ei counter niye kaj shuru korben?"
   - Shows counter name, current active user, cash amount
   - "Confirm Take Over" and "Cancel" buttons

2. **Backend auto-flow** (single API call):
   - Validates target session is active and belongs to a different user
   - Calculates expected cash from target session
   - Closes target session (status = 'closed')
   - Creates `billing_handovers` record:
     - `handover_by` = current session employee
     - `handover_to` = taking-over user
     - `handover_amount` = expected cash
     - `status` = 'received' (auto-accepted)
     - `counter_session_id` = closed session id
   - Creates `cash_drawer_movements` record (type: 'handover')
   - Creates new session for taking-over user:
     - `opening_cash` = handover amount (expected cash from previous session)
     - Links to same counter
   - Queues accounting event (cash_handover)

3. **Result**: User immediately has an active session on that counter. No logout/login needed.

### 3. Edge Cases

- **User already has an active session**: Show warning in confirmation modal — "Apnar already Counter 2 e active session ache. Take-over korle oi session auto-close hobe." Allow proceeding if user confirms.
- **User tries to take over own counter**: Button disabled, tooltip shows "Already active"
- **Cash mismatch**: Handover record preserves variance. Admin can verify later via existing handover verification flow.
- **Concurrent take-over**: Optimistic locking — if another user took over between dropdown load and button click, show error and refresh.

### 4. Existing Flow Preserved

- Existing "Shift Handover" modal (close counter → select person → logout) remains unchanged
- New take-over system is an **add-on** — both flows coexist
- Users can still use the traditional handover flow if they prefer

---

## API Changes

### New Endpoint: `GET /api/billing-counter/sessions/all-with-counters`

Returns all billing counters with their active session info:

```json
{
  "counters": [
    {
      "id": 1,
      "counter_name": "Main Billing Counter",
      "counter_code": "BILL-1",
      "counter_type": "billing",
      "is_active": true,
      "active_session": {
        "id": 42,
        "employee_id": 5,
        "employee_name": "Rahman",
        "expected_cash": 15400,
        "opened_at": "2026-06-02T09:00:00Z"
      }
    },
    {
      "id": 2,
      "counter_name": "Counter 2",
      "counter_code": "BILL-2",
      "counter_type": "billing",
      "is_active": true,
      "active_session": null
    }
  ]
}
```

### New Endpoint: `POST /api/billing-counter/sessions/:id/take-over`

Request body:
```json
{
  "opening_cash": 15400
}
```

Response: new session object

**Logic:**
1. Validate session `:id` is active
2. Validate session belongs to different employee
3. Calculate expected cash
4. Close old session (update status, closed_at, closed_by)
5. Create handover record (auto-received)
6. Create cash drawer movement
7. Create new session for current user
8. Queue accounting event
9. Return new session

---

## Frontend Changes

### ReceptionTopBar.tsx

1. Add state: `counterDropdownOpen`, `takeOverModalOpen`, `takeOverTarget`
2. Add query: `GET /api/billing-counter/sessions/all-with-counters` (fetches all counters)
3. Replace counter button with dropdown trigger
4. Dropdown component:
   - Lists all counters from query
   - Active counters: green badge, employee name, cash amount, "Take Over" button
   - Inactive counters: grey badge, "Open Counter" button
   - Click outside closes dropdown
5. Take-over confirmation modal:
   - Shows counter details, current user, cash amount
   - "Confirm Take Over" button triggers `POST /sessions/:id/take-over`
   - On success: invalidate queries, close modal, show toast

### No changes to BillingCounterPage.tsx or BillingHandoverPage.tsx

Existing pages remain unchanged.

---

## Database

No schema changes required. Uses existing tables:
- `billing_counters`
- `billing_counter_sessions`
- `billing_handovers`
- `cash_drawer_movements`

---

## Security

- Take-over requires authentication (existing middleware)
- Any user with counter access can take over any counter (by design — emergency scenario)
- All take-overs are logged in `billing_handovers` with `handover_by` and `handover_to`
- Accounting events are queued for audit trail
