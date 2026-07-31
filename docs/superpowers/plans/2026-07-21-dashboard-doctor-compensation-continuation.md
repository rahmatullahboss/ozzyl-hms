# Dashboard Doctor Compensation Continuation

**Date:** 2026-07-21

## Reviewed baseline

This continuation reviewed the current `main` implementation and the dashboard-specific source of truth:

- `docs/superpowers/specs/2026-07-19-canonical-doctor-compensation-dashboard-design.md`
- `docs/superpowers/plans/2026-07-19-canonical-doctor-compensation-dashboard.md`
- `src/lib/executive-doctor-analytics.ts`
- `web/src/types/executiveDashboard.ts`
- `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- focused backend and web regression tests
- the July 20–21 commission and lab-commission follow-up commits on `main`

## Progress assessment

The core dashboard work is already implemented on `main`:

- referrer/prescriber commission is separated from performer reserve;
- performer reserve count and amount are exposed independently;
- `testCommission` remains the backward-compatible test compensation total;
- performer reserve facts are read from `diagnostic_performer_reserves`;
- performer accruals do not determine referrer attribution;
- unassigned performer reserves remain under the unassigned practitioner row;
- the doctor table renders Referrer Commission, Performer Tests, Performer Reserve, and Test Total;
- the detail endpoint unions reserve-ledger facts into the Commissions tab.

The implementation plan checkboxes are stale and do not reflect the code already merged. The remaining actionable gap found during this review was narrower: the Commissions drawer displayed raw storage values such as `performer_reserve` and lowercase role identifiers, and the focused route/UI tests did not explicitly prove the performer-reserve detail row from SQL contract through user-facing presentation.

## Continuation changes

- Render human-readable compensation source labels, including `Performer Reserve`, `Referrer Commission`, `Visit Commission`, `Procedure Commission`, and `IPD Round Commission`.
- Render human-readable role labels such as `Performer`, `Prescriber`, and `Referrer`.
- Extend the drawer regression to show referrer and performer reserve rows together.
- Add a focused route regression proving the reserve-ledger union, negative reserve ID namespace, explicit performer role, amount, status, and invoice reference mapping.

## Verification commands

```bash
pnpm exec vitest run test/integration/routes/dashboard-doctor-compensation-details.test.ts
pnpm --dir web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx
pnpm exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Executable checkout verification is delegated to pull-request CI because the workspace connector was unavailable during this continuation. No production deployment, migration, feature-flag change, data mutation, or merge to `main` is included.
