# Dashboard Modal Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard modals and drawers portal-based, stack-aware, keyboard-contained, focus-restoring, and body-scroll-safe while preserving their existing content and callbacks.

**Architecture:** Add one dashboard-local dialog utility that owns portal rendering, overlay stacking, Escape handling, focus containment/restoration, and reference-counted body scroll locking. Integrate the utility into the five scoped dashboard overlays, retaining their existing DOM structure and visual variants while standardizing layer values.

**Tech Stack:** React 19, TypeScript, React DOM portals, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- Preserve all existing dashboard data queries, business calculations, callbacks, labels, and backdrop-click behavior.
- Standard dashboard overlays use `z-[60]`; patient-age detail remains `z-[68]`; invoice inspector remains `z-[70]`; command palette remains `z-[200]`.
- Only the topmost registered dashboard overlay handles Escape and Tab.
- Body overflow must be restored exactly after the final registered overlay closes.
- Use test-driven development and stage only task-owned files.

---

### Task 1: Shared dashboard dialog layer

**Files:**
- Create: `web/src/components/dashboard/DashboardDialogLayer.tsx`
- Create: `web/src/components/dashboard/DashboardDialogLayer.test.tsx`

**Interfaces:**
- Produces: `DashboardDialogPortal`, `useDashboardDialogLayer`, `DASHBOARD_DIALOG_OVERLAY_CLASS`, and `DASHBOARD_DETAIL_OVERLAY_CLASS`.
- `useDashboardDialogLayer({ open, onClose })` returns `{ dialogRef, initialFocusRef }` as refs for the dialog container and preferred initial-focus control.

- [ ] **Step 1: Write failing tests for portal, focus, keyboard, stacking, and scroll locking**

Create a test harness that opens a dialog from a trigger and uses the proposed hook and portal. Assert:

```tsx
expect(screen.getByRole('dialog')).toHaveFocus(); // fallback when no focusable control
expect(document.body.style.overflow).toBe('hidden');
fireEvent.keyDown(document, { key: 'Escape' });
expect(trigger).toHaveFocus();
expect(document.body.style.overflow).toBe(originalOverflow);
```

Add a focusable harness with first and last buttons and assert Tab from the last wraps to the first and Shift+Tab from the first wraps to the last. Add nested parent/child harnesses and assert Escape closes only the child first and body scrolling remains locked until both close.

- [ ] **Step 2: Run the new test and verify red**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardDialogLayer.test.tsx
```

Expected: FAIL because `DashboardDialogLayer.tsx` does not exist.

- [ ] **Step 3: Implement the minimal shared utility**

Implement:

```tsx
export const DASHBOARD_DIALOG_OVERLAY_CLASS = 'z-[60]';
export const DASHBOARD_DETAIL_OVERLAY_CLASS = 'z-[68]';

export function DashboardDialogPortal({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}

export function useDashboardDialogLayer({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLElement>(null);
  // Register a unique token in a module-level stack.
  // Lock body scrolling on the first token and restore the original inline value on the last removal.
  // Capture the opener, focus initialFocusRef or the first focusable control or the dialog fallback.
  // In a capture-phase keydown handler, act only when this token is topmost.
  // Escape invokes the latest onClose callback; Tab/Shift+Tab wrap inside dialogRef.
  // On cleanup, remove the token and restore focus only when the layer being removed was topmost.
  return { dialogRef, initialFocusRef };
}
```

Use a focusable selector containing anchors, enabled buttons, enabled inputs, enabled selects, enabled textareas, and non-negative tabindex elements. Exclude hidden and `aria-hidden="true"` elements. Set `tabIndex={-1}` on each dialog container so the fallback can receive focus.

- [ ] **Step 4: Run the shared utility tests and verify green**

Run the Task 1 command again.

Expected: all `DashboardDialogLayer` tests pass.

- [ ] **Step 5: Commit the shared utility slice**

```bash
git add -- web/src/components/dashboard/DashboardDialogLayer.tsx web/src/components/dashboard/DashboardDialogLayer.test.tsx
git commit -m "feat(dashboard): add accessible dialog layer"
```

---

### Task 2: Integrate drawers and configurator

**Files:**
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.tsx`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.tsx`
- Modify: `web/src/components/dashboard/PatientAgeDetailDrawer.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.test.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.test.tsx`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.test.tsx`
- Modify: `web/src/components/dashboard/PatientAgeDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: Task 1 exports from `./DashboardDialogLayer`.
- Produces: all five existing component APIs unchanged.

- [ ] **Step 1: Add failing integration assertions**

For each scoped component, add or extend a test to assert that an open overlay:

```tsx
expect(screen.getByRole('dialog', { name: expectedName })).toBeInTheDocument();
expect(document.body.style.overflow).toBe('hidden');
fireEvent.keyDown(document, { key: 'Escape' });
expect(onClose).toHaveBeenCalledTimes(1);
```

For `DashboardKpiConfigurator`, click the existing “Customize dashboard” trigger, assert the close button receives focus, press Escape, assert the dialog disappears and focus returns to the trigger.

For one drawer with several controls, assert Tab and Shift+Tab wrap. Retain all existing component-specific data and pagination assertions.

- [ ] **Step 2: Run focused component tests and verify red**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/DashboardKpiConfigurator.test.tsx src/components/dashboard/PatientAgeDetailDrawer.test.tsx
```

Expected: new assertions fail for components not yet using the shared layer.

- [ ] **Step 3: Integrate the shared utility without changing component APIs**

For each component:

```tsx
const { dialogRef, initialFocusRef } = useDashboardDialogLayer({
  open: Boolean(openEntityOrLocalOpenState),
  onClose,
});

return (
  <DashboardDialogPortal>
    <div className={`fixed inset-0 ${DASHBOARD_DIALOG_OVERLAY_CLASS} ...`}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        ...
      >
        <button ref={initialFocusRef} ... />
      </section>
    </div>
  </DashboardDialogPortal>
);
```

Use `DASHBOARD_DETAIL_OVERLAY_CLASS` only for `PatientAgeDetailDrawer`. Remove the duplicated Escape/focus effects from `DoctorPerformanceDrawer` and `PatientAgeDetailDrawer`; the shared utility becomes the single authority. For `DashboardKpiConfigurator`, create a local `closeConfigurator` callback and pass it both to the hook and existing close controls.

- [ ] **Step 4: Run focused component and shared tests**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardDialogLayer.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/DashboardKpiConfigurator.test.tsx src/components/dashboard/PatientAgeDetailDrawer.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit integration**

```bash
git add -- web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/TestPerformanceDrawer.tsx web/src/components/dashboard/KpiBreakdownDrawer.tsx web/src/components/dashboard/DashboardKpiConfigurator.tsx web/src/components/dashboard/PatientAgeDetailDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx web/src/components/dashboard/TestPerformanceDrawer.test.tsx web/src/components/dashboard/KpiBreakdownDrawer.test.tsx web/src/components/dashboard/DashboardKpiConfigurator.test.tsx web/src/components/dashboard/PatientAgeDetailDrawer.test.tsx
git commit -m "fix(dashboard): harden modal keyboard behavior"
```

---

### Task 3: Regression verification and integration

**Files:**
- Verify all task-owned source, tests, design, and plan files.

**Interfaces:**
- Consumes: completed Tasks 1–2.
- Produces: verified commit history ready for `origin/main`.

- [ ] **Step 1: Run the complete focused dashboard set**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardDialogLayer.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/DashboardKpiConfigurator.test.tsx src/components/dashboard/PatientAgeDetailDrawer.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
```

Expected: zero failed tests.

- [ ] **Step 2: Run the production build**

```bash
pnpm --filter web build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 3: Review the complete branch diff**

Confirm no API payloads, dashboard calculations, unrelated overlays, generated artifacts, or production files changed.

- [ ] **Step 4: Reconcile with current `origin/main`**

Fetch `origin/main`, rebase the clean task branch if necessary, and repeat Steps 1–2 after any rebase.

- [ ] **Step 5: Integrate and push**

Use the clean dedicated `main` integration worktree, run:

```bash
pnpm worktree:check -- --mode=integration --require-latest-origin-main
```

Fast-forward or merge the reviewed task commits, repeat focused tests and the web build on merged `main`, push `main`, and confirm `origin/main` resolves to the merge commit.

- [ ] **Step 6: Clean up**

After confirming the push, remove only `.worktrees/fix-dashboard-modal-accessibility-20260729`, delete the fully merged local/remote task branch if present, and run `git worktree prune`.
