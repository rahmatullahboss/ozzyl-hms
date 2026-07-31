# Admin Dashboard Control Center — Product Analysis

**Date:** 2026-07-22
**Reviewed base:** local `main` at `79b054a199dbc877d0232015dcf9625361b0a08e`
**Analysis status:** Complete
**Selected improvement target:** Shared temporal, data-health, and reconciliation foundation

## Product snapshot

The current Hospital Admin Dashboard already includes broad operational and financial reporting capability:

- configurable KPI cards,
- date-range filtering for KPI and executive analytics,
- doctor/test/income/expense/reagent panels,
- IPD finance reporting,
- pending requests and Action Center,
- revenue/collection trend,
- payment-method mix,
- operations and bed status,
- live cash drawers,
- audit feed,
- summary-to-invoice drillthrough.

The implementation is technically more capable than a shallow dashboard. The product problem is that most available measures are enabled together and do not share one universal contract for temporal meaning, source completeness, comparison, reconciliation, or action priority.

The default registry currently enables 40 KPI cards and 5 full analytics panels. Additional non-registry widgets make the page a collection of reports rather than a focused management overview.

## User feedback represented

The product owner reports that the dashboard feels vague and shallow because values do not consistently explain:

- exactly what the number means,
- which time basis it uses,
- whether all sources loaded,
- why it changed,
- whether summary and detail match,
- which issue requires action.

This feedback is supported by the code review. The top range applies to some sections, while revenue trend, payment methods, operations, live cash, Action Center, and audit feed retain independent today/current/latest semantics without a universal visual distinction.

## Improvement targets

| Priority | Target | Impact | Effort |
|---|---|---:|---:|
| 1 | Shared temporal/date-basis and data-health contract | Very high | Medium |
| 2 | Financial summary/detail reconciliation and source warnings | Very high | High |
| 3 | Focused role presets with no more than 10 primary Admin KPIs | Very high | Medium |
| 4 | One persistent Action Center; remove frontend heuristic risks | High | Medium |
| 5 | Period-aware trend/payment mix and visible live states | High | Medium |
| 6 | Financial reconciliation bridge | High | High |
| 7 | Separate period patient flow from current capacity | Medium-high | Medium |
| 8 | Material business audit events instead of raw CRUD | Medium-high | Medium |
| 9 | Dedicated full-page domain analysis and context-preserving drillthrough | Medium | High |
| 10 | Lazy loading, response bundling, accessibility, and observability | Medium | Medium |

## Selected target

**Shared temporal, data-health, and reconciliation foundation** is selected first.

### Rationale

Visual redesign or additional analytics cannot solve ambiguity while widgets use different periods and missing source data can resemble zero. A common trust envelope is required before reducing cards, displaying comparisons, or adding financial bridges.

The foundation must establish:

- `period`, `as_of`, and `live` temporal modes,
- explicit date basis,
- Asia/Dhaka reporting context,
- server-generated timestamps,
- complete/partial/stale/unavailable states,
- warning reason codes,
- full-result reconciliation independent of pagination,
- role-aware metric definitions and drill targets.

## Controlling program documents

- `docs/admin-dashboard/README.md`
- `docs/admin-dashboard/2026-07-22-current-state-audit.md`
- `docs/admin-dashboard/2026-07-22-product-requirements.md`
- `docs/admin-dashboard/2026-07-22-information-architecture-ux-spec.md`
- `docs/admin-dashboard/2026-07-22-data-semantic-api-contract.md`
- `docs/admin-dashboard/2026-07-22-implementation-roadmap.md`
- `docs/admin-dashboard/2026-07-22-qa-acceptance-test-plan.md`
- `docs/admin-dashboard/2026-07-22-agent-task-board.yaml`
- `docs/superpowers/plans/2026-07-22-admin-dashboard-control-center-implementation.md`

## Product decision

The current dashboard will be evolved additively rather than replaced. Existing operational sources, pagination, IPD reporting, Action Center, and drilldown foundations will be reused. Implementation will be feature-flagged and reconciliation-first, with legacy surfaces retained until parity and pilot gates pass.
