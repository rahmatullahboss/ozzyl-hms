# RBAC Permission Matrix

> Auto-generated on 2026-04-22

| File | Method | Path | Allowed Roles |
|------|--------|------|---------------|
| consents.ts | POST | `/templates` | hospital_admin |
| consents.ts | POST | `/` | doctor, md, nurse, pharmacist, hospital_admin |
| consents.ts | POST | `/:id/sign` | doctor, md, nurse, pharmacist, hospital_admin |
| consents.ts | POST | `/:id/revoke` | doctor, md, nurse, pharmacist, hospital_admin |
| fhir.ts | POST | `/Patient` | nurse, reception, doctor, hospital_admin |
| fhir.ts | POST | `/Observation` | doctor, md, nurse, pharmacist, hospital_admin |
| fhir.ts | POST | `/Encounter` | nurse, reception, doctor, hospital_admin |
| lab.ts | PATCH | `/items/:itemId/verify` | laboratory, doctor, md, hospital_admin |
| medicalRecords.ts | GET | `/` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | POST | `/` | hospital_admin, doctor, md |
| medicalRecords.ts | GET | `/births` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | POST | `/births` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | PUT | `/births/:id` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | DELETE | `/births/:id` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | GET | `/deaths` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | POST | `/deaths` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | PUT | `/deaths/:id` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | DELETE | `/deaths/:id` | hospital_admin, doctor, md, nurse |
| medicalRecords.ts | POST | `/diagnosis` | hospital_admin, doctor, md |
| medicalRecords.ts | GET | `/diagnosis/:visitId` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | DELETE | `/diagnosis/:id` | hospital_admin, doctor, md |
| medicalRecords.ts | GET | `/icd10` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | GET | `/master-data` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | POST | `/documents` | hospital_admin, doctor, md |
| medicalRecords.ts | DELETE | `/documents/:id` | hospital_admin, doctor, md |
| medicalRecords.ts | GET | `/referrals` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | GET | `/stats` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | GET | `/:id` | hospital_admin, doctor, md, nurse, reception |
| medicalRecords.ts | PUT | `/:id` | hospital_admin, doctor, md |
| medicalRecords.ts | DELETE | `/:id` | hospital_admin, doctor, md |
| orderSets.ts | POST | `/` | doctor, md, hospital_admin |
| orderSets.ts | PUT | `/:id` | doctor, md, hospital_admin |
| orderSets.ts | DELETE | `/:id` | doctor, md, hospital_admin |
| orderSets.ts | POST | `/:id/items` | doctor, md, hospital_admin |
| orderSets.ts | PUT | `/:id/items/:itemId` | doctor, md, hospital_admin |
| orderSets.ts | DELETE | `/:id/items/:itemId` | doctor, md, hospital_admin |
| orderSets.ts | POST | `/:id/apply` | doctor, md, hospital_admin |
| orderSets.ts | POST | `/favorites` | doctor, md, hospital_admin |
| permissions.ts | GET | `/catalog` | hospital_admin, md |
| permissions.ts | GET | `/matrix` | hospital_admin, md |
| permissions.ts | PUT | `/role` | hospital_admin, md |
| permissions.ts | DELETE | `/role/:role` | hospital_admin, md |
| permissions.ts | GET | `/user/:userId` | hospital_admin, md |
| permissions.ts | POST | `/user/override` | hospital_admin, md |
| permissions.ts | DELETE | `/user/override/:userId/:permission` | hospital_admin, md |
| permissions.ts | GET | `/modules` | hospital_admin, md |
| permissions.ts | PUT | `/modules` | hospital_admin, md |
| permissions.ts | GET | `/modules/:role` | hospital_admin, md |
| pharmacy.ts | GET | `/medicines` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/medicines` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/medicines/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/medicines/:id/stock` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/suppliers` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/suppliers` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/suppliers/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/purchases` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/purchases` | hospital_admin, pharmacist |
| pharmacy.ts | POST | `/sales` | hospital_admin, pharmacist |
| pharmacy.ts | POST | `/billing` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/alerts/low-stock` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/alerts/expiring` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/summary` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/categories` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/categories` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/categories/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/generics` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/generics` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/generics/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/pharmacy-suppliers` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/pharmacy-suppliers` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/pharmacy-suppliers/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/uom` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/uom` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/packing-types` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/packing-types` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/racks` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/racks` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/items` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/items/:id` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/items` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/items/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/stock` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/stock/adjustment` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/stock/transactions` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/purchase-orders` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/purchase-orders/:id` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/purchase-orders` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/purchase-orders/:id/cancel` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/goods-receipts` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/goods-receipts/:id` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/goods-receipts` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/returns/supplier` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/returns/supplier` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/invoices` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/invoices/:id` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/invoices` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/invoice-returns` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/invoice-returns` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/deposits` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/deposits/balance/:patientId` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/deposits` | hospital_admin, pharmacist |
| pharmacy.ts | POST | `/deposits/return` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/settlements` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/settlements` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/counters` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/counters` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/provisional-invoices` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/provisional-invoices` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/prescriptions` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/prescriptions/:id` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/prescriptions` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/prescriptions/:id/dispense` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/narcotics` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/narcotics` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/write-offs` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/write-offs` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/requisitions` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/requisitions` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/dispatches` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/dispatches` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/master-drugs/search` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/master-generics/search` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/master-companies/search` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/master-drugs/stats` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/patient/:patientId/billing-summary` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/patient/:patientId/bill-history` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/patient/:patientId/provisional` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/patient/:patientId/deposits` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/invoices/:id/receipt` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | PUT | `/invoices/:id/print-count` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/deposits/:id/print-count` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/purchase-orders/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/reports/stock` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/reports/sales` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/reports/expiry` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/suppliers/:id/ledger` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/suppliers/:id/summary` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/dispensary-stock` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | GET | `/tax-config` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/tax-config` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/tax-config/:id` | hospital_admin, pharmacist |
| pharmacy.ts | DELETE | `/tax-config/:id` | hospital_admin, pharmacist |
| pharmacy.ts | PATCH | `/items/:id/type` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/items/:id/price-history` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/items/:id/price-history` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/items/barcode/:code` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | PUT | `/items/:id/barcode` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/dosage-templates` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | POST | `/dosage-templates` | hospital_admin, pharmacist |
| pharmacy.ts | PUT | `/dosage-templates/:id` | hospital_admin, pharmacist |
| pharmacy.ts | DELETE | `/dosage-templates/:id` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/grn/pending-approval` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | PUT | `/grn/:id/approve` | hospital_admin, pharmacist |
| pharmacy.ts | GET | `/write-offs/pending-approval` | hospital_admin, pharmacist, doctor, md, nurse |
| pharmacy.ts | PUT | `/write-offs/:id/approve` | hospital_admin, pharmacist |
| qualityKpi.ts | GET | `/dashboard` | hospital_admin, md, director |
| qualityKpi.ts | GET | `/trends` | hospital_admin, md, director |
| qualityKpi.ts | POST | `/snapshot` | hospital_admin, md, director |
| reportPharmacy.ts | GET | `/dispensing-summary` | hospital_admin, pharmacist, doctor, md, nurse |
| reportPharmacy.ts | GET | `/stock-value` | hospital_admin, pharmacist, doctor, md, nurse |
| reportPharmacy.ts | GET | `/expiry-alerts` | hospital_admin, pharmacist, doctor, md, nurse |
| reportPharmacy.ts | GET | `/top-dispensed` | hospital_admin, pharmacist, doctor, md, nurse |
| reportPharmacy.ts | GET | `/purchase-summary` | hospital_admin, pharmacist, doctor, md, nurse |
| reportPharmacy.ts | GET | `/stock-movements` | hospital_admin, pharmacist, doctor, md, nurse |
| radiology/catalog.ts | GET | `/imaging-types` | hospital_admin, doctor, md, nurse, reception |
| radiology/catalog.ts | POST | `/imaging-types` | hospital_admin, doctor, md |
| radiology/catalog.ts | PUT | `/imaging-types/:id` | hospital_admin, doctor, md |
| radiology/catalog.ts | DELETE | `/imaging-types/:id` | hospital_admin, doctor, md |
| radiology/catalog.ts | GET | `/imaging-items` | hospital_admin, doctor, md, nurse, reception |
| radiology/catalog.ts | POST | `/imaging-items` | hospital_admin, doctor, md |
| radiology/catalog.ts | PUT | `/imaging-items/:id` | hospital_admin, doctor, md |
| radiology/catalog.ts | DELETE | `/imaging-items/:id` | hospital_admin, doctor, md |
| radiology/catalog.ts | GET | `/templates` | hospital_admin, doctor, md, nurse, reception |
| radiology/catalog.ts | GET | `/templates/:id` | hospital_admin, doctor, md, nurse, reception |
| radiology/catalog.ts | POST | `/templates` | hospital_admin, doctor, md |
| radiology/catalog.ts | PUT | `/templates/:id` | hospital_admin, doctor, md |
| radiology/catalog.ts | GET | `/film-types` | hospital_admin, doctor, md, nurse, reception |
| radiology/catalog.ts | POST | `/film-types` | hospital_admin, doctor, md |
| radiology/catalog.ts | GET | `/stats` | hospital_admin, doctor, md, nurse, reception |
| radiology/orders.ts | GET | `/` | hospital_admin, doctor, md, nurse, reception |
| radiology/orders.ts | POST | `/` | hospital_admin, doctor, md |
| radiology/orders.ts | GET | `/:id` | hospital_admin, doctor, md, nurse, reception |
| radiology/orders.ts | PATCH | `/:id/scan` | hospital_admin, doctor, md, nurse |
| radiology/orders.ts | PATCH | `/:id/unscan` | hospital_admin, doctor, md |
| radiology/orders.ts | PATCH | `/:id/cancel` | hospital_admin, doctor, md |
| radiology/orders.ts | DELETE | `/:id` | hospital_admin, doctor, md |
| radiology/pacs.ts | GET | `/` | hospital_admin, doctor, md, nurse, reception |
| radiology/pacs.ts | GET | `/:id` | hospital_admin, doctor, md, nurse, reception |
| radiology/pacs.ts | POST | `/` | hospital_admin, doctor, md, nurse |
| radiology/pacs.ts | DELETE | `/:id` | hospital_admin, doctor, md, nurse |
| radiology/pacs.ts | PUT | `/upload/:key{.+}` | hospital_admin, doctor, md, nurse |
| radiology/reports.ts | GET | `/` | hospital_admin, doctor, md, nurse, reception |
| radiology/reports.ts | POST | `/` | hospital_admin, doctor, md |
| radiology/reports.ts | GET | `/:id` | hospital_admin, doctor, md, nurse, reception |
| radiology/reports.ts | PUT | `/:id` | hospital_admin, doctor, md |
| radiology/reports.ts | PATCH | `/:id/finalize` | hospital_admin, doctor, md |
| radiology/reports.ts | DELETE | `/:id` | hospital_admin, doctor, md |

**Total protected endpoints:** 197
