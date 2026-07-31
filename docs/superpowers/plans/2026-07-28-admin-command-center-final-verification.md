# Admin Command Center Final Verification and Comparison Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete ACC-06 by integrating ACC-00 through ACC-05 with current `main`, fixing release-blocking parity gaps, preserving the existing dashboard on the production hostname, and exposing the new Admin Command Center on a dedicated comparison-preview hostname for every tenant.

**Architecture:** The existing `admin_command_center_v2` tenant flag remains the normal-host rollout authority. A narrowly allowlisted preview hostname (`command-center.ozzyl.com`) may activate only the new dashboard composition without mutating tenant feature-flag rows. The frontend keeps `/h/:slug/*` tenant routing, treats the preview hostname as reserved, restores the shared period controls, and preserves historical patient-analytics behavior when the command center is unavailable.

**Tech Stack:** Cloudflare Workers, Hono, D1, React, React Router, React Query, TypeScript, Vitest, Testing Library, Wrangler versions deployment.

## Global Constraints

- Preserve the existing production dashboard at `https://hms.ozzyl.com` unless `admin_command_center_v2` is explicitly enabled for that tenant.
- Expose the new comparison UI at `https://command-center.ozzyl.com` without writing all-tenant feature-flag rows.
- Use `new URL(request.url).hostname`; never trust a forwarded host header for preview activation.
- Keep the preview host inside the same tenant path contract: `/h/:slug/dashboard`.
- Do not reset, stash, discard, or overwrite unrelated work.
- Preserve the canonical-shadow-safe production ancestor `95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf`.
- Production deployment must use version upload, zero-traffic candidate verification, controlled traffic promotion, and a retained rollback version.
- Apply no production migration without explicit migration authorization and fresh pending-migration verification.
- All fixes use TDD and coherent checkpoint commits.

---

### Task 1: Restore visible period and refresh controls

**Files:**
- Modify: `web/src/pages/admin/command-center/AdminCommandCenter.tsx`
- Modify: `web/src/pages/admin/command-center/CommandCenterHeader.tsx`
- Modify: `web/src/pages/admin/command-center/AdminCommandCenter.test.tsx`

**Interfaces:**
- Consumes: `ExecutiveDashboardRangeFilter`, `updateCommandCenterUrl`, `ExecutiveDashboardFilters`.
- Produces: URL-backed period changes and a command-center refresh callback that invalidates dashboard queries.

- [ ] **Step 1: Write the failing range-control tests**

Add tests proving that the command center renders `Last 7 Days`, changes `range`, removes stale custom `from`/`to` values for preset ranges, preserves the active tab, and clears drill state:

```tsx
it('changes the reporting period from the visible range controls', () => {
  renderCommandCenter('/h/city-hospital/dashboard?tab=money&range=custom&from=2026-07-01&to=2026-07-15&invoiceId=44');

  fireEvent.click(screen.getByRole('tab', { name: 'Last 7 Days' }));

  expect(screen.getByTestId('location')).toHaveTextContent('tab=money');
  expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
  expect(screen.getByTestId('location')).not.toHaveTextContent('from=');
  expect(screen.getByTestId('location')).not.toHaveTextContent('to=');
  expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
});
```

Add a refresh test using an injected callback:

```tsx
it('refreshes the command-center queries from the visible refresh control', () => {
  const onRefresh = vi.fn();
  renderCommandCenter('/h/city-hospital/dashboard', { onRefresh });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --dir web exec vitest run src/pages/admin/command-center/AdminCommandCenter.test.tsx
```

Expected: FAIL because the range controls and refresh callback are not rendered.

- [ ] **Step 3: Implement URL-backed period changes**

Extend `AdminCommandCenter` with optional refresh props:

```ts
interface Props {
  overview: AdminDashboardOverviewResponse;
  onRefresh?: () => void;
  refreshing?: boolean;
}
```

Create a period-change handler:

```ts
const changeFilters = (filters: ExecutiveDashboardFilters) => {
  const next = updateCommandCenterUrl(searchParams, {
    range: filters.preset,
    from: filters.preset === 'custom' ? filters.startDate : null,
    to: filters.preset === 'custom' ? filters.endDate : null,
    doctorId: null,
    testId: null,
    invoiceId: null,
    ageBucket: null,
  });
  setSearchParams(next, { replace: false });
};
```

Render the existing range filter from `CommandCenterHeader`:

```tsx
<ExecutiveDashboardRangeFilter
  filters={filters}
  onChange={onFiltersChange}
  onRefresh={onRefresh}
  refreshing={refreshing}
  lastRefreshedAt={generatedAt}
  className="mt-4 shadow-none"
/>
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/admin/command-center/AdminCommandCenter.tsx web/src/pages/admin/command-center/CommandCenterHeader.tsx web/src/pages/admin/command-center/AdminCommandCenter.test.tsx
git commit -m "fix(admin-dashboard): restore command center period controls"
```

---

### Task 2: Add an exact comparison-preview hostname contract

**Files:**
- Modify: `src/lib/dashboard/admin-command-center-flag.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/unit/admin-command-center-flag.test.ts`
- Modify: `test/integration/routes/admin-dashboard-overview.test.ts`
- Modify: `web/src/lib/hostRouting.ts`
- Modify: `web/src/lib/hostRouting.test.ts`

**Interfaces:**
- Produces: `ADMIN_COMMAND_CENTER_PREVIEW_HOST`, `isAdminCommandCenterPreviewHostname(hostname)`.
- Route contract: `/api/dashboard/admin-overview-v2` is enabled when the tenant flag is enabled OR the request URL hostname is the exact preview hostname.

- [ ] **Step 1: Write failing pure-host tests**

```ts
expect(isAdminCommandCenterPreviewHostname('command-center.ozzyl.com')).toBe(true);
expect(isAdminCommandCenterPreviewHostname('COMMAND-CENTER.OZZYL.COM')).toBe(true);
expect(isAdminCommandCenterPreviewHostname('command-center.ozzyl.com.evil.example')).toBe(false);
expect(isAdminCommandCenterPreviewHostname('tenant.ozzyl.com')).toBe(false);
expect(getTenantSlugFromHost('command-center.ozzyl.com')).toBe('');
```

- [ ] **Step 2: Write a failing route test**

Call the overview route with the tenant flag disabled and the request URL host set to `command-center.ozzyl.com`; require HTTP 200 and `reportKey: admin_control_center`. Repeat with `hms.ozzyl.com`; require HTTP 404.

- [ ] **Step 3: Run tests and verify RED**

```bash
pnpm exec vitest run test/unit/admin-command-center-flag.test.ts test/integration/routes/admin-dashboard-overview.test.ts
pnpm --dir web exec vitest run src/lib/hostRouting.test.ts
```

Expected: FAIL because the preview host helper and route override do not exist.

- [ ] **Step 4: Implement exact-host activation**

```ts
export const ADMIN_COMMAND_CENTER_PREVIEW_HOST = 'command-center.ozzyl.com';

export function isAdminCommandCenterPreviewHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, '') === ADMIN_COMMAND_CENTER_PREVIEW_HOST;
}
```

In the overview route:

```ts
const requestHostname = new URL(c.req.url).hostname;
const previewEnabled = isAdminCommandCenterPreviewHostname(requestHostname);
if (!previewEnabled && !await isAdminCommandCenterEnabled(c.env.DB, tenantId)) {
  return c.json({ error: 'Not found' }, 404);
}
```

Add `command-center` to `RESERVED_HOST_SUBDOMAINS`.

- [ ] **Step 5: Run tests and verify GREEN**

Run the same commands. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/admin-command-center-flag.ts src/routes/tenant/dashboard.ts test/unit/admin-command-center-flag.test.ts test/integration/routes/admin-dashboard-overview.test.ts web/src/lib/hostRouting.ts web/src/lib/hostRouting.test.ts
git commit -m "feat(admin-dashboard): add comparison preview host"
```

---

### Task 3: Preserve historical Patient Analytics behavior outside the preview

**Files:**
- Modify: `web/src/pages/analytics/PatientAnalytics.tsx`
- Modify: `web/src/pages/analytics/PatientAnalytics.test.tsx`
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx`
- Modify: `web/src/components/dashboard/adminSidebarConfig.test.ts`

**Interfaces:**
- Historical navigation remains `/h/:slug/analytics/patients`.
- Preview hostname redirects to `/h/:slug/dashboard?tab=patients`.
- Normal hostname preserves the legacy `/h/:slug/reports` fallback until the tenant flag-aware dashboard is entered through `/dashboard`.

- [ ] **Step 1: Write failing compatibility tests**

```tsx
it('routes the preview hostname to the Patients workspace', () => {
  vi.stubGlobal('location', { hostname: 'command-center.ozzyl.com' });
  renderRoute('/h/city-hospital/analytics/patients?range=7d');
  expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/dashboard');
  expect(screen.getByTestId('location')).toHaveTextContent('tab=patients');
  expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
});

it('preserves the legacy reports fallback on the normal hostname', () => {
  vi.stubGlobal('location', { hostname: 'hms.ozzyl.com' });
  renderRoute('/h/city-hospital/analytics/patients?range=7d');
  expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/reports');
});
```

Verify the sidebar continues to point to `analytics/patients`, not directly to an unavailable tab.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --dir web exec vitest run src/pages/analytics/PatientAnalytics.test.tsx src/components/dashboard/adminSidebarConfig.test.ts
```

Expected: FAIL because normal hosts currently redirect to `dashboard?tab=patients`.

- [ ] **Step 3: Implement the compatibility redirect**

```tsx
const preview = isAdminCommandCenterPreviewHostname(window.location.hostname);
const params = new URLSearchParams(location.search);
if (preview) {
  params.set('tab', 'patients');
  return <Navigate replace to={`/h/${slug}/dashboard?${params.toString()}`} />;
}
return <Navigate replace to={`/h/${slug}/reports${params.size ? `?${params.toString()}` : ''}`} />;
```

Set the sidebar path back to `analytics/patients`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/analytics/PatientAnalytics.tsx web/src/pages/analytics/PatientAnalytics.test.tsx web/src/components/dashboard/adminSidebarConfig.tsx web/src/components/dashboard/adminSidebarConfig.test.ts
git commit -m "fix(admin-dashboard): preserve patient analytics fallback"
```

---

### Task 4: Complete ACC-06 integrated review and evidence

**Files:**
- Modify: `web/src/pages/admin/command-center/workspaces/AuditWorkspace.tsx`
- Create: `docs/admin-command-center/ACC-06-FINAL-VERIFICATION-2026-07-28.md`
- Modify: `docs/architecture/admin-command-center-program-board.yaml`

**Interfaces:**
- Produces: final reconciliation, accessibility, privacy, responsive, performance, release, and rollback evidence.

- [ ] **Step 1: Remove stale future-phase copy**

Replace the Audit workspace sentence with:

```text
Latest staff activity is live/current state. Financial reconciliation status and invoice audit evidence remain available through their dedicated workspaces and the shared invoice inspector.
```

- [ ] **Step 2: Run the complete focused ACC suites**

```bash
pnpm exec vitest run test/unit/admin-command-center-flag.test.ts test/unit/admin-dashboard-comparison.test.ts test/unit/admin-dashboard-filter-context.test.ts test/unit/admin-dashboard-overview-assembler.test.ts test/unit/admin-dashboard-reconciliation.test.ts test/unit/admin-dashboard-registry.test.ts test/unit/admin-dashboard-shared-types.test.ts test/unit/admin-dashboard-source-status.test.ts test/unit/dashboard-financial-reconciliation-contract.test.ts test/unit/dashboard-reporting-observability.test.ts test/unit/doctor-reporting-contract.test.ts test/unit/invoice-inspector-contract.test.ts test/unit/patient-age.test.ts test/unit/patient-age-contract.test.ts test/integration/routes/admin-dashboard-overview.test.ts test/integration/routes/admin-dashboard-permissions.test.ts test/integration/routes/billing-invoice-inspector.test.ts test/integration/routes/dashboard-doctor-activity.test.ts test/integration/routes/dashboard-doctor-compensation-details.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-financial-control.test.ts test/integration/routes/dashboard-financial-trend.test.ts test/integration/routes/dashboard-payment-methods.test.ts test/integration/routes/dashboard-patient-age-analytics.test.ts test/integration/routes/dashboard-patient-age-details.test.ts test/integration/routes/dashboard-patient-age-privacy.test.ts
```

```bash
pnpm --dir web exec vitest run src/pages/admin/Dashboard.test.tsx src/pages/admin/command-center src/components/dashboard/AdminKpiInvoiceModal.test.tsx src/components/dashboard/CommissionCalculationBridge.test.tsx src/components/dashboard/DoctorActivityTimeline.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/IPDBillingOverview.test.tsx src/components/dashboard/PatientAgeDetailDrawer.test.tsx src/components/dashboard/PatientAgeSummary.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/components/invoice-inspector src/pages/analytics/PatientAnalytics.test.tsx src/App.patient-analytics-route.test.ts src/components/dashboard/adminSidebarConfig.test.ts
```

- [ ] **Step 3: Run integrated quality gates**

```bash
pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm build
git diff --check main...HEAD
pnpm worktree:check -- --mode=task
```

- [ ] **Step 4: Perform adversarial code review**

Review `main...HEAD` for correctness, privacy, authorization, SQL tenant scope, financial reconciliation, route compatibility, active-query gating, accessibility, and deployment safety. Fix every P0/P1/P2 finding with a failing regression test before proceeding.

- [ ] **Step 5: Record final evidence**

The evidence document must contain:

```text
Integrated base/head
ACC implementation commits
Merge-conflict resolution
Reconciliation matrix and visible-unavailable behavior
Cross-workspace invoice navigation
Patient identity authorization boundary
Responsive/mobile evidence
Keyboard/focus evidence
Query-loading behavior
Typecheck/build/test results
Migration status
Legacy URL and preview URL contracts
Release and rollback commands
Known residual risks
```

Update ACC-06 to `complete` only when all gates pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/command-center/workspaces/AuditWorkspace.tsx docs/admin-command-center/ACC-06-FINAL-VERIFICATION-2026-07-28.md docs/architecture/admin-command-center-program-board.yaml
git commit -m "docs(admin-dashboard): complete ACC-06 verification"
```

---

### Task 5: Integrate to main and deploy the comparison release safely

**Files:**
- No source change unless integration review reveals a current-main conflict.
- Deployment evidence remains outside Git under a mode-700 temporary directory.

**Interfaces:**
- Old link: `https://hms.ozzyl.com`
- New link: `https://command-center.ozzyl.com`
- Rollback: previous Worker version retained at `0%` after promotion.

- [ ] **Step 1: Reconcile with the latest local main**

```bash
git merge main
pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm canonical:check
pnpm build
```

Resolve any new conflict without discarding either side, then rerun the focused affected tests.

- [ ] **Step 2: Merge the verified integration branch into clean main**

From the clean main worktree:

```bash
pnpm worktree:check -- --mode=integration
git merge --no-ff integration/admin-command-center-v2-20260728 -m "merge: admin command center v2"
```

Run fresh post-merge typechecks, ACC tests, canonical governance, build, and worktree policy.

- [ ] **Step 3: Verify authentication and production state**

```bash
pnpm exec wrangler whoami
git merge-base --is-ancestor 95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf HEAD
pnpm exec wrangler deployments list --env production --json
pnpm exec wrangler d1 migrations list DB --env production --remote
pnpm canonical:validate-production-financial-shadow-scope -- --output "$EVIDENCE_DIR/financial-shadow-scope-before.json"
```

If migration `0570_doctor_commission_rule_version_snapshot.sql` is pending, stop before candidate promotion unless explicit migration authorization has been provided.

- [ ] **Step 4: Upload a zero-traffic candidate**

```bash
pnpm exec wrangler deploy --env production --dry-run --outdir "$EVIDENCE_DIR/worker-dry-run"
pnpm exec wrangler versions upload --env production --tag "$RELEASE_TAG" --message "Admin Command Center comparison candidate $RELEASE_TAG from $RELEASE_COMMIT"
pnpm exec wrangler versions deploy "$CURRENT_BASELINE_ID@100" "$NEW_VERSION_ID@0" --env production --message "Zero-traffic Admin Command Center comparison verification" --yes
```

- [ ] **Step 5: Verify both dashboard contracts on the exact candidate**

Using the Worker version override, require:

```text
https://hms.ozzyl.com/h/<tenant>/dashboard -> legacy dashboard when tenant flag is off
https://command-center.ozzyl.com/h/<tenant>/dashboard -> Admin Command Center
```

Run authenticated read-only smoke for every active tenant and confirm no unexpected HTTP 500. Run the all-tenant financial reconciliation and require equality with the pre-release baseline.

- [ ] **Step 6: Promote with controlled traffic and retain rollback**

```bash
pnpm exec wrangler versions deploy "$CURRENT_BASELINE_ID@95" "$NEW_VERSION_ID@5" --env production --message "Admin Command Center comparison low-traffic observation" --yes
pnpm exec wrangler versions deploy "$CURRENT_BASELINE_ID@50" "$NEW_VERSION_ID@50" --env production --message "Admin Command Center comparison wider observation" --yes
pnpm exec wrangler versions deploy "$CURRENT_BASELINE_ID@0" "$NEW_VERSION_ID@100" --env production --message "Admin Command Center comparison production promotion" --yes
```

Re-run health, authenticated smoke, feature smoke, deployment split, feature flag, and all-tenant reconciliation after every stage.

- [ ] **Step 7: Final release evidence**

Record the main commit, Worker version ID/tag, deployment ID, rollback version ID, old/new links, migration verdict, smoke results, and reconciliation verdict. Do not push `main` unless the GitHub workflow has been separately reviewed and authorized.
