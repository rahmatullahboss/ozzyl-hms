# CDB-101 Reporting Route Fingerprint Readiness Design

Date: 2026-07-14

Status: approved continuation of the owner-authorized non-mutating CDB-101 preparation scope

## Goal

Create deterministic, PHI-safe evidence that the deployed legacy reporting routes remain owned by their existing handlers and preserve their approved response contracts while the canonical reporting canary stays on separate routes. The evidence must remain fail-closed until authenticated live production probes are supplied.

## Current gap

CDB-101 operational readiness already records the production Worker version candidate and matching Worker-first route patterns, but blocker `CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE` remains open because the legacy handler and normalized response fingerprints are not captured.

A source-only hash is insufficient because it does not prove deployed behavior. Directly storing production response bodies is prohibited because they can contain patient, practitioner, invoice, or transaction data. The solution therefore needs a two-stage fingerprint.

## Considered approaches

### 1. Full live HTTP capture only

This would probe production and hash raw responses. It can prove deployed behavior, but it creates unnecessary credential and PHI-handling risk and is not reproducible from repository state alone.

### 2. Repository source hash only

This is safe and deterministic, but it cannot prove which Worker version is serving traffic or that normalized live responses still match the approved contract.

### 3. Hybrid static and live evidence

This is the selected approach. Repository route ownership, mounts, guard names, permissions, source hashes, and expected normalized shape paths are captured locally. A separate evidence file later supplies Worker metadata and authenticated read-only probe observations. The validator computes a final fingerprint only when both halves are complete and consistent.

## Route inventory

### Active legacy routes

1. `dashboard_kpi_summary`: `GET /api/dashboard/kpi-summary`
2. `dashboard_doctor_performance`: `GET /api/dashboard/doctor-performance`
3. `dashboard_doctor_performance_details`: `GET /api/dashboard/doctor-performance/details`
4. `dashboard_test_performance`: `GET /api/dashboard/test-performance`
5. `dashboard_test_performance_details`: `GET /api/dashboard/test-performance/:testId/details`
6. `daily_collection`: `GET /api/reports/daily-collection/`
7. `ipd_revenue`: `GET /api/ipd-reports/revenue`

### Separate canonical canary routes

1. `canonical_reporting_status`: `GET /api/canonical-reporting/status`
2. `canonical_doctor_performance`: `GET /api/canonical-reporting/doctor-performance`
3. `canonical_test_performance`: `GET /api/canonical-reporting/test-performance`
4. `canonical_collections`: `GET /api/canonical-reporting/collections`
5. `canonical_ipd_finance`: `GET /api/canonical-reporting/ipd-finance`

The registry explicitly classifies every route as `legacy_active` or `canonical_canary`. A route ID, method, path template, handler file, mount prefix, guard or permission contract, and expected response shape are immutable fingerprint inputs.

## Architecture

### Static repository capture

`scripts/canonical/reporting-route-fingerprint.ts` will expose pure functions and a CLI.

The static capture will:

- verify the exact route mount strings in `src/index.ts`;
- verify the expected handler route markers in the registered source files;
- verify canonical and IPD permission matrix entries;
- record the full Git commit;
- calculate SHA-256 hashes for `wrangler.toml`, `src/index.ts`, registered handler files, `src/lib/route-permissions.ts`, and the route registry;
- parse production route patterns and `run_worker_first` patterns from `wrangler.toml`;
- prove that no legacy route path is mounted under `/api/canonical-reporting`;
- emit only file paths, hashes, route metadata, and issue codes.

The static capture must not contact production.

### Live evidence input

The evidence template will accept:

- exact production Worker name;
- active Worker version ID;
- previous Worker version ID;
- script ETag;
- production route patterns;
- capture UTC time;
- one observation for every registered route.

Each observation contains only:

- route ID;
- method and resolved path without patient or record identifiers;
- tenant ID `100` or a named negative-control tenant;
- role name, never a token or user identity;
- HTTP status;
- sorted normalized response shape paths;
- normalized shape SHA-256;
- `canonicalHandlerObserved` boolean;
- `activeRouteSwitched` boolean when present;
- latency and error classification;
- explicit confirmation that no response values or headers containing secrets were retained.

Raw bodies, cookies, authorization headers, names, IDs from result rows, signed URLs, and clinical or financial values are forbidden.

### Validation and fingerprint

The validator will produce stable issue codes and remain incomplete when any required field is absent.

Legacy route acceptance requires:

- all seven legacy routes observed exactly once;
- approved success or expected authorization status;
- normalized response shape hash present;
- `canonicalHandlerObserved=false`;
- no `/api/canonical-reporting` mount or handler ownership;
- production route patterns equal repository patterns.

Canonical route acceptance requires:

- all five canonical routes observed exactly once;
- separate `/api/canonical-reporting` paths;
- disabled control evidence hidden or denied as expected;
- status evidence containing `activeRouteSwitched=false` when the tenant flag is enabled in a later authorized shadow stage;
- no legacy route classified as canonical.

The final `routeFingerprintSha256` is calculated from canonical JSON containing the static capture plus normalized live observations. It is `null` until evidence is complete. `activeRoutesUnchanged` is never inferred from static code alone.

## CLI modes

### Repository-only mode

```bash
pnpm canonical:fingerprint-reporting-routes -- --repository-only
```

This produces static evidence with:

- `repositoryReady=true` when local contracts pass;
- `liveEvidenceReady=false`;
- `activeRoutesUnchanged=false`;
- `routeFingerprintSha256=null`.

### Evidence validation mode

```bash
pnpm canonical:fingerprint-reporting-routes -- \
  --evidence <protected-normalized-route-evidence.json>
```

The command validates evidence and prints an aggregate result. It does not write production data or make HTTP requests.

## Stable issue classes

- `CDB101_ROUTE_REGISTRY_INVALID`
- `CDB101_ROUTE_MOUNT_MISSING`
- `CDB101_ROUTE_HANDLER_MARKER_MISSING`
- `CDB101_ROUTE_PERMISSION_MISSING`
- `CDB101_ROUTE_PATTERN_MISMATCH`
- `CDB101_WORKER_VERSION_MISSING`
- `CDB101_LIVE_ROUTE_OBSERVATION_MISSING`
- `CDB101_LIVE_ROUTE_OBSERVATION_DUPLICATE`
- `CDB101_LIVE_ROUTE_STATUS_INVALID`
- `CDB101_LIVE_ROUTE_SHAPE_MISSING`
- `CDB101_LEGACY_ROUTE_CANONICALIZED`
- `CDB101_CANONICAL_ROUTE_NOT_SEPARATE`
- `CDB101_ACTIVE_ROUTE_SWITCHED`
- `CDB101_ROUTE_EVIDENCE_SENSITIVE`
- `CDB101_ROUTE_EVIDENCE_INVALID`

## Security and production boundary

- No network request is made by the fingerprint validator.
- No production database command is executed.
- Evidence files must be aggregate and normalized.
- Tokens and raw response bodies are never accepted by the schema.
- The repository template is fail-closed and contains no credential placeholders.
- Generated live evidence stays in protected storage outside Git; only the template and aggregate report are committed.
- This task does not deploy, mutate feature flags, apply migrations, import canonical rows, repair FK violations, create an export, restore Time Travel, push, or merge to `main`.

## Testing

Tests will prove:

- exact route registry and classification;
- deterministic canonical JSON and SHA-256 output;
- repository-only mode remains live-incomplete;
- missing mounts, route markers, permissions, or route patterns fail closed;
- malformed, duplicate, incomplete, or sensitive live observations fail closed;
- a complete normalized fixture produces a stable fingerprint;
- a legacy route marked canonical blocks acceptance;
- canonical status with `activeRouteSwitched=true` blocks acceptance;
- aggregate output does not echo response values, tokens, raw bodies, or user identifiers.

## Out of scope

- obtaining or using production authentication credentials;
- making authenticated production HTTP calls;
- changing the active Worker version;
- enabling tenant `100` shadow mode;
- accepting parity or GO decisions;
- replacing the existing 17-blocker production preflight.
