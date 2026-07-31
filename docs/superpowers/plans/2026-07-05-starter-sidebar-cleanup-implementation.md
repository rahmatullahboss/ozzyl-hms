# Starter Sidebar Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current HMS sidebar and mobile nav align with the Starter HIS sales/demo flow: billing, cash control, reagent control, stock, reports, and settings first.

**Architecture:** Reuse the existing route and permission system. Do not delete pages, routes, or backend logic. Only adjust sidebar grouping/order/labels and mobile shortcuts so advanced modules remain accessible but less prominent.

**Tech Stack:** React, TypeScript, Lucide icons, i18next JSON labels, Vitest.

## Global Constraints

- Do not delete any feature page or route.
- Do not change database schema, backend APIs, billing calculation, reagent deduction, cash ledger, auth, or route protection.
- Main admin demo flow must surface Billing Counter, Cash Control, Due Collection, Discount Review, Expenses, Reagent Control, Stock Control, Reports, and Settings.
- Manual LIS, lab machines, QC, OT, emergency, HR, audit, and branch analytics stay available but move lower/advanced.

---

### Task 1: Admin sidebar starter grouping

**Files:**
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx`
- Test: `web/src/components/dashboard/adminSidebarConfig.test.ts`

**Interfaces:**
- Consumes: `NavGroup[]` and existing relative routes from `App.tsx`.
- Produces: reordered `adminNavGroups` with new label keys and same permission filtering.

- [x] Step 1: Update tests to assert Starter flow groups and top items.
- [x] Step 2: Reorder `adminNavGroups` to put Control Center and Reagent & Stock before advanced operations.
- [x] Step 3: Keep all advanced groups accessible and permission-gated.
- [x] Step 4: Run `pnpm exec vitest run src/components/dashboard/adminSidebarConfig.test.ts` from `web`.

### Task 2: Role sidebars for lab/manager/MD/director

**Files:**
- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Test: existing sidebar tests if available.

**Interfaces:**
- Consumes: existing `roleNavGroups` map.
- Produces: lab shows Reagent Control; manager/MD/director have cash/reagent/stock shortcuts.

- [x] Step 1: Add Reagent Control to lab sidebar.
- [x] Step 2: Add Reagent Control to manager where an implemented route already exists; do not add broken manager-only inventory/discount/expense routes.
- [x] Step 3: Add Reagent Control shortcut to MD/director without changing permissions; do not add inaccessible cash/stock shortcuts from hospital-admin-only routes.

### Task 3: Mobile bottom nav shortcuts

**Files:**
- Modify: `web/src/components/dashboard/MobileBottomNav.tsx`
- Test: `web/src/components/dashboard/MobileBottomNav.test.tsx`

**Interfaces:**
- Consumes: `getNavItems(role, base, t, permissions)`.
- Produces: hospital_admin mobile nav with Dashboard, Billing, Cash, Reagent, More.

- [x] Step 1: Update admin mobile nav.
- [x] Step 2: Keep reception mobile nav stable and update lab mobile shortcut to Reagent Control.
- [x] Step 3: Run targeted mobile nav tests.

### Task 4: Sidebar labels

**Files:**
- Modify: `web/public/locales/en/sidebar.json`
- Modify: `web/public/locales/bn/sidebar.json`

**Interfaces:**
- Consumes: label keys used in nav config.
- Produces: English/Bangla labels for new Starter groups and items.

- [x] Step 1: Add groupStarterControl, groupReagentStock, groupAdvancedOperations, groupAdvancedLabLis, reagentControl, stockControl, cashControl, dueCollection, discountReview.
- [x] Step 2: Ensure existing keys remain valid.

### Task 5: Verification

- [x] Run targeted tests:

```bash
cd web
pnpm exec vitest run src/components/dashboard/adminSidebarConfig.test.ts src/components/dashboard/MobileBottomNav.test.tsx
```

- [x] Run web build:

```bash
cd web
pnpm build
```
