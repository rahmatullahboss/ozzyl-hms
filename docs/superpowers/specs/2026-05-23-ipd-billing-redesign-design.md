# IPD Billing UI/UX Redesign - Design Spec

**Date:** 2026-05-23
**Status:** Approved
**Goal:** Zero cognitive load for operators, 100% transparent billing

---

## Problem Statement

Current IPD billing has 4 different UI surfaces (IPBillingPage, ProvisionalBillingModal, ReceptionPatientDrawer inline billing, AdmissionIPD discharge). This creates confusion and inconsistency. Need a unified single-modal approach.

## Design Decisions

### 1. Single ProvisionalBillingModal for All IPD Billing

**Decision:** One modal used everywhere (F4, Sidebar, IPBillingPage, Patient Drawer)

**Entry Points:**
- Dashboard F4 button → opens ProvisionalBillingModal
- Sidebar "Manage Provisional Bill" button → opens ProvisionalBillingModal
- IPBillingPage "Manage Bill" button → opens ProvisionalBillingModal
- ~~ReceptionPatientDrawer IPD Quick Bill~~ → **REMOVED**

### 2. Remove Inline Billing from ReceptionPatientDrawer

**Decision:** Completely remove IPD Quick Bill section (lines 1304-1456 of ReceptionPatientDrawer.tsx)

**Keep:** "Manage Provisional Bill" button that opens the same ProvisionalBillingModal

### 3. Separate DischargeModal

**Decision:** Discharge flow in a separate modal (not inside ProvisionalBillingModal)

**Entry Points:**
- Sidebar Admissions tab "Initiate Discharge" button
- IPBillingPage detail view "Discharge" button

### 4. Admin PIN for Large Discounts

**Decision:** Discounts > 20% require admin/MD PIN validation

**Logic:**
- Discount ≤ 20%: No PIN required
- Discount > 20%: System prompts for admin PIN
- PIN validated against stored admin PINs

---

## Component Architecture

```
ProvisionalBillingModal (Single Modal)
├── Section 1: Sticky Patient Header
│   ├── Patient avatar, name, PID
│   └── Bed badge: "🛏️ Cabin-302"
│
├── Section 2: Magic Cards (3-column)
│   ├── Total Deposit (green) - ৳40,000
│   ├── Total Cost (gray) - ৳45,000
│   └── Net Balance (red/green) - -৳5,000
│
├── Section 3: Quick Add Item (single row)
│   ├── [Category: Pharmacy/Lab/Service ▼]
│   ├── [Item Search]
│   ├── [Qty]
│   └── [➕ Add Charge]
│
├── Section 4: Ledger Table (2 tabs)
│   ├── Tab 1: Running Charges (with 🗑️ delete)
│   └── Tab 2: Settled Bills (read-only)
│
└── Section 5: Footer Actions
    ├── [🖨️ Print Running Bill]
    └── [💰 Add Deposit]

DischargeModal (Separate Modal)
├── Step 1: Bill Summary (auto-aggregated)
│   ├── Total Charges
│   ├── Discount
│   ├── After Discount
│   ├── Advance Deposit
│   └── Net Payable/Refund
│
├── Step 2: Discount Section
│   ├── [Discount %]
│   └── [Admin PIN] (if >20%)
│
├── Step 3: Payment
│   ├── [Payment Method ▼]
│   ├── [Tender Amount]
│   ├── [Change: ৳X]
│   └── [Remarks]
│
└── Step 4: Complete Settlement
    └── [✅ Complete Settlement & Discharge]
```

---

## UI Layout Details

### ProvisionalBillingModal

```
┌─────────────────────────────────────────────────────────────┐
│  [X]  IPD Provisional Billing                               │
├─────────────────────────────────────────────────────────────┤
│  👤 Patient Name  |  PID-001  |  🛏️ Cabin-302               │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ ৳40,000  │  │ ৳45,000  │  │ -৳5,000  │                 │
│  │ Deposit  │  │   Cost   │  │ Balance  │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
│                                                             │
│  [Category ▼] [Item Search    ] [Qty] [Add Charge]         │
│                                                             │
│  ┌─ Running Charges ──── Settled Bills ────────────────┐   │
│  │ Date | Category | Item | Qty | Total | 🗑️           │   │
│  │────────────────────────────────────────────────────│   │
│  │ ... items ...                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [🖨️ Print Running Bill]              [💰 Add Deposit]     │
└─────────────────────────────────────────────────────────────┘
```

### DischargeModal

```
┌─────────────────────────────────────────────────────────────┐
│  [X]  Discharge & Final Settlement                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Bill Summary ──────────────────────────────────────┐   │
│  │ Total Charges:     ৳45,000                          │   │
│  │ Discount:          -৳2,000 (5%)                     │   │
│  │ After Discount:    ৳43,000                          │   │
│  │ Advance Deposit:   -৳40,000                         │   │
│  │ ─────────────────────────────                       │   │
│  │ Net Payable:       ৳3,000                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Discount:  [____5__]%  [Admin PIN (if >20%)]              │
│                                                             │
│  Payment:   [Cash ▼]   Tender: [৳5,000]   Change: ৳2,000  │
│                                                             │
│  Remarks:   [________________________________]              │
│                                                             │
│  [✅ Complete Settlement & Discharge]                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Backend Changes

### Admin PIN Validation

**Endpoint:** `POST /api/ip-billing/discharge-bill`

**New field:** `admin_pin` (required when discount_percent > 20)

**Logic:**
```typescript
if (discountPercent > 20 && !adminPin) {
  throw new Error('Admin PIN required for discounts above 20%');
}
if (discountPercent > 20 && adminPin) {
  const valid = await validateAdminPin(adminPin);
  if (!valid) throw new Error('Invalid admin PIN');
}
```

### Discharge Automation

On successful discharge:
1. All provisional items → Final Invoice
2. Patient status → Discharged
3. Bed/Cabin → Empty/Needs Cleaning

---

## Files to Modify

### Frontend

| File | Change |
|------|--------|
| `web/src/pages/ReceptionDashboard.tsx` | Enhance ProvisionalBillingModal with new design |
| `web/src/components/reception/ReceptionPatientDrawer.tsx` | Remove IPD Quick Bill (lines 1304-1456) |
| `web/src/components/reception/IpdDischargeDialog.tsx` | Replace with new DischargeModal |
| `web/src/pages/IPBillingPage.tsx` | Remove inline billing, use same modal |

### Backend

| File | Change |
|------|--------|
| `src/routes/tenant/ipBilling.ts` | Add admin_pin validation |
| `src/lib/discharge-billing-guards.ts` | Add discount PIN guard |

---

## Non-Goals

- No changes to OPD billing
- No changes to billing master data
- No changes to deposit system logic
- No changes to bed management logic

## Success Criteria

1. Single modal used from all entry points
2. No inline billing in ReceptionPatientDrawer
3. Discharge flow in separate modal with 4 steps
4. Admin PIN required for discounts > 20%
5. Backend automation on discharge (invoice, status, bed release)
