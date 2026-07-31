# Database and Migration Guide for Agents

Last inspected: 2026-07-13

Read this before any DB, schema, migration, billing, accounting, sync, or local-server work.

## Current DB/schema condition

- Drizzle table declarations parsed from src/db/schema/*.ts: 214
- Unique Drizzle table names: 214
- tenant-schema.sql tables: 59
- schema.sql tables: 3
- SQL files in migrations/: 394
- Numbered migrations: 385
- Latest migration prefix found: 0422
- Next migration prefix to use: 0423
- Existing legacy duplicate numeric prefixes: 42

## Source of truth order

1. Live D1 after applied migrations is runtime truth.
2. migrations/ is historical schema truth. Search it before adding anything.
3. src/db/schema/ is Drizzle/TypeScript schema, but it may not contain every historical table/column.
4. tenant-schema.sql is fresh local tenant/local-server baseline.
5. schema.sql is small bootstrap/global baseline.

## Before adding a migration

1. Search exact table name in src/db/schema, migrations, tenant-schema.sql, and schema.sql.
2. Search alternate names: singular/plural, old prefix, module prefix, camelCase Drizzle const.
3. Search exact column name in migrations, src/routes, src/lib, and tests.
4. Use next unused migration prefix 0423 or newer.
5. Do not create another duplicate numeric prefix.

## Migration required when

Create a numbered migration for new table, new column, index, constraint, default, trigger/view, required seed, production backfill, or any runtime D1 shape route code depends on.

No migration is normally required for UI-only changes, route refactors using existing columns, tests/docs only, TypeScript-only aliases, or cache-only KV changes.

## Update together

- New production table: migration plus usually src/db/schema update.
- Fresh local install needs it: update tenant-schema.sql or schema.sql too.
- Local-to-cloud synced write: emit local_sync_outbox event at write boundary.
- Financial/cash write: check idempotency, audit, counter session/custody, and accounting posting.
- Patient/clinical data: check tenant scope, privacy/audit, and store files in R2 not D1.

## Prefix hints

Accounting/cash: accounting_, chart_, journal_, fiscal_, emp_cash_, cash_, bank_, expense_, income_.
Appointments/OPD: appointments, consultations, visits, visit_services, doctor_shifts, doctor_availability.
Billing/payment: billing_, bills, invoice_items, payments, price_categories.
Clinical/EHR: clinical_, cln_, medical_records, document_records, encounters, patient_vitals, health_record_, consent_.
Diagnostics: tests, lab_, lis_, radiology_, prescription_lab_test_usage_stats.
Emergency/IPD/OT/nursing: er_, ipd_, ot_, admissions, beds, nur_.
Inventory/pharmacy: Inventory*, inventory_, pharmacy_, medicines, formulary_, drug_.
Patient ecosystem: patients, global_patient_, mpi_, health_cards, patient_claim_codes.
Sync/local server: local_sync_, local_schema_, cloud_sync_.

## SQL-only/baseline-only tables noticed

cloud_sync_ingest_events, local_schema_migrations, local_schema_sync_approvals, local_schema_sync_log, local_sync_outbox, OT operational tables, prescription_lab_test_usage_stats, prescription_medicine_usage_stats, shift_handover_reports.
