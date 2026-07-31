# Workforce Management and Duty Roster Design

**Date:** 2026-07-26
**Status:** approved design baseline for documentation-first execution
**Task branch:** `task/workforce-roster-planning-20260726`
**Base:** local reviewed `main` at `a98cb0152`
**Audit:** `docs/reports/2026-07-26-workforce-duty-roster-canonical-readiness-audit.md`
**Canonical evidence snapshot:** `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION-VERIFIED` on `program/cdb-main-continuous-20260725`
**Modular evidence snapshot:** `task/mm-continuous-remaining-program`
**Production mutation:** prohibited
**Canonical provider activation:** prohibited
**Legacy retirement:** prohibited

## 1. Purpose

This design turns the existing Staff Management, Duty Roster, Shift Rotation, Work Calendar, Attendance, Leave, Biometric Punch, and operational Overtime code into one coherent workforce module that can be used safely before complete canonical-data cutover.

The design solves two problems simultaneously:

1. make the existing feature usable and correct now;
2. prevent route/UI/business logic from depending permanently on legacy `staff` and `hr_*` tables.

The design does **not** create canonical workforce tables. It creates a stable module boundary over current operational authority and preserves an explicit replacement point for a future canonical workforce provider.

## 2. Goals

1. Repair all current Duty Roster frontend/backend contract mismatches.
2. Establish a dedicated `workforce-management` modular boundary.
3. Keep all workforce reads and writes tenant-scoped and permissioned.
4. Make roster assignment, cancellation, reactivation, swap, bulk assignment, and rotation generation deterministic and retry-safe.
5. Use tenant work-calendar policy rather than hardcoded weekends.
6. Treat raw attendance punches as immutable events and daily attendance as a projection.
7. Reconcile roster, approved leave, holidays, attendance, and operational overtime.
8. Keep practitioner identity optional and explicitly linked.
9. Keep payroll financial lifecycle outside this module.
10. Preserve existing HTTP route URLs while stabilising request and response DTOs.
11. Add enough characterization, domain, repository, route, permission, and UI tests to make future refactoring safe.
12. Allow future replacement of the legacy workforce provider without rewriting consumers.

## 3. Non-goals

This design does not:

- create `canonical_workforce_members` or any other new canonical workforce authority;
- enable the canonical practitioner provider;
- integrate unmerged CDB files into `main`;
- retire `staff` or existing `hr_*` tables;
- change payroll calculation, payable, payment, expense, custody, or accounting semantics;
- convert existing payroll money storage;
- deploy, push, apply production migrations, run production backfills, or change feature flags;
- support multiple independent shifts for one staff member on one business date in the first release;
- silently infer practitioner identity from name, role, phone, email, department, position, or numeric ID coincidence.

## 4. Governing architecture decisions

### 4.1 Module ownership

The target module boundaries are:

```text
identity-access
├── authentication
├── sessions
├── users
├── roles and permissions
├── invitations and account lifecycle
└── user-to-workforce account relationship

workforce-management
├── staff operational profile
├── department, position and employment status
├── shifts
├── duty roster
├── rotation patterns and assignments
├── holidays and work-calendar policy
├── attendance punches and projection
├── leave entitlement, request and approval
└── operational overtime hours and approval

canonical practitioner identity
├── practitioner person identity
├── identifiers
├── specialties and practitioner departments
├── user link
└── optional employee link

finance-accounting
├── payroll calculation lifecycle
├── payable recognition
├── payroll adjustments
├── settlement and actual payment
├── salary expense
├── cash/bank custody
└── accounting posting
```

### 4.2 One authority per fact

During this phase:

- `staff` remains the operational employee/profile authority;
- `hr_duty_roster` remains current duty-assignment authority;
- `hr_attendance_punches` becomes raw punch-event authority;
- `hr_attendance` is treated as a rebuildable daily projection;
- leave, calendar, shift, rotation, holiday, and overtime tables remain operational authorities inside `workforce-management`;
- canonical practitioner tables remain practitioner identity authority where available;
- payroll tables remain finance-owned legacy authority until canonical payroll work is approved.

A new immutable roster event table may be added as lifecycle history. It does not compete with the current roster row; it records how current state changed.

### 4.3 Practitioner relationship

A workforce member may have:

```ts
practitionerPublicId: string | null
```

The value is returned only when an active exact canonical practitioner employee link exists. Absence is normal for non-clinical employees.

The module must never:

- create a practitioner identity;
- infer a practitioner link;
- require a practitioner for ordinary staff operations;
- use practitioner specialty/department as employee identity.

When CDB-113C reaches `main`, a dedicated adapter may use its provider/commands. Until then, the workforce module uses a local optional lookup against already-present canonical link tables or returns `null` when the schema is unavailable in a test fixture.

## 5. Target file structure

```text
src/modules/workforce-management/
├── domain/
│   ├── workforce-member.ts
│   ├── roster.ts
│   ├── rotation.ts
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
│   ├── practitioner-link-adapter.ts
│   └── workforce-transaction-adapter.ts
├── transport/
│   ├── dto.ts
│   └── mappers.ts
└── index.ts
```

Existing routes remain under `src/routes/tenant/` and become thin transport adapters. Existing UI pages remain in place and consume the stable DTOs.

## 6. Public module contracts

### 6.1 Core types

```ts
export type WorkforceMemberStatus = 'active' | 'inactive';

export type WorkforceMemberRef = {
  tenantId: string;
  staffId: number;
  displayName: string;
  position: string;
  department: string | null;
  status: WorkforceMemberStatus;
  userId: number | null;
  practitionerPublicId: string | null;
};

export type ShiftDefinition = {
  tenantId: string;
  shiftId: number;
  name: string;
  shortCode: string | null;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  isNightShift: boolean;
  color: string | null;
  isActive: boolean;
};

export type RosterAssignment = {
  rosterId: number;
  tenantId: string;
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
```

`status='swapped'` remains a compatibility value because the current schema allows it. New business logic treats swap as an event and keeps both resulting assignments active. A later reviewed migration may simplify current-state vocabulary after compatibility consumers are inventoried.

### 6.2 Workforce directory

```ts
export interface WorkforceDirectory {
  getMember(tenantId: string, staffId: number): Promise<WorkforceMemberRef | null>;
  getActiveMember(tenantId: string, staffId: number): Promise<WorkforceMemberRef | null>;
  listActiveMembers(tenantId: string): Promise<WorkforceMemberRef[]>;
}
```

### 6.3 Roster commands and queries

```ts
export type AssignRosterInput = {
  tenantId: string;
  actorUserId: string;
  staffId: number;
  shiftId: number;
  rosterDate: string;
  remarks?: string;
  idempotencyKey: string;
};

export type BulkAssignRosterInput = {
  tenantId: string;
  actorUserId: string;
  assignments: Array<{ staffId: number; shiftId: number }>;
  startDate: string;
  endDate: string;
  dateMode: 'all_dates' | 'configured_working_days';
  idempotencyKey: string;
};

export type SwapRosterInput = {
  tenantId: string;
  actorUserId: string;
  rosterId: number;
  swapWithStaffId: number;
  reason: string;
  idempotencyKey: string;
};

export type CancelRosterInput = {
  tenantId: string;
  actorUserId: string;
  rosterId: number;
  reason: string;
  idempotencyKey: string;
};

export type GenerateRosterInput = {
  tenantId: string;
  actorUserId: string;
  startDate: string;
  endDate: string;
  replaceExisting: false;
  idempotencyKey: string;
};

export interface RosterCommands {
  assign(input: AssignRosterInput): Promise<RosterAssignment>;
  bulkAssign(input: BulkAssignRosterInput): Promise<{ created: number; updated: number; skipped: number }>;
  swap(input: SwapRosterInput): Promise<{ first: RosterAssignment; second: RosterAssignment }>;
  cancel(input: CancelRosterInput): Promise<RosterAssignment>;
  generate(input: GenerateRosterInput): Promise<{ created: number; unchanged: number; skippedOffDays: number }>;
}

export interface RosterQueries {
  list(input: {
    tenantId: string;
    from: string;
    to: string;
    staffId?: number;
    shiftId?: number;
    department?: string;
  }): Promise<RosterAssignment[]>;
}
```

### 6.4 Rotation contracts

```ts
export type RotationDay = {
  dayNumber: number;
  shiftId: number | null;
  shiftName: string | null;
  isOff: boolean;
};

export type RotationPattern = {
  patternId: number;
  tenantId: string;
  patternName: string;
  cycleDays: number;
  isActive: boolean;
  days: RotationDay[];
};

export type CreateRotationInput = {
  tenantId: string;
  actorUserId: string;
  patternName: string;
  cycleDays: number;
  days: Array<{ dayNumber: number; shiftId: number | null; isOff: boolean }>;
  idempotencyKey: string;
};

export type AssignRotationInput = {
  tenantId: string;
  actorUserId: string;
  staffId: number;
  patternId: number;
  startDate: string;
  endDate?: string;
  cycleOffset: number;
  idempotencyKey: string;
};
```

Off-days are represented by a missing row in legacy `hr_rotation_pattern_days`. `cycle_days` defines the complete cycle. The provider fills missing day numbers as `{ isOff: true, shiftId: null }`. This avoids fabricating a shift ID and avoids a destructive migration of the existing non-null column.

### 6.5 Work calendar

```ts
export type WorkCalendarDay = {
  date: string;
  dayOfWeek: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
  isConfiguredWeekend: boolean;
  holiday: null | {
    holidayId: number;
    name: string;
    type: 'public' | 'optional' | 'restricted';
  };
  isWorkingDay: boolean;
};

export interface WorkCalendarService {
  getDay(tenantId: string, date: string): Promise<WorkCalendarDay>;
  listDays(tenantId: string, from: string, to: string): Promise<WorkCalendarDay[]>;
  countWorkingDays(tenantId: string, from: string, to: string): Promise<number>;
}
```

Roster operations default to `all_dates`; hospitals may schedule seven days. Leave and automatic absence use configured working-day semantics. Rotation generation follows the rotation pattern, not a hardcoded weekend rule.

### 6.6 Attendance contracts

```ts
export type AttendancePunchSource = 'biometric' | 'rfid' | 'manual' | 'web' | 'mobile' | 'device';
export type AttendancePunchType = 'in' | 'out' | 'break_start' | 'break_end';

export type RecordAttendancePunchInput = {
  tenantId: string;
  actor: { type: 'user'; userId: string } | { type: 'device'; deviceId: number; deviceSerial: string };
  staffId: number;
  occurredAtUtc: string;
  punchType: AttendancePunchType;
  source: AttendancePunchSource;
  sourceEventKey: string;
  remarks?: string;
  rawPayloadHash?: string;
};

export type AttendanceDay = {
  tenantId: string;
  staffId: number;
  businessDate: string;
  rosterId: number | null;
  shiftId: number | null;
  firstInTime: string | null;
  lastOutTime: string | null;
  workedMinutes: number;
  status: 'present' | 'absent' | 'late' | 'leave' | 'half_day' | 'off_day' | 'incomplete';
  projectionVersion: number;
};

export interface AttendancePunchService {
  record(input: RecordAttendancePunchInput): Promise<{
    replayed: boolean;
    punchId: number;
    attendance: AttendanceDay;
  }>;
}
```

Business date is derived from tenant timezone and assigned shift. For an overnight shift, punches after midnight may belong to the prior roster date when they fall inside the configured shift window.

### 6.7 Leave and overtime outputs

```ts
export type ApprovedLeaveRange = {
  leaveRequestId: number;
  staffId: number;
  startDate: string;
  endDate: string;
  workingDays: number;
  status: 'approved';
};

export type ApprovedOvertime = {
  overtimeLogId: number;
  staffId: number;
  businessDate: string;
  approvedHours: number;
  multiplierSnapshot: number;
  status: 'approved';
};

export interface WorkforcePayrollInputQuery {
  getMonthlyInputs(input: { tenantId: string; runMonth: string }): Promise<Array<{
    staffId: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    halfDays: number;
    approvedOvertimeHours: number;
    overtimeMultiplierSnapshots: number[];
  }>>;
}
```

This query exposes operational facts. It does not calculate money, create a payable, create an expense, mark a payslip paid, or post accounting.

## 7. Stable HTTP DTO contract

Existing URLs are preserved. JSON payloads and responses use camelCase.

### 7.1 Roster

```text
GET    /api/hr/roster
POST   /api/hr/roster
POST   /api/hr/roster/bulk
PUT    /api/hr/roster/:id/swap
DELETE /api/hr/roster/:id
POST   /api/hr/roster/generate
```

Assign request:

```json
{
  "staffId": 21,
  "shiftId": 3,
  "rosterDate": "2026-07-27",
  "remarks": "ICU coverage",
  "idempotencyKey": "roster:assign:21:2026-07-27:3"
}
```

Swap request:

```json
{
  "swapWithStaffId": 22,
  "reason": "Approved shift exchange",
  "idempotencyKey": "roster:swap:501:22:2026-07-27"
}
```

Roster response:

```json
{
  "data": {
    "rosterId": 501,
    "staffId": 21,
    "staffName": "Nurse Fatima",
    "position": "Nurse",
    "department": "ICU",
    "shiftId": 3,
    "shiftName": "Night",
    "shiftShortCode": "N",
    "shiftStartTime": "22:00",
    "shiftEndTime": "06:00",
    "shiftColor": "#6366F1",
    "rosterDate": "2026-07-27",
    "status": "scheduled",
    "swappedWithStaffId": null,
    "remarks": "ICU coverage",
    "version": 1
  }
}
```

### 7.2 Rotation

```text
POST /api/hr/roster/rotation
GET  /api/hr/roster/rotations
POST /api/hr/roster/rotation/assign
```

Rotation list returns nested `days` for every day from 1 through `cycleDays`, including filled off-days.

### 7.3 Holiday and overtime

Holiday DTO uses:

```ts
{
  holidayId: number;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
  isActive: boolean;
}
```

Overtime rule DTO uses:

```ts
{
  ruleId: number;
  ruleName: string;
  multiplier: number;
  minHoursBeforeOvertime: number;
  maxOvertimeHoursPerDay: number;
  appliesOn: 'weekday' | 'weekend' | 'holiday' | 'all';
  isActive: boolean;
}
```

The UI must not use plural enum values.

## 8. Roster business rules

1. One current roster row exists per tenant, staff, and business date.
2. Assigning an absent row creates it.
3. Assigning the same active shift again is an idempotent replay.
4. Assigning a different shift updates the current row and records a `reassigned` event.
5. Assigning a cancelled row reactivates it and records a `reactivated` event.
6. Staff and shift must both be active and belong to the tenant.
7. Date ranges are inclusive and must satisfy `endDate >= startDate`.
8. Bulk assignment validates all referenced staff and shifts before committing.
9. `all_dates` assigns every date in the range.
10. `configured_working_days` uses work-calendar policy and reports skipped dates.
11. A swap requires two distinct active staff members with active roster rows on the same date.
12. A swap atomically exchanges both shift IDs.
13. A swap records reciprocal staff references and one correlation/idempotency key.
14. Cancellation is a state change with actor and reason; it is not hard deletion.
15. Rotation generation uses active staff-rotation and active pattern rows only.
16. Rotation generation is rerunnable and does not replace manual assignments.
17. A missing rotation step is an off-day.
18. Existing assignments are reported as unchanged unless an explicit separately designed replace workflow is approved.
19. All mutation counts describe committed outcomes, not attempted statements.
20. Required current-state, event, idempotency, and audit statements commit atomically.

## 9. Roster lifecycle evidence

Additive schema may introduce:

```text
hr_roster_events
workforce_mutation_idempotency
```

`hr_roster_events` fields:

- `id`;
- `tenant_id`;
- `event_public_id`;
- `roster_id`;
- `staff_id`;
- `roster_date`;
- `event_type`;
- `from_shift_id`;
- `to_shift_id`;
- `related_staff_id`;
- `reason`;
- `actor_user_id`;
- `idempotency_key`;
- `request_hash`;
- `occurred_at_utc`.

Allowed event types:

```text
assigned
reassigned
reactivated
swapped
cancelled
generated
```

The current row remains authority. Events are immutable evidence and support audit, troubleshooting, and future backfill/reconciliation.

## 10. Attendance and leave rules

### 10.1 Raw punch authority

1. Every device or manual punch has a stable `sourceEventKey`.
2. Unique identity is tenant + source + source-event key.
3. Exact replay returns the original result.
4. Reuse with a different request hash is a conflict.
5. Raw event and daily projection update are coordinated through one application operation.
6. Raw payload is not logged; only an approved hash and safe metadata are retained.
7. Manual correction requires actor and reason.

### 10.2 Daily attendance projection

1. Projection is derived from valid raw punches, roster, shift, work calendar, and approved leave.
2. No-punch does not automatically mean absent.
3. Automatic absence applies only to a staff member expected to work.
4. Approved leave produces `leave`, not `absent`.
5. Configured off-day produces `off_day` unless an active roster overrides it.
6. Missing check-out produces `incomplete`, not fabricated hours.
7. Late status uses the assigned shift start, grace period, business timezone, and actual first-in time.
8. Night shift calculations use shift intervals crossing midnight.
9. Reprojection is deterministic and versioned.

### 10.3 Leave

1. Requested date range uses tenant calendar policy to calculate working days.
2. Balance validation uses working days, not raw calendar-day count.
3. Approval is tenant-scoped, permissioned, and audit-recorded.
4. Approved leave overlapping an active roster produces a visible conflict requiring an explicit roster decision; approval does not silently delete roster history.
5. Attendance projection reads approved leave.
6. Payroll consumes approved paid/unpaid leave summaries through the workforce query contract.

## 11. Overtime boundary

Workforce owns:

- scheduled and actual hours;
- overtime-hour calculation policy;
- rule selection;
- multiplier snapshot;
- approval/rejection;
- actor, date, reason, and audit evidence.

Finance owns:

- money rate;
- overtime amount;
- payable recognition;
- payroll adjustment;
- payment;
- expense and accounting posting.

No workforce command writes payroll, expense, cash, bank, or accounting tables.

## 12. Permissions

Required permission catalogue:

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

Payroll permissions remain finance-owned and are not changed by this design.

Hospital admin and super admin wildcard behavior remains compatible. Ordinary staff may read their own roster, attendance, and leave through a self-scope policy. Self-scope does not grant management of another employee.

Every route is covered by both:

- central route permission mapping;
- application-layer tenant/permission guard for mutation-sensitive use cases.

## 13. Error contract

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
  | 'LEAVE_BALANCE_INSUFFICIENT'
  | 'ATTENDANCE_PUNCH_CONFLICT'
  | 'ATTENDANCE_CORRECTION_REASON_REQUIRED'
  | 'WORKFORCE_PERMISSION_DENIED';
```

Errors include:

- stable code;
- safe message;
- HTTP status mapping;
- retryable boolean;
- optional non-sensitive details.

Raw SQL errors are not returned to clients.

## 14. Transaction and idempotency requirements

1. Mutation inputs carry an idempotency key.
2. Stable canonical JSON or equivalent deterministic request hashing is used.
3. Same key and same hash returns the original committed result.
4. Same key and different hash returns `409`.
5. Staff, shift, roster, rotation, and calendar references are resolved before commit.
6. Current-state rows, lifecycle events, audit evidence, and idempotency completion commit together.
7. No success response is returned after partial required effects.
8. D1 statement limits are handled through bounded operations. A multi-chunk request must persist a visible operation state rather than claiming atomicity that D1 cannot provide.
9. The first implementation limits bulk/generate request size so one operation fits the reviewed transaction boundary. Larger requests return a safe limit error and may be introduced later through a durable job design.

Initial bounded limits:

```text
maximum date range: 62 inclusive days
maximum staff assignments in one bulk request: 50
maximum generated roster mutations in one request: 500
```

These limits keep the first release deterministic and reviewable.

## 15. Schema evolution

Only additive migrations are allowed in this task.

Potential additions:

- roster `version` and `updated_by` columns;
- immutable roster events;
- workforce mutation idempotency table;
- attendance punch source-event key and request hash;
- attendance projection version/business-date fields;
- supporting tenant-scoped indexes.

Historical migration files are never edited. Existing tables and columns remain available. No table is dropped, renamed, truncated, or destructively rebuilt.

Rotation off-days are handled without schema replacement by omitting legacy work-step rows and reconstructing missing days in the provider.

## 16. Provider replacement design

The infrastructure boundary is selected by composition:

```ts
export type WorkforceProviderMode = 'legacy';
```

This branch implements only `legacy`. The public contracts do not expose raw table rows, so a future canonical program may add:

```ts
export type WorkforceProviderMode = 'legacy' | 'shadow' | 'canonical';
```

Future rules:

- legacy returns current provider results;
- shadow returns legacy and compares canonical keys/statuses/counts;
- canonical returns canonical workforce authority;
- critical missing mapping fails closed;
- no hidden canonical-to-legacy fallback;
- cutover requires authority matrix registration, access registry, backfill, reconciliation, zero unexplained variance, rollback evidence, observation, and fresh authorization.

## 17. UI design behavior

The existing `DutyRoster` page remains the user surface but must:

1. use typed camelCase request DTOs;
2. consume one stable response shape;
3. show backend error messages safely;
4. disable mutation buttons while pending;
5. display created/updated/skipped counts for bulk/generation;
6. show cancelled assignments distinctly or omit them through an explicit query option;
7. require a reason for swap and cancellation;
8. remove or implement non-functional delete actions;
9. preserve seven-day hospital scheduling;
10. show configured weekend/holiday indicators without preventing manual roster assignment;
11. test actual request bodies and rendered responses;
12. avoid `any` for staff optional fields in touched code.

`StaffPage` remains the operational profile surface. Login invitation remains an identity-access action invoked through its own API; staff profile creation does not automatically create practitioner identity.

## 18. Testing strategy

### 18.1 Characterization

- exact UI request body tests;
- exact route response DTO tests;
- existing route URL compatibility;
- staff/shift/roster legacy fixture behavior.

### 18.2 Domain tests

- date range and cycle calculations;
- work-calendar week patterns;
- night-shift business date;
- true two-way swap;
- cancellation/reactivation;
- rotation off-days;
- absence eligibility;
- leave working-day count;
- overtime-hour boundary.

### 18.3 Application tests

- tenant ownership;
- permission guard;
- idempotent replay/conflict;
- stale/current version;
- rollback on required statement failure;
- bounded bulk/generate limits.

### 18.4 Repository integration

- current roster upsert;
- immutable event insert;
- active rotation filters;
- nested rotation read mapping;
- punch deduplication;
- attendance reprojection;
- approved leave lookup;
- optional practitioner link.

### 18.5 Route and UI integration

- all seven previously broken Duty Roster mutations;
- response rendering;
- error rendering;
- permission 403 before mutation;
- cross-tenant 404/403;
- query invalidation;
- E2E mock body assertions.

### 18.6 Regression

- HR roster, attendance, leave, biometric, and payroll route suites;
- staff route suites;
- central permission suites;
- TypeScript;
- web build;
- backend build;
- modular checks when present on current `main`;
- canonical governance checks if touched files become governed after branch sync.

## 19. Implementation waves

### Wave 0 — Documentation and synchronization

- commit audit, design, plan, task board, and continuation prompt;
- sync with latest reviewed local `main` before code;
- re-read CDB practitioner and canonical-finance states;
- ensure no active branch owns the same source files.

### Wave 1 — Contract repair

- add failing contract tests;
- align UI requests to backend schemas;
- return stable camelCase response DTOs;
- return nested rotation days;
- remove enum mismatches.

### Wave 2 — Workforce module foundation

- add public types/errors/ports;
- add legacy staff and shift adapters;
- move routes to thin module calls;
- keep route URLs stable.

### Wave 3 — Roster lifecycle

- add idempotency and events;
- fix assignment/reactivation;
- fix atomic two-way swap;
- make generation rerunnable;
- apply bounded request limits.

### Wave 4 — Calendar, leave, and attendance

- centralise calendar policy;
- remove hardcoded weekend logic;
- calculate leave working days;
- project absence only for expected workers;
- support night-shift business date.

### Wave 5 — Biometric and overtime

- add punch source-event idempotency;
- coordinate punch and projection;
- require correction reasons;
- keep overtime monetary effects outside workforce.

### Wave 6 — RBAC, audit, UI, and evidence

- register explicit permissions;
- test off/shadow/enforce central modes as applicable;
- add UI interaction tests;
- run complete verification;
- review and commit task-owned changes.

### Wave 7 — Separate finance handoff

- produce a payroll input contract and audit evidence;
- do not modify payroll runtime on this branch;
- hand payroll lifecycle work to the canonical-finance program after its reviewed checkpoint is on `main`.

## 20. Rollback and compatibility

Local/runtime rollback before any production release consists of reverting module composition to existing route internals while retaining additive tables. No data is deleted.

A later production release must define:

- exact tenant/candidate scope;
- migration and build IDs;
- smoke workflows;
- error and parity thresholds;
- observation owner;
- rollback owner;
- rollback command;
- additive-table compatibility behavior.

This design does not authorise that release.

## 21. Stop conditions

Stop before implementation or integration when:

- the task worktree contains unknown changes;
- local `main` has advanced and the branch has not been reviewed against it;
- canonical practitioner or canonical-finance changes overlap task files without an explicit merge decision;
- the modular registry has been integrated and is not updated for workforce ownership;
- implementation requires a second practitioner or payroll authority;
- implementation requires destructive schema changes;
- a required multi-chunk mutation cannot be made visibly recoverable;
- production, protected data, secret, deploy, migration application, backfill, feature flag, push, or legacy retirement would be required.

## 22. Final decisions

1. Work proceeds now; complete canonical cutover is not a prerequisite.
2. A dedicated `workforce-management` module owns workforce operations.
3. `identity-access` owns accounts and authorization, not roster/attendance/leave.
4. `finance-accounting` owns payroll financial lifecycle.
5. Existing workforce tables remain operational authority behind a module adapter.
6. No canonical workforce tables are created in this task.
7. Practitioner linkage is optional, exact, and never inferred.
8. API DTOs use camelCase and stable response mappers.
9. Roster operations are idempotent, tenant-scoped, auditable, and bounded.
10. Work-calendar policy is explicit; weekends are not hardcoded.
11. Raw punches are immutable events; attendance is a projection.
12. Payroll consumes workforce summaries through a public read contract and remains a separate implementation program.
