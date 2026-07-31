# Doctor Performance Visit Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sortable Visit Collection column to the Doctor Performance dashboard table using the existing API field.

**Architecture:** Keep the existing doctor-performance API and query contract unchanged. Extend only the table presentation and its component regression coverage, reusing the current BDT formatter and server-sort callback.

**Tech Stack:** React, TypeScript, Testing Library, Vitest.

## Global Constraints

- Use the latest local `main` worktree as the reviewed base.
- Do not modify backend calculations, canonical authority, database schema, or migrations.
- Preserve existing table pagination and horizontal scrolling.
- Render values in BDT with two decimal places using the existing formatter.

---

### Task 1: Render and sort Visit Collection

**Files:**
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.tsx`

**Interfaces:**
- Consumes: `DoctorPerformanceRow.visitCollection: number` and `DoctorSort` value `'visitCollection'`.
- Produces: a `Visit Collection` column and `onSortChange('visitCollection')` interaction.

- [ ] **Step 1: Write the failing rendering test**

Add `Visit Collection` to the expected headers and assert the existing fixture amount renders as `৳12,000.00`.

- [ ] **Step 2: Write the failing sorting test**

Click the accessible `Sort by visit collection` button and assert `onSortChange` receives `'visitCollection'`.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx`

Expected: failure because the header, value, and sort control are not rendered.

- [ ] **Step 4: Add the table column**

Insert a sortable header immediately after `Visits`:

```tsx
<th className="px-3 py-3 text-right">
  <SortHeader
    label="Visit Collection"
    value="visitCollection"
    active={sortBy === 'visitCollection'}
    onChange={onSortChange}
  />
</th>
```

Insert the matching row cell immediately after visit count:

```tsx
<td className={moneyCell}>{money(doctor.visitCollection)}</td>
```

Increase the table minimum width enough to preserve the existing layout.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx`

Expected: all component tests pass.

- [ ] **Step 6: Run integration verification**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
pnpm exec tsc --noEmit
```

Expected: all selected tests and TypeScript validation pass.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-23-doctor-performance-visit-collection-design.md docs/superpowers/plans/2026-07-23-doctor-performance-visit-collection.md web/src/components/dashboard/DoctorPerformancePanel.test.tsx web/src/components/dashboard/DoctorPerformancePanel.tsx
git commit -m "feat(dashboard): show doctor visit collection"
```
