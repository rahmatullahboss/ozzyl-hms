# Production Deploy Runbook

> **Canonical shadow override:** Tenant 100 financial canonical shadow mode is active. The immediate deploy command previously documented here is suspended. Follow `docs/operations/canonical-shadow-safe-production-deploy.md` for every production Worker release until this notice is removed.

> **2026-07-29 Canonical/Inventory integration gate:** Inventory Modular Monolith development is complete only on `feature/inventory-modular-monolith`; Canonical Core V1 and Full Modular Monolith remain active. Do not deploy from those program branches or treat a future `main` merge as migration/deployment authorization. Read `docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md` and `docs/database/2026-07-29-inventory-main-migration-reconciliation.md` before preparing any release.

Production releases must use the production environment binding and the versioned candidate workflow. Do not use plain `wrangler deploy`, `wrangler deploy --env production`, or `pnpm deploy:production` as the normal production release path while shadow mode is active.

Before a Canonical/Inventory release candidate is uploaded:

1. confirm the approved release commit is on verified `origin/main`;
2. collect the exact applied and pending production migration set;
3. reconcile every Inventory migration number against accepted Canonical migrations;
4. stop if `0558d_retire_legacy_inventory_tables.sql` or any successor destructive retirement file is pending;
5. obtain separate additive-migration authorization and apply/verify required backward-compatible schema before candidate traffic;
6. keep feature/provider activation, traffic promotion and legacy retirement as separate approvals.

Production D1 was not queried during the 2026-07-29 documentation rebaseline. Repository migration filenames are not evidence of the live pending set.

## Predeploy Checklist

1. `git status --short` reviewed.
2. Migration files reviewed and ordered.
3. D1 backup completed.
4. Restore drill completed or waived with reason.
5. `pnpm test` passed.
6. `pnpm build` passed.
7. Smoke target confirmed: `https://hms-saas-production.rahmatullahzisan.workers.dev`
8. First hospital feature flags reviewed.
9. Rollback commit and previous deployment known.

## Postdeploy Smoke

Run:

```bash
pnpm test:e2e:prod
```

Manually check:

- `/api/health`
- `/api/health/deep`
- hospital login
- patient search
- patient registration duplicate warning
- appointment creation
- prescription draft and finalization
- lab order and report
- bill creation and payment
- document upload/download
- audit log view by hospital admin

## Rollback

1. Stop new risky feature flags.
2. Redeploy the previous known-good commit.
3. Do not roll back schema blindly after live writes.
4. If schema restore is required, follow `backup-restore.md`.
