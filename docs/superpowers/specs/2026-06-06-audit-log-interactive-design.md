# Audit Log Interactive Design

**Date:** 2026-06-06
**Status:** Approved (pending user review of spec)
**Author:** Brainstorming session output

## Problem

The current audit log UI (both the dashboard "Recent Activity" widget and the full `/system-audit` page) presents activity records as a flat, hard-to-scan list. Cash-flow entries (PAYMENT, Billing Deposit, Cash Drawer, Handover, Expense) are mixed with clinical, settings, and operational entries. Admins cannot quickly tell at a glance "how much money moved" or "what changed in the system" because the visual rhythm is the same for every record.

The user wants:
- Activity grouped into 2 categories: **Cash & Transactions** vs **Other Activity**
- Card-based interactive UI (instead of a plain table)
- Cash group visually distinct (color + icon)
- Click-to-filter behavior
- Compact one-line entries inside each card

## Goals

1. Make cash-flow activity immediately scannable
2. Reduce visual noise by collapsing clinical/settings/operations into a single "Other" group
3. Keep the same group definitions consistent between the dashboard widget and the full audit page
4. Mobile-first, but still look good on desktop

## Non-Goals

- Backend changes (the existing `/api/audit/logs` and `/api/dashboard` endpoints already return `table_name` and `record_id` — group logic is purely client-side)
- New audit event types or new fields
- Per-user audit diffing (old_value vs new_value side-by-side) — out of scope

## Design

### Grouping

Two groups replace the previous five:

| Key    | Label (en)             | Label (bn)             | Color   | Icon       | Tables |
|--------|------------------------|------------------------|---------|------------|--------|
| `cash` | Cash & Transactions    | ক্যাশ ও লেনদেন        | emerald | Banknote   | `bills`, `billing`, `billing_deposits`, `billing_counter_sessions`, `billing_handovers`, `cash_drawer_movements`, `expenses`, `payments`, `emp_cash_transactions` |
| `other`| Other Activity         | অন্যান্য কার্যক্রম    | blue    | Activity   | everything else |

The old five groups (`cash`, `settings`, `clinical`, `operations`, `other`) collapse into these two. Settings, clinical, and operations all roll into `other` because admins triaging recent activity mostly care about money first, everything else second.

### Architecture

```
web/src/lib/auditGroups.ts            [NEW]  single source of truth
web/src/components/AuditEntryCard.tsx [NEW]  one compact entry
web/src/components/AuditGroupCard.tsx [NEW]  group container with header + list

web/src/pages/SystemAuditLog.tsx           [UPDATE]  use shared utility, drop to 2 groups, switch from table to card list
web/src/pages/HospitalAdminDashboard.tsx   [UPDATE]  replace flat list with 2 group cards (3–5 entries each)
```

#### `web/src/lib/auditGroups.ts`

Exports:
- `AuditGroupKey = 'cash' | 'other'`
- `AUDIT_GROUPS: AuditGroup[]` — array of 2 groups with `{ key, labelKey, descriptionKey, icon, color, tables }`
- `getAuditGroup(tableName): AuditGroupKey` — returns `'cash'` if table is in the cash list, else `'other'`
- `ACTION_COLORS`, `ACTION_LABELS`, `ENTITY_LABELS` — moved out of `SystemAuditLog.tsx` so both consumers share them
- TypeScript types: `RawAuditEntry`, `AuditEntry`, `AuditGroup`

#### `web/src/components/AuditEntryCard.tsx`

Props: `{ entry: AuditEntry; onClick?: () => void; dense?: boolean }`

Renders a one-line card:
- Action badge (colored by action — `Created` green, `PAYMENT` blue, `Updated` blue, `Deleted` red, etc.)
- Entity label + record id (`Bill #5196`)
- User name
- Time (compact `6/4 5:23 PM`)
- For cash entries, also shows amount if `new_value.amount` / `new_value.total` is present

#### `web/src/components/AuditGroupCard.tsx`

Props: `{ group: AuditGroup; entries: AuditEntry[]; selected?: boolean; onToggle?: () => void; maxItems?: number; href?: string }`

Renders:
- Header: icon + group label + count badge
- List of `AuditEntryCard` (capped at `maxItems`, default 5)
- Footer: "View all →" link if `href` is provided, otherwise "Show more" if entries > maxItems
- Selected state: thicker border in the group color, light tinted background
- Click on the card body → calls `onToggle` (used for filter)

### Dashboard Widget (`HospitalAdminDashboard.tsx`)

Replace lines 1681–1775 with:

```tsx
const cashEntries = useMemo(
  () => recentActivity.filter(a => getAuditGroup(a.tableName) === 'cash'),
  [recentActivity]
);
const otherEntries = useMemo(
  () => recentActivity.filter(a => getAuditGroup(a.tableName) === 'other'),
  [recentActivity]
);

const [activeGroup, setActiveGroup] = useState<AuditGroupKey | null>(null);
const visible = activeGroup === 'cash' ? cashEntries
              : activeGroup === 'other' ? otherEntries
              : [...cashEntries, ...otherEntries];

// ... in JSX:
<div className="card overflow-hidden">
  <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-border)]">
    <h3 className="section-title">{t('recentActivity')}</h3>
    <button onClick={() => navigate(`${base}/audit`)} className="text-sm text-[var(--color-primary)] hover:underline font-medium">
      {t('viewAll')} →
    </button>
  </div>

  {/* Group cards */}
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 border-b border-[var(--color-border)]">
    <AuditGroupCard
      group={AUDIT_GROUPS[0]}
      entries={cashEntries}
      maxItems={3}
      selected={activeGroup === 'cash'}
      onToggle={() => setActiveGroup(activeGroup === 'cash' ? null : 'cash')}
      href={`${base}/audit?group=cash`}
    />
    <AuditGroupCard
      group={AUDIT_GROUPS[1]}
      entries={otherEntries}
      maxItems={3}
      selected={activeGroup === 'other'}
      onToggle={() => setActiveGroup(activeGroup === 'other' ? null : 'other')}
      href={`${base}/audit?group=other`}
    />
  </div>

  {/* Filtered list (when a group is selected) or combined "latest" preview */}
  {activeGroup && (
    <div className="divide-y divide-[var(--color-border)]">
      {visible.slice(0, 10).map(a => <AuditEntryCard key={a.id} entry={toAuditEntry(a)} />)}
    </div>
  )}
</div>
```

Mobile: stacks vertically. Desktop: two-column group cards.

### Full Audit Page (`SystemAuditLog.tsx`)

- Drop the 5-group `AUDIT_GROUPS` definition; import the shared one
- Replace the top "Group Cards" row with the 2-group version (same `AuditGroupCard` component)
- Replace the `<table>` block with a list of `AuditEntryCard`s; keep the existing filter bar (action, entity, search)
- The mobile card list (currently `sm:hidden`) merges into the new card list — only one rendering path needed

### i18n

Add to `web/src/locales/en/common.json` and `bn/common.json`:
- `auditGroup.cash.label` / `auditGroup.cash.description`
- `auditGroup.other.label` / `auditGroup.other.description`
- `auditGroup.viewAll` (e.g., "View all cash activity →")

### Testing

- New `web/src/lib/auditGroups.test.ts` — `getAuditGroup()` table-to-group mapping
- New `web/src/components/AuditEntryCard.test.tsx` — renders action badge, user, time; click handler fires
- New `web/src/components/AuditGroupCard.test.tsx` — selected state, max items cap, footer link
- Update `web/src/pages/SystemAuditLog.test.ts` — assert 2 group cards (was 5), filtered list renders `AuditEntryCard`
- Update `web/src/pages/HospitalAdminDashboard.test.tsx` — assert group cards render with the right entries

### Visual Mockup

Dashboard widget:
```
┌────────────────────────────────────────────────────┐
│ সাম্প্রতিক কার্যক্রম               সব দেখুন →     │
├──────────────────────┬─────────────────────────────┤
│ 💵 ক্যাশ ও লেনদেন    │ 📋 অন্যান্য কার্যক্রম       │
│ ৫টি এন্ট্রি           │ ১০টি এন্ট্রি                 │
│ ──────────────       │ ──────────────               │
│ Bill #5196 • ৳5,000  │ Token #1                    │
│ Deposit • ৳2,500     │ Admission #13060             │
│ Bill #5195 • ৳3,200  │ Token #2                    │
│ সব ক্যাশ দেখুন →     │ সব দেখুন →                  │
└──────────────────────┴─────────────────────────────┘
```

Full audit page:
```
┌────────────────────────────────────────────────────┐
│ ফিল্টার: [💵 ক্যাশ ১৫]  [📋 অন্যান্য ৪২]  [সব]    │
├────────────────────────────────────────────────────┤
│ ┌─ [Created] Bill #5196 ────────────────────┐      │
│ │ Nusrat Jahan • ৳5,000 • 6/4 5:23 PM      │      │
│ └──────────────────────────────────────────┘      │
│ ┌─ [PAYMENT] Billing Deposit #55 ──────────┐      │
│ │ Nusrat Jahan • ৳2,500 • 6/4 9:37 PM      │      │
│ └──────────────────────────────────────────┘      │
│ ...                                                │
└────────────────────────────────────────────────────┘
```

## Risks

- **R1:** Collapsing 5 groups into 2 loses filter granularity. Mitigation: the existing entity-level filter (`bills`, `patients`, etc.) on the audit page still gives admins full drill-down.
- **R2:** Dashboard widget's 15-row LIMIT might not include any cash entries. Mitigation: in the unlikely case one group is empty, show a "No cash activity in the last fetch" empty state inside that group card instead of hiding it.
- **R3:** `old_value` / `new_value` JSON may not always contain `amount`. Mitigation: `AuditEntryCard` only renders the amount badge if a numeric amount is parsed; otherwise hides it.

## Out of Scope (deferred)

- Detail modal with full old_value / new_value diff
- "Compare two snapshots" feature
- Real-time WebSocket push for new audit events
- Per-tenant or per-user filtering at the widget level
