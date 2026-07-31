# Reception IPD UX Review & Fix Plan

## Executive Summary

Comprehensive review of the Reception Dashboard, Patient Context Sidebar, IPD Billing, Admission, Deposit/Payment, Running Bill, and Discharge workflows. This document covers what exists, what works, what's broken, and the implementation plan.

---

## 1. What Already Exists

### Reception Dashboard (`ReceptionDashboard.tsx` ~4,600 lines)
- Patient search (local + global cross-hospital)
- New patient registration with duplicate detection
- Appointment booking (multiple types)
- Quick service bill creation (multi-item cart)
- Pending bills dashboard
- Queue management
- Daily revenue report
- IPD admission from reception
- Provisional billing modal
- Available beds view
- Keyboard shortcuts (F1-F6)

### Patient Context Sidebar (`ReceptionPatientDrawer.tsx` ~1,457 lines)
- 3 tabs: Overview, Timeline, Payments
- Financial snapshot (due/paid/deposit cards)
- Outstanding dues with collect buttons
- Active admission with IPD bill/discharge actions
- Quick OPD bill (service catalog + cart)
- Deposit collection
- Combined billing timeline
- Payment history + deposit ledger

### IPD Billing (`IPBillingPage.tsx` + `ipBilling.ts`)
- Patient list with billing status
- Provisional items management
- Bed charge calculation
- Category-wise breakdown
- Billing timeline
- Discharge bill finalization
- Print running bill

### Admission System (`admissions.ts` ~2,035 lines)
- Full admission CRUD
- Bed management (CRUD, features, reservations)
- Transfer workflows (instant + pending receive)
- Discharge flows (clinical, billing, credit)
- Provisional discharge
- Guardian/care-of handling

### Deposit/Payment System (`deposits.ts` ~790 lines)
- Deposit collection with idempotency
- Refund with balance guard
- Adjustment against bills
- Balance calculation
- Advance report

---

## 2. What Works Correctly

- ✅ Admission creation with atomic bed assignment
- ✅ Deposit collection with idempotency keys
- ✅ Bed status transitions (all use D1 batch for atomicity)
- ✅ Patient context sidebar data fetching
- ✅ Billing timeline (charges + payments combined)
- ✅ Discharge billing guards (blocks if pending charges)
- ✅ Role-based access on deposits and admissions
- ✅ Double-submit prevention via `isPending` guards
- ✅ Cache invalidation after mutations
- ✅ Audit logging on most mutations

---

## 3. What Is Confusing

### UI/UX Issues
1. **Negative balance display** — Shows "-৳780" which confuses receptionists. Should show "Due ৳780" or "Advance ৳780"
2. **Hardcoded English strings** — Multiple strings not wrapped in `t()` (lines 2654, 2715, 3306, 3411 in ReceptionDashboard)
3. **Support button is no-op** — Shows success toast but makes no API call (ReceptionTopBar line 372)
4. **`old_patient` labeled as "Follow Up"** — Semantically confusing
5. **"EMR" keyword in search placeholder** — Reveals hidden command in placeholder text
6. **No loading skeletons in TopBar search** — User gets no feedback during search
7. **Native `confirm()` dialog for logout** — Inconsistent with custom modal pattern

### Backend Issues
1. **Bed charge calculation duplicated 4 times** with different algorithms
2. **Two different invoice number sequences** (discharge vs provisional-to-invoice)
3. **Duplicated helper functions** across files (`queueAccountingPosting`, `inferCategory`, deposit balance query)

---

## 4. What Is Broken

### Critical Bugs

| # | Bug | Severity | Location |
|---|-----|----------|----------|
| 1 | **IP Billing routes have NO role/permission guards** — any authenticated user can access all billing endpoints | CRITICAL | `ipBilling.ts` (all endpoints) |
| 2 | **Race condition in discharge bill deposit deduction** — no conditional INSERT guard, two concurrent discharges could both succeed | HIGH | `ipBilling.ts:722-727` |
| 3 | **Bed charge calculation inconsistency** — `bed-charges.ts` uses `Math.floor+1` with midnight normalization, routes use `Math.ceil` without | HIGH | `bed-charges.ts:29-30` vs `ipBilling.ts:301,430,707` |
| 4 | **`buildRecalculateBedChargesSQL` uses UTC** instead of GMT+6 | MEDIUM | `bed-charges.ts:65` |
| 5 | **Discharge guards don't filter by admission_id** — pending services/dues from previous admissions block current discharge | HIGH | `discharge-billing-guards.ts:39-55` |
| 6 | **Undo transfer can double-occupy a bed** if previous bed is occupied by another patient | HIGH | `admissions.ts:1005,1029` |
| 7 | **Bed reservation INSERT + UPDATE not atomic** | MEDIUM | `admissions.ts:623-628` |
| 8 | **Cancel discharge doesn't clear provisional discharge flag** | MEDIUM | `admissions.ts:1202-1227` |
| 9 | **`addToCart` uses stale `cartTotal`** for calculations | MEDIUM | `ReceptionPatientDrawer.tsx:378-403` |
| 10 | **IPD bill two-step process not atomic** — if pay fails, provisional items are orphaned | MEDIUM | `ReceptionPatientDrawer.tsx:323-363` |

### Medium Bugs

| # | Bug | Location |
|---|-----|----------|
| 11 | `billing_status` filter applied after JS enrichment (pagination would break) | `ipBilling.ts:198` |
| 12 | No validation of `admissionId`/`patientId` route params (NaN propagation) | `ipBilling.ts:279,348` |
| 13 | Missing audit log on `POST /provisional` | `ipBilling.ts:598` |
| 14 | Duplicate endpoints (`POST /` and `POST /batch`, `PATCH` and `PUT` cancel) | `billingProvisional.ts` |
| 15 | Discount calculation inconsistency (`discount` vs `discount_amount`) | `billingProvisional.ts:432` |
| 16 | Pagination `total` returns page count not total count | `deposits.ts:127` |
| 17 | Deposit adjustment rollback not truly atomic | `deposits.ts:669-788` |
| 18 | Ward delete endpoint does nothing (no DELETE statement) | `admissions.ts:405-427` |
| 19 | Bed type enum mismatch (frontend offers `semi_private`/`private`, schema rejects) | `admission.ts:37` vs `BedManagement.tsx:84` |
| 20 | Ward list API returns `available` but frontend expects `available_count` | `admissions.ts:352` vs `BedManagement.tsx:888` |

### Low Bugs

| # | Bug | Location |
|---|-----|----------|
| 21 | Duplicate provisional-discharges routes | `admissions.ts:1275,1292` |
| 22 | `credit-discharge` skips Zod validation | `admissions.ts:1845` |
| 23 | Count SQL uses fragile regex replacement | `admissions.ts:88` |
| 24 | No duplicate bed number check within ward | `admissions.ts:269` |
| 25 | `formatTime` try/catch never catches anything | `ReceptionTopBar.tsx:609-615` |
| 26 | Overly broad cache invalidation (`['reception']` prefix) | `ReceptionTopBar.tsx:195-196` |
| 27 | Timeline uses array index as React key | `ReceptionPatientDrawer.tsx:528` |
| 28 | Non-null assertions on `selectedVisit` in mutation URLs | `ReceptionDashboard.tsx:1013,1027,1041` |

---

## 5. What UI/UX Needs Improvement

### Priority 1: Financial Display
- Replace negative balance with "Due"/"Advance" labels
- Add clear Bengali labels (বাকি আছে, অতিরিক্ত জমা, পরিশোধিত)
- Show financial snapshot cards in sidebar (Total Bill, Total Paid, Deposit, Due/Advance)

### Priority 2: Quick Actions
- Ensure F1-F6 keyboard shortcuts work reliably
- Add "Receive Payment" quick card on dashboard
- Add "Report Delivery" quick card on dashboard
- Improve IPD Billing card flow (search patient first, then open sidebar)

### Priority 3: Sidebar Improvements
- Add more tabs: Services, Reports, Medicine, Notes, Documents
- Improve billing timeline with filters (All, Bills, Payments, Lab, Medicine, etc.)
- Add quick actions: Add Bill, Receive Payment, View IPD Bill, Discharge

### Priority 4: Running Ledger
- Show charges + payments + deposits + discounts in same timeline
- Use simple wording (Bill Added, Payment Received, Deposit Taken, etc.)
- Add category filters

---

## 6. What Backend Logic Needs Improvement

### Priority 1: Security
- Add `requireRole()` to ALL ipBilling.ts endpoints
- Standardize role guard pattern across all routes

### Priority 2: Data Integrity
- Fix bed charge calculation inconsistency (use single source of truth)
- Fix discharge guard to filter by admission_id
- Fix race condition in discharge bill deposit deduction
- Fix undo transfer double-occupancy bug
- Make bed reservation atomic

### Priority 3: Audit
- Add audit log to `POST /provisional`
- Add audit log to provisional item creation

### Priority 4: Code Quality
- Extract duplicated helpers to shared modules
- Use `getDb()` consistently instead of raw `c.env.DB`
- Add NaN validation on route params

---

## 7. What Database/API Changes Are Needed

### API Changes
1. Add `requireRole()` middleware to ipBilling.ts
2. Fix discharge guard SQL to filter by admission_id
3. Add conditional INSERT guard for deposit deduction in discharge bill
4. Fix bed reservation to use atomic batch

### No Schema Changes Required
All issues can be fixed with code changes only. No new tables or columns needed.

---

## 8. What Tests Need to Be Written

### High Priority
1. RBAC tests for IP billing endpoints (deny unauthorized roles)
2. Tenant isolation tests for IP billing
3. Concurrent discharge bill test
4. Discharge guard with admission_id filtering test

### Medium Priority
5. Admission cancellation test
6. Bed transfer with rate change test
7. Deposit adjust success path test
8. Accounting period close blocking test

---

## 9. Implementation Order

### Phase 1: Critical Security & Bug Fixes
1. Add `requireRole()` to ipBilling.ts endpoints
2. Fix discharge guard admission_id filtering
3. Fix bed charge calculation (use `bed-charges.ts` functions everywhere)
4. Fix `buildRecalculateBedChargesSQL` timezone
5. Fix undo transfer double-occupancy
6. Make bed reservation atomic
7. Fix cancel discharge provisional flag clearing

### Phase 2: UI/UX Fixes
8. Fix negative balance display → Due/Advance labels
9. Add Bengali labels for financial terms
10. Fix `addToCart` stale closure
11. Fix hardcoded English strings
12. Fix Support button no-op
13. Fix `formatTime` try/catch

### Phase 3: Backend Improvements
14. Add missing audit logs
15. Extract duplicated helpers
16. Add route param validation
17. Fix pagination total count
18. Fix discount calculation inconsistency

### Phase 4: Testing
19. Add RBAC tests for IP billing
20. Add tenant isolation tests
21. Add concurrent discharge test
22. Run full test suite

---

## 10. Files to Modify

### Backend
- `src/routes/tenant/ipBilling.ts` — Add role guards, fix validation, add audit log
- `src/routes/tenant/billingProvisional.ts` — Fix discount, add audit log
- `src/routes/tenant/deposits.ts` — Fix pagination total
- `src/routes/tenant/admissions.ts` — Fix undo transfer, bed reservation, cancel discharge
- `src/lib/bed-charges.ts` — Fix timezone in SQL
- `src/lib/discharge-billing-guards.ts` — Add admission_id filter

### Frontend
- `web/src/components/reception/ReceptionPatientDrawer.tsx` — Fix addToCart, balance display
- `web/src/pages/ReceptionDashboard.tsx` — Fix hardcoded strings, balance display
- `web/src/components/reception/ReceptionTopBar.tsx` — Fix Support button, formatTime

### Tests
- `test/integration/routes/ip-billing.test.ts` — Add RBAC tests
- `test/integration/routes/admissions.test.ts` — Add undo transfer test
