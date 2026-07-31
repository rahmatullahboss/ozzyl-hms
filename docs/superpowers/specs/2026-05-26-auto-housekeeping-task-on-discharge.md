# Auto Housekeeping Task on Discharge

## Problem

When a patient is discharged, the bed automatically goes to `cleaning` status, but:
- No housekeeping task is created
- Nurses are not notified
- Admin must manually call `clear-cleaning` to make the bed available
- The housekeeping module and bed management are completely decoupled

## Solution

Auto-create a `post_discharge` housekeeping task when a bed enters `cleaning` status after discharge. When a nurse marks the task as `completed`, the bed automatically becomes `available`.

## Flow

```
Patient Discharged (any of 6 paths)
       ↓
Bed → "cleaning" (existing)
       ↓
Auto-create housekeeping_task:
  - task_type: "post_discharge"
  - priority: "high"
  - assigned_to: discharging user (if nurse) or unassigned
  - area_name: bed.ward_name
  - description: "Post-discharge cleaning - Bed {bed_number} (Ward {ward_name})"
  - bed_id: bed.id (NEW field)
  - admission_id: admission.id (NEW field)
       ↓
Dashboard shows pending cleaning tasks for nurses
       ↓
Nurse marks task "completed"
       ↓
Bed → "available" (automatic)
```

## Changes

### 1. Migration: Add linkage columns to housekeeping_tasks

```sql
ALTER TABLE housekeeping_tasks ADD COLUMN bed_id INTEGER;
ALTER TABLE housekeeping_tasks ADD COLUMN admission_id INTEGER;
```

### 2. New helper: `createPostDischargeCleaningTask()`

Location: `src/lib/housekeeping-helpers.ts` (new file)

```typescript
export async function createPostDischargeCleaningTask(
  db: D1Database,
  tenantId: string,
  params: {
    bedId: number;
    bedNumber: string;
    wardName: string;
    admissionId: number;
    assignedTo?: string;
    assignedToId?: number;
  }
): Promise<void>
```

- Generates task number via existing `nextTaskNumber` logic
- Sets `task_type = 'post_discharge'`, `priority = 'high'`
- Sets `scheduled_date = today`
- Links via `bed_id` and `admission_id`

### 3. Modify discharge paths (6 locations)

All discharge paths already have `bed_id` and `admission_id` available. After the batch that sets `bed.status = 'cleaning'`, call `createPostDischargeCleaningTask()`.

Files to modify:
- `src/routes/tenant/admissions.ts` — 3 paths (clinical, billing, credit discharge)
- `src/routes/tenant/dischargePlanning.ts` — 1 path
- `src/routes/tenant/deathRecords.ts` — 1 path
- `src/routes/tenant/ipBilling.ts` — 1 path

### 4. Modify housekeeping task status endpoint

In `src/routes/tenant/housekeeping.ts`, when a task is marked `completed`:
- Check if `bed_id` is set on the task
- If yes, update `beds.status = 'available'`
- Atomic batch operation

### 5. clear-cleaning endpoint (keep as fallback)

The existing `clear-cleaning` endpoint remains for edge cases (lost tasks, admin override). Add a guard: if a pending housekeeping task exists for the bed, warn that the task should be completed instead.

## Role Mapping

| Action | Who |
|--------|-----|
| Task created | System (automatic on discharge) |
| Task assigned | Discharging user (if nurse) or unassigned |
| Task completed | Any nurse (via housekeeping module) |
| Bed → available | Automatic on task completion |
| Manual clear-cleaning | Admin (fallback only) |

## Dashboard Integration

- Show count of `pending` + `in_progress` post_discharge tasks
- Badge on housekeeping navigation
- Filter housekeeping tasks by `task_type = 'post_discharge'`
