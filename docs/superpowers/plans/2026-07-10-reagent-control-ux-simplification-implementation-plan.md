# Reagent Control UX Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dedicated Reagent Control workspace with a four-section, task-oriented UI while preserving all current backend capabilities and generic Lab Monitoring behavior.

**Architecture:** Keep `LabMonitoringDashboard.tsx` as the data and mutation owner, but extract dedicated reagent-control presentation and decision helpers into focused components. Dedicated mode uses Overview, Stock, Test Recipes and Issues; policy, readiness, logs and bulk import move behind progressive disclosure. Query enablement is controlled by pure helper functions and React Query `enabled` options.

**Tech Stack:** React 19, TypeScript, React Router, TanStack Query wrappers, Vitest, Testing Library, Tailwind utility classes.

## Global Constraints

- Do not change backend APIs, database schema, migrations or production tenant policy values.
- Do not automatically enable strict mode or write policy on page load.
- Preserve generic `lab-monitoring` mode navigation and behavior.
- Keep existing mapping, stock, exception, reconciliation, policy and operation-log actions reachable.
- Dedicated Reagent Control primary navigation must contain exactly Overview, Stock, Test Recipes and Issues.
- Use TDD for every task and commit after each independently testable deliverable.
- Keep the dirty `abdullah` workspace untouched.

---

### Task 1: Reagent-control navigation and decision model

**Files:**
- Create: `web/src/pages/laboratory/reagent-control/reagentControlModel.ts`
- Create: `web/src/pages/laboratory/reagent-control/reagentControlModel.test.ts`
- Modify: `web/src/pages/LabMonitoringDashboard.test.ts`

**Interfaces:**
- Produces: `REAGENT_CONTROL_PRIMARY_TABS`, `ReagentControlSection`, `initialReagentControlSection()`, `reagentPolicySummary()`, `reagentControlNextActions()`, `reagentControlQueryState()`.
- Consumed by: Tasks 2–6.

- [ ] **Step 1: Write failing model tests**

```ts
expect(REAGENT_CONTROL_PRIMARY_TABS.map(tab => tab.id)).toEqual([
  'overview', 'stock', 'recipes', 'issues',
]);
expect(initialReagentControlSection()).toBe('overview');
expect(reagentPolicySummary({
  lab_inventory_mode: 'soft',
  reagent_consumption_timing: 'billing',
  allow_result_without_stock: true,
  require_test_mapping_for_completion: false,
})).toMatchObject({
  title: 'Safe rollout is active',
  blocking: 'Billing and results continue',
});
expect(reagentControlQueryState('recipes')).toMatchObject({
  loadRecipes: true,
  loadReconciliation: false,
  loadLogs: false,
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --filter web exec vitest run src/pages/laboratory/reagent-control/reagentControlModel.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure model helpers**

```ts
export type ReagentControlSection = 'overview' | 'stock' | 'recipes' | 'issues';

export const REAGENT_CONTROL_PRIMARY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stock', label: 'Stock' },
  { id: 'recipes', label: 'Test Recipes' },
  { id: 'issues', label: 'Issues' },
] as const;
```

Add plain-language policy summary, prioritized action generation and query flags. Limit actions to three and prioritize disabled mode, missing recipes, stock attention and issues.

- [ ] **Step 4: Run model and existing helper tests**

Run:

```bash
pnpm --filter web exec vitest run src/pages/laboratory/reagent-control/reagentControlModel.test.ts src/pages/LabMonitoringDashboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/laboratory/reagent-control/reagentControlModel.ts web/src/pages/laboratory/reagent-control/reagentControlModel.test.ts web/src/pages/LabMonitoringDashboard.test.ts
git commit -m "feat: define simplified reagent control model"
```

---

### Task 2: Accessible primary navigation

**Files:**
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlTabs.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlTabs.test.tsx`

**Interfaces:**
- Consumes: `ReagentControlSection`, `REAGENT_CONTROL_PRIMARY_TABS`.
- Produces: `ReagentControlTabs({ active, onChange })`.

- [ ] **Step 1: Write failing navigation tests**

Render the component and assert:

```ts
expect(screen.getByRole('tablist', { name: 'Reagent control sections' })).toBeInTheDocument();
expect(screen.getAllByRole('tab')).toHaveLength(4);
expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
expect(onChange).toHaveBeenCalledWith('stock');
```

- [ ] **Step 2: Run and verify red**

Run:

```bash
pnpm --filter web exec vitest run src/pages/laboratory/reagent-control/ReagentControlTabs.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement responsive accessible tabs**

Use `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `tabIndex`, ArrowLeft/ArrowRight/Home/End handling and horizontal overflow on small screens.

- [ ] **Step 4: Run navigation tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/laboratory/reagent-control/ReagentControlTabs.tsx web/src/pages/laboratory/reagent-control/ReagentControlTabs.test.tsx
git commit -m "feat: add accessible reagent control navigation"
```

---

### Task 3: Action-first Overview and guided setup

**Files:**
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlOverview.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlOverview.test.tsx`

**Interfaces:**
- Consumes: policy summary, next actions, mapping counts, stock alerts, exception counts, setup steps and callbacks.
- Produces: `ReagentControlOverview`.

- [ ] **Step 1: Write failing overview tests**

Test soft mode copy, maximum three actions, healthy state, four-step setup and absence of expanded LIS/analyzer details by default.

```ts
expect(screen.getByText('Safe rollout is active')).toBeInTheDocument();
expect(screen.getByText('Billing and results continue')).toBeInTheDocument();
expect(screen.getAllByTestId('reagent-next-action')).toHaveLength(3);
expect(screen.getByText('Load starter reagent catalog')).toBeInTheDocument();
expect(screen.queryByText('OpenELIS-style bridge deployment readiness')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify red**

- [ ] **Step 3: Implement Overview**

Render:

1. Plain-language policy status.
2. Up to three task cards.
3. Four-step setup when incomplete.
4. Compact attention notices only when LIS/analyzer status needs action.
5. An `Advanced settings` button supplied by parent.

- [ ] **Step 4: Run tests and verify pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/laboratory/reagent-control/ReagentControlOverview.tsx web/src/pages/laboratory/reagent-control/ReagentControlOverview.test.tsx
git commit -m "feat: add action-first reagent control overview"
```

---

### Task 4: Simplified Test Recipes workflow

**Files:**
- Create: `web/src/pages/laboratory/reagent-control/ReagentRecipeManager.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentRecipeManager.test.tsx`

**Interfaces:**
- Consumes: lab tests, consumables, existing mappings, forms and callbacks from `LabMonitoringDashboard`.
- Produces: `ReagentRecipeManager`.

- [ ] **Step 1: Write failing progressive-disclosure tests**

Assert the normal form shows only Test, Reagent/consumable and Quantity per test. Assert Mandatory, Notes and CSV importer are hidden initially and appear after their semantic expand buttons are clicked.

```ts
expect(screen.getByLabelText('Lab test')).toBeInTheDocument();
expect(screen.getByLabelText('Reagent or consumable')).toBeInTheDocument();
expect(screen.getByLabelText('Quantity per test')).toBeInTheDocument();
expect(screen.queryByLabelText('Mandatory recipe item')).not.toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'More recipe options' }));
expect(screen.getByLabelText('Mandatory recipe item')).toBeInTheDocument();
expect(screen.queryByText('Bulk recipe import')).not.toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Advanced recipe tools' }));
expect(screen.getByText('Bulk recipe import')).toBeInTheDocument();
```

- [ ] **Step 2: Run and verify red**

- [ ] **Step 3: Implement recipe manager**

Requirements:

- Heading uses Test Recipes, not Mapping.
- Show missing recipe summary first.
- Basic form contains three primary controls and Save recipe.
- Advanced recipe fields and bulk import use separate `aria-expanded` buttons.
- Keep edit/remove and multiple mapping rows.
- Preserve current payload callbacks and raw IDs as secondary text.

- [ ] **Step 4: Run component tests and existing mapping helper tests**

Run:

```bash
pnpm --filter web exec vitest run src/pages/laboratory/reagent-control/ReagentRecipeManager.test.tsx src/pages/LabMonitoringDashboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/laboratory/reagent-control/ReagentRecipeManager.tsx web/src/pages/laboratory/reagent-control/ReagentRecipeManager.test.tsx
git commit -m "feat: simplify test recipe setup"
```

---

### Task 5: Task-oriented Issues and Advanced settings

**Files:**
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlIssues.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlIssues.test.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlAdvancedPanel.tsx`
- Create: `web/src/pages/laboratory/reagent-control/ReagentControlAdvancedPanel.test.tsx`

**Interfaces:**
- Produces: actionable issue categories and advanced policy/readiness/log panel.
- Consumes: existing exception/reconciliation/policy/log data and callbacks.

- [ ] **Step 1: Write failing Issues tests**

Verify category cards and direct action labels:

```ts
expect(screen.getByText('Missing recipe')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Set up recipe' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Add stock' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Retry deduction' })).toBeInTheDocument();
```

Technical source metadata must be inside a collapsed details region.

- [ ] **Step 2: Write failing Advanced panel tests**

Verify policy summary is visible, controls are not expanded by default, strict activation remains disabled when readiness is false, and logs are behind a separate disclosure.

- [ ] **Step 3: Implement both components**

Issues combines exception and reconciliation presentation without changing APIs. Advanced panel holds policy controls, strict readiness, starter catalog import and operation logs.

- [ ] **Step 4: Run tests and verify pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/laboratory/reagent-control/ReagentControlIssues.tsx web/src/pages/laboratory/reagent-control/ReagentControlIssues.test.tsx web/src/pages/laboratory/reagent-control/ReagentControlAdvancedPanel.tsx web/src/pages/laboratory/reagent-control/ReagentControlAdvancedPanel.test.tsx
git commit -m "feat: add actionable reagent issues and advanced settings"
```

---

### Task 6: Integrate dedicated mode and lazy query loading

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`
- Modify: `web/src/pages/LabMonitoringDashboard.test.ts`
- Create or modify: `web/src/pages/LabMonitoringDashboard.render.test.tsx`

**Interfaces:**
- Consumes all components and helpers from Tasks 1–5.
- Preserves existing default export and `mode="lab-monitoring"` behavior.

- [ ] **Step 1: Write failing integration assertions**

Assert:

- `initialLabMonitoringTab('reagent-control')` maps to Overview.
- dedicated mode renders exactly four primary tabs.
- dedicated normal view does not render policy controls, strict button or bulk CSV textarea.
- advanced settings opens those capabilities.
- generic mode still exposes existing broad tabs.
- React Query calls receive `enabled` based on section.

- [ ] **Step 2: Run and verify red**

- [ ] **Step 3: Integrate the new shell**

Implementation rules:

- Add dedicated `ReagentControlSection` state.
- Render `ReagentControlTabs` only for dedicated mode.
- Delegate Overview, Recipes and Issues rendering to extracted components.
- Reuse existing Stock content, with rare controls placed in an advanced disclosure where practical.
- Preserve generic-mode JSX path.
- Use query-state helper for heavy query `enabled` flags.
- Do not call policy update on mount.

- [ ] **Step 4: Run focused integration tests**

Run:

```bash
pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts src/pages/LabMonitoringDashboard.render.test.tsx src/pages/laboratory/reagent-control
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/LabMonitoringDashboard.tsx web/src/pages/LabMonitoringDashboard.test.ts web/src/pages/LabMonitoringDashboard.render.test.tsx web/src/pages/laboratory/reagent-control
git commit -m "refactor: integrate simplified reagent control workspace"
```

---

### Task 7: Regression, accessibility and delivery review

**Files:**
- Modify: `docs/qa/inventory-test-coverage.md`
- Create: `docs/reports/2026-07-10-reagent-control-ux-simplification.md`

**Interfaces:** None.

- [ ] **Step 1: Run TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 2: Run focused frontend tests**

```bash
pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts src/pages/LabMonitoringDashboard.render.test.tsx src/pages/laboratory/reagent-control
```

Expected: all pass.

- [ ] **Step 3: Run inventory/reagent regression**

```bash
pnpm test:inventory
```

Expected: all backend and frontend inventory/reagent tests pass.

- [ ] **Step 4: Run production web build**

```bash
pnpm --filter web build
```

Expected: TypeScript, Vite and PWA build pass.

- [ ] **Step 5: Adversarial review**

Verify:

- no API or migration changes;
- no page-load policy mutation;
- all old capabilities remain reachable;
- soft and strict copy match actual behavior;
- generic lab-monitoring mode is unchanged;
- keyboard and mobile navigation remain usable;
- query enablement does not hide required summary data.

- [ ] **Step 6: Update QA report and commit**

```bash
git add docs/qa/inventory-test-coverage.md docs/reports/2026-07-10-reagent-control-ux-simplification.md
git commit -m "docs: verify simplified reagent control UX"
```

- [ ] **Step 7: Merge to clean main and re-run verification**

Use a separate clean main worktree, merge with `--no-ff`, run focused tests and production web build, push `origin/main`, then remove temporary worktrees and branch only after verification succeeds.
