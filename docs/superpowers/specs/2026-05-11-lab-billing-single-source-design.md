# Lab Test Pricing Single Source of Truth

**Date:** 2026-05-11
**Status:** Approved

## Problem

Lab test prices are stored in two separate tables with no sync:
- `lab_test_catalog.price` → Lab Test Catalog page
- `billing_service_items.price` → Billing Master page

This causes confusion: prices set in Lab Test Catalog don't appear in billing/reception.

## Solution

Make `lab_test_catalog` the single source of truth for lab test prices.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Lab Test Catalog                        │
│                  (lab_test_catalog table)                    │
│  - id, code, name, category, price                           │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      Reception API    Billing API     Lab Order API
      /reception/      /billing-      /lab/orders
       services         counter
              │               │               │
              ▼               ▼               ▼
      Lab Test Prices displayed everywhere (dynamic, not copied)
```

### Changes Required

1. **Reception `/api/reception/services`** → For lab service department, read from `lab_test_catalog`
2. **Billing Counter service items** → For lab items, read from `lab_test_catalog`
3. **LabTestSelector in ReceptionDashboard** → Already uses `/api/lab`, no change needed
4. **Price category overrides** → Keep using `billing_item_price_category_maps` but point to lab test IDs

### Implementation Steps

1. Modify `/api/reception/services` to union `billing_service_items` with `lab_test_catalog` for lab department
2. Modify `/api/billing-counter/service-items` similarly
3. Ensure price categories work with lab tests
4. Remove any duplicate lab entries from `billing_service_items`

### No Changes Needed

- Lab Test Catalog page (existing UI works)
- Lab order creation (already reads from `lab_test_catalog`)
- `lab_test_catalog` table structure