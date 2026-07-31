# AGENTS.md

## IMPORTANT: Always use superpowers skills first
Before any task, ALWAYS load the "using-superpowers" skill using the skill tool. This is mandatory for all work.

## MANDATORY: Main-root and isolated-worktree workflow

Before any file-changing HMS task, read `.agent-rules/git-workflow.md`. The branch and worktree contract is mandatory for features, fixes, refactors, migrations, documentation changes, program checkpoints, verification, and integration.

- The owner-facing root checkout must normally be clean and checked out on local `main`.
- Discover the current `main` worktree from Git metadata; never rely on a dated hardcoded path.
- Every new implementation task must start from the exact latest fetched `origin/main` in a dedicated named branch and linked worktree. The only exception is an explicit request to resume an already-owned named branch/worktree.
- Before the first task-owned edit, run `pnpm worktree:check -- --mode=task` from the new worktree.
- When continuing the same already-owned dirty task, inspect every changed file first, then run `pnpm worktree:check -- --mode=task --allow-dirty`.
- Never implement from an unrelated review, audit, release, or dirty feature branch. Such checkouts are read-only context only.
- Never overwrite, discard, reset, clean, stash, or opportunistically commit unrelated work in any checkout.
- General direct tasks must be committed, verified, integrated through a clean `main` worktree, pushed to `origin/main`, and safely cleaned up; protocol-governed worker tasks that explicitly stop at `READY FOR INTEGRATION` keep their separate integration command, whose integrator owns push and cleanup.
- Before merging or cherry-picking into local `main`, use a clean `main` worktree and run `pnpm worktree:check -- --mode=integration --require-latest-origin-main`.
- The user's standing instruction authorizes completed-task merge pushes to `origin/main` and deletion of the clean fully merged task worktree plus local/remote branches. Deploys, production migrations, and production flag changes still require separate explicit authorization.

## MANDATORY: Manual multi-agent task execution mode

This repository does **not** assume that an agent can create sub-agents. The owner manually opens separate agent sessions and assigns one production-readiness task to each worker.

### Worker command

When the user gives a task ID with a normal execution instruction—for example `W0-01 করো`, `W2-04 complete করো`, or `FINAL-01 execute করো`—treat it as **worker mode**.

In worker mode you MUST:

1. Read `docs/production-readiness/AGENT_TASK_EXECUTION_PROTOCOL.md` and `docs/production-readiness/MANUAL_MULTI_AGENT_RUNBOOK.md`.
2. Resolve exactly one task from `docs/production-readiness/TASK_CATALOG.md`.
3. Check `TASK_STATUS.md`, live branches/worktrees, commits, and `runs/<TASK-ID>.md` to avoid duplicate ownership.
4. Fetch `origin/main`, then create an isolated task branch/worktree from that exact latest remote base; if required dependencies are not yet present on `origin/main`, stop with a blocker instead of using another base. Continue an existing branch only when the task explicitly names it.
5. Load and follow the mandatory Superpowers skills specified by the protocol; do not assume `subagent-driven-development` or any sub-agent facility exists.
6. Review the existing implementation and evidence, reproduce confirmed defects, make focused fixes, add regression coverage, and update the task-owned run report.
7. Perform requirement/safety and code-quality review and run fresh verification.
8. Commit all task-owned changes and leave a clean verified branch.
9. Stop with `READY FOR INTEGRATION` or an exact blocker. **Do not merge into local `main`, update shared status/tracker files, push, deploy, or apply production migrations.**

### Integration command

When the user explicitly says `<TASK-ID> integrate করো`, act as the **integration agent**. Review the worker branch and run report, acquire the shared merge lock, fetch the latest `origin/main`, reconcile and merge through a clean dedicated `main` worktree, rerun required verification, update `TASK_STATUS.md`, the master tracker, and the run report, push the verified result to `origin/main`, confirm remote containment, then delete the clean merged task worktree plus local and remote task branches.

### Wave verification command

When the user says `<WAVE> verify করো`, such as `W0 verify করো`, fetch and verify that the required task integrations and dependencies for that wave are present on `origin/main`, run the wave-level integrated gates from a clean main worktree, and record the wave verdict. Do not implement unfinished task scope under a wave-verification command.

A task is `PASS` only after explicit integration and post-merge verification. A worker branch can only be `READY FOR INTEGRATION`.

Fetching `origin/main` is mandatory before every new task and integration. Worker-mode sessions must not push, deploy, or apply production migrations; the dedicated integration agent is authorized to push a verified completed-task merge and delete its fully merged task branches/worktree. Deploys and production migrations still require separate explicit authorization. Never discard another person's work.

This repository is a Cloudflare-native health ecosystem platform.

Before making changes, identify the work area and read the matching rule files from `.agent-rules/`.

## Always read first
- `.agent-rules/git-workflow.md`
- `.agent-rules/architecture.md`
- `.agent-rules/coding-rules.md`

## Read by work type

### If working on storage, database, persistence, caching
- `.agent-rules/data-storage.md`
- docs/database-guide.md
Before database changes, search existing schema/migrations and check docs/database-guide.md.

### If working on performance, latency, loading speed, scaling
- `.agent-rules/performance.md`

### If working on file uploads, image/PDF handling, client-side preprocessing
- `.agent-rules/browser-processing.md`

### If working on AI assistant, summaries, recommendations, retrieval
- `.agent-rules/ai-buddy.md`

### If working on health data, auth, privacy, permissions, audit, sensitive data
- `.agent-rules/healthcare-security.md`

### If working on appointments, availability, realtime, locks, notifications, queues
- `.agent-rules/booking-realtime.md`

## MANDATORY: Isolated branch from latest main for every task

Before any implementation or repository change, follow `.agent-rules/git-workflow.md`. Every new task must use a unique branch and linked worktree created from the latest fetched `origin/main`. Never work directly on `main`, the root checkout, a backup/integration branch, or another task's branch.

After a task is verified, merged into a clean `main` integration worktree, and pushed to `origin/main`, delete its clean merged worktree plus local and remote task branches. Never delete dirty, unmerged, unpushed, failed, or in-progress work.

## Deployment

**CANONICAL SHADOW SAFETY — MANDATORY:** Tenant 100 financial shadow mode is active. Do not use an immediate 100% production deploy from an arbitrary branch.

- Required runbook: `docs/operations/canonical-shadow-safe-production-deploy.md`
- Do **not** use `wrangler deploy --env production`, `pnpm deploy:production`, or `pnpm build && wrangler deploy --env production` as the normal release path while shadow mode is active.
- Every production release HEAD must contain ancestor `95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf`.
- Upload a tagged Worker version, install it at `0%` beside the freshly verified `100%` baseline, run candidate-bound health/auth/feature smoke and zero reconciliation, then promote using controlled version splits.
- Keep the prior known-good Worker at `0%` after final promotion for rollback.
- **Production URL:** `https://hms.ozzyl.com`
- The `[env.production]` config in `wrangler.toml` binds to the production D1 database, KV, R2, Vectorize and Worker version metadata.

### Main branch push automation
- Pushing to `main` currently triggers `.github/workflows/ci-cd.yml`, which performs an immediate `deploy --env production`.
- While canonical shadow mode is active, do not push a release to `main` unless the production deploy is separately authorized and the workflow has been reviewed for the versioned rollout requirement.
- The GitHub Actions pipeline also applies production D1 migrations with `continue-on-error`; do not assume a push made migrations usable unless workflow logs or `wrangler d1 migrations list DB --env production --remote` confirms no pending migrations.
- A `git push` to GitHub does **not** directly SSH into the hospital LAN local server. Local server updates are a separate pull-based or manual operation.

## Local server + cloud sync deployment

This project also supports a hospital LAN local server that runs through Docker and syncs to the Cloudflare production Worker when internet is available.

### Local server production facts
- Hospital LAN app URL: `http://192.168.1.240`
- Tailscale SSH target: `pcare`
- Server repo path: `/opt/hms`
- Docker compose file: `deploy/local-server/compose.yml`
- Persistent data root: `/data/hms`
- Local secret vars file: `/data/hms/secrets/.dev.vars.local_server`
- Never print or commit `CLOUD_SYNC_TOKEN`, JWT secrets, patient data dumps, or `.dev.vars*` contents.

### When adding or changing tables
For every schema/table change that must work both in cloud and local:
1. Add a numbered migration under `migrations/`.
2. Update `tenant-schema.sql` or `schema.sql` when the table must exist on a fresh local install.
3. If the table participates in local-to-cloud sync, add an immutable `local_sync_outbox` event at the write boundary and keep request handlers thin.
4. Store only metadata, hashes, ids, status, and idempotency keys in sync ledgers unless a later audited mapper explicitly requires sensitive payload handling.
5. Verify migration SQL with SQLite/D1-compatible syntax before deploy.

### Cloud deploy order
Production deploys must follow `docs/operations/canonical-shadow-safe-production-deploy.md`.

Required order: verify canonical-safe ancestry and clean HEAD, run quality gates, capture deployment/flag/reconciliation, upload a tagged version, install it at `0%`, run candidate-bound verification, then promote through controlled traffic splits. Do not use an immediate 100% deploy while Tenant 100 shadow mode is active.

If a migration is required, obtain separate approval, keep it backward-compatible with both running Worker versions, and apply/verify it before relying on the new route or table in production.

### Local server deploy order
After code is committed locally, update the physical server from this workstation by copying the committed revision to `/opt/hms`, then rebuild the local Docker stack:
```bash
ssh pcare 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml up -d --build --remove-orphans'
```
Run local migrations when schema changed:
```bash
ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'
```
Verify after every local deploy:
```bash
ssh pcare 'curl -fsS http://127.0.0.1/api/local-server/status && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml ps'
```

### Local server auto-update behavior
- Local server deploy is **not** automatically triggered by GitHub push unless the hospital server has the local auto-update systemd timer installed and running.
- The optional timer is installed with:
```bash
ssh pcare 'cd /opt/hms && bash scripts/local-server/install-auto-update.sh'
```
- When enabled, `hms-local-auto-update.timer` runs every 5 minutes. It executes `scripts/local-server/update-stack.sh` from `/opt/hms`, fetches `origin/main`, fast-forwards the local checkout, creates a local backup, rebuilds `deploy/local-server/compose.yml`, and rolls back if `/api/local-server/status` does not become healthy.
- The auto-update script rebuilds the stack only; it does **not** run `scripts/local-server/migrate.sh` by itself. Schema migration still needs one of these explicit paths:
  1. For baseline or manual local migration: `ssh pcare 'cd /opt/hms && bash scripts/local-server/migrate.sh'`
  2. For versioned migration debugging only: `ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'`
  3. For normal tenant production local installs, import a tenant-scoped cloud snapshot or use the schema-sync flow below instead of blindly applying all versioned migrations.

### Local server schema sync
- `/data/hms/config/local-server.env` controls periodic schema sync.
- By default, `HMS_LOCAL_SCHEMA_SYNC_ENABLED=0`; safe migration auto-apply is off until explicitly enabled on the hospital server.
- If enabled, the sync worker periodically calls `/api/local-server/schema-sync/sync` and `/api/local-server/schema-sync/sync/apply-approved` from inside the Docker stack.
- Safe migrations may be auto-applied by the schema-sync system; destructive migrations must go through the approval queue. Always verify with:
```bash
ssh pcare 'cd /opt/hms && curl -fsS http://127.0.0.1/api/local-server/status && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml ps'
```

### Sync route rules
- `/api/sync/*` uses server-to-server bearer auth with `CLOUD_SYNC_TOKEN`; do not put it behind normal user JWT auth.
- `/api/sync/ingest` must be idempotent and duplicate-safe.
- Local servers must not accept cloud ingest; they send to cloud only.
- Logs must not include bearer tokens or sensitive patient payloads.

## Core system constraints
- Keep request handlers thin.
- Move heavy work to async systems.
- Use the correct Cloudflare product for the correct job.
- Do not turn the AI buddy into a medical advisor.
- Do not put sensitive logic in the browser.
- Do not make architecture changes that violate the rule files.

If a task touches multiple areas, read all relevant files before coding.
If implementation conflicts with these rules, stop and propose a compliant alternative.

## MANDATORY: Commit after every task

**CRITICAL**: After completing ANY code change, you MUST:
1. Run `git diff` to verify all changes are present
2. Run `git add` and `git commit` immediately
3. Never leave changes uncommitted — they can get lost if the session restarts or files get reverted

**NOTE**: Intermediate commits do not require an immediate push. However, the user's standing repository instruction authorizes and requires pushing a verified completed-task merge to `origin/main`, followed by safe deletion of the merged task's local/remote branches and worktree as defined in `.agent-rules/git-workflow.md`.

This prevents accidental reverts and ensures all work is preserved.

---

## DanpheEMR Reference Project

**Location:** `DanpheEMR reference/` folder in project root

DanpheEMR is an open-source hospital management system (ASP.NET + Angular + SQL Server) used as reference for feature parity. The HR/Staff module comparison is documented below.

### Danphe HR Module Structure (Reference)

Danphe HR is split across 3 subsystems:

| Subsystem | Backend Path | Tables (prefix) | Purpose |
|-----------|-------------|-----------------|---------|
| Employee | `Controllers/Employee/`, `Controllers/Settings/` | `EMP_*` | Employee master, roles, types, profiles |
| Payroll | `Controllers/Payroll/` | `PROLL_*` | Attendance, leave, holidays, daily muster |
| Scheduling | `Controllers/Scheduling/` | `SCH_*` | Shifts, employee schedules, working hours |

### Danphe HR Features (What we compare against)

**Employee Management:**
- Employee CRUD with rich profile (name, DOB, DOJ, contact, department, role, type, blood group, certifications, signatures, images)
- Employee Roles CRUD (Doctor, Nurse, Admin, etc.)
- Employee Types CRUD with active/inactive
- External Referrers (external doctors) separate handling
- Employee self-service profile + password change
- Signatory image upload for reports
- Employee preferences (lab/imaging favorites)
- Service item mapping (employee → billing service items for OPD)

**Attendance:**
- Daily time record import (raw punch data: EmployeeId + RecordDateTime)
- Daily Muster grid per employee per month (Present, AttStatus, ColorCode, TimeIn, TimeOut)
- CSV bulk import attendance
- Manual attendance status editing with color coding
- Holiday push to daily muster

**Leave:**
- Leave Categories (Sick, Casual, Annual, etc.) with category codes
- Leave Rules per year (days allowed, pay percent, approval workflow)
- Leave Requests: pending → approved/cancelled (with RequestedTo, ApprovedBy, timestamps)
- Per-employee leave summary by category and year
- Holiday calendar with fiscal year
- Weekend policy per year (configurable days)

**Scheduling/Shifts:**
- Shift Master (name, start/end time, total hours, default flag)
- Employee-Shift mapping (many-to-many)
- Day-wise employee availability (working/non-working per day)
- Employee schedules with date, day name, working day flag
- Working hours tracking per employee
- Bulk schedule management with transactional safety

**NOT present in Danphe HR (our advantage areas):**
- No payroll/salary calculation or payslip generation
- No salary structure (basic, HRA, PF, etc.)
- No overtime rules or calculation
- No shift rotation/roster auto-generation
- No biometric device integration (CSV only)
- No employee self-service portal beyond profile
- No document management for employees
- No resignation/exit workflow
- No loan/advance management
- No performance appraisal
- No recruitment/onboarding

---

### Our HMS vs Danphe HR — Feature Comparison

| Feature Area | DanpheEMR | Our HMS | Status |
|-------------|-----------|---------|--------|
| **Employee/Staff CRUD** | ✅ Rich profile (30+ fields) | ✅ Basic profile (name, position, salary, dept, joining_date, mobile, bank_account) | ⚠️ Our fields are fewer |
| **Employee Roles** | ✅ CRUD with IsActive | ✅ Via RBAC roles (doctor, nurse, lab, reception, md, director, pharmacist, accountant) | ✅ MATCH |
| **Employee Types** | ✅ CRUD | ❌ Not present | ⚠️ GAP |
| **External Referrers** | ✅ Separate handling | ❌ Not present (doctors table exists separately) | ⚠️ GAP |
| **Employee Profile Self-Service** | ✅ Profile view + password change | ❌ Not present | ⚠️ GAP |
| **Signatory Image** | ✅ Upload for reports | ❌ Not present | ⚠️ GAP |
| **Employee Preferences** | ✅ Per-employee favorites | ❌ Not present | ⚠️ GAP |
| **Department Management** | ✅ Hierarchy with head, room no | ✅ Department field on staff | ⚠️ Basic (no hierarchy) |
| **Attendance - Raw Punches** | ✅ DailyTimeRecord import | ✅ `hr_attendance_punches` (biometric/rfid/manual/web/mobile/device) | ✅ BETTER (multi-source) |
| **Attendance - Daily Muster** | ✅ Grid per employee/month | ✅ `hr_attendance` + monthly summary API | ✅ MATCH |
| **Attendance - CSV Import** | ✅ Bulk CSV import | ❌ Not present (biometric API instead) | ⚠️ GAP (but biometric is better) |
| **Attendance - Manual Edit** | ✅ Edit status with color | ✅ Mark absent, check-in/out | ✅ MATCH |
| **Attendance - Holiday Integration** | ✅ Push to daily muster | ✅ Holiday management + weekend policy | ✅ MATCH |
| **Shift Management** | ✅ Shift Master (name, time, default) | ✅ `hr_shifts` (name, time, grace, break, night shift, color, short_code) | ✅ BETTER (more fields) |
| **Employee-Shift Mapping** | ✅ Many-to-many | ✅ Via roster assignment | ✅ MATCH |
| **Shift Rotation/Roster** | ❌ Not present | ✅ `hr_rotation_patterns` + auto-generate roster | ✅ BETTER (Danphe doesn't have this) |
| **Duty Roster Calendar** | ❌ Not present | ✅ `hr_duty_roster` with calendar view | ✅ BETTER |
| **Shift Swap** | ❌ Not present | ✅ Swap between staff | ✅ BETTER |
| **Leave Categories** | ✅ With category codes | ✅ `hr_leave_categories` with max_days_per_year | ✅ MATCH |
| **Leave Rules** | ✅ Per-year, days, pay% | ✅ `hr_leave_rules` per year, days, pay% | ✅ MATCH |
| **Leave Requests** | ✅ pending/approved/cancelled | ✅ pending/approved/rejected/cancelled + rejection_reason | ✅ BETTER |
| **Leave Balance Tracking** | ❌ Not explicit (calculated from rules) | ✅ `hr_employee_leave_balances` (total, used, balance, carry_forward) | ✅ BETTER |
| **Leave Carry Forward** | ❌ Not present | ✅ Carry forward with max 10-day cap | ✅ BETTER |
| **Leave Balance Validation** | ❌ Not present | ✅ Prevents over-drafting on request | ✅ BETTER |
| **Holiday Management** | ✅ With fiscal year | ✅ `hr_holidays` (public/optional/restricted) | ✅ MATCH |
| **Weekend Policy** | ✅ Per year, configurable days | ✅ `hr_weekend_policies` with patterns (every/1st/2nd/3rd/4th/1st+3rd/2nd+4th) | ✅ BETTER (more patterns) |
| **Payroll - Salary Heads** | ❌ Not present | ✅ `hr_salary_heads` (earning/deduction, taxable flag) | ✅ BETTER |
| **Payroll - Salary Structure** | ❌ Not present | ✅ `hr_staff_salary_structure` (fixed/percentage per head) | ✅ BETTER |
| **Payroll - Run Workflow** | ❌ Not present | ✅ `hr_payroll_runs` (draft→locked→approved) | ✅ BETTER |
| **Payroll - Payslip Generation** | ❌ Not present | ✅ `hr_payslips` with breakdown, attendance summary, leave deduction | ✅ BETTER |
| **Payroll - Accounting Integration** | ❌ Not present | ✅ Creates expense + accounting event on approval | ✅ BETTER |
| **Overtime Rules** | ❌ Not present | ✅ `hr_overtime_rules` (multiplier, min hours, max OT, weekday/weekend/holiday) | ✅ BETTER |
| **Overtime Tracking** | ❌ Not present | ✅ `hr_overtime_log` with approval workflow | ✅ BETTER |
| **Overtime → Payroll** | ❌ Not present | ✅ Auto-integrate OT pay into payslip | ✅ BETTER |
| **Biometric Devices** | ❌ CSV only | ✅ `hr_biometric_devices` with API key auth | ✅ BETTER |
| **Biometric Enrollment** | ❌ Not present | ✅ `hr_biometric_enrollments` (fingerprint/RFID/face/card/PIN) | ✅ BETTER |
| **Real-time Attendance Board** | ❌ Not present | ✅ Live board with auto-refresh | ✅ BETTER |
| **Punch Sources** | ❌ CSV import only | ✅ biometric, RFID, manual, web, mobile, device | ✅ BETTER |
| **Staff Invitation** | ❌ Not present | ✅ Email invitation with role assignment | ✅ BETTER |
| **Multi-tenancy** | ❌ Single-tenant | ✅ All tables scoped by tenant_id | ✅ BETTER |
| **RBAC** | ✅ Role-based | ✅ Role-based with middleware | ✅ MATCH |
| **Audit Logging** | ✅ CreatedBy/ModifiedBy | ✅ Audit logs table | ✅ MATCH |
| **i18n** | ❌ English only | ✅ English + Bengali | ✅ BETTER |

### Summary

**Areas where Our HMS is BETTER than Danphe (16 areas):**
- Payroll system (salary heads, structure, runs, payslips, accounting integration)
- Overtime (rules, tracking, payroll integration)
- Leave (balance tracking, carry-forward, over-draft protection, rejection reasons)
- Shift/Roster (rotation patterns, auto-generate, shift swap, calendar view)
- Biometric (device API, multi-source punches, real-time live board)
- Weekend policies (more pattern options)
- Staff invitation system
- Multi-tenancy
- i18n (English + Bengali)

**Areas where Danphe is BETTER than Our HMS (5 areas):**
- Employee profile richness (30+ fields vs our basic fields)
- Employee types management
- External referrer handling
- Employee self-service profile
- CSV attendance import (we have biometric API instead)

**Overall HR Module Match: ~110%** — Our HMS exceeds Danphe's HR capabilities significantly. Danphe's HR is limited to basic attendance/leave/scheduling, while we have a full payroll system, biometric integration, overtime management, and duty roster with rotation patterns.

**Key Reference Files:**
- Danphe backend: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Payroll/`, `Controllers/Employee/`, `Controllers/Scheduling/`
- Danphe models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/EmployeeModels/`, `Payroll/`, `SchedulingModels/`
- Danphe frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/employee/`, `payroll-module/`, `scheduling/`
- Our HR routes: `src/routes/tenant/hr/` (attendance.ts, leave.ts, payroll.ts, roster.ts, biometric.ts)
- Our HR schemas: `src/schemas/hr.ts`
- Our HR migrations: `migrations/0049_hr_module.sql`, `0078_duty_roster_biometric.sql`, `0263_hr_gaps_department_weekend_policy.sql`
- Our HR frontend: `web/src/pages/HRDashboard.tsx`, `AttendancePunch.tsx`, `DutyRoster.tsx`, `LeaveManagement.tsx`

## Standing workflow rules

- Always use the relevant CodexPro skill/superpower skill before and during implementation work.
- Always follow TDD for code changes: write or update tests first, make them fail for the right reason, implement the minimal fix, then rerun focused and relevant regression tests.
- Always make focused git commits after completing a verified work slice.
- Do not stage unrelated existing workspace changes when committing a slice.

## Standing CodexPro workflow rules

- Check available CodexPro skills before code work and apply the relevant workflow mindset, especially quick-dev, code-review, and testarch/TDD.
- Use TDD for functional code changes: add or update a focused test when practical, implement the smallest safe change, then rerun focused tests and relevant regressions.
- Review diffs before staging. Never use bulk git add in a dirty workspace.
- Make focused commits after each verified slice. Do not mix unrelated generated files, reports, backups, or local planning files into feature commits.
- Use a clean integration worktree for main integration. Prefer cherry-picking or patch-level application over merging an entire dirty feature branch.
- Before pushing to main, verify conflict markers are gone, run focused tests, and run a build when frontend or shared TypeScript is touched.
- Never delete branches unless the user explicitly asks.

## Session handoff files

Keep these files accurate when intentionally part of the active workflow:

- active-context.md: current task, branch/worktree, files touched, blockers, and next concrete step.
- .ai-bridge/current-plan.md: plan and verification steps for non-trivial work.
- .ai-bridge/codex-status.md: meaningful changes, tests run, results, blockers, next review focus.
- .ai-bridge/decisions.md: stable architecture or workflow decisions.
- .ai-bridge/open-questions.md: unresolved questions the next session must know.

Only commit handoff/planning files when they are intentionally updated and useful for future sessions.
