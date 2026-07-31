# Unified Action Center Phase 1: Shell and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one canonical Action Center shell and overview, embed the existing audited approvals queue, preserve legacy URLs through redirects, move review moderation into Patient Experience navigation, and make dashboard action cards open actionable filtered queues.

**Architecture:** Keep all current approval source tables and decision endpoints unchanged. Add a lightweight `/api/action-center/summary` aggregator that reuses approval eligibility logic and combines it with existing exception/task/receivable counts. The React shell owns shared navigation and summary counts, while each domain page retains its own query and mutation behaviour.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, React, React Router, TanStack Query, i18next, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Preserve existing approval maker-checker, evidence, separation-of-duties, and audit behaviour.
- Do not apply a database migration in Phase 1.
- Keep all old bookmarked URLs functional through `replace` redirects.
- Preserve supported query parameters when redirecting the old pending-approval route.
- Do not count a source-specific queue in the unified total unless the same eligibility logic is used by its destination queue.
- Reuse existing semantic Ozzyl HMS tokens; do not introduce a new global font or raw page-specific colour system.
- Interactive targets must be keyboard reachable and at least 44px high where practical.
- Do not modify unrelated E2E report/auth-state artifacts.

---

### Task 1: Extract reusable approval summary logic

**Files:**
- Create: `src/services/actionCenter/approvalSummary.ts`
- Modify: `src/routes/tenant/approvals.ts:1977-2060`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- Consumes: D1 database binding and tenant ID.
- Produces:

```ts
export interface ApprovalOperationalSummary {
  totalPending: number;
  highPriority: number;
  olderThan24h: number;
  dueSoon: number;
  todayApproved: number;
  rejectedToday: number;
  cashHandoverPending: number;
  expensePending: number;
  missingEvidence: number;
  executionFailed: number;
  infoRequested: number;
  infoSubmitted: number;
  blocked: number;
  actionable: number;
  totalPendingAmount: number;
  averageAgeMinutes: number;
  oldestPendingMinutes: number;
  oldestPendingAt: string | null;
  pendingByType: Record<string, number>;
}

export async function loadApprovalOperationalSummary(
  db: D1Database,
  tenantId: string,
): Promise<ApprovalOperationalSummary>;
```

- [x] **Step 1: Write a failing route regression test**

Add a test proving `/api/approvals/summary` still returns the current normalized shape after the logic is extracted:

```ts
expect(response.status).toBe(200);
expect(body.data).toEqual(expect.objectContaining({
  totalPending: expect.any(Number),
  highPriority: expect.any(Number),
  cashHandoverPending: expect.any(Number),
  pendingByType: expect.any(Object),
}));
```

- [x] **Step 2: Run the focused test and verify RED only after replacing the inline implementation with an unresolved import**

Run:

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts
```

Expected: the new extraction test or TypeScript transform fails because `loadApprovalOperationalSummary` does not exist.

- [x] **Step 3: Move the existing summary calculation into the service**

The service must reuse the current helpers from `approvals.ts`; export narrowly scoped helpers only when required. The route becomes:

```ts
approvals.get('/summary', requireRole(...APPROVAL_REVIEW_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  try {
    const data = await loadApprovalOperationalSummary(c.env.DB, tenantId);
    return c.json({ data });
  } catch (error) {
    logServerError({
      request: c.req.raw,
      status: 500,
      environment: c.env.ENVIRONMENT,
      source: 'onError',
      error,
      message: 'approvals /summary failed',
      tenantId,
      userId: c.get('userId'),
      requestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? c.req.header('cf-ray') ?? undefined,
      tags: ['approvals_summary_failed', 'd1_query_failed'],
    });
    return c.json({ error: 'Failed to load approval summary' }, 500);
  }
});
```

- [x] **Step 4: Run focused approvals tests and verify GREEN**

Run the same Vitest command. Expected: all tests in `approvals.test.ts` pass.

**Execution evidence (2026-07-14):** RED failed with the expected missing `approvalSummary` module. GREEN passed with 98/98 approval integration tests. `pnpm build:migrations` generated the fresh worktree manifest and `pnpm exec tsc --noEmit` then passed.

- [x] **Step 5: Commit**

```bash
git add src/services/actionCenter/approvalSummary.ts src/routes/tenant/approvals.ts test/integration/routes/approvals.test.ts
git commit -m "refactor(approvals): expose operational summary service"
```

**Commit:** `792cf76c`

---

### Task 2: Add Action Center summary API

**Files:**
- Create: `src/routes/tenant/actionCenter.ts`
- Modify: `src/index.ts:15-20,450-456`
- Test: `test/integration/routes/action-center.test.ts`

**Interfaces:**
- Consumes: `loadApprovalOperationalSummary(db, tenantId)` and existing canonical source tables.
- Produces: `GET /api/action-center/summary`.

```ts
export interface ActionCenterSummary {
  approvals: ApprovalOperationalSummary;
  exceptions: { open: number; critical: number; slaBreached: number };
  collections: { open: number; followupDue: number; exposure: number };
  tasks: { open: number; overdue: number; assignedToMe: number };
  resolvedToday: number;
  nextBestAction: {
    workstream: 'approvals' | 'exceptions' | 'collections' | 'tasks';
    href: string;
    label: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  } | null;
  capabilities: {
    persistentExceptions: boolean;
    persistentCollections: boolean;
    persistentTasks: boolean;
  };
}
```

Phase 1 has no persistent exception or collection cases yet. Use honest capability flags and current source counts:

```ts
return c.json({
  data: {
    approvals,
    exceptions: { open: 0, critical: 0, slaBreached: 0 },
    collections: {
      open: Number(receivableAggregate.totalInvoices ?? 0),
      followupDue: 0,
      exposure: Number(receivableAggregate.totalDue ?? 0),
    },
    tasks: { open: 0, overdue: 0, assignedToMe: 0 },
    resolvedToday: approvals.todayApproved + approvals.rejectedToday,
    nextBestAction: approvals.totalPending > 0 ? {
      workstream: 'approvals',
      href: '/action/approvals?status=pending',
      label: 'Review oldest pending approval',
      priority: approvals.highPriority > 0 ? 'high' : 'medium',
    } : null,
    capabilities: {
      persistentExceptions: false,
      persistentCollections: false,
      persistentTasks: false,
    },
  },
});
```

The receivable aggregate must use a direct aggregate query over the full eligible bill dataset, not the current 100-row listing.

- [x] **Step 1: Write tenant isolation and shape tests**

Test that unauthenticated access is rejected, tenant ID is bound in every query, and the response includes capabilities rather than pretending unsupported workflows are live.

- [x] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center.test.ts
```

Expected: route returns 404 because it is not registered.

- [x] **Step 3: Implement and mount the route**

In `src/index.ts`:

```ts
import actionCenterRoutes from './routes/tenant/actionCenter';
// ...
app.route('/api/action-center', actionCenterRoutes);
```

Use `requireRole(...APPROVAL_REVIEW_ROLES)` or the existing equivalent hospital-admin operational-read role set.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the same command. Expected: all action-center integration tests pass.

**Execution evidence (2026-07-14):** RED failed with the expected missing `actionCenter` route module. GREEN passed with 3/3 Action Center tests; combined Action Center + Approvals regression passed 101/101. Root TypeScript and `git diff --check` passed. The receivable exposure and count come from one tenant-bound full-dataset aggregate query.

- [x] **Step 5: Commit**

```bash
git add src/routes/tenant/actionCenter.ts src/index.ts test/integration/routes/action-center.test.ts
git commit -m "feat(action-center): add operational summary endpoint"
```

**Commit:** `ec778a11`

---

### Task 3: Build the shared Action Center shell

**Files:**
- Create: `web/src/components/action-center/ActionCenterShell.tsx`
- Create: `web/src/components/action-center/ActionCenterShell.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/public/locales/en/adminPages.json`
- Modify: `web/public/locales/bn/adminPages.json`

**Interfaces:**

```ts
export type ActionCenterSection = 'overview' | 'approvals' | 'exceptions' | 'collections' | 'tasks';

export interface ActionCenterShellProps {
  activeSection: ActionCenterSection;
  title: string;
  description: string;
  children: React.ReactNode;
  primaryAction?: React.ReactNode;
}
```

Add:

```ts
actionCenter: {
  summary: () => ['action-center', 'summary'] as const,
}
```

The shell fetches `/api/action-center/summary`, renders canonical tab links, and shows count badges only for supported/live counts. It must not wrap its own `DashboardLayout`; page routes own the outer layout to prevent nested sidebars.

- [x] **Step 1: Write failing accessibility and navigation tests**

Assert:

```ts
expect(screen.getByRole('navigation', { name: /action center/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/h/city-care/action/approvals');
expect(screen.getByRole('link', { name: /exceptions/i })).toHaveAttribute('aria-current', 'page');
```

Also assert every tab has a visible focus style class and no disabled-looking unsupported tab is rendered as active functionality.

- [x] **Step 2: Run the component test and verify RED**

```bash
pnpm --filter web exec vitest run src/components/action-center/ActionCenterShell.test.tsx
```

Expected: import fails because the component does not exist.

- [x] **Step 3: Implement the shell**

Use `NavLink`, `useParams`, `useApiQuery`, Lucide icons, semantic `<nav>`, and token-based classes. Each link must have at least `min-h-11` and visible `focus-visible:ring-2` styling.

- [x] **Step 4: Add English and Bengali copy**

Add `actionCenter` keys for title, overview, approvals, exceptions, collections, tasks, loading, stale, and capability-unavailable messages. Do not hardcode Bengali strings in JSX.

- [x] **Step 5: Run the test and verify GREEN**

Run the same Vitest command. Expected: all shell tests pass.

**Execution evidence (2026-07-14):** RED failed with the expected missing `ActionCenterShell` component. GREEN passed with 4/4 shell tests. The shell uses semantic navigation, canonical deep links, `min-h-11` targets, visible focus rings, capability-aware badges, non-blocking loading/stale feedback, and no nested `DashboardLayout`. Root TypeScript passed.

- [x] **Step 6: Commit**

```bash
git add web/src/components/action-center web/src/lib/queryKeys.ts web/public/locales/en/adminPages.json web/public/locales/bn/adminPages.json
git commit -m "feat(action-center): add shared navigation shell"
```

**Commit:** `1473889a`

---

### Task 4: Create the Action Center Overview page

**Files:**
- Create: `web/src/pages/admin/ActionCenterOverview.tsx`
- Create: `web/src/pages/admin/ActionCenterOverview.test.tsx`

**Interfaces:**
- Consumes: `ActionCenterShell` and `/api/action-center/summary` cache.
- Produces: canonical `/h/:slug/action` page.

- [x] **Step 1: Write failing overview tests**

Cover:

```ts
expect(screen.getByRole('heading', { name: /action center/i })).toBeInTheDocument();
expect(screen.getByRole('link', { name: /review approvals/i })).toHaveAttribute(
  'href',
  '/h/city-care/action/approvals?status=pending',
);
expect(screen.queryByText(/persistent exceptions/i)).not.toBeInTheDocument();
```

For `nextBestAction: null`, assert a healthy empty state and no disabled review button.

- [x] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/ActionCenterOverview.test.tsx
```

- [x] **Step 3: Implement the overview**

Render six compact metrics, four workstream cards, capability-aware descriptions, and one next-best-action panel. Do not duplicate the large approval cockpit from `PendingApprovals`.

- [x] **Step 4: Run and verify GREEN**

Run the same command. Expected: all overview tests pass.

**Execution evidence (2026-07-14):** RED failed with the expected missing `ActionCenterOverview` component. GREEN passed with 4/4 overview tests and 8/8 combined overview + shell tests. Root TypeScript passed. The page renders six metrics, four workstreams, honest capability messaging, canonical links, and no disabled next-action dead end.

- [x] **Step 5: Commit**

```bash
git add web/src/pages/admin/ActionCenterOverview.tsx web/src/pages/admin/ActionCenterOverview.test.tsx
git commit -m "feat(action-center): add operational overview"
```

**Commit:** `65fbcc71`

---

### Task 5: Canonicalize routes and preserve legacy intent

**Files:**
- Modify: `web/src/App.tsx:46,113,342,466-469,950-963`
- Create: `web/src/App.action-center.test.tsx`

**Interfaces:**
- Canonical routes:
  - `/h/:slug/action`
  - `/h/:slug/action/approvals`
  - `/h/:slug/action/exceptions`
  - `/h/:slug/action/collections`
  - `/h/:slug/action/tasks`
  - `/h/:slug/patient-experience/reviews`
- Legacy routes use `replace` redirects and preserve search parameters where relevant.

- [x] **Step 1: Write failing route tests**

Assert old URLs resolve to canonical destinations:

```ts
expect(resolve('/h/city-care/approvals')).toBe('/h/city-care/action');
expect(resolve('/h/city-care/action/pending-approvals?tab=Expense&status=pending'))
  .toBe('/h/city-care/action/approvals?tab=Expense&status=pending');
expect(resolve('/h/city-care/alerts')).toBe('/h/city-care/action/exceptions');
expect(resolve('/h/city-care/review-moderation')).toBe('/h/city-care/patient-experience/reviews');
```

- [x] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/App.action-center.test.tsx
```

- [x] **Step 3: Extend the redirect helper**

```tsx
function TenantRedirect({ path, preserveSearch = false }: { path: string; preserveSearch?: boolean }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { search } = useLocation();
  return <Navigate to={`/h/${slug}/${path}${preserveSearch ? search : ''}`} replace />;
}
```

- [x] **Step 4: Register canonical and alias routes**

Use lazy imports for the new Overview. Map exceptions/tasks initially to the existing pages inside the new route hierarchy. Map collections to the current `DueReceivables` until Phase 3 replaces its API and UI.

- [x] **Step 5: Run and verify GREEN**

Run the same test. Expected: all route tests pass.

**Execution evidence (2026-07-14):** RED failed with the expected missing redirect helper. GREEN passed with 4/4 route contract tests. Root TypeScript passed. Canonical Action Center and Patient Experience routes are registered, legacy aliases use replace redirects, and supported search parameters are preserved.

- [x] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/App.action-center.test.tsx
git commit -m "refactor(navigation): canonicalize action center routes"
```

**Commit:** `58b7a611`

---

### Task 6: Embed the existing approvals queue in the shell

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.test.tsx`
- Modify: `web/src/pages/ApprovalCenter.tsx`
- Modify: `web/src/pages/ApprovalCenter.test.tsx`
- Modify: `web/src/pages/__tests__/ApprovalCenter.test.tsx`

**Interfaces:**

```ts
export interface PendingApprovalsProps {
  embedded?: boolean;
}
```

When `embedded=true`, render the existing approvals content inside `ActionCenterShell` without a nested `DashboardLayout` and without duplicating the shell header/navigation.

- [x] **Step 1: Write failing embedded-mode test**

```ts
render(<PendingApprovals embedded />);
expect(screen.getByRole('navigation', { name: /action center/i })).toBeInTheDocument();
expect(screen.queryAllByTestId('dashboard-layout')).toHaveLength(0);
expect(screen.getByRole('tab', { name: /pending/i })).toBeInTheDocument();
```

- [x] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/PendingApprovals.test.tsx src/pages/ApprovalCenter.test.tsx src/pages/__tests__/ApprovalCenter.test.tsx
```

- [x] **Step 3: Add embedded rendering without changing approval actions**

Extract the current page body into a local `content` variable. Return:

```tsx
if (embedded) {
  return (
    <ActionCenterShell
      activeSection="approvals"
      title={t('pendingApprovals.title')}
      description={t('pendingApprovals.subtitle')}
    >
      {content}
    </ActionCenterShell>
  );
}
return <DashboardLayout role="hospital_admin">{content}</DashboardLayout>;
```

The canonical route must render `<PendingApprovals embedded />` inside one outer `DashboardLayout`.

- [x] **Step 4: Convert the old Approval Center page to a compatibility redirect**

The `/approvals` route should redirect to `/action`; delete dead queue-card assertions and replace them with redirect tests. Do not keep two visible approval concepts.

- [x] **Step 5: Run and verify GREEN**

Run the same test command. Expected: all tests pass and existing action-routing tests remain unchanged.

**Execution evidence (2026-07-14):** Embedded-mode RED failed because the old component ignored the prop and rendered a nested layout. Legacy redirect RED failed because the duplicate card hub still rendered. GREEN passed with 63/63 tests across Pending Approvals, both Approval Center compatibility suites, and the canonical route contract. Root TypeScript passed. Approval query, mutation, evidence, source routing, and maker-checker behaviours remained covered by the existing 56 regression tests.

- [x] **Step 6: Commit**

```bash
git add web/src/pages/admin/PendingApprovals.tsx web/src/pages/admin/PendingApprovals.test.tsx web/src/pages/ApprovalCenter.tsx web/src/pages/ApprovalCenter.test.tsx web/src/pages/__tests__/ApprovalCenter.test.tsx
git commit -m "refactor(approvals): embed queue in action center"
```

**Commit:** `f62d6a1e`

---

### Task 7: Simplify sidebar information architecture

**Files:**
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx:21-40,58-60`
- Modify or create: `web/src/components/dashboard/adminSidebarConfig.test.tsx`
- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Modify: `web/public/locales/en/sidebar.json`
- Modify: `web/public/locales/bn/sidebar.json`

**Interfaces:**
- Action Center group contains Overview, Approvals, Exceptions, Collections, Tasks.
- Patient Experience group contains Review Moderation and Marketplace Booking.
- Remove duplicate Due Collection and Collection Follow-ups top-level items from Starter Control; their old routes remain aliases.

- [x] **Step 1: Write failing navigation structure tests**

Assert exact ordered paths:

```ts
expect(actionCenter.items.map((item) => item.path)).toEqual([
  'action',
  'action/approvals',
  'action/exceptions',
  'action/collections',
  'action/tasks',
]);
expect(patientExperience.items.map((item) => item.path)).toEqual([
  'patient-experience/reviews',
  'marketplace-bookings',
]);
```

- [x] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/components/dashboard/adminSidebarConfig.test.tsx
```

- [x] **Step 3: Update the config and translations**

Use distinct Lucide icons: `LayoutDashboard`, `ShieldCheck`, `ShieldAlert`, `WalletCards` or existing supported equivalent, `ClipboardCheck`, and `MessageSquare`. Keep icon style consistent.

- [x] **Step 4: Run and verify GREEN**

Run the same test command.

**Execution evidence (2026-07-14):** RED identified four expected IA gaps: no Patient Experience group, duplicate approval concepts, duplicate collection links, and an 11-group layout. GREEN passed with 21/21 sidebar configuration tests. Root TypeScript passed. Existing referrals and setup routes were preserved by moving them to Patients & Services and Settings instead of deleting them.

- [x] **Step 5: Commit**

```bash
git add web/src/components/dashboard/adminSidebarConfig.tsx web/src/components/dashboard/adminSidebarConfig.test.ts web/src/components/dashboard/Sidebar.tsx web/public/locales/en/sidebar.json web/public/locales/bn/sidebar.json
git commit -m "refactor(sidebar): unify action center navigation"
```

**Commit:** `b4606fca`

---

### Task 8: Correct dashboard Action Required deep links

**Files:**
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx`

**Interfaces:**
- Receivable exposure → `/action/collections?sort=exposure&status=open`
- Discount audit → `/action/exceptions?type=high_discount&status=open`
- Approval-related cards → `/action/approvals?...`

- [x] **Step 1: Write failing link tests**

```ts
expect(screen.getByRole('link', { name: /receivable/i })).toHaveAttribute(
  'href',
  '/h/city-care/action/collections?sort=exposure&status=open',
);
expect(screen.getByRole('link', { name: /discount/i })).toHaveAttribute(
  'href',
  '/h/city-care/action/exceptions?type=high_discount&status=open',
);
```

- [x] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/pages/admin/widgets/ActionRequiredPanel.test.tsx
```

- [x] **Step 3: Update links and copy**

Use `Review report` rather than `Action Required` for any card whose canonical destination remains read-only in Phase 1. Do not imply that an action is available when the capability flag is false.

- [x] **Step 4: Run and verify GREEN**

Run the same command.

**Execution evidence (2026-07-14):** RED reproduced seven expected gaps: the dashboard still used the legacy approval-count source, had no receivable card, used old source-page links, and retried the wrong query. GREEN passed with 9/9 Action Required tests. Root TypeScript and `git diff --check` passed. Approval count and receivable exposure now come from `/api/action-center/summary`; security rule counts remain on the existing security-alert endpoint. Every card opens a canonical filtered queue and uses touch-safe, keyboard-visible controls.

- [x] **Step 5: Commit**

```bash
git add web/src/pages/admin/widgets/ActionRequiredPanel.tsx web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx
git commit -m "fix(dashboard): deep link action cards to canonical queues"
```

**Commit:** `5d7ca0ea`

---

### Task 9: Phase 1 verification gate

**Files:**
- Review only: all files changed by Tasks 1-8.

- [x] **Step 1: Run backend integration suites**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center.test.ts test/integration/routes/approvals.test.ts
```

Expected: all tests pass.

- [x] **Step 2: Run frontend focused suites**

```bash
pnpm --filter web exec vitest run src/components/action-center/ActionCenterShell.test.tsx src/pages/admin/ActionCenterOverview.test.tsx src/App.action-center.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/dashboard/adminSidebarConfig.test.ts src/pages/admin/widgets/ActionRequiredPanel.test.tsx
```

Expected: all tests pass.

- [x] **Step 3: Run compile and build gates**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Expected: both commands exit 0; the full build includes main, patient, and admin assets.

- [x] **Step 4: Validate diff**

```bash
git diff --check
```

Expected: no whitespace errors.

- [x] **Step 5: Run adversarial review**

Verify there is no nested `DashboardLayout`, no redirect loop, no lost query string, no duplicated approval summary eligibility, and no unsupported workflow presented as live.

**Final verification evidence (2026-07-14):**

- Backend: 101/101 passed across Action Center and Approvals integration suites.
- Frontend: 99/99 passed across shell, overview, route, approvals, sidebar, and dashboard action suites.
- Root TypeScript: passed.
- Full monorepo build: passed and produced main, patient, and admin bundles; only existing chunk/deprecation warnings were emitted.
- Diff validation: passed.
- Adversarial review fixed two findings before the final rerun: the canonical Approvals route now owns exactly one outer `DashboardLayout`, and capability-false exception/collection cards display an explicit review-only label rather than implying an unavailable mutation.
- Redirect aliases are one-way, supported query strings are preserved, both summary routes call `loadApprovalOperationalSummary`, and unsupported persistent capabilities remain false.

- [x] **Step 6: Commit any review fixes, then create the phase completion commit if needed**

```bash
git add src web test docs
git commit -m "feat(action-center): complete shell and navigation phase"
```

**Completion commit:** `b1406a88`
**Phase status:** `READY FOR INTEGRATION`
