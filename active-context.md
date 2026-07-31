# Active Context — ozzyl-hms
> Updated: 2026-06-23T12:05:00+06:00

## Current task
Build the first slice of Staff Duty Monitoring: a read-only Admin Operations Monitor that aggregates duty roster/attendance, housekeeping tasks, helpdesk SLA issues, MRD chart tasks, discharge checklist gaps, and cash proof/handover gaps.

## Branch / worktree
agent/staff-duty-monitoring-plan / .worktrees/staff-duty-monitoring-plan

## Files touched this session
- src/routes/tenant/operationsMonitor.ts — new read-only operations monitor endpoint.
- test/integration/routes/operations-monitor.test.ts — route-level coverage for central snapshot, date validation, and management-role gate.
- src/index.ts — mounted `/api/operations-monitor`.
- web/src/pages/admin/OperationsMonitorPage.tsx — admin control-room UI for attention items and duty KPIs.
- web/src/pages/admin/OperationsMonitorPage.test.tsx — focused UI coverage.
- web/src/App.tsx — mounted `/monitor/operations`.
- web/src/components/dashboard/adminSidebarConfig.tsx and Sidebar.tsx — added Duty Monitor navigation label/link.

## Pending decisions
- Whether to continue from read-only monitor into a persistent operational_tasks engine after this slice is reviewed.

## Blockers
- none.

## Next concrete step
Commit the verified read-only Operations Monitor slice, then decide whether to merge to main in the integration workspace.
