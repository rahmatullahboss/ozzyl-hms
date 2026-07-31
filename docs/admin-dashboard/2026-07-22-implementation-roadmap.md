# Admin Dashboard Control Center — Implementation Roadmap

**Date:** 2026-07-22
**Status:** Planned
**Delivery model:** Additive, feature-flagged, reconciliation-first

## 1. Delivery strategy

The program is divided into reviewable phases. Each phase must preserve current production behavior until its parity and acceptance gates pass.

The sequence is intentionally:

```text
Semantics
→ API trust envelope
→ focused preset
→ reconciliation/action UX
→ operations/trend/audit refinement
→ performance and rollout
```

A visual redesign must not proceed ahead of semantic and reconciliation contracts.

## 2. Global constraints

- Start implementation from a clean reviewed base in an isolated worktree.
- Do not use the dirty documentation-source worktree for code implementation.
- Read repository architecture, coding, data-storage, performance, security, and production-readiness rules before changes.
- Operational tables remain authoritative.
- Do not create a parallel financial ledger.
- Schema changes are additive and require migration, schema mirrors, tests, and rollback/flag strategy.
- Production mutation requires separate authorization and runbook evidence.
- Use TDD for each behavior change.
- Commit at safe checkpoints.
- Keep admin, MD, director, and manager dashboard consumers compatible during migration.

## 3. Phase 0 — Baseline and contract freeze

### Objective

Create a verified implementation baseline and freeze metric meanings before changing UI.

### Deliverables

- Current route/component test baseline
- Shared semantic type definitions
- Metric registry inventory with explicit definitions
- Role-preset decision table
- Golden fixture dataset design
- Feature flags registered

### Key decisions

- Resolve `Total Collection` meaning.
- Resolve whether `Net Income` is operational estimate or GL result.
- Split period due versus outstanding due.
- Split deposit received/applied/refunded/liability.
- Split commission earned/waived/payable/paid/outstanding.
- Classify every dashboard metric as period/as-of/live.

### Gate

No implementation proceeds with an unresolved financial label.

## 4. Phase 1 — Shared semantic foundation

### Objective

Provide one normalized filter, temporal, source-status, comparison, warning, and reconciliation contract.

### Backend work

- Add shared dashboard semantic types.
- Add central metric registry or generated registry definition.
- Add filter normalization utility using Asia/Dhaka business dates.
- Add comparison-period resolver.
- Add source-status aggregation helpers.
- Add reconciliation helper.
- Add typed warning/reason codes.

### Frontend work

- Extend `ExecutiveDashboardFilters` with URL serialization and date-basis support.
- Introduce temporal-mode and health badges.
- Add shared data-state rendering primitives.

### Gate

Unit tests prove date range, previous period, zero denominator, temporal mode, and source-status behavior.

## 5. Phase 2 — Versioned admin overview API

### Objective

Replace many default overview calls with a compact role-oriented response while retaining legacy endpoints.

### Work

- Add `GET /api/dashboard/admin-overview` behind a feature flag.
- Implement bounded domain providers:
  - billing/collection,
  - due/deposit,
  - expense/payout,
  - cash/custody,
  - operations/capacity,
  - domain health.
- Include generated time, filters, permissions, health, primary metrics, and reconciliation.
- Return partial domain states instead of false zeros.
- Add provider timing and response-size telemetry without PHI.

### Performance target

Default overview calls only required role providers and returns under 100 KB uncompressed.

### Gate

Integration fixtures demonstrate tenant isolation, permissions, complete/partial/unavailable states, and comparison/reconciliation correctness.

## 6. Phase 3 — Focused role presets and page shell

### Objective

Turn the default dashboard into an overview.

### Work

- Add Hospital Admin, MD/Director, Accountant, and Manager Operations presets.
- Limit Hospital Admin to no more than 10 primary KPI signals.
- Preserve optional configuration for additional modules.
- Warn when configuration creates an excessively dense primary area.
- Add global context bar with:
  - range,
  - date basis,
  - timezone,
  - server generated time,
  - aggregate data health,
  - refresh.
- Keep live widgets visibly live during historical review.

### Migration

- Existing tenant overrides are preserved.
- New tenants receive role presets.
- A controlled migration may offer “Reset to recommended preset”; do not silently delete user customization.

### Gate

UI tests verify default count, URL restoration, live badges, and no hidden historical/today mixing.

## 7. Phase 4 — Financial reconciliation control center

### Objective

Make billing, collection, deposits, expenses, payouts, cash, and custody explainable.

### Work

- Implement billing bridge.
- Implement collection/cash bridge.
- Implement custody/variance bridge.
- Add balanced/unreconciled status.
- Add source-row preview and full-workspace links.
- Add unknown payment method and unmapped service warnings.
- Ensure prior-period due collection is shown separately from current billing collection.
- Ensure deposits are separate from revenue.

### Gate

Golden fixtures reconcile summary, source groups, all matching detail, screen, and export with zero unexplained difference unless an explicit exception fixture is used.

## 8. Phase 5 — Action Center consolidation

### Objective

Use one persistent management queue.

### Work

- Extend Action Center summary with age, amount, owner, SLA, and filtered routes where missing.
- Add reconciliation, unknown/unmapped, evidence, posting, and commission exceptions.
- Remove `riskRows()` and the duplicate frontend exception section.
- Replace normal-expense alerts with evidence/policy exceptions.
- Show capability as manage or review-only.

### Gate

No dashboard exception is created solely by frontend amount thresholds. Every displayed action has a backend rule key and reproducible filtered detail.

## 9. Phase 6 — Period-aware trend and payment mix

### Objective

Remove independent today/7-day semantics from period analysis.

### Work

- Add versioned trend endpoint.
- Rename trend according to actual measure.
- Add granularity and comparison.
- Provide accessible text/table alternative.
- Make payment mix follow selected period.
- Promote unknown payment method to warning/action state.
- Remove client calculation of authoritative summary totals.

### Gate

Trend and payment mix match the normalized overview period and exact server totals for fixture data.

## 10. Phase 7 — Operations and capacity separation

### Objective

Distinguish patient-flow activity from current capacity.

### Work

- Add period patient-flow response.
- Add current/as-of capacity response.
- Replace duplicate operations summaries with one funnel and one capacity strip.
- Add compact domain health summaries.
- Move complete doctor, test, reagent, stock, radiology, and IPD tables to dedicated workspaces or explicit expansion.

### Gate

No conversion rate is calculated across incompatible stages. Live/current values are labeled and independently refreshed.

## 11. Phase 8 — Business audit feed

### Objective

Show material events instead of raw CRUD activity.

### Work

- Add server-side business event mapper/policy.
- Generate severity from event type and business impact.
- Add concise narrative and amount/field difference where permitted.
- Link directly to the affected record/event.
- Retain full raw audit access in Audit Explorer.

### Gate

Tests cover bill value change, discount override, cancellation/refund, expense/payout, cash variance, permission change, and sensitive export. Frontend performs no severity inference.

## 12. Phase 9 — Drillthrough and dedicated workspaces

### Objective

Keep overview concise while preserving deep evidence.

### Work

- Extend generic metric detail contract with health/reconciliation/warnings.
- Fix full-result aggregates such as top counter/user.
- Add focus management to drawers.
- Add explicit full-page actions.
- Preserve URL context through doctor, test, commission, IPD, financial audit, stock, and audit workspaces.

### Gate

Browser refresh, back, and copied URL reproduce the same filtered detail when permitted.

## 13. Phase 10 — Performance, accessibility, and observability

### Performance

- Measure default provider fan-out.
- Lazy-load optional below-fold domains.
- Review D1 query plans and indexes.
- Enforce bounded ranges and pagination.
- Record endpoint latency and response size.

### Accessibility

- Keyboard and focus testing
- Screen-reader labels and chart summaries
- Color-independent states
- Responsive table alternatives
- Reduced-motion support

### Observability

- Source-status counts
- Reconciliation failure counts
- Partial dashboard load rate
- Unknown/unmapped amount/count
- Slow provider timing
- Drill/action navigation errors

### Gate

Performance, accessibility, and security release criteria in the QA plan pass.

## 14. Phase 11 — Shadow rollout and cutover

### Steps

1. Deploy additive backend contracts with UI flag off.
2. Run fixture and staging parity.
3. Enable for internal/test tenant.
4. Observe source status, reconciliation, latency, and response size.
5. Resolve all material unexplained differences.
6. Enable read-only control center for pilot hospital.
7. Collect operational feedback.
8. Expand tenant cohort.
9. Retire duplicate dashboard surfaces only after adoption and parity.
10. Remove legacy adapters in a separate cleanup task.

### Rollback

- Disable feature flag.
- Preserve old dashboard routes and UI during rollout.
- No destructive schema rollback is required for additive fields/tables.
- Reconciliation and warning data remain audit evidence.

## 15. Dependency map

```text
P0 contract freeze
└── P1 semantic foundation
    ├── P2 overview API
    │   ├── P3 role presets/shell
    │   ├── P4 financial reconciliation
    │   ├── P6 trend/payment
    │   └── P7 operations/capacity
    ├── P5 Action Center consolidation
    └── P8 business audit

P3 + P4 + P5 + P6 + P7 + P8
└── P9 drillthrough
    └── P10 performance/a11y/observability
        └── P11 rollout
```

## 16. Suggested checkpoint commits

1. `feat(dashboard): add semantic metric registry and filter contract`
2. `feat(dashboard): add versioned admin overview response`
3. `feat(dashboard): add role presets and control center shell`
4. `feat(dashboard): add financial reconciliation bridges`
5. `refactor(dashboard): consolidate management actions`
6. `feat(dashboard): add period trend and payment mix`
7. `feat(dashboard): separate patient flow and live capacity`
8. `feat(audit): add material dashboard event feed`
9. `feat(dashboard): preserve drillthrough context and health state`
10. `perf(dashboard): bound overview loading and add observability`
11. `test(dashboard): add rollout reconciliation and accessibility gates`

## 17. Completion definition

The program is complete only when:

- default overview is focused,
- all metrics have explicit semantics,
- live versus historical context is unmistakable,
- financial values reconcile,
- partial source failure cannot masquerade as zero,
- Action Center is the only exception queue,
- unknown/unmapped data is visible,
- detail and exports share filters and totals,
- permissions are server enforced,
- performance and accessibility gates pass,
- pilot observation shows no material unexplained differences.
