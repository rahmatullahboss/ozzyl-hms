# Unified Approval Center — Implementation Plan

## Goal
Create a centralized approval center that aggregates all pending approvals (bill edit, bill cancel, discount, refund, expenses, pharmacy GRN/write-off, inventory, HR) into a single admin page with approve/reject workflow.

## Architecture
- **Approach:** Hybrid — new `approval_requests` table for bill edit/cancel approvals; existing module approvals federated via aggregator endpoint
- **Backend:** Hono route on Cloudflare Workers, D1 for persistence
- **Frontend:** React + TanStack Query + Tailwind CSS
- **Pattern:** Reuse pharmacy ApprovalQueuePage pattern (tab-based queue, approve/reject dialog, separation of duties)

## Tech Stack
- Backend: Hono, Drizzle ORM, D1, Zod
- Frontend: React 19, TanStack Query v5, Tailwind CSS v4, Lucide icons
- Testing: Vitest (backend + frontend), Playwright (e2e)

---

## Task 1: Create approval_requests table schema

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `src/db/schema/approval-requests.ts` (new)
- `src/db/schema/schema.ts` (add export)

**Code:**

```typescript
// src/db/schema/approval-requests.ts
import { sqliteTable, text, integer, numeric } from 'drizzle-orm/sqlite-core';

export const approvalRequests = sqliteTable('approval_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(), // 'bill_edit', 'bill_cancel', 'discount', 'refund'
  entityId: integer('entity_id').notNull(), // bill_id, invoice_id, etc.
  entityNo: text('entity_no'), // invoice_no for display
  requestedBy: integer('requested_by').notNull(),
  requestData: text('request_data').notNull(), // JSON: { old_value, new_value, reason }
  status: text('status').notNull().default('pending'), // pending, approved, rejected
  reviewedBy: integer('reviewed_by'),
  reviewedAt: numeric('reviewed_at'),
  reviewNotes: text('review_notes'),
  createdAt: numeric('created_at').notNull().default(''),
});
```

**Verification:**
```bash
pnpm test -- --testPathPattern=approval-requests
```

---

## Task 2: Create approval_requests migration

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- Migration file via `pnpm db:generate`

**Commands:**
```bash
pnpm db:generate
```

**Verification:**
```bash
# Check migration file exists in src/db/migrations/
ls -la src/db/migrations/ | tail -5
```

---

## Task 3: Create approval Zod schemas

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `src/schemas/approval.ts` (new)

**Code:**

```typescript
import { z } from 'zod';

export const createApprovalRequestSchema = z.object({
  type: z.enum(['bill_edit', 'bill_cancel', 'discount', 'refund']),
  entityId: z.number().int().positive(),
  entityNo: z.string().optional(),
  requestData: z.object({
    oldValue: z.any().optional(),
    newValue: z.any().optional(),
    reason: z.string().min(1, 'Reason is required'),
  }),
});

export const reviewApprovalSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
}).refine(
  (data) => data.action !== 'reject' || (data.notes && data.notes.trim().length > 0),
  { message: 'Notes are required when rejecting' }
);

export const approvalQuerySchema = z.object({
  type: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional().default('pending'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});
```

**Verification:**
```bash
pnpm test -- --testPathPattern=approval
```

---

## Task 4: Write tests for approval API endpoints (TDD - RED phase)

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `test/routes/approvals.test.ts` (new)

**Test Cases:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Approval Center API', () => {
  describe('POST /api/approvals', () => {
    it('should create a bill_edit approval request', async () => {
      // Given: authenticated user, existing bill
      // When: POST /api/approvals with type=bill_edit
      // Then: returns 201 with approval request, status='pending'
    });

    it('should create a bill_cancel approval request', async () => {
      // Given: authenticated user, existing bill
      // When: POST /api/approvals with type=bill_cancel
      // Then: returns 201 with approval request
    });

    it('should reject if duplicate pending request exists', async () => {
      // Given: existing pending approval for same entity
      // When: POST /api/approvals with same entityId
      // Then: returns 409 conflict
    });

    it('should require authentication', async () => {
      // When: POST without auth
      // Then: returns 401
    });
  });

  describe('GET /api/approvals', () => {
    it('should return pending approvals filtered by type', async () => {
      // Given: multiple approval requests of different types
      // When: GET /api/approvals?type=bill_edit&status=pending
      // Then: returns only bill_edit pending items
    });

    it('should return aggregated counts per type', async () => {
      // When: GET /api/approvals/counts
      // Then: returns { bill_edit: 2, bill_cancel: 1, ... }
    });

    it('should paginate results', async () => {
      // When: GET /api/approvals?page=2&limit=10
      // Then: returns correct page
    });
  });

  describe('PUT /api/approvals/:id/review', () => {
    it('should approve a pending request', async () => {
      // Given: pending approval request
      // When: PUT /api/approvals/:id/review with action=approve
      // Then: status changes to approved, reviewed_by set
    });

    it('should reject a pending request with notes', async () => {
      // Given: pending approval request
      // When: PUT /api/approvals/:id/review with action=reject, notes
      // Then: status changes to rejected
    });

    it('should enforce separation of duties', async () => {
      // Given: approval created by user A
      // When: user A tries to approve own request
      // Then: returns 403
    });

    it('should require notes for rejection', async () => {
      // When: reject without notes
      // Then: returns 400 validation error
    });

    it('should not allow reviewing already reviewed requests', async () => {
      // Given: already approved request
      // When: try to approve again
      // Then: returns 409
    });
  });

  describe('PUT /api/approvals/:id/review - bill_edit approval side effects', () => {
    it('should apply bill edit changes on approval', async () => {
      // Given: pending bill_edit approval with new items
      // When: approve
      // Then: bill items are updated, audit log created
    });
  });

  describe('PUT /api/approvals/:id/review - bill_cancel approval side effects', () => {
    it('should cancel bill on approval', async () => {
      // Given: pending bill_cancel approval
      // When: approve
      // Then: bill status=cancelled, accounting reversal created
    });
  });
});
```

**Verification:**
```bash
pnpm test -- --testPathPattern=approvals.test
# All tests should FAIL (RED phase)
```

---

## Task 5: Implement approval API endpoints (TDD - GREEN phase)

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `src/routes/tenant/approvals.ts` (new)

**Code:**

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import {
  createApprovalRequestSchema,
  reviewApprovalSchema,
  approvalQuerySchema,
} from '../../schemas/approval';
import { approvalRequests } from '../../db/schema/approval-requests';
import { eq, and, desc, sql, count } from 'drizzle-orm';

const approvals = new Hono();

// All approval endpoints require admin/manager roles
approvals.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));

// POST /api/approvals — Create approval request
approvals.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createApprovalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { type, entityId, entityNo, requestData } = parsed.data;
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const db = c.get('db');

  // Check for duplicate pending request
  const existing = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.tenantId, tenantId),
        eq(approvalRequests.type, type),
        eq(approvalRequests.entityId, entityId),
        eq(approvalRequests.status, 'pending')
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: 'Pending approval already exists for this item' }, 409);
  }

  const [created] = await db
    .insert(approvalRequests)
    .values({
      tenantId,
      type,
      entityId,
      entityNo: entityNo || null,
      requestedBy: userId,
      requestData: JSON.stringify(requestData),
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    .returning();

  await createAuditLog(c, {
    action: 'CREATE',
    table_name: 'approval_requests',
    record_id: created.id,
    new_value: JSON.stringify(created),
  });

  return c.json({ data: created }, 201);
});

// GET /api/approvals — List approval requests
approvals.get('/', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenantId');
  const query = approvalQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const { type, status, page, limit } = query.data;
  const offset = (page - 1) * limit;

  const conditions = [
    eq(approvalRequests.tenantId, tenantId),
    eq(approvalRequests.status, status),
  ];

  if (type) {
    conditions.push(eq(approvalRequests.type, type));
  }

  const whereClause = and(...conditions);

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(approvalRequests)
      .where(whereClause)
      .orderBy(desc(approvalRequests.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(approvalRequests)
      .where(whereClause),
  ]);

  return c.json({
    data: items.map((item) => ({
      ...item,
      requestData: JSON.parse(item.requestData),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /api/approvals/counts — Get pending counts per type
approvals.get('/counts', async (c) => {
  const db = c.get('db');
  const tenantId = c.get('tenantId');

  const counts = await db
    .select({
      type: approvalRequests.type,
      total: count(),
    })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.tenantId, tenantId),
        eq(approvalRequests.status, 'pending')
      )
    )
    .groupBy(approvalRequests.type);

  const result: Record<string, number> = {};
  for (const row of counts) {
    result[row.type] = row.total;
  }

  return c.json({ data: result });
});

// PUT /api/approvals/:id/review — Approve or reject
approvals.put('/:id/review', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = reviewApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { action, notes } = parsed.data;
  const userId = c.get('userId');
  const tenantId = c.get('tenantId');
  const db = c.get('db');

  // Fetch the approval request
  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, id),
        eq(approvalRequests.tenantId, tenantId)
      )
    )
    .limit(1);

  if (!request) {
    return c.json({ error: 'Approval request not found' }, 404);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'This request has already been reviewed' }, 409);
  }

  // Separation of duties: cannot approve own request
  if (request.requestedBy === userId) {
    return c.json({ error: 'Cannot approve your own request' }, 403);
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await db
    .update(approvalRequests)
    .set({
      status: newStatus,
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
      reviewNotes: notes || null,
    })
    .where(eq(approvalRequests.id, id));

  // Execute side effects based on type and action
  if (action === 'approve') {
    await executeApprovalSideEffects(c, request);
  }

  await createAuditLog(c, {
    action: action === 'approve' ? 'APPROVE' : 'REJECT',
    table_name: 'approval_requests',
    record_id: id,
    old_value: JSON.stringify({ status: request.status }),
    new_value: JSON.stringify({ status: newStatus, notes }),
  });

  return c.json({ data: { id, status: newStatus } });
});

// Side effect execution for approved requests
async function executeApprovalSideEffects(c: any, request: any) {
  const db = c.get('db');
  const requestData = JSON.parse(request.requestData);

  switch (request.type) {
    case 'bill_cancel': {
      // Apply the bill cancellation
      const { cancelBillById } = await import('./billing-cancellation-helpers');
      await cancelBillById(db, request.entityId, c.get('userId'), requestData.reason);
      break;
    }
    case 'bill_edit': {
      // Apply the bill edit
      const { applyBillEdit } = await import('./billing-edit-helpers');
      await applyBillEdit(db, request.entityId, requestData.newValue, c.get('userId'));
      break;
    }
    // discount and refund are handled by existing workflows
  }
}

export default approvals;
```

**Verification:**
```bash
pnpm test -- --testPathPattern=approvals.test
# All tests should PASS (GREEN phase)
```

---

## Task 6: Register approval routes in main app

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `src/index.ts` (add import + route registration)

**Changes:**
```typescript
// Add import
import approvalRoutes from './routes/tenant/approvals';

// Add route registration (near other tenant routes)
app.route('/api/approvals', approvalRoutes);
```

**Verification:**
```bash
pnpm test -- --testPathPattern=approvals.test
```

---

## Task 7: Refactor billing.ts to support approval workflow

**Target:** backend
**Working Directory:** .
**Agent:** bee:backend-engineer-typescript

**Files to Create/Modify:**
- `src/routes/tenant/billing.ts` (modify PUT /:id to check approval)
- `src/routes/tenant/billing-edit-helpers.ts` (new — extract edit logic)

**Changes to billing.ts:**
- When editing a paid bill (currently blocked), create approval request instead
- When editing an unpaid bill with significant changes, optionally require approval
- The `applyBillEdit` function extracted for use by approval side effects

**Changes to billingCancellation.ts:**
- When cancelling a bill, create approval request instead of immediate cancel
- Admin/MD/Director can still cancel directly (their actions auto-approve)
- The `cancelBillById` function extracted for use by approval side effects

**Verification:**
```bash
pnpm test -- --testPathPattern=billing
```

---

## Task 8: Write tests for Approval Center frontend (TDD - RED phase)

**Target:** frontend
**Working Directory:** web
**Agent:** bee:frontend-engineer

**Files to Create/Modify:**
- `web/src/pages/__tests__/ApprovalCenter.test.tsx` (new)

**Test Cases:**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalCenter } from '../ApprovalCenter';

describe('ApprovalCenter', () => {
  it('should render pending approval tabs with counts', async () => {
    // Given: API returns counts { bill_edit: 2, bill_cancel: 1, expense: 3 }
    // When: render ApprovalCenter
    // Then: shows tabs with correct badge counts
  });

  it('should display approval items in table', async () => {
    // Given: API returns list of pending approvals
    // When: render ApprovalCenter
    // Then: shows table with entity_no, requested_by, reason, created_at
  });

  it('should open approve/reject dialog on Review click', async () => {
    // Given: approval item in list
    // When: click Review button
    // Then: opens dialog with approve/reject toggle and notes field
  });

  it('should submit approval with notes', async () => {
    // Given: dialog open with reject selected and notes filled
    // When: click Submit
    // Then: calls PUT /api/approvals/:id/review with correct payload
  });

  it('should show empty state when no pending items', async () => {
    // Given: API returns empty list
    // When: render ApprovalCenter
    // Then: shows "No pending approvals" message
  });

  it('should filter by approval type', async () => {
    // Given: multiple types of approvals
    // When: click on "Bill Edit" tab
    // Then: shows only bill_edit approvals
  });
});
```

**Verification:**
```bash
cd web && pnpm test -- --testPathPattern=ApprovalCenter.test
# All tests should FAIL (RED phase)
```

---

## Task 9: Implement Approval Center frontend (TDD - GREEN phase)

**Target:** frontend
**Working Directory:** web
**Agent:** bee:frontend-engineer

**Files to Create/Modify:**
- `web/src/pages/ApprovalCenter.tsx` (new)
- `web/src/components/ApprovalDialog.tsx` (new — reuse pharmacy pattern)
- `web/src/hooks/useApprovals.ts` (new)

**ApprovalCenter.tsx structure:**
- Tab navigation with counts (reuse pharmacy pattern)
- Table with columns: Type, Entity No, Requested By, Reason, Date, Actions
- Review button opens ApprovalDialog
- Empty state component
- Pagination

**ApprovalDialog.tsx structure:**
- Approve/Reject toggle buttons
- Notes textarea (required for reject)
- Submit button with loading state
- Reuse pattern from `web/src/pages/pharmacy/ApprovalQueuePage.tsx`

**useApprovals.ts hooks:**
```typescript
// useApprovalCounts() — GET /api/approvals/counts
// useApprovalList(type, status, page) — GET /api/approvals
// useReviewApproval() — PUT /api/approvals/:id/review
// useCreateApproval() — POST /api/approvals
```

**Verification:**
```bash
cd web && pnpm test -- --testPathPattern=ApprovalCenter.test
# All tests should PASS (GREEN phase)
```

---

## Task 10: Add Approval Center route and navigation

**Target:** frontend
**Working Directory:** web
**Agent:** bee:frontend-engineer

**Files to Create/Modify:**
- `web/src/App.tsx` (add route)
- Navigation component (add menu item with badge)

**Changes:**
```typescript
// App.tsx — add route
<Route path="approvals" element={<ApprovalCenter />} />

// Navigation — add menu item
{
  label: 'Approvals',
  path: '/approvals',
  icon: ShieldCheck,
  badge: pendingApprovalCount, // from useApprovalCounts()
}
```

**Verification:**
```bash
cd web && pnpm build
```

---

## Task 11: Code review

**Target:** both
**Working Directory:** .
**Agent:** bee:requesting-code-review

**Review Checklist:**
- [ ] Separation of duties enforced (creator != approver)
- [ ] Zod validation on all inputs
- [ ] Audit logs created for all approval actions
- [ ] SQL injection prevented (parameterized queries via Drizzle)
- [ ] Role-based access control correct
- [ ] No hardcoded values
- [ ] Error messages user-friendly
- [ ] Tests cover happy path + edge cases
- [ ] Frontend handles loading/error states
- [ ] Cache invalidation correct on frontend

---

## Execution Order

1. Task 1: Schema ✅
2. Task 2: Migration ✅
3. Task 3: Zod schemas ✅
4. Task 4: Tests (RED) ✅
5. Task 5: Backend implementation (GREEN) ✅
6. Task 6: Route registration ✅
7. Task 7: Billing refactor ✅
8. Task 8: Frontend tests (RED) ✅
9. Task 9: Frontend implementation (GREEN) ✅
10. Task 10: Route + navigation ✅
11. Task 11: Code review ✅

## Zero-Context Test
An engineer with no codebase context should be able to:
1. Read this plan
2. Follow each task in order
3. Run the verification commands
4. Get passing tests at each stage
5. End with a working Approval Center
