# Tenant DB sharding

HMS currently runs on one D1 binding named `DB`. This foundation keeps current behavior unchanged while adding a routing layer so tenant data can be moved to shard databases later.

## Current behavior

- Every tenant resolves to `DB` by default.
- Existing routes that still use `c.env.DB` keep working.
- New or refactored tenant routes should call `getTenantD1(env, tenantId)` or `getTenantDrizzle(env, tenantId)` from `src/lib/tenant-db.ts`.

## Routing registry

`tenant_db_routes` maps each tenant to a logical shard and Cloudflare D1 binding.

Example:

```sql
INSERT OR REPLACE INTO tenant_db_routes (tenant_id, shard_key, db_binding, status)
VALUES ('hospital-a', 'shard-01', 'DB_SHARD_01', 'active');
```

## Emergency/static routing

`HMS_TENANT_DB_ROUTES_JSON` can override the registry without a code change.

Example:

```json
{"hospital-a":"DB_SHARD_01"}
```

## Future shard rollout steps

1. Add a new D1 binding in `wrangler.toml`, for example `DB_SHARD_01`.
2. Apply the same schema/migrations to that D1 database.
3. Export one tenant from the main DB and import it into the shard DB.
4. Update `tenant_db_routes` for that tenant.
5. Refactor high-traffic tenant routes to use the tenant DB resolver instead of direct `c.env.DB`.

Keep control/global tables such as tenants, subscriptions, marketplace identity, and tenant routing in the main registry DB.
