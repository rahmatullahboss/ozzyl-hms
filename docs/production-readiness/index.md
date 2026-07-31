# HMS Production Readiness and Architecture — Document Index

**Last rebaselined:** 2026-07-31 18:52 Asia/Dhaka

CDB-V1-071B is now production-released. The immediate programme is no longer “finish Canonical before anything else”; it is post-release observation plus parallel Inventory integration, Full-MM rebaseline and one audited inactive-domain lane.

## Start here now

1. **[Post-Canonical Production Roadmap](../architecture/2026-07-31-post-canonical-production-roadmap.md)** — owner-facing current decision, progress, module matrix and phases
2. **[Post-Canonical Parallel Execution Board](../architecture/post-canonical-parallel-execution-board.yaml)** — machine-readable workers, gates and shared-file locks
3. **[START_HERE.md](./START_HERE.md)** — current session entry point
4. **[CURRENT_NEXT_TASK.md](./CURRENT_NEXT_TASK.md)** — exact immediate tasks
5. **[TASK_STATUS.md](./TASK_STATUS.md)** — current release/program status and blockers
6. **[Machine-Readable Current State](../architecture/canonical-inventory-mm-current-state.yaml)** — Git, production, programme and authorization state
7. **[Inventory/Main Migration Reconciliation](../database/2026-07-29-inventory-main-migration-reconciliation.md)** — historical collision map and retirement rules; new Inventory range must be reserved after `0571`

## Current one-line status

```text
CDB-V1-071B production released at 100% → run 24/72-hour observation while Inventory integration rehearsal + Full-MM rebaseline + one inactive-domain audit proceed in parallel → integrate serially → use separate approvals for later production activation and retirement
```

## Status dimensions

Use three separate module statuses:

1. code deployed in the Worker bundle;
2. operationally commissioned by a hospital;
3. Canonical authority complete.

A deployed route is not proof that the hospital uses the module or that its legacy authority has been retired.

## Parallel execution now

- `OBS-001` — post-release observation;
- `INV-INT-001` — Inventory latest-main integration rehearsal;
- `MM-RB-001` — Full-MM current-main/final-Inventory rebaseline;
- `DIAG-AUD-001` — Diagnostics greenfield eligibility audit, or Patient Mobile consumer lane;
- one serial integration/review owner.

Maximum recommended workers: four plus one integrator.

## Historical/manual hospital review track

Use these after reconciling live ownership and current architecture:

1. **[MANUAL_MULTI_AGENT_RUNBOOK.md](./MANUAL_MULTI_AGENT_RUNBOOK.md)**
2. **[OWNER_TASK_COMMANDS.md](./OWNER_TASK_COMMANDS.md)**
3. **[TASK_CATALOG.md](./TASK_CATALOG.md)**
4. **[AGENT_TASK_EXECUTION_PROTOCOL.md](./AGENT_TASK_EXECUTION_PROTOCOL.md)**
5. **[TASK_RUN_REPORT_TEMPLATE.md](./TASK_RUN_REPORT_TEMPLATE.md)**
6. **[Task Run Reports](./runs/README.md)**
7. **[FIRST_HOSPITAL_PILOT_SCOPE.md](./FIRST_HOSPITAL_PILOT_SCOPE.md)**
8. **[MODULE_REVIEW_WORKFLOW.md](./MODULE_REVIEW_WORKFLOW.md)**
9. **[MODULE_REVIEW_TEMPLATE.md](./MODULE_REVIEW_TEMPLATE.md)**

Historical task labels are not current ownership. Verify branches, worktrees, commits, run reports and external authorization before assigning work.

## Release and monitoring operations

- **[Canonical Shadow-Safe Production Deploy](../operations/canonical-shadow-safe-production-deploy.md)** — candidate, traffic and rollback workflow
- **[Production Deploy Runbook](../operations/production-deploy-runbook.md)** — general pre/post-release checks
- **[Cloudflare Tail Logging](../CLOUDFLARE_TAIL_LOGGING.md)** — immediate production error capture
- **[Backup and Restore](../operations/backup-restore.md)** — recovery evidence
- **[First Hospital Go-Live Guide](../operations/first-hospital-go-live.md)** — operational commissioning
- **[Dashboard Monitoring Guide](../HOSPITAL_DASHBOARD_MONITORING_GUIDE.md)** — operational/business monitoring reference

## Historical architecture controls

The following remain useful evidence but are superseded where they claim that CDB production deployment is pending:

- **[2026-07-29 Release Control Center](../architecture/2026-07-29-canonical-inventory-mm-release-control-center.md)**
- **[2026-07-29 Continuation Prompts](../architecture/2026-07-29-canonical-inventory-mm-continuation-prompt.md)**
- **[Historical Project Phase Review](../CURRENT_PROJECT_PHASE_REVIEW.md)**
- **[Historical Code Review](../CODE_REVIEW_PHASED_REPORT.md)**

## Daily use

1. Read `START_HERE.md` and `CURRENT_NEXT_TASK.md`.
2. Inspect live Git/worktree/remote state.
3. Separate production observation from repository development.
4. Give each worker one bounded context and one worktree.
5. Let only the integration owner reserve migrations and modify shared registries/trackers.
6. Keep integration, production activation and destructive retirement as separate claims and approvals.
