# Incident Response Runbook

## Severity

| Severity | Example | Response |
| --- | --- | --- |
| P0 | PHI leak, production data loss, auth bypass | stop affected feature, preserve logs, notify owner immediately |
| P1 | billing mutation bug, document access bug, major outage | disable workflow or rollback, investigate within 1 hour |
| P2 | degraded performance, non-critical report error | fix in normal hotfix flow |

## First 15 Minutes

1. Identify affected tenant and route.
2. Disable risky feature flag if available.
3. Preserve audit logs and request metadata.
4. Check `/api/health/deep`.
5. Decide rollback vs hotfix.

## PHI/Data Incident

- do not delete audit logs
- do not run destructive SQL
- export relevant audit window
- rotate exposed credentials/tokens
- document patient/hospital impact

## Closeout

Every incident needs:

- timeline
- root cause
- affected data/workflow
- fix
- verification
- prevention item
