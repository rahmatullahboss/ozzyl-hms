# Health Card QR Production Hardening

This document tracks production-grade improvements that are intentionally kept out of the first advanced QR rollout because they require broader product, policy, or workflow work.

## Current Advanced Rollout

- Printed health cards use an opaque QR token, not raw patient demographics or clinical data.
- Staff can scan the token to resolve a patient using role-aware data scopes.
- Reception/admin/billing roles receive registration-safe demographics and identifiers.
- Doctor roles can receive linked clinical summaries for treatment workflow.
- Nurse roles receive registration-safe data plus a nursing-context hint; full nursing clinical access should be tied to assignments.
- Cross-hospital import creates a tenant-local MRN while preserving the same global UHID.
- Scan and import actions are audited.

## Future Improvements

1. Add fine-grained care-team assignment checks for nurse clinical access across OPD, IPD, ward, and emergency contexts.
2. Add card-token rotation policy with configurable expiry, reissue workflows, and forced revocation after suspected card loss.
3. Add duplicate-resolution UI before import when the destination tenant has partial demographic matches.
4. Add break-glass emergency access with reason capture, stricter audit review, and admin alerts.
5. Add tenant-configurable policy controls for which roles can import patients and which roles can view cross-hospital summaries.
6. Add QR scan rate limiting per token, per tenant, and per staff user.
7. Add patient notification when a card is scanned or imported at a new hospital.
8. Add offline scanner queue support for reception desks with unreliable connectivity.
9. Add signed portable bundles for interoperability with external systems that are not on this platform.
