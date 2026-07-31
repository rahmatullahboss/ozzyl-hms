# CDB-101 Authorization Boundary Hardening Design

Date: 2026-07-15

Status: preparation-only; no production authorization or mutation

## Goal

Replace direct `JSON.parse(... as ReportingCutoverAuthorization)` casts with one strict, aggregate-only authorization document boundary. Every production wrapper must reject malformed, widened, duplicated, sensitive, unprotected, or semantically incomplete authorization before making any Wrangler or production request.

## Document boundary

The strict parser accepts exactly the schema-v2 `ReportingCutoverAuthorization` fields defined by `scripts/canonical/production-cutover-contract.ts`.

It rejects:

- invalid JSON;
- duplicate object keys at any nesting depth;
- unknown root or nested fields;
- recursively nested credential, header, cookie, token, password, secret, raw-body, signed-URL, or private-key fields;
- missing or incorrectly typed nested objects, arrays, booleans, strings, numbers, or nullables;
- unsafe integer values;
- excessive document size or nesting;
- prototype-pollution keys;
- value-echoing error messages.

Structural parsing and semantic authorization validation remain separate. A structurally valid document can still be execution-ineligible due to missing approval, hashes, owners, window, FK evidence, or command IDs.

## Protected authorization file

Mutation wrappers require an authorization file that:

- is outside the repository;
- is directly inside a real mode-`700` directory;
- is a regular non-symlink mode-`600` file;
- is opened with no-follow semantics;
- is bounded in size;
- is read before any network command;
- never has its path or contents echoed.

The committed template remains an inert fail-closed example and is not accepted by mutation wrappers as protected authorization.

## Offline validator

Add:

```bash
pnpm canonical:validate-reporting-authorization -- \
  --authorization <protected-authorization-v2.json>
```

The command makes no network request and emits only:

- document readiness;
- semantic execution readiness;
- stable issue codes and gates;
- deterministic command IDs when structural parsing succeeds;
- aggregate-only/no-network/no-mutation assertions.

It never emits owner identities, communication channels, local paths, hashes from source fields, or raw document values.

## Wrapper ordering

The migration, production-import, and shadow-flag wrappers must perform this exact order:

1. parse CLI arguments;
2. load and strictly parse the protected authorization file;
3. run semantic authorization validation with current UTC time;
4. return an aggregate fail-closed receipt when either gate fails;
5. only then perform approved read-only production identity/state checks;
6. only after all existing confirmation and execution gates pass, run the separately authorized mutation.

An invalid authorization therefore cannot trigger even a read-only production request from a mutation wrapper.

## Template cleanup

Remove legacy duplicate compatibility fields from the committed schema-v2 template. The template must contain exactly the strict document schema, remain fail-closed, and keep all authorization booleans false and approval/evidence values null.

## Testing

Regression coverage includes:

- duplicate keys at root and nested levels;
- unknown legacy compatibility fields;
- recursively nested sensitive fields;
- missing nested objects and wrong primitive types;
- prototype-pollution keys;
- oversized/deep documents;
- protected file permissions, symlinks, repository paths, and sanitized failures;
- offline validator aggregate output;
- all three mutation wrappers proving invalid authorization causes zero `pnpm`/Wrangler subprocess invocations;
- exact schema-v2 ready authorization still passes semantic validation;
- committed template passes structural parsing but remains execution-ineligible.

## Out of scope

- issuing or signing an authorization;
- filling owner identities or approvals;
- creating real route/import/export/FK evidence;
- making production requests;
- applying migrations;
- importing data;
- changing feature flags;
- deployment, export, restore, repair, push, or `main` merge.
