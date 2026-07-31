# Admin Command Center Page Override

Date: 2026-07-27
Parent: `design-system/hms-saas/MASTER.md`

This file overrides the global design system only for the Admin Command Center and its drawers/inspectors.

## 1. Product mode

- Style: data-dense enterprise healthcare dashboard
- Variance: balanced, predictable, low visual novelty
- Motion: subtle and functional
- Density: high on desktop, progressive disclosure on smaller screens
- Icons: existing Lucide set only
- Color: existing semantic cyan/green system; amber/red reserved for warnings and critical states

The command center is a control surface, not a marketing page. Do not apply hero, social-proof, neumorphic, or conversion-page patterns from the global file.

## 2. Page hierarchy

Desktop order:

1. Page title and refresh state
2. Shared period selector
3. Workspace navigation
4. Reconciliation/status strip for the active workspace
5. Active workspace content
6. Drawers/inspectors opened from stable URL state

The shared period selector and workspace navigation remain visible near the top after route changes. They are not duplicated inside individual panels.

## 3. Workspace navigation

### Desktop

Use a horizontally scrollable labeled tab bar:

- Overview
- Money
- Doctors
- Patients
- IPD
- Diagnostics
- Inventory
- Audit

Requirements:

- Text label plus Lucide icon
- Active indicator and `aria-current`/`aria-selected`
- Minimum 44 px interaction height
- Preserve filter state on tab change
- Do not mix this tab hierarchy with another top-level sidebar hierarchy inside the page

### Mobile

Use a labeled workspace select or compact horizontally scrollable tabs. Do not show more than four cramped icon-only controls.

## 4. KPI density

### Overview

- Maximum 10 primary cards
- 2 columns at 375 px
- 2–3 columns at 768 px
- 4–5 columns at 1,024 px and above
- Card labels may wrap to two lines
- Values use tabular figures
- Each card includes one semantic detail line or basis label

### Detailed workspaces

Do not repeat every Overview card. Use section-specific totals and tables.

## 5. Date basis and live status

Every panel header shows one of:

- Service date
- Bill date
- Payment date
- Commission accrual date
- Commission settlement date
- Live/current state

Live/current panels use a text badge with an icon, not color alone. Historical panels show the selected period label.

## 6. Reconciliation status

Use a compact strip near the top of financial sections:

```text
Reconciled · Summary ৳X · Details ৳X · Difference ৳0
```

States:

- Reconciled: neutral/green check plus text
- Warning: amber warning icon plus exact difference
- Unavailable: gray information icon plus reason

Never hide the difference behind a tooltip.

## 7. Financial control layout

Desktop Money workspace:

```text
Business performance | Collection flow
Cash custody         | Doctor liability
Trend and payment methods across full width
Detail tables below
```

Mobile:

- One block per row
- Formula displayed as a vertical calculation bridge
- Primary total remains visible without horizontal scrolling

Deposits, collection, revenue, drawer cash, and doctor liability use separate labels and cannot share one unlabeled total.

## 8. Tables

### Desktop

- Use existing table tokens
- Sticky identity column only at widths where it does not cover other columns
- Sortable headers show `aria-sort`
- Column chooser for secondary fields
- Server-side pagination
- Row click is never the only way to open detail; include a labeled action or linked identity

### Tablet and mobile

Do not rely on `min-width: 1800px` or larger.

Use:

- Priority columns
- Expandable row details
- Card rows for doctor and invoice summaries
- “More details” disclosure
- Horizontal scrolling only for optional audit-style raw tables

## 9. Doctor workspace

Primary doctor row fields:

- Doctor name
- Visits
- Referred tests
- Performed tests
- Collection
- Payable
- Paid
- Outstanding
- Last activity

Expanded detail or drawer includes the complete compensation formula.

Doctor drawer tabs:

- Summary
- Activity
- Visits
- Referred tests
- Performed tests
- Compensation

Invoice numbers are interactive links/buttons with visible focus state.

## 10. Invoice inspector

### Desktop

- Right-side drawer, maximum width approximately 1,120–1,280 px
- Full-height with independent content scroll
- Header contains invoice number, status, copy action, print/PDF/full-page actions, and close
- Tab row remains visible while content scrolls

### Mobile

- Full-screen sheet
- Sticky header and tab selector
- Clear Back/Close action
- No nested horizontal table required for the Summary tab

Tabs:

- Summary
- Items & tests
- Payments & deposits
- Discount & referral
- Doctor compensation
- Audit timeline

Focus moves to the close control on open and returns to the trigger on close. Escape closes on desktop. Browser Back closes a URL-opened inspector.

## 11. Patient age analytics

Use horizontal bars or a compact table rather than a donut with seven categories.

Each bucket displays:

- Label
- Unique patients
- Visits/services
- Collection
- Share

Selecting a bucket opens aggregate service/doctor/department detail first. Patient identity is a separate permission-gated view.

## 12. Action Center summary

Overview shows one compact Action Center panel with:

- Pending approvals
- Critical exceptions
- Receivable exposure
- Overdue tasks
- Next best action

The panel links to the existing Action Center. Do not render a second local exception grid with independent calculations.

## 13. Accessibility

- Text contrast at least 4.5:1
- Interactive target at least 44×44 px
- Visible focus rings
- Dialogs use `role="dialog"`, `aria-modal`, labeled headings, focus restoration, and Escape support
- Status never communicated by color alone
- Charts include textual totals and table alternatives
- Reduced-motion preference disables non-essential transitions
- Loading and errors use appropriate live regions without stealing focus

## 14. Motion

- 150–250 ms opacity/translate transitions
- No layout-shifting scale effects on cards or rows
- No animated number counting for financial totals
- Drawer motion must remain interruptible
- Refresh does not blank the full page; keep previous content with a clear fetching state

## 15. Responsive verification

Required viewport checks:

- 375×812
- 768×1,024
- 1,024×768
- 1,440×900

At every viewport:

- No primary action is hidden
- The selected period is visible
- Workspace navigation is usable
- Financial formulas remain readable
- Doctor and invoice drill paths remain reachable
- Patient identity does not appear without permission
