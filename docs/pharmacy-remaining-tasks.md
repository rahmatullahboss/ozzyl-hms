# Pharmacy Module — Remaining Tasks

> **Date:** 2026-05-20
> **PR:** https://github.com/rahmatullahboss/ozzyl-hms/pull/47
> **Status:** Phase 1 complete, refactoring pending

---

## Completed (2026-05-20)

### New Report Endpoints
- `GET /reports/pharmacy/medicine-profit` — Revenue vs COGS per medicine with margin %
- `GET /reports/pharmacy/batch-stock` — Batch-wise stock breakdown with expiry filtering
- `GET /reports/pharmacy/supplier-purchases` — Supplier-wise consolidated purchase report

### File Split
3417-line `pharmacy.ts` split into 6 focused files:
- `pharmacy/master.ts` (359 lines) — Master data CRUD
- `pharmacy/stock.ts` (105 lines) — Stock management
- `pharmacy/purchase.ts` (373 lines) — Purchase flow
- `pharmacy/invoices.ts` (493 lines) — Invoicing
- `pharmacy/advanced.ts` (467 lines) — Advanced features
- `pharmacy/index.ts` (1742 lines) — Legacy + reports + remaining

---

## Remaining Tasks

### 1. Service Layer Extraction (Medium Priority)

**Problem:** All business logic lives in route handlers. Handlers are "fat" (some 100+ lines). No separation between HTTP layer and business logic.

**Target:**
```
src/services/pharmacy/
  ├── master.service.ts      # CRUD for categories, generics, suppliers, items
  ├── stock.service.ts       # Stock queries, adjustments, FEFO logic
  ├── purchase.service.ts    # PO, GRN, supplier returns
  ├── invoice.service.ts     # Invoice creation, returns, deposits
  ├── report.service.ts      # All report queries
  └── index.ts               # Re-exports
```

**Approach:**
1. Create service files with pure functions (take db + tenantId + params, return results)
2. Move SQL queries from route handlers into service functions
3. Route handlers become thin: validate → call service → format response
4. Keep raw SQL pattern (project convention), don't switch to Drizzle ORM in routes

**Risk:** Medium — each endpoint needs testing after extraction

---

### 2. Drizzle Schema Coverage (Medium Priority)

**Problem:** 40+ pharmacy tables exist in SQL migrations but only `pharmacySales` and `pharmacySaleItems` have Drizzle schema definitions. All other tables use raw `db.$client.prepare()` calls — no type safety.

**Target:** Add Drizzle schemas for all pharmacy tables in `src/db/schema/schema.ts`.

**Tables needing schemas:**
- `pharmacy_categories`, `pharmacy_generics`, `pharmacy_suppliers`
- `pharmacy_uom`, `pharmacy_packing_types`, `pharmacy_racks`
- `pharmacy_items`, `pharmacy_item_rack_map`
- `pharmacy_purchase_orders`, `pharmacy_po_items`
- `pharmacy_goods_receipts`, `pharmacy_grn_items`
- `pharmacy_stock`, `pharmacy_stock_transactions`
- `pharmacy_counters`
- `pharmacy_invoices`, `pharmacy_invoice_items`
- `pharmacy_supplier_returns`, `pharmacy_supplier_return_items`
- `pharmacy_invoice_returns`, `pharmacy_invoice_return_items`
- `pharmacy_deposits`, `pharmacy_settlements`
- `pharmacy_provisional_invoices`, `pharmacy_provisional_items`
- `pharmacy_prescriptions`, `pharmacy_prescription_items`
- `pharmacy_narcotic_records`
- `pharmacy_write_offs`, `pharmacy_write_off_items`
- `pharmacy_requisitions`, `pharmacy_requisition_items`
- `pharmacy_dispatches`, `pharmacy_dispatch_items`
- `pharmacy_tax_config`, `pharmacy_item_price_history`, `pharmacy_dosage_templates`

**Approach:**
1. Run `drizzle-kit introspect` to auto-generate schemas from D1
2. Review and clean up generated schemas
3. Add proper indexes and relations
4. Gradually migrate routes from raw SQL to Drizzle ORM (optional, low priority)

**Risk:** Low — schema-only change, no behavior change

---

### 3. Legacy V1 Table Deprecation (Low Priority)

**Problem:** Dual table system exists:
- **V1 (legacy):** `medicines`, `medicine_stock_batches`, `medicine_stock_movements`, `medicine_purchases`, `medicine_purchase_items`, `suppliers`
- **V2 (current):** `pharmacy_items`, `pharmacy_stock`, `pharmacy_stock_transactions`, `pharmacy_purchase_orders`, `pharmacy_goods_receipts`, `pharmacy_suppliers`

Both are active. Some endpoints use V1, others use V2. This causes confusion and maintenance burden.

**Approach:**
1. Audit which endpoints still use V1 tables (grep for table names)
2. Migrate remaining V1 endpoints to V2 tables
3. Add `deprecated` flag to V1 endpoints
4. Create migration to drop V1 tables (after confirming no usage)
5. Update `reportPharmacy.ts` to remove V1 fallbacks

**Risk:** High — needs careful testing, data migration verification

---

### 4. Additional Improvements (Future)

- **Test coverage:** Add unit tests for new report endpoints
- **API documentation:** Document all pharmacy endpoints (OpenAPI/Swagger)
- **Performance:** Add indexes for common report queries
- **Pagination:** Add pagination to report endpoints that return large datasets
