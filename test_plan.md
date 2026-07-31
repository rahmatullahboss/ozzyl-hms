# 🧪 HMS Test Plan

> **Framework**: Vitest + `@cloudflare/vitest-pool-workers`  
> **Run**: `npm test` from `apps/api/`  
> No tests need to be written at this time — this doc is a reference for future sprints.

---

## Test Setup Requirements

```
test/
├── helpers/
│   ├── setup.ts          — test DB seeding, tenant creation
│   └── fixtures.ts       — reusable patient/doctor/staff data
├── routes/
│   ├── patients.test.ts
│   ├── doctors.test.ts
│   ├── visits.test.ts
│   ├── lab.test.ts
│   ├── pharmacy.test.ts
│   ├── billing.test.ts
│   ├── staff.test.ts
│   ├── shareholders.test.ts
│   └── commissions.test.ts
└── lib/
    └── sequence.test.ts
```

---

## 🔴 Priority 1 — Money & Stock (write first)

### Billing ([billing.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/billing.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 1 | Create bill with multiple line items → correct subtotal/total | Happy path |
| 2 | Discount > subtotal → total clamped to 0 | Edge case |
| 3 | Collect partial payment → status = `partially_paid` | Happy path |
| 4 | Collect full remaining → status = `paid` | Happy path |
| 5 | **Overpayment rejected** → 400 error | Guard |
| 6 | Pay on already-paid bill → 400 error | Guard |
| 7 | Bill not found → 404 | Error |
| 8 | Income record created on bill creation | Side effect |
| 9 | Invoice number auto-increments (INV-000001, INV-000002) | Sequence |
| 10 | Receipt number auto-increments (RCP-000001) | Sequence |
| 11 | Tenant isolation — can't access other tenant's bills | Security |

### Pharmacy — Purchases ([pharmacy.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/pharmacy.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 1 | Purchase creates stock batches with correct quantities | Happy path |
| 2 | Medicine aggregate qty updated after purchase | Side effect |
| 3 | Stock movement recorded with type `purchase_in` | Side effect |
| 4 | **Atomic batch** — partial failure rolls back all items | Atomicity |
| 5 | Purchase with discount → correct total_amount | Edge case |
| 6 | Multiple items in one purchase → all batches created | Happy path |

### Pharmacy — Sales ([pharmacy.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/pharmacy.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 7 | FEFO: earliest-expiry batch deducted first | Core logic |
| 8 | Multi-batch deduction when qty > single batch | Edge case |
| 9 | **Insufficient stock → 400** | Guard |
| 10 | Aggregate medicine qty decremented after sale | Side effect |
| 11 | Stock movement recorded with type `sale_out` | Side effect |
| 12 | Sale with zeroed batch → batch qty_available = 0 | Edge case |

### Pharmacy — Alerts
| # | Test Case | Type |
|---|-----------|------|
| 13 | Low stock alert returns medicines at/below reorder_level | Happy path |
| 14 | Expiring alert returns batches within `days` window | Happy path |
| 15 | Summary returns correct investment/income/COGS/profit | Calculation |

---

## 🟠 Priority 2 — Core CRUD

### Patients ([patients.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/patients.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 1 | Create patient → patient_code generated (P-000001) | Happy path |
| 2 | Serial number generated for queue management | Side effect |
| 3 | Search by name, mobile, patient_code | Happy path |
| 4 | Update patient — partial fields merge correctly | Edge case |
| 5 | Zod rejects invalid data (missing name) | Validation |
| 6 | Tenant isolation | Security |

### Doctors (`doctors.test.ts`)
| # | Test Case | Type |
|---|-----------|------|
| 1 | Create doctor with consultation fee | Happy path |
| 2 | Search by name/specialty | Happy path |
| 3 | Soft delete sets `is_active = 0` | Happy path |
| 4 | Deleted doctors not returned in list | Edge case |
| 5 | Update partial fields | Edge case |

### Visits (`visits.test.ts`)
| # | Test Case | Type |
|---|-----------|------|
| 1 | Create OPD visit → visit_no generated | Happy path |
| 2 | Create IPD visit → admission_no generated | Happy path |
| 3 | List with patient/doctor JOINs | Happy path |
| 4 | Discharge non-IPD visit → 404 | Guard |
| 5 | Discharge IPD → discharge_date set | Happy path |

### Lab (`lab.test.ts`)
| # | Test Case | Type |
|---|-----------|------|
| 1 | Add test to catalog | Happy path |
| 2 | Create lab order with items → prices from catalog | Happy path |
| 3 | Invalid test ID → 400 | Guard |
| 4 | Enter result → status = `completed` | Happy path |
| 5 | Today's queue returns only today's pending items | Filter |
| 6 | Print count increments | Side effect |
| 7 | Soft delete test (deactivate) | Happy path |

---

## 🟡 Priority 3 — Staff & Finance

### Staff ([staff.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/staff.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 1 | Pay salary with bonus + deduction → correct net_salary | Happy path |
| 2 | **Duplicate month payment → 409** | Guard |
| 3 | Expense record created for salary | Side effect |
| 4 | Salary report shows paid/unpaid per staff | Report |
| 5 | `/salary-report` route accessible (not shadowed by [/:id](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/schemas/commission.ts#18-19)) | Routing |
| 6 | Soft deactivate staff | Happy path |
| 7 | Inactive staff can't receive salary → 404 | Guard |

### Shareholders ([shareholders.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/shareholders.test.ts))
| # | Test Case | Type |
|---|-----------|------|
| 1 | Calculate per-person distribution | Calculation |
| 2 | Distribute creates per-shareholder records | Happy path |
| 3 | **Duplicate month distribution → 409** | Guard |
| 4 | **Share limit exceeded → 400** | Guard |
| 5 | Mark individual payment as paid | Happy path |
| 6 | Tenant isolation on UPDATE | Security |
| 7 | Distribution with 0 profit → all amounts = 0 | Edge case |

### Commissions (`commissions.test.ts`)
| # | Test Case | Type |
|---|-----------|------|
| 1 | Create commission → defaults to `unpaid` | Happy path |
| 2 | Mark as paid → status + date set | Happy path |
| 3 | Summary groups by paid/unpaid with correct totals | Report |
| 4 | Filter by status and marketing person | Filter |

---

## 🔵 Priority 4 — Cross-cutting

### Sequence Counter (`sequence.test.ts`)
| # | Test Case | Type |
|---|-----------|------|
| 1 | First call returns `PREFIX-000001` | Happy path |
| 2 | Concurrent calls increment atomically | Concurrency |
| 3 | Different tenants have independent counters | Tenant isolation |
| 4 | Different counter types are independent | Independence |

### Security (can be in any test file)
| # | Test Case | Type |
|---|-----------|------|
| 1 | Unauthenticated request → 401 | Auth |
| 2 | Wrong tenant → 0 results or 404 | Isolation |
| 3 | SQL injection attempt via query params → safe (bind) | Security |

---

## Total Test Count

| Priority | Tests | Module |
|----------|-------|--------|
| 🔴 P1 | 26 | Billing (11) + Pharmacy (15) |
| 🟠 P2 | 20 | Patients (6) + Doctors (5) + Visits (5) + Lab (7) |
| 🟡 P3 | 18 | Staff (7) + Shareholders (7) + Commissions (4) |
| 🔵 P4 | 7 | Sequence (4) + Security (3) |
| **Total** | **71** | |
