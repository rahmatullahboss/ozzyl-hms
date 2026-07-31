# Admin Command Center Blueprint

## Rule for this branch

Do not merge to `main` and do not deploy until the complete command-center rollout is implemented, tested, built, reviewed, merged to main, and deployed from main.

## Goal

The dashboard must feel like an enterprise hospital command center. It should help admins and owners quickly answer:

1. Is today's cash safe and reconciled?
2. Is revenue leaking through discounts, dues, refunds, cancellations, or unposted payments?
3. Are OPD, IPD, lab, pharmacy, and bed operations flowing normally?
4. Which counter, staff member, or department needs attention?
5. What action should be taken next?

## Full implementation scope

### Executive command strip

Show high-signal cards for selected-day cash, expense, outstanding due, discount, OPD patients, and IPD admitted patients. Every financial card opens a KPI drilldown.

### Financial control center

Show net drawer movement, money-in sources, cash-out sources, and source row counts. Labels must be human-readable and must never show internal translation keys.

### Exception and risk center

Surface receivable exposure, discount audit, and expense evidence. These are currently derived from available dashboard totals and should later be expanded with dedicated exception APIs.

### Patient flow and operations

Keep OPD, diagnostic, IPD, and pharmacy operational widgets visible with responsive card layouts.

### Department, staff, and counter accountability

Keep action required, live cash drawer, operations snapshot, payment method breakdown, audit feed, and trend widgets visible in one command-center layout. Drilldowns expose counter/user context where rows provide it.

### Enterprise KPI drilldown

Every KPI drawer must show:

- total
- row count
- top source
- top counter/user
- formula/source-of-truth note
- source breakdown
- detail rows with time, invoice/reference, patient/reference, counter/user, items/tests, amount, and status
- invoice row click when bill id is available

### PC and mobile behavior

- Desktop: multi-column command layout with wide KPI drawer.
- Tablet: two-column responsive cards.
- Mobile: stacked cards, full-width drawer, horizontal table safety for dense rows, touch-friendly buttons.

## Test gate

Before merge/deploy:

- `KPISummaryCards.test.tsx`
- `KpiBreakdownDrawer.test.tsx`
- dashboard integration tests
- web build
- backend KPI breakdown tests
- enterprise review checklist

## Known future expansion after this rollout

Dedicated APIs should later provide richer exception counts, due aging, department splits, staff suspicious activity, and SLA breaches. The current rollout uses the strongest available dashboard and KPI breakdown data without inventing backend facts.
