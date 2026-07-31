# CDB-101 Protected Route Evidence Normalizer Design

Date: 2026-07-15

Status: approved continuation of non-mutating CDB-101 preparation

## Goal

Create an offline, fail-closed tool that converts authenticated production response bodies already captured by an approved operator into the PHI-free normalized route evidence consumed by `scripts/canonical/reporting-route-fingerprint.ts`.

The tool must never make a network request, accept credentials or headers, print raw response values, write inside the repository, or claim that active routes are unchanged unless the existing fingerprint validator accepts the completed evidence.

## Inputs

The CLI accepts three paths:

```bash
pnpm canonical:normalize-reporting-route-evidence -- \
  --protected-root <absolute-private-directory> \
  --manifest <relative-manifest.json> \
  --output <relative-evidence.json>
```

The protected root must:

- be outside the repository;
- exist as a real directory, not a symlink;
- have mode `700`;
- contain the manifest and all body files;
- contain no path traversal in manifest or output names.

The manifest must have mode `600`, contain no credentials, headers, cookies, raw body values, or arbitrary extra fields, and declare:

- exact active and previous Worker UUIDs;
- active script ETag SHA-256;
- capture UTC timestamp;
- exact production route patterns;
- exactly one probe descriptor for each registered route.

Each probe descriptor contains only:

- route ID;
- relative JSON body file;
- tenant scope;
- role name;
- HTTP status;
- latency milliseconds;
- optional error class.

Each body file must be a regular, non-symlink file with mode `600` and bounded size.

## Shape normalization

The normalizer parses JSON in memory and emits only structural paths:

- object fields use dot notation, for example `summary.total`;
- arrays use `[]`, for example `rows[]` and `rows[].doctorId`;
- array element shapes are unioned without retaining array length or values;
- paths are sorted and unique;
- object key length, nesting depth, node count, path count, manifest size, and body size are bounded;
- malformed JSON, unsupported values, excessive structure, or control characters fail closed.

The shape SHA-256 is computed from the existing canonical JSON serializer.

## Handler and switch markers

The tool derives evidence markers from the response body instead of accepting operator claims:

- `canonicalHandlerObserved=true` only when a `canonical: true` marker is observed;
- legacy responses with a canonical marker remain blocked by the existing validator;
- canonical `200` responses without `canonical: true` remain blocked;
- any observed `activeRouteSwitched: true` remains blocked;
- canonical `404` control responses may have `activeRouteSwitched=null`;
- legacy responses without a switch marker normalize to `activeRouteSwitched=false`.

## Output

The tool builds a `ReportingRouteLiveEvidence` object, validates it against a fresh repository capture using `evaluateReportingRouteFingerprint`, and writes the evidence only when the full repository/live contract passes.

Output behavior:

- output path must be inside the protected root and outside the repository;
- existing output files are never overwritten;
- a temporary `600` file is written, flushed, and atomically renamed;
- partial files are removed on failure;
- stdout contains only an aggregate receipt with counts, evidence SHA-256, readiness flags, and explicit no-network/no-mutation/no-retained-values assertions;
- raw bodies, values, local paths, tokens, identities, and headers are never printed.

## Security invariants

- No HTTP client or production connector is used.
- No production database command is used.
- No credential or header field is accepted by the manifest schema.
- Protected root and files are checked with `lstat`; symlinks are rejected.
- Relative paths cannot escape the protected root.
- The repository itself cannot be used as the protected root.
- Evidence generation cannot reduce the authoritative 17-blocker cutover gate by itself; it only prepares one missing external artifact.

## Testing

Tests cover:

- deterministic nested object and array shape extraction;
- value non-retention;
- canonical and active-route marker derivation;
- exact twelve-route evidence generation;
- malformed, missing, duplicate, and unexpected probes;
- credentials or header fields in manifests;
- path traversal, repository-root use, symlinks, incorrect modes, oversized files, excessive depth/nodes/paths, malformed JSON, and output overwrite refusal;
- atomic output cleanup on validation failure;
- aggregate receipt contains no raw values or local protected paths;
- generated evidence passes the existing route fingerprint validator;
- no network or production mutation occurs.

## Out of scope

- logging in to production;
- capturing HTTP responses;
- storing authentication material;
- selecting production records or identifiers;
- deploying a Worker;
- applying migrations;
- importing canonical data;
- changing feature flags;
- repairing foreign keys;
- exporting or restoring D1;
- authorizing or executing the reporting cutover.
