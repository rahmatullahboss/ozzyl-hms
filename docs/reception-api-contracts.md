# Reception Interface — API Contract Map

> Auto-generated documentation for frontend-backend integration.
> Last updated: 2026-05-15

---

## Sidebar Navigation

| Route | Page / Component |
|-------|-----------------|
| `/reception/dashboard` | `ReceptionDashboard` |
| `/reception/patients` | `PatientList` |
| `/reception/patients/new` | `PatientForm` |
| `/reception/patients/:id` | `PatientDetail` |
| `/reception/patient-card-scan` | `PatientCardScanner` |
| `/reception/billing` | `BillingDashboard` |
| `/reception/billing-counter` | `BillingCounterPage` |
| `/reception/ip-billing` | `IPBillingPage` |
| `/reception/billing-provisional` | `ProvisionalBillingPage` |
| `/reception/payments` | `PaymentsPage` |
| `/reception/appointments` | `AppointmentScheduler` |
| `/reception/queue` | `QueueManagement` |
| `/reception/deposits` | `DepositsPage` |
| `/reception/credit-notes` | `CreditNotesPage` |
| `/reception/settlements` | `PatientSettlementsPage` |
| `/reception/billing-handover` | `BillingHandoverPage` |
| `/reception/admissions` | `AdmissionIPD` |
| `/reception/reports` | `ReceptionReportsPage` |
| `/reception/doctor-status` | `DoctorStatusPage` |
| `/reception/insurance` | `InsuranceBillingPage` |

---

## Backend Routes

### reception.ts

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/reception/services` | `search?`, `department_id?`, `price_category_id?`, `limit?` | `{ services: ServiceItem[] }` | List billing service items |
| GET | `/api/reception/service-departments` | — | `{ departments: Dept[] }` | List service departments |
| GET | `/api/reception/patients/:id/context` | URL: `patientId` | Patient context (visits, bills, admission, deposits, labOrders, payments, depositLedger) | Global patient context for drawer |
| GET | `/api/reception/report-delivery/lookup` | `invoice` (query) | Invoice/patient/report readiness | Lab report delivery lookup |
| GET | `/api/reception/doctors/today` | `date?` (query) | `{ date, doctors: DoctorStatus[] }` | Today's doctor availability |
| PATCH | `/api/reception/doctors/:doctorId/today` | `{ isAvailable?`, `maxSerial?` } | `{ doctorId, date, isAvailable, maxSerial }` | Update doctor availability |
| POST | `/api/reception/quick-admit` | `{ name?`, `mobile?`, `age?`, `gender?`, `reason?`, `idempotencyKey?` } | `{ patient, visitNo, message }` | Quick emergency admission |
| POST | `/api/reception/admit-with-deposit` | `{ patientId`, `bedId?`, `doctorId?`, `admissionType`, `admitSource?`, `depositAmount`, `paymentMethod`, ... } | `{ admission, deposit? }` | Admission with deposit |
| POST | `/api/reception/visits/:visitId/services` | `{ serviceItemId`, `doctorId?`, `quantity?`, `discountAmount?`, `description?` } | `{ id, message, serviceName, totalAmount }` | Add single service to visit |
| POST | `/api/reception/visits/:visitId/services/bulk` | `{ serviceItemIds[]`, `doctorId?`, `quantity?`, `discountAmount?` } | `{ message, services[], totalCount, grandTotal }` | Add multiple services |
| POST | `/api/reception/visits/:visitId/services/lab` | `{ labTestIds[]`, `discountAmount?`, `orderDate?`, `notes?` } | `{ orderId, orderNo, message, totalAmount }` | Add lab order as visit service |
| POST | `/api/reception/visits/:visitId/services/procedure` | `{ serviceItemId`, `procedureName`, `instructions?`, `quantity?`, `discountAmount?` } | `{ procedureId, orderNo, message, totalAmount }` | Add procedure order |
| GET | `/api/reception/visits/:visitId/services` | URL: `visitId` | `{ services[], pendingTotal }` | List services for a visit |
| POST | `/api/reception/visits/:visitId/generate-bill` | `{ discount?`, `idempotencyKey?` } | `{ billId, invoiceNo, total, serviceCount, idempotent? }` | Generate bill from pending services |
| GET | `/api/reception/daily-report` | `date?`, `staff_id?` | `{ date, summary, byCategory, byPaymentMethod, byDoctor }` | Daily collection report |
| GET | `/api/reception/visits` | `date?`, `search?`, `limit?` | `{ visits[] }` | Visit list for reception |

### billingCounter.ts

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-counter/pending-appointment-charges` | `date?`, `limit?` | `{ data[], date }` | Pending appointment charges |
| GET | `/api/billing-counter/pending-bills` | `date?`, `limit?` | `{ data[], date }` | Pending unpaid bills |
| GET | `/api/billing-counter/handover-recipients` | — | `{ recipients[] }` | List handover recipients |
| GET | `/api/billing-counter/handovers/pending` | — | `{ handovers[] }` | Pending counter handovers assigned to current user |
| POST | `/api/billing-counter/handovers/:handoverId/accept` | `{ receivedAmount`, `remarks?`, `disputeReason?` } | `{ message, handoverId, status, receivedAmount, openedSessionId }` | Accept incoming counter handover and start next shift |
| GET | `/api/billing-counter/sessions/active` | — | `{ active, session }` | Get active counter session |
| POST | `/api/billing-counter/sessions/activate` | `{ counterId`, `openingCash?`, `remarks?` } | `{ message, session }` | Activate billing counter |
| POST | `/api/billing-counter/sessions/:id/close` | `{ closingCash`, `handoverAmount?`, `handoverTo?`, `remarks?` } | `{ message, sessionId, closingCash, expectedCash, variance, ... }` | Close counter session |
| GET | `/api/billing-counter/service-items` | `search?`, `limit?`, `price_category_id?`, `department_id?` | `{ data[] }` | Service catalog search |
| POST | `/api/billing-counter/invoices` | `{ patientId`, `visitId?`, `items[]`, `referringDoctorId?`, `priceCategoryId?`, `billMode`, `payment`, `idempotencyKey?` } | `{ message, billId, invoiceNo, mode, total, paidAmount, depositDeducted, dueAmount, status }` | Create billing counter invoice |
| GET | `/api/billing-counter/admin/pending-handovers` | — (admin) | `{ handovers[], totalPending, count }` | Admin pending handovers |
| GET | `/api/billing-counter/admin/collection-summary` | `date?` | `{ date, todayCollection, pendingCount, pendingAmount, counterBreakdown[] }` | Admin collection summary |
| POST | `/api/billing-counter/admin/collect/:handoverId` | — | `{ message, handoverId, status }` | Admin collect handover |
| POST | `/api/billing-counter/admin/partial-collect/:handoverId` | `{ collectedAmount`, `remarks?` } | `{ message, handoverId, status, collectedAmount, remainingAmount }` | Admin partial collect |
| GET | `/api/billing-counter/sessions/history` | `date?`, `staff_id?`, `status?` | `{ sessions[], date, count }` | Counter sessions history |

### billing.ts

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing` | `status?`, `from?`, `to?`, `search?`, `page?`, `limit?` | `{ bills[], meta, summary }` | List bills with pagination |
| GET | `/api/billing/due` | `from?`, `to?`, `date?`, `patient_id?`, `search?` | `{ bills[], summary }` | List outstanding bills |
| GET | `/api/billing/patient/:patientId/ledger` | URL: `patientId`, `from?`, `to?` | Patient ledger with transactions | Consolidated receivable statement |
| GET | `/api/billing/patient/:patientId` | URL: `patientId` | `{ bills[] }` | All bills for a patient |
| GET | `/api/billing/:id` | URL: `id` | `{ bill, items[], payments[], deposit_adjustments[] }` | Single bill with full detail |
| POST | `/api/billing` | `{ patientId`, `items[]`, `visitId?`, `referringDoctorId?`, `priceCategoryId?`, `discount?` } | `{ message, billId, invoiceNo, total }` | Create new itemized bill |
| POST | `/api/billing/pay` | `{ billId`, `amount`, `paymentMethod`, `type?`, `idempotencyKey?`, `externalTransactionId?` } | `{ message, receiptNo, paidAmount, outstanding, status, idempotent? }` | Record payment on bill |
| PUT | `/api/billing/:id` | `{ items[]`, `discount?` } | `{ message, totalAmount, discount, itemCount }` | Edit bill (pre-payment) |

### billingProvisional.ts

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-provisional` | `patient_id?`, `visit_id?`, `bill_status?`, `search?`, `page?`, `per_page?`, `limit?` | `{ data[], page, per_page, total }` | List provisional items |
| GET | `/api/billing-provisional/summary` | `patient_id?`, `bill_status?` | `{ total_items, total_amount, billed_count, ... }` | Provisional summary |
| GET | `/api/billing-provisional/patient/:patientId/summary` | URL: `patientId` | `{ data: summary }` | Patient provisional summary |
| POST | `/api/billing-provisional` | `{ patient_id`, `visit_id?`, `admission_id?`, `items[]` } | `{ message, count }` | Create provisional items |
| POST | `/api/billing-provisional/batch` | Same as POST | Same | Batch create |
| PATCH | `/api/billing-provisional/:id/cancel` | `{ cancel_reason }` | `{ message }` | Cancel provisional |
| PUT | `/api/billing-provisional/:id/cancel` | `{ cancel_reason }` | `{ message }` | Cancel (alt method) |
| POST | `/api/billing-provisional/pay` | `{ patient_id`, `provisional_item_ids?`, `discount?`, `payment_method?`, `remarks?` } | `{ message, bill_id, invoice_no, total, paid, due, status, items_count }` | Convert to invoice |

### billingHandover.ts

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-handover` | `status?`, `staff_id?` | `{ handovers[] }` | List handovers |
| GET | `/api/billing-handover/pending/:staffId` | URL: `staffId` | `{ pending[] }` | Pending for staff |
| POST | `/api/billing-handover` | `{ handover_to`, `handover_amount`, `due_amount?`, `handover_type?`, `remarks?` } | `{ id, message, status }` | Create handover |
| PUT | `/api/billing-handover/:id/receive` | `{ remarks?` } | `{ message }` | Confirm receipt |
| PUT | `/api/billing-handover/:id/verify` | — | `{ message }` | Admin verify |
| GET | `/api/billing-handover/report/daily` | `date`, `staff_id` | `{ date, total_in, total_out, total_collection, total_handover, difference }` | Daily collection vs handover |

---

## Frontend → API → Backend Mapping

### ReceptionDashboard (`/reception/dashboard`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/reception/visits?date=` | `GET /api/reception/visits` | List visits for date |
| `GET /api/billing` | `GET /api/billing` | List all bills |
| `GET /api/patients` | `GET /api/patients` | List patients |
| `GET /api/doctors` | `GET /api/doctors` | List doctors |
| `GET /api/reception/services` | `GET /api/reception/services` | Billing service items |
| `GET /api/reception/service-departments` | `GET /api/reception/service-departments` | Departments |
| `GET /api/reception/daily-report?date=` | `GET /api/reception/daily-report` | Daily report |
| `GET /api/appointments/today` | `GET /api/appointments/today` | Today's appointments |
| `GET /api/queue/tokens/stats` | `GET /api/queue/tokens/stats` | Queue stats |
| `GET /api/billing-counter/sessions/active` | `GET /api/billing-counter/sessions/active` | Active counter |
| `GET /api/deposits/balance/{patientId}` | `GET /api/deposits/balance/:patientId` | Deposit balance |
| `GET /api/reception/visits/{visitId}/services` | `GET /api/reception/visits/:visitId/services` | Visit services |
| `POST /api/queue/token` | `POST /api/queue/token` | Issue queue token |
| `POST /api/patients` | `POST /api/patients` | Create patient |
| `POST /api/visits` | `POST /api/visits` | Create visit |
| `POST /api/appointments` | `POST /api/appointments` | Book appointment |
| `POST /api/appointments/{id}/pay-now` | `POST /api/appointments/:id/pay-now` | Pay appointment |
| `POST /api/reception/quick-admit` | `POST /api/reception/quick-admit` | Quick admit |
| `POST /api/reception/visits/{id}/services/bulk` | `POST /api/reception/visits/:id/services/bulk` | Bulk add services |
| `POST /api/reception/visits/{id}/services/lab` | `POST /api/reception/visits/:id/services/lab` | Add lab order |
| `POST /api/reception/visits/{id}/services/procedure` | `POST /api/reception/visits/:id/services/procedure` | Add procedure |
| `POST /api/reception/visits/{id}/generate-bill` | `POST /api/reception/visits/:id/generate-bill` | Generate bill |
| `POST /api/billing-counter/invoices` | `POST /api/billing-counter/invoices` | Quick service bill |
| `POST /api/billing/pay` | `POST /api/billing/pay` | Collect payment |

### BillingCounterPage (`/reception/billing-counter`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/patients?search=` | `GET /api/patients` | Patient search |
| `GET /api/reception/patients/{id}/context` | `GET /api/reception/patients/:id/context` | Patient context |
| `GET /api/visits?patientId=` | `GET /api/visits` | Patient visits |
| `GET /api/deposits/balance/{patientId}` | `GET /api/deposits/balance/:patientId` | Deposit balance |
| `GET /api/doctors?search=` | `GET /api/doctors` | Doctor search |
| `GET /api/billing-master/schemes` | `GET /api/billing-master/schemes` | Insurance schemes |
| `GET /api/billing-master/price-categories` | `GET /api/billing-master/price-categories` | Price categories |
| `GET /api/reception/service-departments` | `GET /api/reception/service-departments` | Departments |
| `GET /api/billing-master/counters` | `GET /api/billing-master/counters` | Counters |
| `GET /api/billing-counter/sessions/active` | `GET /api/billing-counter/sessions/active` | Active session |
| `GET /api/billing-counter/handover-recipients` | `GET /api/billing-counter/handover-recipients` | Handover recipients |
| `GET /api/billing-counter/handovers/pending` | `GET /api/billing-counter/handovers/pending` | Incoming handover for current user |
| `GET /api/billing-counter/pending-appointment-charges?limit=12` | `GET /api/billing-counter/pending-appointment-charges` | Pending appointments |
| `GET /api/billing-counter/pending-bills?limit=12` | `GET /api/billing-counter/pending-bills` | Pending bills |
| `GET /api/billing-counter/service-items?search=&limit=` | `GET /api/billing-counter/service-items` | Service catalog |
| `POST /api/billing-counter/invoices` | `POST /api/billing-counter/invoices` | Create invoice |
| `POST /api/billing-counter/sessions/activate` | `POST /api/billing-counter/sessions/activate` | Activate counter |
| `POST /api/billing-counter/sessions/{id}/close` | `POST /api/billing-counter/sessions/:id/close` | Close counter |
| `POST /api/billing-counter/handovers/{id}/accept` | `POST /api/billing-counter/handovers/:handoverId/accept` | Accept incoming handover |
| `POST /api/appointments/{id}/pay-now` | `POST /api/appointments/:id/pay-now` | Pay appointment |
| `POST /api/billing/pay` | `POST /api/billing/pay` | Pay bill |

### ReceptionPatientDrawer (`/components/reception/ReceptionPatientDrawer.tsx`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/reception/patients/{id}/context` | `GET /api/reception/patients/:id/context` | Patient context |
| `GET /api/billing-counter/service-items` | `GET /api/billing-counter/service-items` | Service catalog |
| `GET /api/doctors` | `GET /api/doctors` | List doctors |
| `GET /api/billing-counter/sessions/active` | `GET /api/billing-counter/sessions/active` | Active counter |
| `POST /api/deposits` | `POST /api/deposits` | Collect deposit |
| `POST /api/billing-counter/invoices` | `POST /api/billing-counter/invoices` | Create invoice |

### ReceptionTopBar (`/components/reception/ReceptionTopBar.tsx`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/patients?search=` | `GET /api/patients` | Patient search |
| `GET /api/billing-counter/sessions/active` | `GET /api/billing-counter/sessions/active` | Active counter |
| `GET /api/billing-counter/handover-recipients` | `GET /api/billing-counter/handover-recipients` | Handover recipient list |
| `GET /api/billing-counter/handovers/pending` | `GET /api/billing-counter/handovers/pending` | Pending handover assigned to user |
| `POST /api/reception/quick-admit` | `POST /api/reception/quick-admit` | Quick admit |
| `POST /api/billing-counter/sessions/{id}/close` | `POST /api/billing-counter/sessions/:id/close` | Handover current shift |
| `POST /api/billing-counter/handovers/{id}/accept` | `POST /api/billing-counter/handovers/:handoverId/accept` | Accept previous shift handover |

### ReceptionReportsPage (`/reception/reports`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/reception/daily-report?date=` | `GET /api/reception/daily-report` | Daily collection report |
| `GET /api/reception/report-delivery/lookup?invoice=` | `GET /api/reception/report-delivery/lookup` | Report delivery lookup |
| `POST /api/billing/pay` | `POST /api/billing/pay` | Collect due payment |

### BillingDashboard (`/reception/billing`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/billing` | `GET /api/billing` | List bills |
| `GET /api/billing/due` | `GET /api/billing/due` | List due bills |
| `POST /api/billing-counter/invoices` | `POST /api/billing-counter/invoices` | Create quick bill |
| `POST /api/billing/pay` | `POST /api/billing/pay` | Collect payment |
| `GET /api/deposits/balance/{patientId}` | `GET /api/deposits/balance/:patientId` | Deposit balance |
| `GET /api/billing-provisional/patient/{patientId}/summary` | `GET /api/billing-provisional/patient/:patientId/summary` | Provisional summary |
| `GET /api/billing/{billId}` | `GET /api/billing/:id` | Bill detail |

### ProvisionalBillingPage (`/reception/billing-provisional`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/billing-provisional` | `GET /api/billing-provisional` | List provisional items |
| `GET /api/billing-provisional/summary` | `GET /api/billing-provisional/summary` | Summary stats |
| `GET /api/billing-master/service-items` | `GET /api/billing-master/service-items` | Service catalog |
| `POST /api/billing-provisional/batch` | `POST /api/billing-provisional/batch` | Create provisional |
| `PUT /api/billing-provisional/{id}/cancel` | `PUT /api/billing-provisional/:id/cancel` | Cancel |
| `POST /api/billing-provisional/pay` | `POST /api/billing-provisional/pay` | Convert to invoice |

### BillingHandoverPage (`/reception/billing-handover`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/billing-handover` | `GET /api/billing-handover` | List handovers |
| `GET /api/billing-counter/admin/pending-handovers` | `GET /api/billing-counter/admin/pending-handovers` | Admin pending |
| `POST /api/billing-handover` | `POST /api/billing-handover` | Create handover |
| `PUT /api/billing-handover/{id}/receive` | `PUT /api/billing-handover/:id/receive` | Receive |
| `PUT /api/billing-handover/{id}/verify` | `PUT /api/billing-handover/:id/verify` | Verify |
| `POST /api/billing-counter/admin/collect/{id}` | `POST /api/billing-counter/admin/collect/:handoverId` | Admin collect |
| `POST /api/billing-counter/admin/partial-collect/{id}` | `POST /api/billing-counter/admin/partial-collect/:handoverId` | Partial collect |

### IPBillingPage (`/reception/ip-billing`)

| Frontend Call | Backend Route | Purpose |
|--------------|--------------|---------|
| `GET /api/ip-billing/patients` | `GET /api/ip-billing/patients` | IPD patients |
| `GET /api/ip-billing/stats` | `GET /api/ip-billing/stats` | Stats |
| `GET /api/ip-billing/pending/{admissionId}` | `GET /api/ip-billing/pending/:admissionId` | Pending items |
| `GET /api/admissions/{id}/detail` | `GET /api/admissions/:id/detail` | Admission detail |
| `GET /api/deposits/balance/{patientId}` | `GET /api/deposits/balance/:patientId` | Deposit balance |
| `GET /api/billing-master/service-departments` | `GET /api/billing-master/service-departments` | Departments |
| `GET /api/billing-master/service-items` | `GET /api/billing-master/service-items` | Service items |
| `POST /api/billing-provisional` | `POST /api/billing-provisional` | Create provisional |
| `POST /api/deposits` | `POST /api/deposits` | Collect deposit |
| `PUT /api/billing-provisional/{id}/cancel` | `PUT /api/billing-provisional/:id/cancel` | Cancel provisional |
| `POST /api/ip-billing/discharge-bill` | `POST /api/ip-billing/discharge-bill` | Discharge billing |

---

## Doctor Status (new — 2026-05-14)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/reception/doctors/today` | `date?` (query) | `{ date, doctors: DoctorStatus[] }` | Get doctor daily status |
| PATCH | `/api/reception/doctors/:doctorId/today` | `{ isAvailable?`, `maxSerial?` } | `{ doctorId, date, isAvailable, maxSerial }` | Toggle availability / set serial limit |

**Frontend:** `DoctorStatusPage` (`/reception/doctor-status`)

---

## Key Conventions

- All API routes are versioned: `/api/v1/...` (enforced from day 1)
- Timezone: stored UTC, displayed in user's timezone
- Soft delete on important records; no hard delete without confirmation
- `idempotencyKey` supported on payment and billing endpoints to prevent double-submit
- `GET /api/reception/patients/:id/context` is the single source of truth for patient drawer data — aggregates visits, bills, admission, deposits, lab orders, payments, and deposit ledger in one call
- `due` field is source of truth for outstanding balance once deposits or credit notes have adjusted a bill (billing.ts pay endpoint)
