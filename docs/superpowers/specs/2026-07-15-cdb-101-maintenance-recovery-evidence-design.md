# CDB-101 Maintenance, Owner, and Recovery Evidence Design

Date: 2026-07-15

Status: preparation-only; no production export, Time Travel action, owner approval, or live request

## Goal

Create one strict protected offline evidence boundary for the remaining maintenance-window, operational-owner, rollback-policy, protected-export, and Time Travel bookmark prerequisites for reporting cutover.

The evidence boundary must prevent all production mutation wrappers from starting an external command unless one exact evidence pack:

- binds the exact production database, reporting domain, and tenant `100`;
- proves authorization issuance and approval occurred before maintenance start;
- proves an exact maintenance start/end and expiry equal to end plus observation grace;
- proves four distinct acknowledged operational identities: rollback primary/backup and observation primary/backup;
- proves exact decision authorities and protected communication channels;
- binds reviewed rollback, reopen, and observation timing thresholds;
- proves a protected production export with exact SHA-256, positive size, metadata evidence, and mode `700`/`600` storage assertions;
- proves an exact Time Travel bookmark for the same production database;
- proves the canonical import source-export SHA-256 equals the protected recovery export SHA-256;
- produces an authorization-compatible normalized snapshot and aggregate-only receipt.

## Exact evidence document

Schema version `1` contains:

- evidence ID and generation timestamp;
- exact production database identity;
- reporting domain and tenant `100`;
- authorization issuance and owner-approval evidence;
- approved maintenance window and expiry evidence;
- rollback and observation owner contracts, each with primary, backup, acknowledgement, channel, authority, evidence ID, and evidence SHA-256;
- reviewed rollback policy and evidence;
- protected export evidence;
- Time Travel bookmark evidence.

The document must not contain filesystem paths, SQL, raw command output, credentials, headers, cookies, tokens, patient/practitioner identities, row identifiers, signed URLs, or free-form notes.

## Chronology

Evidence is ready only when:

1. authorization issue time is valid;
2. authorization approval is after issuance and no later than maintenance start;
3. maintenance approval is after issuance and no later than maintenance start;
4. all four owner acknowledgements are after issuance and no later than maintenance start;
5. export and bookmark captures are after issuance and no later than maintenance start;
6. the evidence document is generated after all approvals/captures and no later than maintenance start;
7. validation time is not before document generation;
8. maintenance end is after start;
9. expiry equals maintenance end plus observation grace exactly.

## Owner rules

- Rollback authority is exactly `may_initiate_rollback`.
- Observation authority is exactly `may_accept_or_reject_go`.
- Primary and backup are required for both roles.
- All four owner IDs are distinct.
- Evidence IDs/hashes are required for both owner contracts.
- Communication channel IDs are identifiers only; no URL or message body is retained.

## Recovery rules

Protected export evidence requires:

- `captured=true`;
- exact production database name and UUID;
- scope `production_database_full_snapshot`;
- SHA-256 and positive byte size;
- metadata evidence ID/SHA-256;
- directory mode `700` and file mode `600`;
- no path or raw export content.

Time Travel evidence requires:

- `captured=true`;
- exact production database UUID;
- safe bookmark identifier;
- evidence ID/SHA-256;
- capture no later than maintenance start.

The export SHA-256 must equal `productionImport.sourceExportSha256` in the final schema-v2 authorization.

## Authorization binding

Add one exact schema-v2 field:

```json
{
  "maintenanceRecoveryEvidence": {
    "evidenceId": null,
    "evidenceSha256": null
  }
}
```

A validated pack must exactly match authorization fields for:

- evidence ID/SHA-256;
- issued, start, end, expiry times;
- authorization approval;
- rollback owner;
- observation owner;
- rollback policy;
- export evidence;
- production import source-export SHA-256.

The evidence ID/SHA-256 and the complete normalized maintenance/owner/recovery snapshot are included in migration, import, and feature-flag deterministic command IDs.

## Protected file and receipt

Reuse `scripts/canonical/protected-json-document.ts`:

- outside repository;
- real mode-`700` parent directory;
- unique mode-`600` regular file;
- no symlink or hard link;
- no-follow descriptor open;
- device/inode binding;
- bounded JSON and nesting;
- duplicate-key and unsafe-key rejection.

Receipt output is aggregate-only and contains readiness, stable issue codes, bundle SHA-256, normalized authorization snapshot SHA-256, owner count, export size, and no-network/no-mutation assertions. It never returns paths, owner IDs, bookmark IDs, source hashes, or evidence values.

## Out of scope

- creating or approving owner evidence;
- capturing a production export;
- creating or using a Time Travel bookmark;
- restore testing;
- production request or mutation;
- deployment, migration, import, feature flag, push, or `main` merge.
