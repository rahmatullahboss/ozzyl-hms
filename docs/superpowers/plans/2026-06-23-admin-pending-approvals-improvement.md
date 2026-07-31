# Admin Pending Approvals Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Admin Pending Approvals page match the HMS design system, make KPI cards clickable filters, and allow safe approve/reject decisions from the filtered queue and detail drawer.

**Architecture:** Keep the existing `/api/approvals` backend as the source of truth. Refactor the frontend page into small UI helpers inside `web/src/pages/admin/PendingApprovals.tsx` first, then extract reusable components only if the file becomes hard to maintain. Use existing admin primitives (`DashboardLayout`, `BulkActionsBar`, `ApprovalDetailDrawer`, design-system `.card`, `.btn-*`, `.input`, token colors) instead of hand-coded white/gray Tailwind blocks.

**Tech Stack:** React, TypeScript, react-router search params, TanStack Query hooks through `useApiQuery`/`useApiMutation`, Hono Worker API, Vitest + Testing Library.

---

## Current System Map

### Existing frontend files
- `web/src/pages/admin/PendingApprovals.tsx`
  - Fetches `/api/approvals?status=pending&limit=100` with `queryKeys.admin.pendingApprovals()`.
  - Maps API rows into local `Approval` rows.
  - Has type tabs, derived summary cards, manual table, row click drawer, and bottom bulk actions bar.
  - Current design issue: summary cards and table use direct `bg-white`, `border`, `bg-gray-*`, `bg-blue-600`, `text-gray-*` classes instead of HMS tokens/classes like `.card`, `btn-primary`, `bg-[var(--color-primary)]`, and `text-[var(--color-text-secondary)]`.
  - Current interaction gap: summary/KPI cards are static; they do not drive filters.
- `web/src/components/admin/ApprovalDetailDrawer.tsx`
  - Shows request details and has Approve/Reject buttons.
  - Reject note is required, approval note is optional.
  - Uses `DetailDrawer`, `DrawerSection`, and `DrawerField`.
- `web/src/components/admin/BulkActionsBar.tsx`
  - Already handles selected-row bulk approve/reject with confirmation.
- `web/src/components/admin/AdminDataTable.tsx`
  - Existing admin table primitive with search, sorting, column picker, pagination, `.card` wrapper.
  - It does not currently support row selection out of the box, so replacing PendingApprovals table with it requires either extending it carefully or keeping a purpose-built selectable table.
- `web/src/lib/queryKeys.ts`
  - Existing `admin.pendingApprovals()` key is static; `approvals.list(type, status)` and `approvals.counts()` also exist.
- `web/src/App.tsx`
  - `action/pending-approvals` route renders `PendingApprovals`.
- `web/public/locales/en/adminPages.json`
  - Contains `pendingApprovals.*` copy.

### Existing backend files
- `src/routes/tenant/approvals.ts`
  - `GET /api/approvals/counts`: pending counts by type.
  - `GET /api/approvals`: supports `type`, `status`, `page`, `limit` query params.
  - `PUT /api/approvals/:id/review`: approve/reject one request.
  - `POST /api/approvals/bulk-review`: approve/reject up to 100 requests.
  - Enforces reviewer roles and separation of duties; self-request approvals are rejected.
- `src/schemas/approval.ts`
  - Validate query, single review, and bulk-review payloads.

---

## Product Design Decision

Pending Approvals should be a decision queue, not only a table.

Final page layout:
1. Page header with title, subtitle, refresh/action area.
2. Clickable KPI filter strip:
   - Total Pending → all pending requests.
   - High Risk → only `risk === 'high'` pending requests.
   - Older than 24h → only pending requests older than 24 hours.
   - Approved Today → query/show reviewed approvals with `status=approved` for today only if backend supports it; otherwise show a disabled/secondary card labelled as reporting metric until backend support is added.
3. Type filter tabs or segmented controls.
4. Secondary search/filter toolbar: search by request id, patient, requester, reason; optional quick filters for amount/risk.
5. Selectable queue table with visible row actions: `Review`, `Approve`, `Reject`.
6. Drawer for safe decision review with audit information and notes.
7. Bulk action bar for selected pending rows only.

Important rule: for approve/reject, keep the drawer confirmation as the safest path for high-risk or financial requests. Inline row buttons may open the drawer preselected to `approve` or `reject`; avoid one-click final approve without a review step.

---

## Task 1: Add queue filter model and KPI click behavior

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify tests: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] **Step 1: Write failing tests for KPI filters**

Add tests that prove KPI cards are buttons and filter rows:

```tsx
it('filters to high-risk approvals when High Priority KPI is clicked', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  fireEvent.click(screen.getByRole('button', { name: /pendingApprovals.summary.highPriority/i }));

  expect(screen.getByText('AP-003')).toBeInTheDocument();
  expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
});

it('filters to approvals older than 24h when stale KPI is clicked', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  fireEvent.click(screen.getByRole('button', { name: /pendingApprovals.summary.olderThan24h/i }));

  expect(screen.getByText('AP-004')).toBeInTheDocument();
});
```

Use deterministic `created_at` values in `mockData`; set `vi.setSystemTime()` if the test currently depends on real time.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter web test -- PendingApprovals.test.tsx
```

Expected: tests fail because KPI cards are not buttons and do not set filter state.

- [ ] **Step 3: Add filter state**

In `PendingApprovals.tsx`, introduce:

```ts
type QueueFilter = 'all' | 'high-risk' | 'older-than-24h' | 'approved-today';

const KPI_FILTER_LABEL_KEYS: Record<QueueFilter, string> = {
  all: 'totalPending',
  'high-risk': 'highPriority',
  'older-than-24h': 'olderThan24h',
  'approved-today': 'todayApproved',
};
```

Add state and URL sync:

```ts
const queueParam = searchParams.get('queue') as QueueFilter | null;
const isValidQueueFilter = (value: string | null): value is QueueFilter =>
  value === 'all' || value === 'high-risk' || value === 'older-than-24h' || value === 'approved-today';
const [queueFilter, setQueueFilterRaw] = useState<QueueFilter>(() => isValidQueueFilter(queueParam) ? queueParam : 'all');

const updateSearch = (next: Partial<{ tab: TypeTab; queue: QueueFilter }>) => {
  const params = new URLSearchParams(searchParams);
  if (next.tab) params.set('tab', next.tab);
  if (next.queue) params.set('queue', next.queue);
  setSearchParams(params);
};
```

Update `setActiveTab` to preserve queue:

```ts
const setActiveTab = (tab: TypeTab) => {
  setActiveTabRaw(tab);
  updateSearch({ tab });
};

const setQueueFilter = (filter: QueueFilter) => {
  setQueueFilterRaw(filter);
  updateSearch({ queue: filter });
  setSelectedIds(new Set());
};
```

- [ ] **Step 4: Apply KPI + type filtering in one derived list**

Replace current `filtered` with a pipeline:

```ts
const typeFiltered = activeTab === 'All'
  ? approvals
  : approvals.filter((approval) => approval.type === TYPE_MAP[activeTab as keyof typeof TYPE_MAP]);

const filtered = typeFiltered.filter((approval) => {
  if (queueFilter === 'high-risk') return approval.risk === 'high';
  if (queueFilter === 'older-than-24h') return isOlderThan24h(approval.submittedAt);
  if (queueFilter === 'approved-today') return approval.status === 'approved' && isToday(approval.submittedAt);
  return true;
});
```

Add helpers near `humanizeKey`:

```ts
function isOlderThan24h(value: string): boolean {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp > 24 * 60 * 60 * 1000;
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}
```

- [ ] **Step 5: Implement clickable KPI cards**

Create a tiny local component inside `PendingApprovals.tsx`:

```tsx
function KpiFilterCard({ label, value, active, tone, onClick }: {
  label: string;
  value: number;
  active: boolean;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  onClick: () => void;
}) {
  const valueClass = tone === 'danger' ? 'text-red-600'
    : tone === 'warning' ? 'text-orange-600'
    : tone === 'success' ? 'text-green-600'
    : 'text-[var(--color-text-primary)]';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`card p-4 text-left transition-all focus-ring ${active ? 'ring-2 ring-[var(--color-primary)]' : 'hover:shadow-md'}`}
    >
      <div className="text-sm text-[var(--color-text-secondary)]">{label}</div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
    </button>
  );
}
```

Use it for the four KPIs. Each must set the matching `queueFilter`.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter web test -- PendingApprovals.test.tsx
```

Expected: KPI tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/admin/PendingApprovals.tsx web/src/pages/admin/PendingApprovals.test.tsx
git commit -m "feat: add clickable pending approval KPI filters"
```

---

## Task 2: Bring the page into the HMS design system

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/public/locales/en/adminPages.json` if new labels are added.
- Modify tests: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] **Step 1: Write failing design-contract tests**

Add assertions that the page uses HMS primitives:

```tsx
it('renders KPI cards with the HMS card class and pressed state', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  const highRisk = screen.getByRole('button', { name: /pendingApprovals.summary.highPriority/i });
  expect(highRisk.className).toContain('card');
  fireEvent.click(highRisk);
  expect(highRisk).toHaveAttribute('aria-pressed', 'true');
});

it('uses token-based selected tab styling', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  const refundTab = screen.getByRole('button', { name: 'pendingApprovals.tabs.refund' });
  fireEvent.click(refundTab);
  expect(refundTab.className).toContain('bg-[var(--color-primary)]');
});
```

- [ ] **Step 2: Replace hardcoded card/table classes**

Replace:
- `bg-white rounded-lg border p-4` → `card p-4`
- tab selected `bg-blue-600 text-white` → `bg-[var(--color-primary)] text-white shadow-sm`
- tab inactive `bg-gray-100 text-gray-700 hover:bg-gray-200` → `bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]`
- table wrapper `bg-white rounded-lg border overflow-hidden` → `card overflow-hidden`
- table header `bg-gray-50` → `bg-[var(--color-bg-secondary)]`
- gray text classes inside table → `text-[var(--color-text-secondary)]` or `text-[var(--color-text-muted)]`

Do not introduce a new visual language. Follow `web/src/index.css` tokens and existing admin widgets.

- [ ] **Step 3: Add page subtitle and filter summary**

Under title add:

```tsx
<p className="text-sm text-[var(--color-text-secondary)]">
  {t('pendingApprovals.subtitle')}
</p>
```

Add locale:

```json
"subtitle": "Review discounts, refunds, bill cancellations, payment voids, stock adjustments, payouts, and manual adjustments before they affect finance records."
```

Add a small active-filter line above the table:

```tsx
<div className="text-sm text-[var(--color-text-secondary)]">
  {t('pendingApprovals.filterSummary', { count: filtered.length })}
</div>
```

Locale:

```json
"filterSummary": "Showing {{count}} approval request(s)"
```

- [ ] **Step 4: Add a compact mobile card list**

For small screens, hide the wide table and render cards:

```tsx
<div className="md:hidden space-y-3">
  {filtered.map((approval) => (
    <button
      key={approval.id}
      type="button"
      onClick={() => handleRowClick(approval)}
      className="mobile-card-item w-full text-left items-start"
    >
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{approval.id}</span>
          <span className={`px-2 py-1 rounded text-xs font-medium ${RISK_BADGE[approval.risk] ?? 'bg-gray-100 text-gray-600'}`}>
            {t(`pendingApprovals.riskLabels.${approval.risk}`, { defaultValue: approval.risk })}
          </span>
        </div>
        <div className="text-sm text-[var(--color-text-secondary)]">{approval.requestedBy}</div>
        <div className="text-sm font-medium">{formatCurrency(approval.amount)}</div>
        <div className="text-xs text-[var(--color-text-muted)] truncate">{approval.reason}</div>
      </div>
    </button>
  ))}
</div>
```

Keep the desktop table visible with `hidden md:block`.

- [ ] **Step 5: Run tests and visual smoke**

Run:

```bash
pnpm --filter web test -- PendingApprovals.test.tsx
pnpm --filter web test -- admin/widgets/a11y.test.tsx
```

Expected: tests pass, no broken snapshots/queries.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/PendingApprovals.tsx web/src/pages/admin/PendingApprovals.test.tsx web/public/locales/en/adminPages.json
git commit -m "refactor: align pending approvals with admin design system"
```

---

## Task 3: Make approve/reject workflow safer and clearer

**Files:**
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify tests: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] **Step 1: Add tests for explicit review actions**

Add tests:

```tsx
it('opens drawer in approve mode when row approve action is clicked', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  fireEvent.click(screen.getAllByRole('button', { name: /approve/i })[0]);

  expect(screen.getByText('Confirm Approval')).toBeInTheDocument();
});

it('requires a rejection reason before confirming rejection', () => {
  vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
  render(<PendingApprovals />);

  fireEvent.click(screen.getAllByRole('button', { name: /reject/i })[0]);

  expect(screen.getByText('Confirm Rejection')).toBeDisabled();
});
```

- [ ] **Step 2: Allow drawer to open with initial action**

Update `ApprovalDetailDrawer` props:

```ts
initialAction?: 'approve' | 'reject' | null;
onActionConsumed?: () => void;
```

Inside the component:

```tsx
useEffect(() => {
  if (initialAction) {
    setAction(initialAction);
    setNote('');
    onActionConsumed?.();
  }
}, [initialAction, onActionConsumed]);
```

- [ ] **Step 3: Add visible row actions**

Add a final table column labelled `pendingApprovals.table.actions`. Each row gets:

```tsx
<td className="py-3 px-4 text-sm" onClick={(event) => event.stopPropagation()}>
  <div className="flex items-center gap-2 justify-end">
    <button type="button" className="btn-secondary text-xs" onClick={() => openForDecision(approval, 'reject')}>
      {t('pendingApprovals.actions.reject')}
    </button>
    <button type="button" className="btn-primary text-xs" onClick={() => openForDecision(approval, 'approve')}>
      {t('pendingApprovals.actions.approve')}
    </button>
  </div>
</td>
```

Implement:

```ts
const [initialDrawerAction, setInitialDrawerAction] = useState<'approve' | 'reject' | null>(null);

const openForDecision = (approval: Approval, action: 'approve' | 'reject') => {
  setSelectedApproval(approval);
  setInitialDrawerAction(action);
  setDrawerOpen(true);
};
```

Pass to drawer:

```tsx
initialAction={initialDrawerAction}
onActionConsumed={() => setInitialDrawerAction(null)}
```

- [ ] **Step 4: Use real approval ID only**

Current code computes ID from `selectedApproval.reference?.replace('Approval #', '')`. This is fragile. Replace with:

```ts
const handleApprove = (id: string, note: string) => {
  reviewMutation.mutate({ id, action: 'approve', notes: note });
};

const handleReject = (id: string, note: string) => {
  reviewMutation.mutate({ id, action: 'reject', notes: note });
};
```

The drawer already calls `onApprove?.(approval.id, note)` and `onReject?.(approval.id, note)`.

- [ ] **Step 5: Improve bulk rejection note behavior**

Do not silently send `Bulk rejection` for all rejected rows. Add a bulk rejection note modal or require using row-level rejection for rejects in the first implementation. Simpler safe version:

```ts
const APPROVAL_BULK_ACTIONS: BulkAction[] = [
  { id: 'approve', ... },
  // omit bulk reject until note modal exists
];
```

Then add a later task for bulk reject notes if needed.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter web test -- PendingApprovals.test.tsx
```

Expected: row action tests pass; existing drawer approve/reject tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/admin/PendingApprovals.tsx web/src/components/admin/ApprovalDetailDrawer.tsx web/src/pages/admin/PendingApprovals.test.tsx
git commit -m "feat: add explicit pending approval decisions"
```

---

## Task 4: Optional backend support for better server-side filtering

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/schemas/approval.ts`
- Modify/add tests: `test/approval-schemas.test.ts` and/or `test/approvals.test.ts`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`

Only do this task after Tasks 1–3. The UI can initially filter the 100 returned pending rows client-side. Add backend filters if production queues may exceed 100 pending approvals.

- [ ] **Step 1: Write schema tests**

Add tests for optional query params:

```ts
expect(approvalQuerySchema.parse({ status: 'pending', risk: 'high', age: 'older_than_24h' })).toMatchObject({
  risk: 'high',
  age: 'older_than_24h',
});
```

- [ ] **Step 2: Extend `approvalQuerySchema`**

Add optional fields:

```ts
risk: z.enum(['low', 'medium', 'high']).optional(),
age: z.enum(['older_than_24h']).optional(),
date: z.enum(['today']).optional(),
```

- [ ] **Step 3: Apply backend filtering carefully**

Since `risk` is currently derived from `request_data.amount`, prefer not to add expensive JSON parsing in SQL unless needed. For D1-safe MVP, keep server-side type/status/page filters and document that risk/age is client-side. If server-side is required later, add explicit `risk` or `amount` columns to `approval_requests` through a migration instead of relying on JSON extraction.

- [ ] **Step 4: Commit or skip**

If no backend changes are needed, do not create a fake commit. If changed:

```bash
git add src/routes/tenant/approvals.ts src/schemas/approval.ts test/approval-schemas.test.ts
git commit -m "feat: support approval queue filters"
```

---

## Task 5: Final validation

- [ ] Run focused frontend tests:

```bash
pnpm --filter web test -- PendingApprovals.test.tsx ApprovalDetailDrawer BulkActionsBar
```

- [ ] Run route/schema tests if backend touched:

```bash
npm test -- --run test/approval-schemas.test.ts test/approvals.test.ts
```

- [ ] Run typecheck/build if frontend touched:

```bash
pnpm --filter web build
```

- [ ] Run root status/diff review:

```bash
git status
git diff --stat main...HEAD
```

- [ ] Security review checklist:
  - Reviewer roles stay enforced by backend.
  - Self-approval remains blocked.
  - Reject note is required.
  - No patient-sensitive data is added to logs or toast messages.
  - Approve/reject mutation invalidates pending approvals and counts.
  - Bulk approval is capped and still audited.

---

## Acceptance Criteria

- KPI cards are clickable, keyboard focusable, and preserve filter state in URL query params.
- Active KPI and active type tab are visually obvious and use HMS design tokens.
- Page uses `.card`, `.btn-primary`, `.btn-secondary`, tokenized text/background colors, and existing admin drawer/bulk primitives.
- Admin can review an item, approve, or reject from the detail drawer.
- Row-level `Approve`/`Reject` buttons open the same drawer confirmation flow; no accidental one-click financial mutation.
- Pending list and approval counts refresh after successful action.
- Tests cover KPI filtering, row decision actions, drawer confirmation, empty/loading state, type tabs, and bulk selection.
- No backend security regression: role check, tenant isolation, separation of duties, and audit logs remain intact.

---

## Implementation Notes

- This page should not become a second unrelated approval system. Use `/api/approvals` as the unified queue and keep module-specific approval pages as drill-down destinations only.
- The current route `/action/pending-approvals` is correct for admin action center; do not move it unless sidebar/breadcrumb routes are updated together.
- Avoid adding live polling in this slice. Add manual refresh first; later use a safe interval only if hospital operators need it.
- Keep UI copy in `web/public/locales/en/adminPages.json`; Bangla translation can be added separately if needed.
