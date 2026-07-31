# CDB-V1-030M Service Catalog and Pricing Integration Audit

**Checkpoint:** `CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION-VERIFIED`
**Date:** 2026-07-29
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local repository implementation and verification only
**Production access, mutation, activation, deployment, traffic change, push or main integration:** none

## Outcome

The protected service-catalog and effective-pricing writer group is command-complete. The five route writer pairs across billing master, price categories and settings import/export now cross reviewed Canonical command boundaries, and the two compatibility writes inside the route adapter are explicitly registered as guarded atomic compatibility boundaries.

The completed route pairs are:

- `src/routes/tenant/billingMaster.ts` / `billing_service_items`;
- `src/routes/tenant/billingMaster.ts` / `billing_item_price_category_maps`;
- `src/routes/tenant/priceCategories.ts` / `billing_item_price_category_maps`;
- `src/routes/tenant/settings-import-export.ts` / `billing_service_items`;
- `src/routes/tenant/settings-import-export.ts` / `billing_item_price_category_maps`.

The adapter-owned compatibility pairs are:

- `src/lib/canonical/service-catalog-route-integration.ts` / `billing_service_items`;
- `src/lib/canonical/service-catalog-route-integration.ts` / `billing_item_price_category_maps`.

## Implemented authority

`src/lib/canonical/contracts/manage-service-catalog.ts` now implements the frozen commands:

- `upsertCanonicalServiceCatalogItem`;
- `setCanonicalServicePrice`;
- `retireCanonicalServicePrice`.

Prepared variants support composition with existing route-owned compatibility statements inside one D1 batch. Each command uses tenant-scoped idempotency, stable request fingerprints, exact source mapping, immutable outbox evidence and fail-closed replay conflict handling.

`src/lib/canonical/service-catalog-route-integration.ts` provides deterministic legacy source identities, exact source evidence hashes, department-to-service-kind typing, base and price-category context resolution, and immutable price replacement or retirement. Existing master-data HTTP responses and CSV import behaviour remain compatible.

## Identity, price and correction rules

- Service identity is tenant-scoped and derives from an explicit route source key; labels do not create identity.
- Billing service and price-map compatibility rows adopt nullable tenant-unique `canonical_source_key` values only when mutated.
- Prices are converted to exact integer minor units and retain `BDT` currency evidence.
- Non-base prices require an exact price-category context key.
- Active effective periods for the same tenant, service and context cannot overlap.
- Price changes append a replacement version and retire the prior effective version; posted history is not overwritten.
- Stale service or price evidence fails closed.
- Cross-tenant service or price references are rejected.

Migration `migrations/0569_service_catalog_route_identity.sql` adds the nullable tenant-scoped route identities without rewriting existing rows. Schema governance confirms that migration number `0569` is unique.

## Atomicity and rollback

Service creation, update, tenant copy, deactivation, default-category pricing, price-matrix mutation, category mapping and CSV import now commit their compatibility rows together with Canonical catalog or price facts, exact source mappings, idempotency receipt and outbox event. A failed compatibility or Canonical statement rolls back the complete batch.

Verified behaviour includes:

- exact replay returns the prior command result;
- changed replay fails with an idempotency conflict;
- overlapping effective periods are rejected;
- stale replacement or retirement evidence is rejected;
- tenant isolation is retained;
- legacy compatibility, Canonical facts, mappings and outbox roll back together.

## Verification

Focused service-catalog and pricing verification passed:

- 8 test files;
- 76 tests;
- 0 failures.

The focused files cover command contracts, prepared composition, route identity schema, route integration, billing-master service items, price-category routes, settings import and deterministic governance classification.

Additional gates passed:

- TypeScript `tsc --noEmit`;
- pre-main-sync migration manifest build with 503 governed migrations;
- complete pre-main-sync `canonical:check`;
- post-main-sync focused merge and service-pricing verification with 14 files / 138 tests;
- post-main-sync migration manifest build with 504 governed migrations;
- complete post-main-sync `canonical:check`;
- canonical schema, authority, access, identity/episode, protected inventory, contract and writer-coverage checks.

## Deterministic protected state after checkpoint

- protected surfaces: 941;
- protected writers: 235;
- protected readers: 510;
- protected tables: 84;
- Canonical-command writers: 117;
- atomic-compatibility writers: 96;
- governed-external writers: 3;
- command-required writers: 15;
- isolated fixtures: 4;
- remaining implementation groups: 4;
- unknown or unclassified writers/readers: 0;
- existing command boundaries: 19;
- contract-only command boundaries: 1;
- repository authority-access registry: 1,031 writers and 2,690 readers.

## Safety and authorization

No production database was queried or mutated. No provider flag was enabled. No traffic, deployment, live retirement, push or CDB-to-main integration occurred. Reviewed local `main` source `fb4565ba0` was synchronized into the CDB branch, and existing legacy and Canonical history remains intact.

## Exact next bounded checkpoint

`CDB-V1-030N-INVOICE-DEPOSIT-REPORTING-INTEGRATION`

Complete the nine overlapping invoice-document, patient-deposit-liability and reporting-metric writer pairs across:

- `src/lib/billing-create-batch.ts`;
- `src/lib/billing-payment-state.ts`;
- `src/lib/canonical/appointment-billing-finalization.ts`;
- `src/lib/canonical/gateway-payment-verification.ts`;
- `src/lib/executed-refund.ts`;
- `src/lib/payment-void-execution.ts`.

Reuse the existing invoice, deposit, cancellation and metric-governance commands; preserve current HTTP and accounting compatibility; require exact invoice/deposit lineage and integer-minor-unit evidence; and prove replay, stale or concurrent rejection, tenant isolation, atomic audit/outbox and complete rollback without production access or mutation.
