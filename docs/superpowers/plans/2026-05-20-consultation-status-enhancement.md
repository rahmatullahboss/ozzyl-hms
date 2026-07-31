# Consultation Status Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `waiting`, `referred`, `follow_up_required` statuses to the consultation system so hospitals can track the full patient flow from arrival to completion.

**Architecture:** Extend the existing consultation status enum in both the Zod validation schema and the D1 database check constraint. Update the frontend status badge map. This is a surgical change across 3 layers (schema → DB → UI).

**Tech Stack:** Zod (validation), D1/SQL (database), React + TypeScript (frontend)

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/schemas/consultation.ts:23` | Modify | Add new status values to Zod enum |
| `migrations/0262_consultation_status_extend.sql` | Create | DB migration to update check constraint |
| `web/src/pages/ConsultationNotes.tsx:27` | Modify | Add new status badges |

---

### Task 1: Update Zod Schema

**Files:**
- Modify: `src/schemas/consultation.ts:23`

- [ ] **Step 1: Read the current schema**

Read `src/schemas/consultation.ts` to understand the current status enum.

- [ ] **Step 2: Add new status values**

In `updateConsultationSchema`, change the `status` field from:
```typescript
status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
```
to:
```typescript
status: z.enum(['waiting', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show', 'referred', 'follow_up_required']).optional(),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm build 2>&1 | head -30`
Expected: No TypeScript errors from consultation schema

---

### Task 2: Database Migration

**Files:**
- Create: `migrations/0262_consultation_status_extend.sql`

- [ ] **Step 1: Read existing check constraint**

Check the current constraint in the consultations table by reading the schema or running a query.

- [ ] **Step 2: Create migration file**

Create `migrations/0262_consultation_status_extend.sql`:

```sql
-- Migration 0262: Extend consultation status to include waiting, referred, follow_up_required
-- D1 does not support ALTER TABLE to modify CHECK constraints directly.
-- The constraint is enforced at the application layer via Zod validation.
-- This migration documents the status extension for reference.

-- The following statuses are now valid for consultations:
-- waiting, scheduled, in_progress, completed, cancelled, no_show, referred, follow_up_required

-- Update any existing 'scheduled' consultations that might benefit from 'waiting' status
-- (Uncomment if needed for data cleanup)
-- UPDATE consultations SET status = 'waiting' WHERE status = 'scheduled' AND scheduled_at <= datetime('now', '+6 hours');
```

- [ ] **Step 3: Run migration on local DB**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx wrangler d1 execute hms-local --local --file=migrations/0262_consultation_status_extend.sql`
Expected: Success (no error)

---

### Task 3: Update Frontend Status Badges

**Files:**
- Modify: `web/src/pages/ConsultationNotes.tsx:27`

- [ ] **Step 1: Read current status badge map**

Read `web/src/pages/ConsultationNotes.tsx` around line 27 to see the current `STATUS_BADGE` object.

- [ ] **Step 2: Add new status badges**

Update the `STATUS_BADGE` constant to include the new statuses:

```typescript
const STATUS_BADGE: Record<string, { label: string; badge: string }> = {
  waiting: { label: 'Waiting', badge: 'badge-info' },
  scheduled: { label: 'Scheduled', badge: 'badge-primary' },
  in_progress: { label: 'In Progress', badge: 'badge-warning' },
  completed: { label: 'Completed', badge: 'badge-success' },
  cancelled: { label: 'Cancelled', badge: 'badge-danger' },
  no_show: { label: 'No Show', badge: 'badge-danger' },
  referred: { label: 'Referred', badge: 'badge-secondary' },
  follow_up_required: { label: 'Follow-up Required', badge: 'badge-warning' },
};
```

- [ ] **Step 3: Add status filter options**

Find the status filter dropdown in the same file and add the new options. Look for a `<select>` element with status options and add:
```html
<option value="waiting">Waiting</option>
<option value="referred">Referred</option>
<option value="follow_up_required">Follow-up Required</option>
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms/web && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

---

### Task 4: Verify End-to-End

- [ ] **Step 1: Start dev server**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm dev`
Expected: Server starts on localhost:8787

- [ ] **Step 2: Test creating consultation with new status**

```bash
curl -X POST http://localhost:8787/api/consultations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "X-Tenant-Id: <tenant>" \
  -d '{"doctorId":1,"patientId":1,"scheduledAt":"2026-05-21T10:00:00","status":"waiting"}'
```
Expected: 201 response with status "waiting"

- [ ] **Step 3: Commit**

```bash
git add src/schemas/consultation.ts migrations/0262_consultation_status_extend.sql web/src/pages/ConsultationNotes.tsx
git commit -m "feat(consultation): add waiting, referred, follow_up_required statuses"
```
