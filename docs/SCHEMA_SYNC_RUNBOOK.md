# Local-Server Schema-Sync Runbook

**Owner:** `fix/db-migrations` (commit `617a80b6`).
**Status:** active.
**Audience:** SRE / on-call engineer / DBA migrating a tenant.

---

## 1. What the schema-sync endpoint is for

The `local-server/schema-sync/*` route family allows an operator with a verified
local-server install to push schema changes (new migrations, column additions,
index changes) into a tenant's D1 database without going through the normal
release pipeline. It exists so the on-prem Dell R730 server (see
`docs/RUNBOOK_BACKUP_RESTORE.md`) can keep its D1 mirror in lock-step with the
cloud worker.

It is **not** a public API and it is **not** a replacement for normal migrations.
Anything that can wait for the next release should wait.

---

## 2. Authentication

The endpoint no longer trusts a static `X-Internal-Schema-Sync` header. The
caller must present three signed headers:

| Header | Description |
|---|---|
| `X-Sync-Schema-Version` | The manifest version the caller believes is current (e.g. `2026.06.15-0348`). |
| `X-Sync-Timestamp` | Unix seconds, must be within ±5 minutes of server clock (replay protection). |
| `X-Sync-Signature` | `HMAC-SHA256(secret, "${version}\n${timestamp}\n${body}")` in lowercase hex. |

The shared secret is configured via the `HMS_LOCAL_SERVER_SYNC_SECRET` worker
secret (the legacy `LOCAL_SERVER_SYNC_SECRET` name is also accepted for
back-compat). It is the same secret the local-server install and the worker
must both load; rotation is described in §6.

A request that fails any of (a) missing header, (b) clock-skew window, or
(c) signature mismatch is rejected with `401 Unauthorized` and a row is
written to `local_schema_sync_log` with `reason='signature_failed'`.

---

## 3. Authorization (RBAC)

Even with a valid signature, the **approval** endpoint requires the caller to
hold the `schema.sync.approve` permission (defined in the central
`ROUTE_PERMISSIONS` matrix shipped by `fix/auth-rbac`). The **apply** endpoint
requires `schema.sync.apply`. Both permissions are reserved for the
`super_admin` role and a small set of named DBA accounts. The route handler
enforces this with `requirePermission(...)`; the per-tenant signature is
necessary but not sufficient.

---

## 4. Approval payload format

The approval endpoint accepts a JSON body with explicit typed fields. Free-form
SQL strings are no longer accepted.

```json
{
  "manifest_version": "2026.06.15-0348",
  "migrations": [
    { "id": "0349_portal_consent_hardening", "sha256": "ab12…", "expected_rows_affected_max": 12000 },
    { "id": "0350_billing_cash_hardening",   "sha256": "cd34…", "expected_rows_affected_max": 8000  }
  ],
  "justification": "P0-29 / P0-30 / P0-32 portal privacy fixes; max 12000 affected rows (verified in staging restore).",
  "approver_user_id": 42,
  "approver_tenant_id": "tenant-hq"
}
```

The server:

1. Verifies the signature against the JSON body.
2. Re-validates the `sha256` of each migration against the manifest file in
   the worker bundle.
3. Compares `expected_rows_affected_max` against a hard cap configured in
   `wrangler.toml` (`SCHEMA_SYNC_MAX_ROWS_PER_CALL`, default 25000).
4. Requires a `justification` of at least 20 characters that contains the
   string of one of the P0/P1 IDs in `docs/CODE_REVIEW_PHASED_REPORT.md`.
5. Writes an `approval_requested` row to `local_schema_sync_log` with the
   full payload and caller identity.

If any of (1)–(4) fails, the request is rejected with `400` / `403` and the
audit row is written with `reason='validation_failed'`.

---

## 5. Apply path & denylist

The apply endpoint:

1. Re-validates the signature and the approval record.
2. Re-checks the per-migration `sha256` against the manifest.
3. Skips any migration that already has a row in `__migrations` (idempotent).
4. Rejects the entire batch if **any** statement matches the denylist:
   - `DROP TABLE`, `DROP SCHEMA`
   - `TRUNCATE`
   - `ALTER TABLE … DROP COLUMN`
   - `DELETE` (any form, except inside a migration that explicitly opts in via
     a `-- schema-sync-allow-delete` comment)
5. Executes the statements via D1's `db.batch([...])` after splitting on `;`
   with awareness of `$$` dollar-quoted blocks.
6. Writes an `applied` (or `apply_failed`) row to `local_schema_sync_log`.

The script `scripts/apply-migrations.sh` accepts `--dry-run` (skip the batch
call, only emit the audit row) and `--max N` (refuse to apply more than N
migrations in a single invocation).

---

## 6. Secret rotation

1. Generate a new 32-byte secret:
   `head -c 32 /dev/urandom | xxd -p -c 64`.
2. Put it in the worker secret store:
   `wrangler secret put HMS_LOCAL_SERVER_SYNC_SECRET`.
3. Update the local-server install (`/etc/ozzyl/local-server.env`).
4. Both sides must be updated within the 5-minute skew window — easiest is
   to do them in the same maintenance window.
5. The old secret continues to work for the next 24 hours (grace window
   enforced by a parallel `HMS_LOCAL_SERVER_SYNC_SECRET_PREVIOUS` secret)
   so a half-rotated fleet does not deadlock.

---

## 7. Audit log

Every signature, approval, apply, reject, and rotation event writes one row
to `local_schema_sync_log`:

| Column | Description |
|---|---|
| `id` | Auto-increment |
| `tenant_id` | Tenant being synced |
| `actor_user_id` | Caller identity (or `system` for service-initiated) |
| `actor_ip` | Caller IP |
| `action` | `signature_failed` / `approval_requested` / `approved` / `apply_started` / `applied` / `apply_failed` / `secret_rotated` |
| `manifest_version` | The version involved |
| `migration_ids` | JSON array of migration ids in the request |
| `reason` | Free-text reason (required for `signature_failed`, `apply_failed`) |
| `created_at` | UTC timestamp |

This log is read by the `local_server_sync_audit` Cloudflare Analytics Engine
dataset and is alerted on in `docs/INCIDENT_RUNBOOK.md` §3 ("Sync failures").

---

## 8. Rollback procedure

A bad apply can be rolled back **only** if the corresponding migration
shipped a `down.sql` and that `down.sql` is itself in the manifest. The
rollback endpoint requires the same signed headers plus a `rollback=true`
flag in the body. It runs the matching `down.sql` inside a transaction and
records a `rolled_back` row in `local_schema_sync_log`.

If the migration did not ship `down.sql`, rollback must be done by restoring
the D1 database from the most recent `wrangler d1 export` snapshot. See
`docs/RUNBOOK_BACKUP_RESTORE.md` §3.

---

## 9. Example `curl`

```bash
TS=$(date +%s)
BODY='{"manifest_version":"2026.06.15-0348","migrations":[{"id":"0349_portal_consent_hardening","sha256":"ab12…","expected_rows_affected_max":12000}],"justification":"P0-29 portal privacy; max 12000 rows in staging.","approver_user_id":42,"approver_tenant_id":"tenant-hq"}'
SIG=$(printf '%s\n%s\n%s' "2026.06.15-0348" "$TS" "$BODY" \
  | openssl dgst -sha256 -hmac "$HMS_LOCAL_SERVER_SYNC_SECRET" -hex \
  | awk '{print $2}')

curl -X POST https://hms.example.com/api/local-server/schema-sync/approve \
  -H "Content-Type: application/json" \
  -H "X-Sync-Schema-Version: 2026.06.15-0348" \
  -H "X-Sync-Timestamp: $TS" \
  -H "X-Sync-Signature: $SIG" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  --data "$BODY"
```

---

## 10. Related runbooks

- `docs/INCIDENT_RUNBOOK.md` — alert destinations, on-call escalation
- `docs/RUNBOOK_BACKUP_RESTORE.md` — D1 / R2 / KV backup & restore
- `docs/CODE_REVIEW_PHASED_REPORT.md` — P0-06, P0-07, P0-08 (this runbook closes them)
