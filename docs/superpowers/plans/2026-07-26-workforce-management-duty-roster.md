# Workforce Management and Duty Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Staff Management, Duty Roster, Shift Rotation, Work Calendar, Attendance, Leave, Biometric Punch, and operational Overtime usable, tenant-safe, auditable, and modular while preserving current legacy authority and keeping payroll-finance changes outside this branch.

**Architecture:** Introduce `src/modules/workforce-management` as a public application boundary over existing `staff` and `hr_*` tables. Existing Hono routes become thin transport adapters, the web client uses stable camelCase DTOs, roster and punch mutations become bounded/idempotent/auditable, and practitioner identity remains an optional exact employee link. Payroll receives read-only workforce summaries through a later finance-owned integration task.

**Tech Stack:** TypeScript 5.9, Hono, Zod, Cloudflare D1, Vitest, React 19, TanStack Query, Playwright, pnpm workspaces.

## Global Constraints

- Work only in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/workforce-roster-planning-20260726` on `task/workforce-roster-planning-20260726`.
- Before runtime implementation, merge the latest reviewed local `main`, inspect every conflict, and run `pnpm worktree:check -- --mode=task`.
- Never reset, clean, stash, overwrite, or opportunistically commit another task’s work.
- Read `docs/reports/2026-07-26-workforce-duty-roster-canonical-readiness-audit.md` and `docs/superpowers/specs/2026-07-26-workforce-management-duty-roster-design.md` before implementation.
- Re-read the current canonical practitioner checkpoint and canonical-finance checkpoint before touching identity, payroll, accounting, or central permission files.
- Do not copy unmerged canonical command/provider implementations into this branch.
- Do not create canonical workforce tables in this task.
- Do not modify payroll calculation, payable, payment, expense, custody, or accounting semantics.
- Do not modify `src/routes/tenant/hr/payroll.ts` in this branch.
- Do not deploy, push, access production, apply migrations remotely, run protected backfills, enable provider flags, or retire legacy tables.
- Use additive migrations only; historical migrations remain unchanged.
- Preserve existing route URLs.
- Public JSON DTOs use camelCase.
- Practitioner linkage is optional and must use exact active employee-link evidence; no name, phone, email, role, department, or numeric-coincidence matching.
- Every mutation validates tenant scope and active state before writing.
- Every mutation defines exact replay and conflicting-replay behavior.
- Maximum inclusive date range: 62 days.
- Maximum staff/shift pairs in one bulk assignment: 50.
- Maximum generated roster mutations in one request: 500.
- Stage exact task-owned files only and create one focused commit per task.

---

## Target File Map

### New module files

```text
src/modules/workforce-management/
├── domain/
│   ├── workforce-member.ts
│   ├── roster.ts
│   ├── work-calendar.ts
│   ├── attendance.ts
│   ├── leave.ts
│   ├── overtime.ts
│   └── errors.ts
├── application/
│   ├── ports.ts
│   ├── workforce-directory.ts
│   ├── roster-service.ts
│   ├── rotation-service.ts
│   ├── work-calendar-service.ts
│   ├── attendance-punch-service.ts
│   ├── attendance-query-service.ts
│   ├── leave-service.ts
│   ├── overtime-service.ts
│   └── workforce-payroll-input-query.ts
├── infrastructure/
│   ├── d1-workforce-member-repository.ts
│   ├── d1-roster-repository.ts
│   ├── d1-work-calendar-repository.ts
│   ├── d1-attendance-repository.ts
│   ├── d1-leave-repository.ts
│   ├── d1-overtime-repository.ts
│   ├── d1-workforce-idempotency-repository.ts
│   ├── practitioner-link-adapter.ts
│   └── workforce-transaction-adapter.ts
├── transport/
│   ├── dto.ts
│   └── mappers.ts
└── index.ts
```

### Existing runtime files

```text
src/schemas/hr.ts
src/routes/tenant/staff.ts
src/routes/tenant/hr/index.ts
src/routes/tenant/hr/roster.ts
src/routes/tenant/hr/attendance.ts
src/routes/tenant/hr/leave.ts
src/routes/tenant/hr/biometric.ts
src/lib/route-permissions.ts
web/src/pages/DutyRoster.tsx
web/src/pages/StaffPage.tsx
web/e2e/hr-module.spec.ts
```

### Additive migration

```text
migrations/0551_workforce_roster_integrity.sql
```

Before creating migration `0550`, verify that the name is still unused after synchronizing with local `main`. If another reviewed task has claimed `0550`, stop and update this plan, task board, and migration path together before schema implementation.

---

### Task 0: Commit Documentation, Synchronize Main, and Reconfirm Program Boundaries

**Files:**
- Read: `agents.md`
- Read: `.agent-rules/git-workflow.md`
- Read: `docs/reports/2026-07-26-workforce-duty-roster-canonical-readiness-audit.md`
- Read: `docs/superpowers/specs/2026-07-26-workforce-management-duty-roster-design.md`
- Read: `docs/superpowers/plans/2026-07-26-workforce-management-duty-roster.md`
- Read: latest canonical control center and practitioner receipt in the canonical worktree
- Read: latest canonical-finance handoff/status
- Modify only if present after main sync: `docs/architecture/module-registry.yaml`

**Interfaces:**
- Consumes: reviewed local `main`, current CDB practitioner state, current canonical-finance state, modular registry state.
- Produces: one clean, current, conflict-reviewed task branch before source edits.

- [ ] **Step 1: Verify worktree policy with documentation changes**

Run:

```bash
pnpm worktree:check -- --mode=task --allow-dirty
```

Expected: `WORKTREE_POLICY_OK`, with dirty files limited to this documentation package.

- [ ] **Step 2: Commit the complete planning package**

Run:

```bash
git add docs/reports/2026-07-26-workforce-duty-roster-canonical-readiness-audit.md docs/superpowers/specs/2026-07-26-workforce-management-duty-roster-design.md docs/superpowers/plans/2026-07-26-workforce-management-duty-roster.md docs/architecture/workforce-management-program-task-board.yaml docs/architecture/workforce-management-continuation-prompt.md
git commit -m "docs(workforce): define staff and roster hardening program"
```

Expected: one documentation-only commit.

- [ ] **Step 3: Merge the latest reviewed local main**

Run:

```bash
git merge main
```

Expected: fast-forward or a reviewed merge. Stop on conflicts affecting payroll, practitioner commands/providers, HR routes, central RBAC, or migration numbering. Record exact conflicts in the task board before resolving them.

- [ ] **Step 4: Reconfirm migration availability**

Run:

```bash
pnpm exec tsx -e "import { existsSync } from 'node:fs'; if (existsSync('migrations/0551_workforce_roster_integrity.sql')) process.exit(1); console.log('MIGRATION_0551_AVAILABLE');"
```

Expected: `MIGRATION_0551_AVAILABLE`.

- [ ] **Step 5: Reconfirm canonical boundaries**

Verify these facts from the authoritative worktrees:

```text
canonical practitioner identity is not employee identity
practitioner employee link is optional and exact
a canonical workforce authority is not yet approved
payroll calculation/payable/payment/accounting remain finance-owned
production mutation and legacy retirement remain unauthorised
```

If any fact has changed, update the design and plan before source code.

- [ ] **Step 6: Register workforce module only when the registry exists on current main**

When `docs/architecture/module-registry.yaml` is available on current `main`, add:

```yaml
  - id: workforce_management
    name: Workforce, Roster, Attendance and Leave
    status: migrating
    risk: high
    current_paths:
      - src/routes/tenant/staff.ts
      - src/routes/tenant/hr/roster.ts
      - src/routes/tenant/hr/attendance.ts
      - src/routes/tenant/hr/leave.ts
      - src/routes/tenant/hr/biometric.ts
    target_path: src/modules/workforce-management
    public_api: src/modules/workforce-management/index.ts
    owns:
      - employee operational profile
      - shifts, roster and rotation lifecycle
      - work calendar and holidays
      - attendance punch facts and daily projection
      - leave lifecycle
      - operational overtime approval
    authority: existing_workforce_tables_behind_legacy_provider
    allowed_dependencies:
      - identity_access
      - audit_operations
      - notifications_integrations
    entry_points:
      - staff routes
      - roster, attendance, leave and biometric routes
    production_observation_required: true
```

Narrow `identity_access` to authentication, sessions, users, roles, permissions, invitations, and user/workforce account linking. Do not assign roster, attendance, leave, or overtime ownership to `identity_access`.

- [ ] **Step 7: Run the clean synchronization gate**

```bash
pnpm worktree:check -- --mode=task
pnpm exec tsc --noEmit
```

Expected: both pass.

- [ ] **Step 8: Commit registry synchronization when changed**

```bash
git add docs/architecture/module-registry.yaml
git commit -m "docs(modules): register workforce management boundary"
```

Skip this commit when the registry is not yet on reviewed `main`; retain the deferred gate in the task board.

---

### Task 1: Characterize the Broken Duty Roster Contract With RED Tests

**Files:**
- Create: `test/unit/workforce-duty-roster-contract.test.ts`
- Modify: `test/integration/routes/hr-roster.test.ts`
- Modify: `web/src/pages/DutyRoster.test.ts`
- Modify: `web/e2e/hr-module.spec.ts`

**Interfaces:**
- Consumes: current Zod schemas, route URLs, current UI mutation code.
- Produces: executable request/response fixtures that define the stable camelCase contract.

- [ ] **Step 1: Add backend request fixtures**

Create `test/unit/workforce-duty-roster-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assignRosterSchema,
  bulkAssignRosterSchema,
  generateRosterSchema,
  createRotationSchema,
  assignRotationSchema,
  createHolidaySchema,
  createOvertimeRuleSchema,
} from '../../src/schemas/hr';

export const rosterContractFixtures = {
  assign: {
    staffId: 21,
    shiftId: 3,
    rosterDate: '2026-07-27',
    remarks: 'ICU coverage',
    idempotencyKey: 'roster:assign:21:2026-07-27:3',
  },
  bulk: {
    assignments: [{ staffId: 21, shiftId: 3 }],
    startDate: '2026-07-27',
    endDate: '2026-07-31',
    dateMode: 'all_dates',
    idempotencyKey: 'roster:bulk:icu:2026-07-27:2026-07-31',
  },
  generate: {
    startDate: '2026-07-27',
    endDate: '2026-07-31',
    replaceExisting: false,
    idempotencyKey: 'roster:generate:2026-07-27:2026-07-31',
  },
  rotation: {
    patternName: 'ICU weekly',
    cycleDays: 7,
    days: [
      { dayNumber: 1, shiftId: 3, isOff: false },
      { dayNumber: 2, shiftId: null, isOff: true },
    ],
    idempotencyKey: 'rotation:create:icu-weekly',
  },
  rotationAssign: {
    staffId: 21,
    patternId: 5,
    startDate: '2026-07-27',
    cycleOffset: 0,
    idempotencyKey: 'rotation:assign:21:5:2026-07-27',
  },
  holiday: {
    holidayName: 'Victory Day',
    holidayDate: '2026-12-16',
    holidayType: 'public',
  },
  overtime: {
    ruleName: 'Weekday overtime',
    multiplier: 1.5,
    minHoursBeforeOt: 8,
    maxOtHoursPerDay: 4,
    appliesOn: 'weekday',
  },
} as const;

describe('workforce duty-roster public contracts', () => {
  it('accepts every documented request fixture', () => {
    expect(assignRosterSchema.safeParse(rosterContractFixtures.assign).success).toBe(true);
    expect(bulkAssignRosterSchema.safeParse(rosterContractFixtures.bulk).success).toBe(true);
    expect(generateRosterSchema.safeParse(rosterContractFixtures.generate).success).toBe(true);
    expect(createRotationSchema.safeParse(rosterContractFixtures.rotation).success).toBe(true);
    expect(assignRotationSchema.safeParse(rosterContractFixtures.rotationAssign).success).toBe(true);
    expect(createHolidaySchema.safeParse(rosterContractFixtures.holiday).success).toBe(true);
    expect(createOvertimeRuleSchema.safeParse(rosterContractFixtures.overtime).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run schema characterization and confirm RED**

```bash
pnpm exec vitest run test/unit/workforce-duty-roster-contract.test.ts
```

Expected: failures because idempotency/date mode/replaceExisting/nullable off-day fields are not yet accepted.

- [ ] **Step 3: Add exact roster response contract**

Add to `test/integration/routes/hr-roster.test.ts`:

```ts
it('returns stable camelCase roster DTOs', async () => {
  const { app } = createTestApp({
    route: rosterRoutes,
    routePath: '/roster',
    role: 'hospital_admin',
    tables: {
      hr_duty_roster: [ROSTER_1],
      staff: [STAFF_1],
      hr_shifts: [SHIFT_MORNING],
    },
  });

  const res = await app.request('/roster?from=2025-04-01&to=2025-04-30');
  expect(res.status).toBe(200);
  const body = await res.json() as { data: Array<Record<string, unknown>> };
  expect(body.data[0]).toMatchObject({
    rosterId: 1,
    staffId: 1,
    rosterDate: '2025-04-07',
    shiftName: 'Morning',
  });
  expect(body.data[0]).not.toHaveProperty('roster_date');
});
```

- [ ] **Step 4: Run response characterization and confirm RED**

```bash
pnpm exec vitest run test/integration/routes/hr-roster.test.ts -t "stable camelCase"
```

Expected: FAIL because the route returns raw database column names.

- [ ] **Step 5: Replace export-only web coverage with request-body tests**

Use React Testing Library and mock `api.post`. The first assignment assertion must be:

```ts
expect(post).toHaveBeenCalledWith('/api/hr/roster', {
  staffId: 1,
  shiftId: 2,
  rosterDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: expect.stringMatching(/^roster:assign:/),
});
```

Add equivalent assertions for bulk, generate, rotation create, rotation assign, holiday creation, and overtime rule creation.

- [ ] **Step 6: Run web characterization and confirm seven RED cases**

```bash
pnpm --filter web exec vitest run src/pages/DutyRoster.test.ts
```

Expected: the request-body cases fail against current snake_case mutation bodies.

- [ ] **Step 7: Make E2E mocks validate request bodies**

In `web/e2e/hr-module.spec.ts`, parse `request.postDataJSON()` for each mutation endpoint and return `400` when required camelCase fields are absent. Do not let E2E tests succeed with an arbitrary body.

- [ ] **Step 8: Commit RED characterization tests**

```bash
git add test/unit/workforce-duty-roster-contract.test.ts test/integration/routes/hr-roster.test.ts web/src/pages/DutyRoster.test.ts web/e2e/hr-module.spec.ts
git commit -m "test(workforce): characterize duty roster contracts"
```

---

### Task 2: Stabilize Zod Schemas, Transport DTOs, and Frontend Request Shapes

**Files:**
- Modify: `src/schemas/hr.ts`
- Create: `src/modules/workforce-management/transport/dto.ts`
- Create: `src/modules/workforce-management/transport/mappers.ts`
- Modify: `src/routes/tenant/hr/roster.ts`
- Modify: `src/routes/tenant/hr/biometric.ts`
- Modify: `web/src/pages/DutyRoster.tsx`
- Test: Task 1 files

**Interfaces:**
- Consumes: Task 1 contract fixtures.
- Produces: stable request schemas and response DTO mappers used by all later application services.

- [ ] **Step 1: Define common schema primitives**

Add to `src/schemas/hr.ts` near HR schema primitives:

```ts
const positiveInt = z.number().int().positive();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idempotencyKey = z.string().min(8).max(200);
```

- [ ] **Step 2: Replace roster mutation schemas with the exact contract**

```ts
export const assignRosterSchema = z.object({
  staffId: positiveInt,
  shiftId: positiveInt,
  rosterDate: dateString,
  remarks: z.string().max(300).optional(),
  idempotencyKey,
});

export const bulkAssignRosterSchema = z.object({
  assignments: z.array(z.object({ staffId: positiveInt, shiftId: positiveInt })).min(1).max(50),
  startDate: dateString,
  endDate: dateString,
  dateMode: z.enum(['all_dates', 'configured_working_days']).default('all_dates'),
  idempotencyKey,
}).refine((value) => value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

export const swapRosterSchema = z.object({
  swapWithStaffId: positiveInt,
  reason: z.string().min(3).max(300),
  idempotencyKey,
});

export const cancelRosterSchema = z.object({
  reason: z.string().min(3).max(300),
  idempotencyKey,
});

export const generateRosterSchema = z.object({
  startDate: dateString,
  endDate: dateString,
  replaceExisting: z.literal(false).default(false),
  idempotencyKey,
}).refine((value) => value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});
```

- [ ] **Step 3: Make rotation off-day validation explicit**

```ts
const rotationDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  shiftId: positiveInt.nullable(),
  isOff: z.boolean().default(false),
}).superRefine((day, ctx) => {
  if (!day.isOff && day.shiftId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftId'], message: 'shiftId is required for a working day' });
  }
  if (day.isOff && day.shiftId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftId'], message: 'shiftId must be null for an off-day' });
  }
});

export const createRotationSchema = z.object({
  patternName: z.string().min(2).max(100),
  cycleDays: z.number().int().min(1).max(62),
  days: z.array(rotationDaySchema).min(1).max(62),
  idempotencyKey,
});

export const assignRotationSchema = z.object({
  staffId: positiveInt,
  patternId: positiveInt,
  startDate: dateString,
  endDate: dateString.optional(),
  cycleOffset: z.number().int().min(0).max(61).default(0),
  idempotencyKey,
}).refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});
```

- [ ] **Step 4: Create transport DTO types**

Create `src/modules/workforce-management/transport/dto.ts` with these exports:

```ts
export type RosterAssignmentDto = {
  rosterId: number;
  staffId: number;
  staffName: string;
  position: string;
  department: string | null;
  shiftId: number;
  shiftName: string;
  shiftShortCode: string | null;
  shiftStartTime: string;
  shiftEndTime: string;
  shiftColor: string | null;
  rosterDate: string;
  status: 'scheduled' | 'swapped' | 'cancelled';
  swappedWithStaffId: number | null;
  remarks: string | null;
  version: number;
};

export type RotationPatternDto = {
  patternId: number;
  patternName: string;
  cycleDays: number;
  isActive: boolean;
  days: Array<{
    dayNumber: number;
    shiftId: number | null;
    shiftName: string | null;
    isOff: boolean;
  }>;
};

export type HolidayDto = {
  holidayId: number;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
  isActive: boolean;
};

export type OvertimeRuleDto = {
  ruleId: number;
  ruleName: string;
  multiplier: number;
  minHoursBeforeOvertime: number;
  maxOvertimeHoursPerDay: number;
  appliesOn: 'weekday' | 'weekend' | 'holiday' | 'all';
  isActive: boolean;
};
```

- [ ] **Step 5: Create pure row mappers**

Create `src/modules/workforce-management/transport/mappers.ts` with `mapRosterRow`, `mapShiftRow`, `mapHolidayRow`, and `mapOvertimeRuleRow`. `mapRosterRow` must map snake_case database columns to `RosterAssignmentDto`, and must never expose raw row keys.

- [ ] **Step 6: Return nested rotation days**

In the current rotation GET route, fetch day rows and fill absent cycle days:

```ts
const days = Array.from({ length: Number(pattern.cycle_days) }, (_, index) => {
  const dayNumber = index + 1;
  const row = dayRows.find((item) => Number(item.day_number) === dayNumber);
  return row
    ? { dayNumber, shiftId: Number(row.shift_id), shiftName: String(row.shift_name), isOff: false }
    : { dayNumber, shiftId: null, shiftName: null, isOff: true };
});
```

- [ ] **Step 7: Convert every DutyRoster mutation body to camelCase**

Assignment:

```ts
assignMutation.mutate({
  staffId: popover.staffId,
  shiftId: Number(shiftId),
  rosterDate: popover.dateStr,
  idempotencyKey: `roster:assign:${popover.staffId}:${popover.dateStr}:${shiftId}`,
});
```

Bulk:

```ts
bulkMutation.mutate({
  assignments: bulkForm.staffIds.map((staffId) => ({ staffId, shiftId: Number(bulkForm.shiftId) })),
  startDate: bulkForm.startDate,
  endDate: bulkForm.endDate,
  dateMode: 'all_dates',
  idempotencyKey: `roster:bulk:${bulkForm.startDate}:${bulkForm.endDate}:${bulkForm.staffIds.join(',')}:${bulkForm.shiftId}`,
});
```

Use equivalent documented fields for generate, rotation create/assign, holiday, and overtime. Use singular `weekday`, `weekend`, `holiday`, and `all` enum values.

- [ ] **Step 8: Run contract tests**

```bash
pnpm exec vitest run test/unit/workforce-duty-roster-contract.test.ts test/integration/routes/hr-roster.test.ts
pnpm --filter web exec vitest run src/pages/DutyRoster.test.ts
```

Expected: request schema, response DTO, and web mutation-body tests pass.

- [ ] **Step 9: Commit contract stabilization**

```bash
git add src/schemas/hr.ts src/modules/workforce-management/transport/dto.ts src/modules/workforce-management/transport/mappers.ts src/routes/tenant/hr/roster.ts src/routes/tenant/hr/biometric.ts web/src/pages/DutyRoster.tsx test/unit/workforce-duty-roster-contract.test.ts test/integration/routes/hr-roster.test.ts web/src/pages/DutyRoster.test.ts web/e2e/hr-module.spec.ts
git commit -m "fix(workforce): align duty roster API contracts"
```

---

### Task 3: Create Workforce Domain Contracts and Public Module API

**Files:**
- Create: `src/modules/workforce-management/domain/workforce-member.ts`
- Create: `src/modules/workforce-management/domain/roster.ts`
- Create: `src/modules/workforce-management/domain/work-calendar.ts`
- Create: `src/modules/workforce-management/domain/attendance.ts`
- Create: `src/modules/workforce-management/domain/leave.ts`
- Create: `src/modules/workforce-management/domain/overtime.ts`
- Create: `src/modules/workforce-management/domain/errors.ts`
- Create: `src/modules/workforce-management/application/ports.ts`
- Create: `src/modules/workforce-management/index.ts`
- Create: `test/modules/workforce-management/public-contract.test.ts`
- Create: `test/modules/workforce-management/domain-policies.test.ts`

**Interfaces:**
- Consumes: stable DTO names from Task 2.
- Produces: stable domain/application interfaces used by every repository and route task.

- [ ] **Step 1: Write the public API RED test**

```ts
import { describe, expect, it } from 'vitest';
import * as workforce from '../../../src/modules/workforce-management';

describe('workforce-management public API', () => {
  it('exports the supported composition surface', () => {
    expect(workforce.WorkforceError).toBeTypeOf('function');
    expect(workforce.createWorkforceModule).toBeTypeOf('function');
    expect(workforce.calculateCycleDay).toBeTypeOf('function');
    expect(workforce.resolveWeekPattern).toBeTypeOf('function');
    expect(workforce.resolveAttendanceBusinessDate).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/public-contract.test.ts
```

Expected: module cannot be resolved.

- [ ] **Step 3: Implement the stable error contract**

Create `domain/errors.ts`:

```ts
export type WorkforceErrorCode =
  | 'WORKFORCE_MEMBER_NOT_FOUND'
  | 'WORKFORCE_MEMBER_INACTIVE'
  | 'SHIFT_NOT_FOUND'
  | 'SHIFT_INACTIVE'
  | 'ROSTER_NOT_FOUND'
  | 'ROSTER_CONFLICT'
  | 'ROSTER_SWAP_SAME_STAFF'
  | 'ROSTER_SWAP_TARGET_MISSING'
  | 'ROTATION_NOT_FOUND'
  | 'ROTATION_INACTIVE'
  | 'INVALID_DATE_RANGE'
  | 'REQUEST_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEAVE_BALANCE_INSUFFICIENT'
  | 'ATTENDANCE_PUNCH_CONFLICT'
  | 'ATTENDANCE_CORRECTION_REASON_REQUIRED'
  | 'WORKFORCE_PERMISSION_DENIED';

export class WorkforceError extends Error {
  constructor(
    readonly code: WorkforceErrorCode,
    message: string,
    readonly httpStatus: 400 | 403 | 404 | 409 | 422,
    readonly retryable = false,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = 'WorkforceError';
  }
}
```

- [ ] **Step 4: Implement deterministic roster helpers**

Create in `domain/roster.ts`:

```ts
export function calculateCycleDay(input: {
  startDate: string;
  targetDate: string;
  cycleDays: number;
  cycleOffset: number;
}): number {
  if (input.cycleDays < 1) throw new RangeError('cycleDays must be positive');
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const target = Date.parse(`${input.targetDate}T00:00:00Z`);
  const elapsed = Math.floor((target - start) / 86_400_000);
  if (elapsed < 0) throw new RangeError('targetDate is before startDate');
  return ((elapsed + input.cycleOffset) % input.cycleDays) + 1;
}

export function enumerateInclusiveDates(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (end < start) throw new RangeError('endDate is before startDate');
  const count = Math.floor((end - start) / 86_400_000) + 1;
  if (count > 62) throw new RangeError('date range exceeds 62 days');
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}
```

- [ ] **Step 5: Implement work-calendar pattern policy**

Create `resolveWeekPattern` in `domain/work-calendar.ts`:

```ts
export type WeekendWeekPattern = 'every' | '1st' | '2nd' | '3rd' | '4th' | '5th' | '1st_3rd' | '2nd_4th';

export function resolveWeekPattern(pattern: WeekendWeekPattern, weekOfMonth: number): boolean {
  if (pattern === 'every') return true;
  if (pattern === '1st_3rd') return weekOfMonth === 1 || weekOfMonth === 3;
  if (pattern === '2nd_4th') return weekOfMonth === 2 || weekOfMonth === 4;
  return Number.parseInt(pattern, 10) === weekOfMonth;
}
```

- [ ] **Step 6: Implement overnight business-date policy**

Create in `domain/attendance.ts`:

```ts
export function resolveAttendanceBusinessDate(input: {
  localDate: string;
  localTime: string;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  isNightShift: boolean;
}): string {
  if (!input.isNightShift || !input.shiftStartTime || !input.shiftEndTime) return input.localDate;
  if (input.localTime >= input.shiftStartTime) return input.localDate;
  if (input.localTime <= input.shiftEndTime) {
    const current = Date.parse(`${input.localDate}T00:00:00Z`);
    return new Date(current - 86_400_000).toISOString().slice(0, 10);
  }
  return input.localDate;
}
```

- [ ] **Step 7: Define repository and transaction ports**

Create `application/ports.ts` with use-case-specific interfaces for workforce members, shifts, roster current state/events, rotations, calendar, attendance, leave, overtime, idempotency, clock, ID generation, audit, and D1 transaction batching. Do not expose Hono context or raw D1 rows in public interfaces.

- [ ] **Step 8: Test domain policies**

Add cases for:

```text
cycle offset wrap-around
date range rejects 63 days
1st_3rd and 2nd_4th weekend patterns
night shift 02:00 maps to prior business date
normal shift keeps local date
```

Run:

```bash
pnpm exec vitest run test/modules/workforce-management/public-contract.test.ts test/modules/workforce-management/domain-policies.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 9: Commit module contracts**

```bash
git add src/modules/workforce-management test/modules/workforce-management/public-contract.test.ts test/modules/workforce-management/domain-policies.test.ts
git commit -m "feat(workforce): define module contracts"
```

---

### Task 4: Implement Legacy Workforce and Shift Repositories With Optional Practitioner Link

**Files:**
- Create: `src/modules/workforce-management/application/workforce-directory.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-workforce-member-repository.ts`
- Create: `src/modules/workforce-management/infrastructure/practitioner-link-adapter.ts`
- Create: `test/modules/workforce-management/d1-workforce-member-repository.test.ts`
- Modify: GET paths in `src/routes/tenant/staff.ts`

**Interfaces:**
- Consumes: `WorkforceMemberRepository`, `ShiftRepository`, `WorkforceMemberRef`, `ShiftDefinition`.
- Produces: tenant-safe staff/shift queries and optional exact practitioner public ID.

- [ ] **Step 1: Write repository RED tests**

Required assertions:

```ts
it('returns an active tenant-owned employee with an exact practitioner link', async () => {
  expect(await repository.getMember('100', 21)).toEqual({
    tenantId: '100',
    staffId: 21,
    displayName: 'Nurse Fatima',
    position: 'Nurse',
    department: 'ICU',
    status: 'active',
    userId: 44,
    practitionerPublicId: 'prac_icu_21',
  });
});

it('never returns a staff row from another tenant', async () => {
  expect(await repository.getMember('100', 99)).toBeNull();
});

it('returns null practitionerPublicId for a non-clinical employee', async () => {
  expect((await repository.getMember('100', 22))?.practitionerPublicId).toBeNull();
});

it('rejects an inactive shift through requireActiveShift', async () => {
  await expect(requireActiveShift(shiftRepository, '100', 8)).rejects.toMatchObject({ code: 'SHIFT_INACTIVE' });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/d1-workforce-member-repository.test.ts
```

Expected: repository modules missing.

- [ ] **Step 3: Implement tenant-scoped staff query**

Primary query:

```sql
SELECT
  s.id,
  s.tenant_id,
  s.name,
  s.position,
  s.department,
  s.status,
  s.user_id,
  pel.practitioner_public_id
FROM staff s
LEFT JOIN canonical_practitioner_employee_links pel
  ON pel.tenant_id = CAST(s.tenant_id AS TEXT)
 AND pel.legacy_staff_id = s.id
 AND pel.link_status = 'active'
WHERE s.tenant_id = ? AND s.id = ?
LIMIT 1
```

When test/legacy schemas lack `canonical_practitioner_employee_links`, catch only the missing-table database error, retry a staff-only query, and set `practitionerPublicId: null`. Re-throw every other database error.

- [ ] **Step 4: Implement active member/shift guards**

```ts
export async function requireActiveMember(repository: WorkforceMemberRepository, tenantId: string, staffId: number) {
  const member = await repository.getMember(tenantId, staffId);
  if (!member) throw new WorkforceError('WORKFORCE_MEMBER_NOT_FOUND', 'Staff member not found', 404);
  if (member.status !== 'active') throw new WorkforceError('WORKFORCE_MEMBER_INACTIVE', 'Staff member is inactive', 409);
  return member;
}

export async function requireActiveShift(repository: ShiftRepository, tenantId: string, shiftId: number) {
  const shift = await repository.getShift(tenantId, shiftId);
  if (!shift) throw new WorkforceError('SHIFT_NOT_FOUND', 'Shift not found', 404);
  if (!shift.isActive) throw new WorkforceError('SHIFT_INACTIVE', 'Shift is inactive', 409);
  return shift;
}
```

- [ ] **Step 5: Route staff reads through the module query**

Update only staff list/detail reads in `src/routes/tenant/staff.ts`. Preserve the existing compatibility response consumed by `StaffPage`; derive both compatibility fields and stable mapped fields from one module result, not duplicate SQL queries.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm exec vitest run test/modules/workforce-management/d1-workforce-member-repository.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 7: Commit directory adapter**

```bash
git add src/modules/workforce-management/application/workforce-directory.ts src/modules/workforce-management/infrastructure/d1-workforce-member-repository.ts src/modules/workforce-management/infrastructure/practitioner-link-adapter.ts src/routes/tenant/staff.ts test/modules/workforce-management/d1-workforce-member-repository.test.ts
git commit -m "feat(workforce): add legacy workforce directory adapter"
```

---

### Task 5: Add Additive Roster Integrity, Idempotency, and Punch Projection Schema

**Files:**
- Create: `migrations/0551_workforce_roster_integrity.sql`
- Create: `test/workforce-roster-integrity-schema.test.ts`
- Modify only through command: generated migration manifest artifact

**Interfaces:**
- Consumes: current `hr_duty_roster`, `hr_attendance_punches`, `hr_attendance`.
- Produces: versioned roster state, immutable roster events, workforce mutation idempotency, punch source identity, attendance projection version.

- [ ] **Step 1: Write the schema RED test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/0551_workforce_roster_integrity.sql', 'utf8');

describe('workforce roster integrity migration', () => {
  it('adds only additive integrity structures', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS hr_roster_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workforce_mutation_idempotency');
    expect(sql).toContain('source_event_key');
    expect(sql).toContain('request_hash');
    expect(sql).toContain('projection_version');
    expect(sql).toContain('UNIQUE(tenant_id, mutation_type, idempotency_key)');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|ALTER TABLE\s+\w+\s+RENAME/i);
  });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/workforce-roster-integrity-schema.test.ts
```

Expected: migration file missing.

- [ ] **Step 3: Create the exact additive migration**

```sql
ALTER TABLE hr_duty_roster ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hr_duty_roster ADD COLUMN updated_by INTEGER;

CREATE TABLE IF NOT EXISTS hr_roster_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  event_public_id TEXT NOT NULL,
  roster_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  roster_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('assigned','reassigned','reactivated','swapped','cancelled','generated')),
  from_shift_id INTEGER,
  to_shift_id INTEGER,
  related_staff_id INTEGER,
  reason TEXT,
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  FOREIGN KEY (roster_id) REFERENCES hr_duty_roster(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_roster_events_public_id
  ON hr_roster_events(tenant_id, event_public_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_roster_events_idempotency
  ON hr_roster_events(tenant_id, idempotency_key, roster_id, event_type);
CREATE INDEX IF NOT EXISTS idx_hr_roster_events_roster
  ON hr_roster_events(tenant_id, roster_id, occurred_at_utc);

CREATE TABLE IF NOT EXISTS workforce_mutation_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')),
  result_json TEXT,
  created_by INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  UNIQUE(tenant_id, mutation_type, idempotency_key)
);

ALTER TABLE hr_attendance_punches ADD COLUMN source_event_key TEXT;
ALTER TABLE hr_attendance_punches ADD COLUMN request_hash TEXT;
ALTER TABLE hr_attendance ADD COLUMN business_date TEXT;
ALTER TABLE hr_attendance ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hr_attendance ADD COLUMN roster_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_attendance_punch_source_event
  ON hr_attendance_punches(tenant_id, source, source_event_key)
  WHERE source_event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_attendance_business_date
  ON hr_attendance(tenant_id, business_date, staff_id);
```

- [ ] **Step 4: Build the migration manifest and run the schema test**

```bash
pnpm build:migrations
pnpm exec vitest run test/workforce-roster-integrity-schema.test.ts
```

Expected: manifest builds and schema test passes.

- [ ] **Step 5: Commit additive schema**

Stage the tracked generated manifest source. The compressed `.generated/schema-migrations/manifest.json.gz` artifact is runtime-generated and must remain untracked when ignored by repository policy:

```bash
git add migrations/0551_workforce_roster_integrity.sql test/workforce-roster-integrity-schema.test.ts src/data/schema-migrations.generated.ts
git commit -m "feat(workforce): add roster integrity schema"
```

Before committing, confirm `git status --short` does not include any unrelated generated files.

---

### Task 6: Implement Workforce Mutation Idempotency and D1 Transaction Composition

**Files:**
- Create: `src/modules/workforce-management/infrastructure/d1-workforce-idempotency-repository.ts`
- Create: `src/modules/workforce-management/infrastructure/workforce-transaction-adapter.ts`
- Create: `test/modules/workforce-management/workforce-idempotency.test.ts`

**Interfaces:**
- Consumes: `workforce_mutation_idempotency`, stable request hashing, D1 batch.
- Produces: `runIdempotentWorkforceMutation<T>()` used by roster and attendance commands.

- [ ] **Step 1: Write RED replay/conflict/rollback tests**

Required cases:

```ts
it('returns a completed result for the same key and same request hash', async () => {
  const result = await runIdempotentWorkforceMutation(context, request, execute);
  const replay = await runIdempotentWorkforceMutation(context, request, execute);
  expect(replay).toEqual(result);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('throws IDEMPOTENCY_CONFLICT when the key is reused with a different hash', async () => {
  await runIdempotentWorkforceMutation(context, firstRequest, execute);
  await expect(runIdempotentWorkforceMutation(context, changedRequest, execute))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 });
});

it('does not persist completed state when a required statement fails', async () => {
  await expect(runIdempotentWorkforceMutation(context, request, failingExecute)).rejects.toThrow();
  expect(await repository.find(context.tenantId, context.mutationType, context.idempotencyKey))
    .toMatchObject({ status: 'failed' });
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/workforce-idempotency.test.ts
```

Expected: idempotency implementation missing.

- [ ] **Step 3: Use deterministic request hashing**

Import the existing canonical stable JSON helper when available on current `main`:

```ts
import { stableCanonicalJson } from '../../../lib/canonical/idempotency';

export async function hashWorkforceRequest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableCanonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

Do not invent a second incompatible canonical JSON algorithm.

- [ ] **Step 4: Implement reserve/replay/conflict statements**

The repository must:

1. read tenant + mutation type + idempotency key;
2. return stored `result_json` when status is `completed` and hash matches;
3. throw `IDEMPOTENCY_CONFLICT` when hash differs;
4. insert `processing` when absent;
5. update to `completed` with result JSON in the same required commit boundary as business state when possible;
6. update to `failed` only after a failed operation that did not commit required business statements.

- [ ] **Step 5: Implement bounded D1 transaction adapter**

```ts
export function createWorkforceTransaction(db: D1Database) {
  return {
    async commit(statements: D1PreparedStatement[]) {
      if (statements.length === 0) return;
      await db.batch(statements);
    },
  };
}
```

The application service prepares every required statement before calling `commit`. It must not loop multiple independent `db.batch` calls and then return one atomic success claim.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm exec vitest run test/modules/workforce-management/workforce-idempotency.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 7: Commit idempotency foundation**

```bash
git add src/modules/workforce-management/infrastructure/d1-workforce-idempotency-repository.ts src/modules/workforce-management/infrastructure/workforce-transaction-adapter.ts test/modules/workforce-management/workforce-idempotency.test.ts
git commit -m "feat(workforce): add mutation idempotency boundary"
```

---

### Task 7: Implement Correct Roster Assignment, Reactivation, Cancellation, and Atomic Two-Way Swap

**Files:**
- Create: `src/modules/workforce-management/application/roster-service.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-roster-repository.ts`
- Modify: `src/routes/tenant/hr/roster.ts`
- Create: `test/modules/workforce-management/roster-service.test.ts`
- Modify: `test/integration/routes/hr-roster.test.ts`

**Interfaces:**
- Consumes: active member/shift guards, idempotency, transaction adapter, roster DTO mapper.
- Produces: `assign`, `cancel`, `swap`, and `list` roster use cases.

- [ ] **Step 1: Write RED domain/application cases**

Required cases:

```text
cross-tenant staff -> 404
inactive staff -> WORKFORCE_MEMBER_INACTIVE
cross-tenant shift -> 404
inactive shift -> SHIFT_INACTIVE
new assignment -> scheduled row + assigned event
same assignment replay -> same result and no second event
different shift on same date -> update + reassigned event
cancelled row assignment -> scheduled + reactivated event
cancellation requires actor/reason and increments version
swap same staff -> ROSTER_SWAP_SAME_STAFF
swap target missing same-date roster -> ROSTER_SWAP_TARGET_MISSING
swap exchanges both shifts atomically
failure of second swap statement leaves both assignments unchanged
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/roster-service.test.ts
```

Expected: roster service/repository missing.

- [ ] **Step 3: Implement current-row lookup and statement builders**

Repository interfaces must include:

```ts
findByStaffDate(tenantId: string, staffId: number, rosterDate: string): Promise<RosterRecord | null>;
findById(tenantId: string, rosterId: number): Promise<RosterRecord | null>;
prepareInsertAssignment(input: PreparedRosterInsert): D1PreparedStatement;
prepareUpdateAssignment(input: PreparedRosterUpdate): D1PreparedStatement;
prepareInsertEvent(input: PreparedRosterEvent): D1PreparedStatement;
```

Every update statement includes tenant and expected version:

```sql
UPDATE hr_duty_roster
SET shift_id = ?, status = ?, swapped_with_staff_id = ?, remarks = ?,
    version = version + 1, updated_by = ?, updated_at = datetime('now')
WHERE tenant_id = ? AND id = ? AND version = ?
```

A zero-row update becomes `ROSTER_CONFLICT`.

- [ ] **Step 4: Implement assignment/reactivation decision table**

```ts
if (!existing) eventType = 'assigned';
else if (existing.status === 'cancelled') eventType = 'reactivated';
else if (existing.shiftId !== input.shiftId) eventType = 'reassigned';
else return existingResult;
```

The service validates active member and shift before preparing statements.

- [ ] **Step 5: Implement cancellation as state transition**

Cancellation sets `status='cancelled'`, retains shift/date/history, records reason/actor, increments version, and inserts a `cancelled` event. It never deletes the row.

- [ ] **Step 6: Implement true two-way swap**

Required preparation order:

```ts
const source = await repository.requireById(input.tenantId, input.rosterId);
const target = await repository.findByStaffDate(input.tenantId, input.swapWithStaffId, source.rosterDate);
if (source.staffId === input.swapWithStaffId) throw sameStaffError;
if (!target || target.status === 'cancelled') throw targetMissingError;

const statements = [
  repository.prepareSwapUpdate(source, target.shiftId, target.staffId, input.actorUserId),
  repository.prepareSwapUpdate(target, source.shiftId, source.staffId, input.actorUserId),
  repository.prepareInsertEvent(sourceSwapEvent),
  repository.prepareInsertEvent(targetSwapEvent),
  idempotency.prepareComplete(result),
];
await transaction.commit(statements);
```

Both current rows remain active. Both shift IDs exchange. Reciprocal staff references and one correlation key are recorded.

- [ ] **Step 7: Replace direct route SQL with thin application calls**

The route responsibilities become:

```text
read tenant/user context
validate Zod payload
call roster service
map WorkforceError to JSON/status
return DTO
```

No route-level multi-table roster orchestration remains.

- [ ] **Step 8: Run focused tests**

```bash
pnpm exec vitest run test/modules/workforce-management/roster-service.test.ts test/integration/routes/hr-roster.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 9: Commit roster lifecycle**

```bash
git add src/modules/workforce-management/application/roster-service.ts src/modules/workforce-management/infrastructure/d1-roster-repository.ts src/routes/tenant/hr/roster.ts test/modules/workforce-management/roster-service.test.ts test/integration/routes/hr-roster.test.ts
git commit -m "fix(workforce): harden roster lifecycle"
```

---

### Task 8: Implement Rotation, Tenant Work Calendar, Bulk Assignment, and Retry-Safe Generation

**Files:**
- Create: `src/modules/workforce-management/application/rotation-service.ts`
- Create: `src/modules/workforce-management/application/work-calendar-service.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-work-calendar-repository.ts`
- Modify: `src/modules/workforce-management/infrastructure/d1-roster-repository.ts`
- Modify: `src/routes/tenant/hr/roster.ts`
- Create: `test/modules/workforce-management/rotation-calendar.test.ts`
- Modify: `test/integration/routes/hr-roster.test.ts`

**Interfaces:**
- Consumes: roster assignment use case, active member/shift guards, date policies.
- Produces: nested rotations, calendar-aware bulk assignment, rerunnable rotation generation.

- [ ] **Step 1: Write RED cases**

Required cases:

```text
rotation off-day is reconstructed from a missing legacy day row
inactive rotation pattern cannot be assigned
a rotation assignment must reference active tenant-owned staff/pattern
rotation generation ignores inactive staff-rotation rows
rotation generation ignores inactive pattern rows
Saturday/Sunday are not automatically skipped in all_dates mode
configured_working_days skips only policy-matched dates
holiday is reported by calendar policy
generation second run creates zero new rows and returns unchanged count
generation never overwrites a manual assignment
range > 62 days -> REQUEST_LIMIT_EXCEEDED
planned mutations > 500 -> REQUEST_LIMIT_EXCEEDED
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/rotation-calendar.test.ts
```

Expected: services/repository missing.

- [ ] **Step 3: Implement calendar day evaluation**

For each date:

1. derive lowercase weekday;
2. derive week-of-month using `Math.floor((dayOfMonth - 1) / 7) + 1`;
3. read active tenant weekend policies for that weekday;
4. apply `resolveWeekPattern`;
5. read active holiday for the date;
6. return `isWorkingDay = !isConfiguredWeekend && holiday === null`.

Roster `all_dates` ignores `isWorkingDay` for assignment eligibility. Leave/absence use it.

- [ ] **Step 4: Implement rotation create with omitted off-day rows**

Validate exact day-number uniqueness and range `1..cycleDays`. Insert only working days into `hr_rotation_pattern_days`. The GET mapper reconstructs omitted days as off-days.

- [ ] **Step 5: Implement active rotation assignment checks**

Queries must include:

```sql
WHERE sr.tenant_id = ?
  AND sr.is_active = 1
  AND rp.tenant_id = ?
  AND rp.is_active = 1
```

- [ ] **Step 6: Implement bounded bulk assignment**

Calculate dates first, validate limits, validate every distinct staff/shift before preparing any mutation, and call roster assignment statement builders. Counts mean:

```text
created = absent current rows inserted
updated = cancelled/reactivated or different-shift rows updated
skipped = exact unchanged assignments or configured non-working days
```

- [ ] **Step 7: Implement retry-safe rotation generation**

Generation uses active rotations and patterns, calculates each cycle day, skips off-days, and treats an existing current roster row as unchanged. It does not use plain insert against an unknown duplicate set. It prepares at most 500 business mutations in one reviewed operation.

- [ ] **Step 8: Replace hardcoded weekend code**

Delete route logic equivalent to:

```ts
if (day === 0 || day === 6) continue;
```

All calendar decisions come from `WorkCalendarService` or explicit `all_dates` behavior.

- [ ] **Step 9: Run focused tests**

```bash
pnpm exec vitest run test/modules/workforce-management/rotation-calendar.test.ts test/integration/routes/hr-roster.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 10: Commit rotation/calendar/generation**

```bash
git add src/modules/workforce-management/application/rotation-service.ts src/modules/workforce-management/application/work-calendar-service.ts src/modules/workforce-management/infrastructure/d1-work-calendar-repository.ts src/modules/workforce-management/infrastructure/d1-roster-repository.ts src/routes/tenant/hr/roster.ts test/modules/workforce-management/rotation-calendar.test.ts test/integration/routes/hr-roster.test.ts
git commit -m "feat(workforce): add calendar-aware roster generation"
```

---

### Task 9: Make Attendance Punches Replay-Safe and Daily Attendance a Deterministic Projection

**Files:**
- Create: `src/modules/workforce-management/application/attendance-punch-service.ts`
- Create: `src/modules/workforce-management/application/attendance-query-service.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-attendance-repository.ts`
- Modify: `src/routes/tenant/hr/attendance.ts`
- Modify: `src/routes/tenant/hr/biometric.ts`
- Create: `test/modules/workforce-management/attendance-punch-service.test.ts`
- Modify: HR attendance/biometric integration tests

**Interfaces:**
- Consumes: roster, shift, calendar, approved leave, punch source identity.
- Produces: immutable punch facts and versioned daily attendance projection.

- [ ] **Step 1: Write RED cases**

Required cases:

```text
same tenant/source/sourceEventKey and same hash -> replay original punch
same key and different hash -> ATTENDANCE_PUNCH_CONFLICT
cross-tenant staff -> 404
inactive staff -> conflict
night-shift 02:00 punch maps to prior roster business date
approved leave -> leave projection, not absent
configured off-day with no roster -> off_day
active roster overrides configured weekend
in without out -> incomplete, not fabricated worked hours
punch insert and projection update fail together
manual correction without reason -> ATTENDANCE_CORRECTION_REASON_REQUIRED
auto absence selects only expected workers
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/attendance-punch-service.test.ts
```

Expected: attendance services missing.

- [ ] **Step 3: Define punch source event keys**

- Biometric/device: manufacturer event ID when supplied; otherwise deterministic hash of device ID + staff enrollment + occurred time + punch type.
- Manual/web/mobile: caller-generated UUID/idempotency key.
- Do not use row auto-increment ID as retry identity.

- [ ] **Step 4: Implement business-date resolution**

1. convert `occurredAtUtc` using the tenant timezone setting already used by the project;
2. find the most relevant active roster around local date and prior date;
3. use assigned shift and `resolveAttendanceBusinessDate`;
4. fall back to local date only when no roster/shift context exists.

Do not use `new Date().toISOString().slice(0, 10)` as hospital business date.

- [ ] **Step 5: Implement deterministic daily projection**

Projection rules:

```ts
if (approvedLeave) status = 'leave';
else if (!expectedToWork) status = 'off_day';
else if (validPunches.length === 0) status = 'absent';
else if (!lastOut) status = 'incomplete';
else if (firstInAfterGrace) status = 'late';
else status = 'present';
```

`expectedToWork` is true when an active roster exists, or when a configured working-day policy explicitly requires attendance for non-rostered staff under the tenant’s attendance policy. The first implementation must default non-rostered staff to not automatically absent unless the existing tenant policy explicitly says otherwise.

- [ ] **Step 6: Commit raw punch and projection statements together**

Prepare:

```text
insert raw punch
insert/update attendance projection with version guard
complete idempotency/result
write audit evidence for manual corrections
```

Use one D1 batch for the required statements.

- [ ] **Step 7: Replace route orchestration**

`attendance.ts` and `biometric.ts` become transport adapters. Device authentication remains in biometric transport/security code; projection policy moves to the module.

- [ ] **Step 8: Fix auto-absence selection**

Replace “all active staff” selection with a query that returns expected workers after applying active roster, approved leave, holiday, weekend, and tenant attendance-policy filters.

- [ ] **Step 9: Run focused tests**

```bash
pnpm exec vitest run test/modules/workforce-management/attendance-punch-service.test.ts test/integration/routes/hr-new-routes.test.ts test/integration/routes/hr-biometric.test.ts
pnpm exec tsc --noEmit
```

Expected: attendance, manual-punch, summary, and biometric route coverage passes with the new module boundary.

- [ ] **Step 10: Commit attendance integrity**

```bash
git add src/modules/workforce-management/application/attendance-punch-service.ts src/modules/workforce-management/application/attendance-query-service.ts src/modules/workforce-management/infrastructure/d1-attendance-repository.ts src/routes/tenant/hr/attendance.ts src/routes/tenant/hr/biometric.ts test/modules/workforce-management/attendance-punch-service.test.ts test/integration/routes/hr-new-routes.test.ts test/integration/routes/hr-biometric.test.ts
git commit -m "fix(workforce): make attendance projection replay-safe"
```

---

### Task 10: Integrate Leave With Work Calendar, Roster Conflicts, and Attendance Projection

**Files:**
- Create: `src/modules/workforce-management/application/leave-service.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-leave-repository.ts`
- Modify: `src/routes/tenant/hr/leave.ts`
- Create: `test/modules/workforce-management/leave-service.test.ts`
- Modify: leave integration tests

**Interfaces:**
- Consumes: work calendar, roster query, leave balance/request tables, attendance reprojection.
- Produces: working-day leave calculation, approval guard, visible roster conflict result.

- [ ] **Step 1: Write RED cases**

Required cases:

```text
Friday-only configured weekend is excluded from leave working days
optional holiday handling follows explicit tenant policy
raw calendar-day count is not used for balance
insufficient balance -> LEAVE_BALANCE_INSUFFICIENT
cross-tenant staff/category/request -> 404
approved leave overlapping active roster returns conflict metadata
approval does not delete or cancel roster automatically
attendance projection for approved leave becomes leave
rejected/cancelled leave does not affect attendance
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/leave-service.test.ts
```

Expected: leave service missing.

- [ ] **Step 3: Calculate leave working days through WorkCalendarService**

```ts
const days = await calendar.listDays(input.tenantId, input.startDate, input.endDate);
const workingDays = days.filter((day) => day.isWorkingDay).length;
```

The leave request persists the reviewed working-day total, not `differenceInCalendarDays + 1`.

- [ ] **Step 4: Validate balance and tenant ownership**

All staff, leave category, balance, and request queries include tenant ID. Approval uses the stored request period plus current reviewed calendar policy; when policy changed after request, return a visible conflict requiring recalculation rather than silently changing days.

- [ ] **Step 5: Return roster conflict metadata**

Approval result:

```ts
{
  leaveRequestId: number;
  workingDays: number;
  rosterConflicts: Array<{ rosterId: number; rosterDate: string; shiftId: number }>;
  requiresRosterReview: boolean;
}
```

No automatic roster deletion/cancellation is performed.

- [ ] **Step 6: Reproject affected attendance dates**

After approval/rejection/cancellation, prepare deterministic reprojection statements for affected existing attendance rows inside the supported bounded date range.

- [ ] **Step 7: Replace direct route business logic**

The leave route validates transport, calls the application service, maps stable errors, and returns the conflict-aware result.

- [ ] **Step 8: Run focused tests**

```bash
pnpm exec vitest run test/modules/workforce-management/leave-service.test.ts test/integration/routes/hr-new-routes.test.ts test/integration/routes/leave-request-approver.test.ts
pnpm exec tsc --noEmit
```

Expected: leave balance/request/approval and manual attendance interaction coverage passes.

- [ ] **Step 9: Commit leave integration**

```bash
git add src/modules/workforce-management/application/leave-service.ts src/modules/workforce-management/infrastructure/d1-leave-repository.ts src/routes/tenant/hr/leave.ts test/modules/workforce-management/leave-service.test.ts test/integration/routes/hr-new-routes.test.ts test/integration/routes/leave-request-approver.test.ts
git commit -m "fix(workforce): reconcile leave with calendar and roster"
```

---

### Task 11: Isolate Operational Overtime and Publish a Finance-Safe Workforce Input Query

**Files:**
- Create: `src/modules/workforce-management/domain/overtime.ts`
- Create: `src/modules/workforce-management/application/overtime-service.ts`
- Create: `src/modules/workforce-management/application/workforce-payroll-input-query.ts`
- Create: `src/modules/workforce-management/infrastructure/d1-overtime-repository.ts`
- Modify: overtime portions of `src/routes/tenant/hr/roster.ts` or current overtime route file
- Create: `test/modules/workforce-management/overtime-service.test.ts`
- Create: `test/modules/workforce-management/payroll-input-query.test.ts`

**Interfaces:**
- Consumes: roster/attendance/leave facts.
- Produces: approved operational overtime hours and read-only monthly workforce summaries; no money/payroll writes.

- [ ] **Step 1: Write RED overtime boundary tests**

Required cases:

```text
weekday/weekend/holiday/all rule selection
max overtime hours per day cap
approved hours retain multiplier snapshot
cross-tenant approval is rejected
approval records actor/time
workforce service never prepares SQL for hr_payroll_runs, hr_payslips, expenses, accounting_vouchers, cash, or bank tables
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/modules/workforce-management/overtime-service.test.ts test/modules/workforce-management/payroll-input-query.test.ts
```

Expected: services missing.

- [ ] **Step 3: Implement pure overtime-hour calculation**

```ts
export function calculateApprovedOvertimeHours(input: {
  scheduledMinutes: number;
  actualMinutes: number;
  minMinutesBeforeOvertime: number;
  maxOvertimeMinutes: number;
}): number {
  const eligible = Math.max(0, input.actualMinutes - Math.max(input.scheduledMinutes, input.minMinutesBeforeOvertime));
  return Math.min(eligible, input.maxOvertimeMinutes) / 60;
}
```

No currency or salary rate enters this function.

- [ ] **Step 4: Implement approval/rejection service**

Use tenant-scoped log/rule lookup, actor user ID, status transition guard, and immutable audit evidence. Do not calculate an overtime money amount.

- [ ] **Step 5: Implement monthly workforce input query**

Return:

```ts
Array<{
  staffId: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  halfDays: number;
  approvedOvertimeHours: number;
  overtimeMultiplierSnapshots: number[];
}>
```

This query may read attendance, leave, and overtime tables only. It must not write payroll/expense/accounting tables.

- [ ] **Step 6: Remove non-functional UI/API overtime delete behavior**

When no reviewed deactivate/delete endpoint exists, remove the delete action from `DutyRoster.tsx`. Do not add hard deletion in this task. A future rule lifecycle may add `isActive=false` with audit.

- [ ] **Step 7: Run focused tests**

```bash
pnpm exec vitest run test/modules/workforce-management/overtime-service.test.ts test/modules/workforce-management/payroll-input-query.test.ts
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 8: Commit overtime boundary**

```bash
git add src/modules/workforce-management/domain/overtime.ts src/modules/workforce-management/application/overtime-service.ts src/modules/workforce-management/application/workforce-payroll-input-query.ts src/modules/workforce-management/infrastructure/d1-overtime-repository.ts src/routes/tenant/hr/roster.ts web/src/pages/DutyRoster.tsx test/modules/workforce-management/overtime-service.test.ts test/modules/workforce-management/payroll-input-query.test.ts
git commit -m "feat(workforce): isolate operational overtime inputs"
```

---

### Task 12: Add Granular Workforce RBAC and Harden Staff Mutations

**Files:**
- Modify: `src/lib/route-permissions.ts`
- Modify: `src/routes/tenant/hr/index.ts`
- Modify: `src/routes/tenant/staff.ts`
- Modify: `src/routes/tenant/hr/roster.ts`
- Modify: `src/routes/tenant/hr/attendance.ts`
- Modify: `src/routes/tenant/hr/leave.ts`
- Modify: `src/routes/tenant/hr/biometric.ts`
- Create: `test/integration/routes/workforce-rbac.test.ts`
- Modify: permission catalogue/seed files discovered on current main

**Interfaces:**
- Consumes: existing central permission policy and application guards.
- Produces: explicit route rules and self-scope separation.

- [ ] **Step 1: Write RED permission matrix tests**

Required cases:

```text
roster read without roster:read -> 403
roster assignment without roster:write -> 403
swap without roster:swap -> 403
cancel without roster:cancel -> 403
generate without roster:generate -> 403
leave approval without leave:approve -> 403
attendance correction without attendance:correct -> 403
biometric management without biometric:manage -> 403
overtime approval without overtime:approve -> 403
staff self-read does not grant other-staff read
hospital_admin wildcard remains compatible
permission denial occurs before any mutation query
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/integration/routes/workforce-rbac.test.ts
```

Expected: routes are not covered by exact workforce rules.

- [ ] **Step 3: Register permission names**

Use the design catalogue:

```text
workforce:read
workforce:write
workforce:deactivate
roster:read
roster:write
roster:swap
roster:cancel
roster:generate
calendar:read
calendar:write
attendance:read
attendance:write
attendance:correct
leave:read
leave:request
leave:approve
biometric:read
biometric:manage
overtime:read
overtime:write
overtime:approve
```

Add them through the project’s existing permission catalogue/seed mechanism. Do not create a parallel permission table.

- [ ] **Step 4: Add central route permission mappings**

Map exact methods/paths. Examples:

```ts
{ method: 'GET', pattern: /^\/api\/hr\/roster(?:\/|$)/, permission: 'roster:read' }
{ method: 'POST', pattern: /^\/api\/hr\/roster$/, permission: 'roster:write' }
{ method: 'PUT', pattern: /^\/api\/hr\/roster\/\d+\/swap$/, permission: 'roster:swap' }
{ method: 'DELETE', pattern: /^\/api\/hr\/roster\/\d+$/, permission: 'roster:cancel' }
{ method: 'POST', pattern: /^\/api\/hr\/roster\/generate$/, permission: 'roster:generate' }
```

Order specific routes before broad route patterns if the current matcher is first-match.

- [ ] **Step 5: Add application-layer mutation guards**

Mutation-sensitive services receive an already-resolved actor permission set or a small `WorkforceAuthorization` port. They do not trust UI visibility as authorization.

- [ ] **Step 6: Harden staff create/update/deactivate**

Staff mutation requirements:

```text
tenant-owned user link only
active/inactive status explicit
no automatic practitioner creation
staff invitation/account operation delegated to identity-access flow
audit actor preserved
cross-tenant ID returns 404/403
```

Keep route URLs and compatible UI responses.

- [ ] **Step 7: Run RBAC and staff route tests**

```bash
pnpm exec vitest run test/integration/routes/workforce-rbac.test.ts test/integration/routes/staff.test.ts test/integration/routes/hr-roster.test.ts
pnpm exec tsc --noEmit
```

Use exact staff route test filenames after repository discovery.

- [ ] **Step 8: Commit RBAC/staff hardening**

```bash
git add packages/shared/src/authz.ts src/lib/route-permissions.ts src/routes/tenant/hr/index.ts src/routes/tenant/staff.ts src/routes/tenant/hr/roster.ts src/routes/tenant/hr/attendance.ts src/routes/tenant/hr/leave.ts src/routes/tenant/hr/biometric.ts test/integration/routes/workforce-rbac.test.ts test/integration/routes/staff-access-unification-routes.test.ts test/integration/routes/staff-extended-fields.test.ts test/integration/routes/staff-invitation.test.ts
git commit -m "fix(workforce): enforce granular HR permissions"
```

Before committing, review the shared authorization diff and confirm no unrelated role defaults or critical-permission semantics changed.

---

### Task 13: Complete Duty Roster and Staff UI Interaction Hardening

**Files:**
- Modify: `web/src/pages/DutyRoster.tsx`
- Modify: `web/src/pages/DutyRoster.test.ts`
- Modify: `web/src/pages/StaffPage.tsx`
- Create or modify: `web/src/pages/StaffPage.test.tsx`
- Modify: `web/e2e/hr-module.spec.ts`

**Interfaces:**
- Consumes: stable DTOs and error/result contracts.
- Produces: usable UI with exact mutation bodies, pending/error/count feedback, and no dead actions.

- [ ] **Step 1: Add RED UI behavior tests**

Required cases:

```text
assignment sends camelCase body and disables submit while pending
swap requires non-empty reason
cancel requires non-empty reason
generation displays created/unchanged/skippedOffDays
bulk displays created/updated/skipped
backend 409 displays stable safe error message
cancelled assignment renders distinct state
rotation off-day renders without shift ID
holiday/weekend indicators do not block manual assignment
overtime delete action is absent
StaffPage does not imply staff creation creates practitioner identity
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter web exec vitest run src/pages/DutyRoster.test.ts src/pages/StaffPage.test.tsx
```

Expected: missing interaction states fail.

- [ ] **Step 3: Define typed frontend DTOs**

Replace touched `any` types with explicit types matching transport DTOs. Keep the type definitions in the page’s existing local pattern unless the web app already has a shared API types directory after main sync.

- [ ] **Step 4: Add reason dialogs for swap/cancel**

The mutation is disabled until trimmed reason length is at least 3. Include idempotency keys derived from stable roster/staff/date inputs.

- [ ] **Step 5: Show mutation outcome counts**

Use existing toast/alert patterns:

```ts
showSuccess(`Roster generated: ${result.created} created, ${result.unchanged} unchanged, ${result.skippedOffDays} off-days skipped`);
```

- [ ] **Step 6: Show safe backend errors**

Read the project API error shape and display only safe message/code. Do not render SQL/database internals.

- [ ] **Step 7: Strengthen E2E route mocks**

Every mutation mock validates exact body shape and returns response DTOs matching backend camelCase. Add one rejected cross-contract case proving snake_case would fail.

- [ ] **Step 8: Run web unit and E2E tests**

```bash
pnpm --filter web exec vitest run src/pages/DutyRoster.test.ts src/pages/StaffPage.test.tsx
pnpm --filter web exec playwright test e2e/hr-module.spec.ts
pnpm --filter web build
```

Expected: pass.

- [ ] **Step 9: Commit UI hardening**

```bash
git add web/src/pages/DutyRoster.tsx web/src/pages/DutyRoster.test.ts web/src/pages/StaffPage.tsx web/src/pages/StaffPage.test.tsx web/e2e/hr-module.spec.ts
git commit -m "fix(web): complete workforce roster interactions"
```

---

### Task 14: Run Full Verification, Update Evidence, and Prepare a Clean Integration Handoff

**Files:**
- Modify: `docs/architecture/workforce-management-program-task-board.yaml`
- Modify: `docs/architecture/workforce-management-continuation-prompt.md`
- Create: `docs/reports/2026-07-26-workforce-management-implementation-verification.md`
- Modify only when required by current main governance: canonical/module registries and contract tests

**Interfaces:**
- Consumes: every implementation checkpoint.
- Produces: reproducible verification evidence, exact commit list, remaining blockers, clean handoff.

- [ ] **Step 1: Run focused backend tests**

```bash
pnpm exec vitest run test/unit/workforce-duty-roster-contract.test.ts test/modules/workforce-management test/integration/routes/hr-roster.test.ts test/integration/routes/workforce-rbac.test.ts
```

Add exact discovered attendance, biometric, leave, and staff route test paths to the command. Expected: all pass.

- [ ] **Step 2: Run web verification**

```bash
pnpm --filter web exec vitest run src/pages/DutyRoster.test.ts src/pages/StaffPage.test.tsx
pnpm --filter web exec playwright test e2e/hr-module.spec.ts
pnpm --filter web build
```

Expected: pass.

- [ ] **Step 3: Run broad backend gates**

```bash
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm build:web
pnpm worktree:check -- --mode=task --allow-dirty
```

Expected: pass.

- [ ] **Step 4: Run current modular/canonical governance when present**

When current main exposes these commands, run:

```bash
pnpm canonical:check
pnpm canonical:authority-check
pnpm canonical:access-check
```

Also run the current modular boundary checker command listed in the integrated modular docs/package scripts. If a command is absent on current main, record `not available on reviewed main` rather than inventing a replacement.

- [ ] **Step 5: Review all changed files**

```bash
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- src/modules/workforce-management src/routes/tenant/hr src/routes/tenant/staff.ts src/schemas/hr.ts src/lib/route-permissions.ts web/src/pages/DutyRoster.tsx web/src/pages/StaffPage.tsx migrations/0551_workforce_roster_integrity.sql
```

Expected: only task-owned files; no payroll/accounting/production mutations.

- [ ] **Step 6: Write verification report**

Record:

```text
branch and worktree
base/main commit
all task commit IDs
migration number and manifest result
focused test files/test counts
web test/E2E/build results
TypeScript result
canonical/module governance results
production mutation: no
provider activation: no
legacy retirement: no
push/integration: no unless separately authorised
remaining risks and exact next action
```

- [ ] **Step 7: Update task board and continuation prompt**

Mark each task `verified`, `blocked`, or `not_started`; include exact commit, tests, and next command. Do not mark production observation or legacy retirement complete.

- [ ] **Step 8: Commit verification metadata**

```bash
git add docs/reports/2026-07-26-workforce-management-implementation-verification.md docs/architecture/workforce-management-program-task-board.yaml docs/architecture/workforce-management-continuation-prompt.md
git commit -m "docs(workforce): record implementation verification"
```

- [ ] **Step 9: Prove the worktree is clean**

```bash
pnpm worktree:check -- --mode=task
git status --short
```

Expected: `WORKTREE_POLICY_OK` and no changed files.

- [ ] **Step 10: Stop before integration unless explicitly requested**

The final handoff must state:

```text
implementation branch ready for review
production mutation not performed
canonical provider not enabled
legacy writes not retired
payroll finance untouched
push/main integration not performed unless separately authorised
```

---

## Acceptance Matrix

| Requirement | Owning task | Proof |
|---|---:|---|
| Seven broken UI request contracts fixed | 1–2 | backend schema + web interaction tests |
| Stable camelCase responses | 2 | route contract tests |
| Dedicated workforce module | 3–4 | public-contract and repository tests |
| Optional exact practitioner link | 4 | tenant/link repository tests |
| Additive schema only | 5 | migration safety test |
| Mutation replay/conflict | 6 | idempotency tests |
| Tenant/active roster validation | 7 | roster service tests |
| True two-way swap | 7 | atomic failure/success tests |
| Cancel/reactivate semantics | 7 | lifecycle tests/events |
| No hardcoded weekend | 8 | calendar/bulk tests |
| Active rotation filters | 8 | rotation tests |
| Retry-safe generation | 8 | second-pass zero-new-row test |
| Punch deduplication | 9 | punch replay/conflict tests |
| Night-shift business date | 9 | domain/application tests |
| Absence only for expected workers | 9 | projection tests |
| Leave working-day calculation | 10 | leave/calendar tests |
| Visible leave/roster conflict | 10 | approval result test |
| Overtime money excluded | 11 | SQL-boundary/source test |
| Finance-safe monthly input contract | 11 | payroll-input query tests |
| Granular RBAC | 12 | permission-before-mutation tests |
| UI reason/pending/error/count states | 13 | web unit/E2E tests |
| No payroll runtime changes | all | final diff review |
| Reproducible verification/handoff | 14 | report + clean worktree |

## Explicit Deferred Work

The following remains outside this plan:

1. canonical workforce-member/roster/attendance authority design;
2. workforce legacy/shadow/canonical provider modes;
3. production migration/backfill/cutover/observation;
4. legacy `staff` and `hr_*` retirement;
5. payroll calculation/payable/payment/accounting lifecycle;
6. monetary overtime computation and payroll posting;
7. destructive simplification of legacy roster status or rotation-day schema;
8. multi-shift-per-staff-per-business-date support;
9. durable large-batch roster job beyond the initial 500-mutation limit.

Each deferred item requires its own reviewed specification and authorization boundary.
