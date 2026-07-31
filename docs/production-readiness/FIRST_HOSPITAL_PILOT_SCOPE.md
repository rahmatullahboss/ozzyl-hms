# First Hospital Controlled Pilot Scope

**Decision date:** 2026-07-12  
**Decision owner:** Product / Hospital Owner  
**Release type:** Controlled hospital pilot  
**Broad multi-hospital rollout:** Not approved by this scope decision

## Included in the first pilot

The first hospital pilot includes the core workflows required for routine OPD and IPD operation:

- Platform, tenant, authentication, users, roles and permissions
- Patient registration, identity, duplicate checks and patient search
- Reception, appointment, queue and visit creation
- Doctor OPD workspace, clinical charting and prescriptions
- IPD admission, bed/ward operations, nursing workflow and discharge
- Billing, payments, deposits/due/refund where applicable, cash counter and cash closing
- Laboratory workflow
- Pharmacy and dispensing workflow
- Store, reagent and general inventory required by the selected departments
- Hospital administration and MD/management dashboards
- Required reports, prints, audit records and operational configuration for these workflows

## Deferred from the first pilot

### Offline / local-server mode

The offline/local-server capability exists and has previous review evidence, but it is deliberately not enabled for the first controlled hospital pilot.

**Pilot verdict:** `N/A FOR THIS HOSPITAL — RE-REVIEW BEFORE ENABLEMENT`

Before enabling it for a future hospital or phase, repeat environment-specific review for:

- local server installation and hardening
- schema and data sync
- reconnect/conflict handling
- branch and tenant isolation
- update/rollback process
- backup/restore
- monitoring and incident response

Other optional integrations or specialty modules may also be marked `N/A FOR THIS HOSPITAL` when they are not part of the signed hospital commissioning scope.

## Production-readiness consequence

This scope decision does not mark any included module as ready. Every included module must still pass its applicable code, UI, automated, manual, operational and sign-off gates. Wave 0 blockers must close before the hospital begins real multi-role clinical use.
