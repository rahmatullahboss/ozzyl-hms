# CDB-101 Worker Build and Version Evidence Design

Date: 2026-07-15

Status: daytime preparation only; no Cloudflare request, version upload, deployment, traffic change, or production mutation

## Goal

Create one strict protected offline evidence boundary for the exact Worker candidate build and immutable version pair required by the reporting cutover authorization.

The boundary must prove that one reviewed repository commit produced one reviewed build manifest and one candidate Worker version which currently receives zero production traffic, while one distinct previous Worker version remains the 100-percent active rollback baseline.

## Exact scope

The evidence document binds:

- Worker service `hms-saas-production`;
- environment `production`;
- entrypoint `src/index.ts`;
- compatibility date `2026-02-17`;
- exact four production routes;
- exact 40-character candidate Git commit;
- clean repository capture and repository evidence hash;
- package, lockfile, Wrangler config, migration manifest, and build artifact SHA-256 values;
- reviewed build command identifier, builder identifier, completion time, artifact size, and build manifest evidence;
- explicit deployment approval scope, owner, approval time, evidence ID, and evidence SHA-256;
- candidate Worker version UUID, monotonically higher version number, creation/capture times, source commit, build manifest SHA-256, script ETag, metadata evidence, and zero-percent traffic;
- previous Worker version UUID, lower positive version number, metadata evidence, active state, and 100-percent traffic;
- route fingerprint SHA-256, active-route unchanged evidence ID, and exact route equality;
- explicit assertions that no candidate traffic assignment or deployment was performed by the evidence-capture step.

## Chronology

Evidence is ready only when:

1. repository capture precedes build completion;
2. build completion precedes candidate version creation;
3. candidate and previous metadata capture precede route capture;
4. route capture precedes the exact deployment approval;
5. deployment approval precedes evidence generation;
6. evidence generation occurs no later than validation time;
7. candidate version number is greater than previous version number;
8. candidate source commit and build-manifest hash equal the repository/build records exactly.

## Live-production safety

The build and candidate records must prove:

- `uploadPerformedByEvidenceCapture=false`;
- `trafficPercentage=0`;
- `trafficAssigned=false`;
- `deploymentPerformed=false`.

The previous record must prove:

- `active=true`;
- `trafficPercentage=100`.

Any non-zero candidate traffic, any partial traffic split, or any ambiguity about the active version is a blocker.

This validator never uploads a version, deploys a Worker, reads Cloudflare, changes routes, or assigns traffic.

## Authorization binding

Add one exact schema-v2 field:

```json
{
  "workerBuildVersionEvidence": {
    "evidenceId": null,
    "evidenceSha256": null
  }
}
```

A validated pack must exactly match authorization deployment fields for:

- deployment authorized state;
- candidate commit;
- candidate Worker version UUID;
- previous Worker version UUID;
- build manifest SHA-256;
- route fingerprint SHA-256;
- active-routes-unchanged evidence ID;
- evidence pack ID and SHA-256.

The complete normalized build/version snapshot is included in migration, import, and feature-flag deterministic command IDs.

## Protected file and receipt

Reuse `scripts/canonical/protected-json-document.ts`:

- evidence file outside the repository;
- direct real mode-`700` parent;
- unique mode-`600` regular file;
- no symlink or hard link;
- no-follow descriptor open and inode binding;
- bounded JSON size/depth;
- duplicate, unknown, sensitive, and unsafe key rejection.

Receipts are aggregate-only. They expose readiness, stable issue codes, evidence SHA-256, normalized authorization-snapshot SHA-256, candidate/previous version numbers, candidate/previous traffic percentages, artifact size, route count, and no-network/no-mutation assertions. They do not expose UUIDs, commit SHA, ETags, evidence IDs, routes, paths, identities, or raw metadata.

## Wrapper ordering

All three guarded database/flag wrappers must require the protected Worker build/version evidence pack after authorization, FK evidence, and maintenance/recovery evidence, but before any external child process.

## Out of scope

- building or uploading a real candidate version;
- Cloudflare API inspection;
- traffic assignment;
- Worker deployment or rollback;
- route mutation;
- production database request or mutation;
- push or merge to `main`.
