# Workforce, Staff Management, and Duty Roster Canonical-Readiness Audit

**Date:** 2026-07-26
**Task branch:** `task/workforce-roster-planning-20260726`
**Task worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/workforce-roster-planning-20260726`
**Task base:** local reviewed `main` at `a98cb0152`
**Execution posture:** documentation and local read-only verification only
**Source implementation changed:** no
**Production mutation authorised:** no
**Canonical provider activation authorised:** no
**Legacy retirement authorised:** no

## 1. Purpose

This audit determines whether Staff Management, Duty Roster, Shift Rotation, Attendance, Leave, Holiday, Biometric Punch, and operational Overtime can be reviewed and hardened in parallel with the HMS canonical-data and modular-monolith programs.

The decision is **yes**, with one non-negotiable boundary:

> Workforce operations may be modularised and made production-safe now, but they must not invent a second practitioner authority, must not change payroll financial semantics, and must keep legacy workforce tables behind an explicit module adapter until a separately governed canonical workforce authority is approved.

The work does not need to wait for complete canonical database cutover. It must, however, be structured so that future provider replacement does not require rewriting route, UI, attendance, leave, or roster business logic.

## 2. Evidence sources

### 2.1 Local `main`

The task branch was created from clean local `main` at commit `a98cb0152`. The current implementation evidence was read from:

- `src/routes/tenant/staff.ts`
- `src/routes/tenant/hr/index.ts`
- `src/routes/tenant/hr/roster.ts`
- `src/routes/tenant/hr/attendance.ts`
- `src/routes/tenant/hr/leave.ts`
- `src/routes/tenant/hr/biometric.ts`
- `src/routes/tenant/hr/payroll.ts`
- `src/schemas/hr.ts`
- `src/lib/route-permissions.ts`
- `web/src/pages/StaffPage.tsx`
- `web/src/pages/DutyRoster.tsx`
- `test/integration/routes/hr-roster.test.ts`
- `web/src/pages/DutyRoster.test.ts`
- `web/e2e/hr-module.spec.ts`
- `migrations/0049_hr_module.sql`
- `migrations/0078_duty_roster_biometric.sql`
- `migrations/0263_hr_gaps_department_weekend_policy.sql`
- `tenant-schema.sql`

### 2.2 Canonical-data program snapshot

The current canonical program was inspected from:

- branch `program/cdb-main-continuous-20260725`;
- checkpoint receipt `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION-VERIFIED`;
- `docs/architecture/canonical-program-control-center.md`;
- `docs/database/canonical-authority-matrix.yaml`;
- `docs/database/audits/2026-07-26-practitioner-operational-adoption-audit.md`;
- `docs/database/migration-runs/P11-canonical-practitioner-operational-adoption.md`;
- `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`;
- `src/db/schema/canonical/identity.ts`.

CDB-113C implements canonical practitioner commands and a disabled legacy/shadow/canonical practitioner provider on its own program branch. It has **not** been integrated into local `main`, so this workforce branch must not import those unmerged files or duplicate them.

### 2.3 Modular-monolith program snapshot

The modular program was inspected from branch `task/mm-continuous-remaining-program`:

- `docs/architecture/modular-monolith-spec.md`;
- `docs/architecture/module-registry.yaml`.

The current registry groups “Staff” under `identity_access`, while finance owns payroll. This audit finds that the identity entry is too broad for roster, attendance, leave, calendar, biometric, and overtime operations. A dedicated `workforce_management` module is required when that registry reaches `main`.

## 3. Current authority map

| Business fact | Current authority | Target boundary in this work | Canonical relationship |
|---|---|---|---|
| Authentication user/session | `users` and security tables | `identity-access` | External governed security authority |
| Employee/staff operational profile | `staff` | `workforce-management` legacy provider | No approved canonical workforce authority yet |
| Clinical practitioner identity | canonical practitioner tables plus legacy compatibility | canonical practitioner program | Optional explicit employee link only |
| Shift definition | `hr_shifts` | `workforce-management` | Operational workforce fact |
| Duty assignment for staff/date | `hr_duty_roster` | `workforce-management` | Operational workforce fact |
| Rotation pattern/assignment | `hr_rotation_patterns`, `hr_rotation_pattern_days`, `hr_staff_rotations` | `workforce-management` | Operational workforce fact |
| Weekend and holiday policy | `hr_weekend_policies`, `hr_holidays` | `workforce-management` | Operational work-calendar fact |
| Raw attendance punch | `hr_attendance_punches` | `workforce-management` immutable event boundary | Operational workforce fact |
| Daily attendance summary | `hr_attendance` | `workforce-management` rebuildable projection | Derived from roster, leave, calendar, and punches |
| Leave entitlement/request | `hr_employee_leave_balances`, `hr_leave_requests`, rules/categories | `workforce-management` | Operational workforce fact |
| Overtime hours/approval | `hr_overtime_rules`, `hr_overtime_log` | `workforce-management` | Approved hours feed finance; money does not belong here |
| Payroll calculation/payable/payment | `hr_payroll_runs`, `hr_payslips`, adjustments, expense linkage | `finance-accounting` | Canonical authority matrix records a payroll lifecycle gap |

## 4. Canonical-program conclusions

### 4.1 Practitioner is not employee

Canonical governance explicitly states:

- authentication user is not practitioner identity;
- employee is not practitioner identity;
- practitioner-to-employee relationship is an explicit link;
- numeric ID coincidence, name, phone, email, specialty, and department are not identity evidence.

The workforce module must therefore support all staff, including receptionists, accountants, cashiers, cleaners, security personnel, store personnel, administrators, and technicians. A staff member may have an optional `practitionerPublicId` only when an active exact link exists.

### 4.2 Do not create canonical workforce tables in this branch

The canonical authority matrix does not yet define workforce-member, roster, attendance, leave, or work-calendar canonical tables. Creating them here would bypass canonical governance and risk a competing architecture.

Phase 1 must use existing workforce tables through a public module contract. A future canonical workforce checkpoint may replace the provider after authority registration, backfill, reconciliation, shadow comparison, cutover, rollback, and retirement evidence.

### 4.3 Payroll is a separate financial gap

The canonical authority matrix classifies `payroll_lifecycle` as `canonical_gap` and states that calculation, approval, payable recognition, settlement, custody, and accounting must become separate lifecycle facts. The active canonical-finance branch is already changing payroll-related files.

This roster/staff task must not:

- change payroll calculations;
- change salary expense recognition;
- change accounting posting;
- convert payroll money types;
- import a parallel payroll architecture;
- modify active canonical-finance task files during its dirty execution window.

The workforce module may expose attendance, approved leave, and approved overtime summaries as read contracts for finance.

## 5. Verified API contract failure

`web/src/pages/DutyRoster.tsx` sends snake_case payloads while `src/schemas/hr.ts` requires camelCase. A direct local schema check using the exact UI shapes returned:

```json
{
  "assign": false,
  "bulk": false,
  "generate": false,
  "rotation": false,
  "rotationAssign": false,
  "holiday": false,
  "overtime": false
}
```

### 5.1 Mutation mismatches

| Action | UI payload | Backend schema |
|---|---|---|
| Assign roster | `staff_id`, `shift_id`, `date` | `staffId`, `shiftId`, `rosterDate` |
| Bulk roster | `staff_ids`, `shift_id`, `from_date`, `to_date` | `assignments`, `startDate`, `endDate` |
| Generate roster | `from`, `to` | `startDate`, `endDate` |
| Create rotation | `pattern_name`, `cycle_days`, `day_number`, `shift_id`, `is_day_off` | `patternName`, `cycleDays`, `dayNumber`, `shiftId`, `isOff` |
| Assign rotation | `staff_id`, `rotation_id`, `start_date`, `offset` | `staffId`, `patternId`, `startDate`, `cycleOffset` |
| Add holiday | `name`, `date`, `type` | `holidayName`, `holidayDate`, `holidayType` |
| Add overtime rule | `rule_name`, `min_hours`, `max_ot_per_day`, plural applies-on values | `ruleName`, `minHoursBeforeOt`, `maxOtHoursPerDay`, singular applies-on values |

### 5.2 Response mismatches

- Roster backend returns `roster_date`; UI reads `date`.
- Holiday backend returns `holiday_name`, `holiday_date`, `holiday_type`; UI reads `name`, `date`, `type`.
- Rotation list returns only pattern rows; UI expects nested `days`.
- Overtime backend returns `min_hours_before_ot` and `max_ot_hours_per_day`; UI reads `min_hours` and `max_ot_per_day`.
- Shift E2E fixtures use `name` and `grace_period_minutes`, while the backend returns `shift_name` and `grace_period`.

This is a production-blocking defect because the page can render while all principal writes fail validation.

## 6. Backend correctness findings

### 6.1 High severity

1. **No active tenant-owned workforce validation**
   Roster assignment accepts numeric staff and shift IDs without verifying that each row belongs to the authenticated tenant and is active.

2. **Swap is not a two-way exchange**
   The target receives the source shift, but the source row keeps its original shift and is only marked `swapped`.

3. **Cancelled assignment cannot be cleanly reassigned**
   Cancellation leaves the row in place while the unique key remains `(tenant_id, staff_id, roster_date)`.

4. **Roster generation is not retry-safe**
   It uses plain `INSERT`; a repeated period can hit uniqueness errors. Chunked D1 batches can commit earlier chunks before a later chunk fails.

5. **Rotation generation ignores active state**
   Queries do not require both `hr_staff_rotations.is_active = 1` and `hr_rotation_patterns.is_active = 1`.

6. **Hardcoded weekend logic conflicts with tenant policy**
   Bulk assignment skips Saturday and Sunday despite the existing `hr_weekend_policies` table and despite hospitals operating seven days.

7. **HR route permission coverage is incomplete**
   HR handlers contain no explicit granular permission middleware. The central route matrix has no `/api/hr` or `/api/staff` rule in the inspected `main` snapshot.

8. **Raw punch and attendance projection are not atomic/retry-safe**
   Device punch inserts a raw event, then separately creates or updates attendance. Retry can duplicate events or leave projection drift.

9. **UTC date is used as hospital business date**
   `new Date().toISOString()` can assign a Bangladesh-local punch or attendance action to the wrong date. Night shifts make this worse.

10. **Auto-absence marks people who were not expected to work**
    `mark-absent` selects all active staff without excluding approved leave, roster off-day, holiday, weekend, or non-rostered employees.

### 6.2 Medium severity

1. `created_by` exists on roster but is not populated consistently.
2. Roster mutations lack immutable lifecycle/audit events.
3. Rotation pattern days require `shift_id NOT NULL`, while UI models off-days with no shift.
4. Leave duration counts calendar days, not configured working days.
5. Approved leave does not produce a roster/attendance conflict or reconciliation state.
6. Manual punch stores values inconsistent with the `HH:mm` shape used by normal attendance.
7. Biometric device identity is not the primary authenticated source boundary for device-origin punches.
8. Live attendance classifies no-punch or last-out as absent without roster and leave context.
9. Overtime UI shows a delete action with no implemented mutation.
10. Existing overtime multiplier columns use `REAL`; approved hours may remain operational, but monetary use must be deferred to canonical finance.

## 7. Test-quality findings

Fresh focused verification on the clean reviewed base produced:

```text
pnpm exec vitest run test/integration/routes/hr-roster.test.ts
17 tests passed

cd web
pnpm exec vitest run src/pages/DutyRoster.test.ts
1 test passed
```

These results do not prove usability:

- backend tests mostly assert HTTP status and schema rejection;
- successful assignment tests do not require real staff/shift fixtures;
- no test proves tenant ownership, active state, swap exchange, cancellation reactivation, idempotent generation, or audit evidence;
- the web test only verifies that the component exports a function;
- E2E mocks accept mutations without checking body shape;
- E2E responses use frontend-shaped fixtures and therefore hide backend response mismatch.

The current tests provide false confidence and must be replaced by contract, domain, repository, route, and UI interaction tests.

## 8. Modular-monolith conclusion

The modular specification requires:

- one registered owner for each fact;
- thin routes;
- stable public module contracts;
- no raw D1 rows in public APIs;
- tenant and permission checks before mutation;
- explicit idempotency and transaction semantics;
- no direct cross-module table writes after migration;
- characterization, permission, tenant, retry, rollback, and parity tests.

The existing modular registry’s `identity_access` entry should eventually be narrowed to authentication, sessions, users, roles, permissions, and account links. A new module should own workforce operations:

```text
src/modules/workforce-management/
├── domain/
├── application/
├── infrastructure/
└── index.ts
```

The task branch must not copy the unmerged modular registry into `main`. The implementation plan includes a sync gate: when the modular registry is integrated into local `main`, update it in this task branch before runtime implementation is integrated.

## 9. Recommended execution scope

### Included

- stable camelCase API DTOs and response mappers;
- Staff Directory query/mutation facade;
- optional practitioner-link lookup;
- shift definitions;
- duty roster assignment, cancellation, reactivation, bulk assignment, swap, and generation;
- rotation definitions and assignments;
- work-calendar policy and holidays;
- attendance punch/event integrity and daily projection;
- leave workday calculation and roster/attendance conflict handling;
- operational overtime hours and approval;
- granular permissions and audit evidence;
- UI contract and interaction tests;
- modular/canonical readiness documentation.

### Excluded

- canonical workforce tables;
- canonical provider activation;
- production migrations or backfills;
- legacy table retirement;
- payroll financial lifecycle changes;
- salary expense/accounting changes;
- deployment, push, or production observation;
- destructive schema changes.

## 10. Readiness decision

Duty Roster and Staff Management can proceed now from `main` in the dedicated task branch. The safe sequence is:

1. complete and commit audit/design/plan documents;
2. before implementation, sync the task branch with the then-current reviewed local `main`;
3. re-read canonical practitioner and canonical-finance checkpoints;
4. characterize current contracts with failing tests;
5. repair public DTO contracts;
6. introduce the workforce module facade over legacy tables;
7. harden roster lifecycle and work-calendar behavior;
8. harden attendance, leave, biometric, overtime, RBAC, and UI in bounded commits;
9. keep payroll runtime changes outside this branch;
10. integrate only after focused/full verification and a clean review.

This approach enables parallel progress without waiting for complete canonical cutover and without creating an architecture that must be discarded when legacy tables are eventually retired.
