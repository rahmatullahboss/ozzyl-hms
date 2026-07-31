# P2 Known Issues — Lab Module & System-Wide

> Identified during adversarial code review (2026-03-13). All issues now resolved.

---

## 1. Race Condition on `getNextSequence` — ✅ Already Fixed

**Scope**: System-wide (Lab, Billing, Pharmacy, Patients)
**File**: [`sequence.ts`](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/lib/sequence.ts)

**Problem**: Two simultaneous requests could generate duplicate sequence numbers.

**Status**: Already fixed — uses atomic `INSERT ... ON CONFLICT DO UPDATE SET current_value = current_value + 1 RETURNING current_value`.

---

## 2. Approximate Critical Threshold in `detectAbnormalFlag` — ✅ Fixed

**File**: [`lab.ts`](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/routes/tenant/lab.ts)

**Problem**: Critical thresholds were computed as `2× the normal range width` — a rough heuristic, not clinically accurate.

**Fix**: Added `critical_low` and `critical_high` columns to `lab_test_catalog` (migration `0026`). `detectAbnormalFlag` now uses per-test thresholds when available, falling back to the 2x heuristic when not set. Schemas and CRUD updated to support the new fields.

---

## 3. No Pagination on Lab Queue Endpoint — ✅ Fixed

**File**: [`lab.ts`](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/routes/tenant/lab.ts)

**Problem**: `GET /orders/queue/today` returned ALL lab items without `LIMIT`/`OFFSET`.

**Fix**: Added `?page=1&limit=50` query params (limit capped at 200). Response now includes `meta: { total, page, limit, totalPages }`.

---

## 4. Missing Tenant Isolation in Billing JOINs — ✅ Fixed

**Files**: `billing.ts` (list, due, detail endpoints)

**Problem**: `JOIN patients p ON b.patient_id = p.id` lacked `AND p.tenant_id = b.tenant_id`. Error logging suppressed.

**Fix**: Added tenant_id filter to all JOIN clauses + `console.error` before re-throwing.

---

## 5. Unsafe `.toLocaleString()` in BillingDashboard — ✅ Fixed

**File**: `BillingDashboard.tsx`

**Problem**: `bill.total_amount.toLocaleString()` crashed with `TypeError` when API returned null fields.

**Fix**: Added `?? 0` null coalescing before all `.toLocaleString()` calls.

---

## 6. Recharts Dimension Warnings — ✅ Fixed

**File**: `HospitalAdminDashboard.tsx`

**Problem**: `ResponsiveContainer` logged width/height = -1 warnings during initial render.

**Fix**: Added `minHeight={0}` prop.
