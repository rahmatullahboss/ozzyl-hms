# Admin Dashboard Control Center — Information Architecture and UX Specification

**Date:** 2026-07-22
**Status:** Controlling UX direction
**Audience:** Product, UX, frontend, backend, QA

## 1. Experience objective

The dashboard must behave like a hospital management control room, not a catalogue of every available report. It should help a user scan, understand trust state, prioritize work, and move to the correct evidence surface.

The design optimizes for:

- rapid scanning,
- semantic clarity,
- exception-first decision making,
- progressive disclosure,
- reproducible filters,
- keyboard and screen-reader use,
- stable perceived performance.

## 2. Page hierarchy

```text
Admin Control Center
├── Global context and data health
├── Primary decision signals
├── Financial reconciliation
├── Action Center
├── Operational flow and current capacity
├── Domain health summaries
├── Material audit events
└── Links to full report workspaces
```

Default order is intentional. Data-health and primary decisions appear before detailed domain tables.

## 3. Global context bar

### 3.1 Required visible elements

- Page title: `Hospital Admin Control Center`
- Active hospital/branch when multi-site applies
- Range preset and explicit start/end dates
- Date-basis selector or locked basis label
- Timezone: `Asia/Dhaka`
- Aggregate data-health badge
- Server generated timestamp
- Refresh action
- Optional “More filters” disclosure for doctor/test/department filters

### 3.2 Temporal-mode treatment

The page supports three modes but does not force one global mode for all metrics:

| Mode | Meaning | UI treatment |
|---|---|---|
| Period | Events within selected dates | Calendar/range badge |
| As of | Balance/state at end date | `As of <date>` badge |
| Live | Current operational state | Prominent `Live` badge and own refresh time |

A live widget remains live when the user selects a historical period. It must state this explicitly rather than silently appearing filtered.

### 3.3 Filter behavior

- Preset buttons update URL state.
- Custom range requires valid start ≤ end.
- Filter changes reset pagination and selected preview state.
- Browser back/forward restores filters and expanded section where practical.
- A copied URL reproduces the same permitted view.
- Live widgets do not change their source query when a historical period is selected; their labels remain stable.

### 3.4 Data-health disclosure

Collapsed state example:

```text
Data health: Warning · 2 domains need attention
```

Expanded content:

- domain,
- state,
- generated time,
- unavailable/stale source,
- reconciliation difference,
- recommended recovery action.

## 4. Above-the-fold layout

### Desktop ≥ 1280 px

```text
[ Global context bar                                      ]
[ KPI 1 ][ KPI 2 ][ KPI 3 ][ KPI 4 ][ KPI 5 ]
[ KPI 6 ][ KPI 7 ][ KPI 8 ][ KPI 9 ][ KPI 10]
[ Financial reconciliation bridge       ][ Action summary ]
```

### Tablet 768–1279 px

- Global context wraps into two rows.
- KPI grid uses two or three columns.
- Financial bridge and Action Center stack.

### Mobile < 768 px

- Context controls use horizontal wrapping, not horizontal page scrolling.
- Primary KPI grid becomes one column or compact two-column cards when text remains readable.
- Only primary value and one status line remain visible; secondary formula/comparison is expandable.
- Tables become card lists or responsive column-priority views.
- No critical action is hidden behind hover.

## 5. Primary KPI card specification

### 5.1 Anatomy

```text
[Temporal badge]                      [Health icon/text]
Explicit metric name
৳123,456
+৳12,000 · +10.8% vs previous period
Target: ≤ ৳100,000 / No target
Payment date · Generated 5:30 PM
View details →
```

### 5.2 Content priority

1. Metric name
2. Current value
3. comparison or threshold
4. temporal/date context
5. health/reconciliation state
6. drill action

### 5.3 Visual status

Use semantic tokens and visible text:

- Healthy
- Needs review
- Partial
- Stale
- Unreconciled
- Unavailable

Do not communicate status only through green, amber, or red.

### 5.4 Direction logic

| Metric type | Desirable direction |
|---|---|
| Collection, completed services | Higher may be positive but requires capacity/context |
| Expense, due, waiting time, stock-out | Lower is generally positive |
| Bed occupancy | Target range, not always higher |
| Variance/unexplained difference | Zero target |
| Approvals/exceptions | Lower is positive |
| Commission | Neutral amount; status depends on payable/paid/overdue semantics |

The server registry supplies direction; frontend does not infer it from the sign.

### 5.5 Card interactions

- Entire card may be keyboard/click activated when it has one action.
- Native `<button>` or `<a>` is preferred over a generic `div role="button"` when markup allows.
- `Enter` and `Space` activate.
- Focus is visible.
- Drill target is announced in the accessible label.

## 6. Recommended Hospital Admin preset

### Primary cards

1. Net billed amount — period, bill date
2. Cash received — period, payment date
3. Non-cash received — period, payment date
4. Approved expense paid — period, payment/execution date
5. New due created — period, bill date
6. Outstanding due — as of period end
7. Net cash movement — period, movement date
8. Drawer variance — live/latest closing
9. Critical actions — current queue
10. Bed occupancy — live/current

### Not primary by default

- every service-category collection card,
- every commission subtype,
- all inventory/reagent/radiology SKU states,
- complete doctor/test tables,
- detailed IPD transaction table,
- generic low-risk audit events.

These remain available through compact domain summaries, configuration, or full workspaces.

## 7. Financial reconciliation section

### 7.1 Layout

Use a structured bridge rather than independent decorative cards.

#### Billing bridge

```text
Gross billed                         ৳300,000
Discount                            −৳20,000
Net billed                           ৳280,000
New due created                     −৳40,000
Collection against period bills      ৳240,000
```

#### Collection and cash bridge

```text
Bill collection                      ৳240,000
Prior-period due collection          ৳30,000
New deposits received                ৳20,000
Refunds/returns                     −৳5,000
Approved cash expense paid          −৳15,000
Doctor payout paid                  −৳10,000
Net cash movement                    ৳260,000
```

#### Custody bridge

```text
Opening/received drawer cash         ৳100,000
Net cash movement                    ৳260,000
Cash drop/handover                  −৳300,000
Expected available cash              ৳60,000
Counted/closed cash                   ৳59,500
Variance                                −৳500
```

Only rows supported by the authoritative source contract are displayed.

### 7.2 Reconciliation badge

- `Balanced` when unexplained difference is within tolerance.
- `Unreconciled by ৳X` otherwise.
- Clicking the difference opens the exception/filter context, never a generic unfiltered report.

### 7.3 Drill behavior

Each bridge row opens a bounded source preview. Complex investigation links to Financial Audit, Daily Collection, Cash Drawers, Expenses, Payouts, Deposits, or Accounting reports with preserved context.

## 8. Action Center

### 8.1 Information hierarchy

```text
Action Center · 3 critical · 8 warning
[Critical] Unbalanced closing      ৳500   2h old   Owner: Cashier A
[Critical] Unknown payment method  ৳4,000 3 rows   Owner: Reception
[Warning ] Missing expense receipt ৳2,500 1 day    Owner: Accounts
```

### 8.2 Required item content

- severity text and icon,
- title,
- amount and/or count,
- age/SLA,
- owner/assignee when available,
- capability state (`Manage` or `Review only`),
- explicit action.

### 8.3 Rules

- Sort critical first, then SLA breach, then oldest age/amount according to rule policy.
- Empty state confirms there are no active actions, not merely no data.
- Stale or partial queue state is visible.
- Do not duplicate the queue elsewhere on the page.

## 9. Operations section

### 9.1 Period flow

Use a compact horizontal/vertical funnel or step strip:

```text
Checked in 120
→ Consulted 95
→ Tests ordered 60
→ Tests completed 52
→ Admitted 8
→ Discharged 6
```

Display drop-off or completion ratio only when stages share compatible source definitions.

### 9.2 Current capacity

Separate live/current tiles:

- bed occupancy,
- available beds,
- active cash counters,
- diagnostic backlog,
- pending discharge settlement.

### 9.3 Domain health cards

Each domain has one compact summary:

```text
Laboratory
Critical 1 · Warning 7
1 QC block · 7 overdue tests
Open laboratory monitor →
```

No full 10-column domain table belongs in the default overview.

## 10. Trend visualization

### 10.1 Measure naming

Chart title must include the actual measure:

- Payment-date collection trend
- Net billed trend
- Expense paid trend
- New due trend

Avoid generic `Revenue trend` unless the response is explicitly GL-posted revenue.

### 10.2 Chart rules

- Line chart for four or more chronological points.
- Stat card for one to three points.
- Maximum six simultaneous series.
- Visible time granularity: day/week/month.
- Exact values available through pointer, touch, and keyboard.
- Accessible text summary and expandable data table.
- Subtle gridlines; no glow or gradient that competes with data.
- Different line styles or direct labels when multiple series are present.
- Empty and error states contain recovery guidance.

## 11. Payment method visualization

Use a ranked list and compact stacked bar when categories are few. Every row displays method, amount, and percentage.

Unknown/blank payment method appears first as a warning when non-zero:

```text
Unknown method · ৳4,000 · 3 transactions · Fix classification
```

Do not rely on colored circles alone; method text and amounts remain visible.

## 12. Audit feed

### 12.1 Dashboard event format

```text
Critical · Bill amount changed
Rahim changed INV-105 from ৳12,500 to ৳9,500
Difference ৳3,000 · Approval pending · 5:28 PM
Review event →
```

### 12.2 Included events

- material bill changes,
- discount overrides,
- cancellation/refund,
- expense/payout execution,
- cash variance/handover,
- permission changes,
- sensitive export.

Generic `CREATE/UPDATE table #id` stays in the Audit Explorer.

## 13. Drillthrough and navigation

### 13.1 Levels

```text
Dashboard summary
→ source/category preview
→ dedicated filtered workspace
→ individual record
→ audit history
```

### 13.2 Context persistence

The URL carries:

- start/end dates,
- preset,
- date basis,
- metric/source,
- doctor/test/department when selected,
- status,
- temporal mode where applicable.

Back navigation restores filter and scroll state.

### 13.3 Dialog and drawer behavior

- Focus moves into the drawer/dialog on open.
- Focus is trapped while modal.
- Escape closes unless a destructive operation is in progress.
- Focus returns to the trigger.
- Drawer title includes metric and period.
- Full-page action is visible for complex analysis.

## 14. Loading, empty, and failure states

### Loading

Reserve final layout dimensions. Skeletons match the expected card/table geometry.

### Verified zero

```text
৳0
Complete data · No matching activity
```

### Empty/not applicable

```text
Not applicable for this hospital configuration
```

### Partial

```text
Partial data
Cash totals loaded; handover source unavailable
Retry source →
```

### Stale

```text
Stale · generated 18 minutes ago
Refresh →
```

### Unreconciled

```text
Unreconciled by ৳500
Open matching exceptions →
```

### Error

State the affected domain, what remains usable, and a specific retry path.

## 15. Configuration UX

### 15.1 Presets first

Configuration starts from role presets:

- Hospital Admin
- MD/Director
- Accountant
- Manager Operations

### 15.2 Customization limits

- User may enable optional sections.
- System warns when too many primary cards are selected.
- A section can be collapsed or moved, but semantic definitions are not editable.
- Labels may be localized or given approved aliases; they cannot change the underlying measure meaning.
- “Reset to role preset” is always available.

## 16. Localization

- English and Bangla use equivalent financial meanings.
- Avoid literal translation that reintroduces ambiguity.
- BDT formatting is consistent.
- Dates display in Asia/Dhaka.
- Technical reason codes may be hidden behind readable localized messages while remaining available in detail/export.

## 17. Accessibility checklist

- One page-level `<h1>` and logical heading sequence
- Landmark for filters, main content, and complementary live controls
- Filter controls have visible labels
- Keyboard-operable tabs and date inputs
- No hover-only disclosure
- Status includes text/icon, not color alone
- Tables have headers and sortable state where applicable
- Chart data table and screen-reader summary
- Minimum 44 px interactive targets where practical
- Focus-visible styles
- Reduced-motion support for card/chart transitions
- Dialog focus management
- Contrast verified in light and dark modes
- Horizontal tables provide a non-scrolling priority/card alternative on narrow screens

## 18. Visual style direction

The product should use a restrained enterprise healthcare style:

- dense but organized spacing,
- strong typographic hierarchy,
- neutral surfaces,
- semantic color only for status and emphasis,
- tabular figures for money/counts,
- consistent Lucide icon treatment,
- minimal decorative animation,
- no excessive glow, gradient, or card elevation,
- light and dark mode parity.

Visual polish must not obscure exact values or status.

## 19. UX acceptance criteria

1. A user can identify the period, date basis, timezone, and data-health state without opening another control.
2. Live values remain visibly live during historical review.
3. The default view contains no more than 10 primary KPI signals.
4. An exception is reachable in one action from the overview.
5. Every financial primary signal displays reconciliation state.
6. Unknown/unmapped values are visible and actionable.
7. A keyboard-only user can filter, open a KPI, navigate detail, and close the drawer.
8. Mobile view has no page-level horizontal overflow.
9. Back navigation preserves report context.
10. Full domain tables are not loaded or displayed by default above the fold.
