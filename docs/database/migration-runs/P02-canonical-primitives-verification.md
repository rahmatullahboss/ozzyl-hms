# P02 Canonical Primitives and Atomic Command Verification

**Task:** CDB-021 — Add canonical primitives and atomic command batch

**Date:** 2026-07-14

**Branch:** `task/cdb-021-canonical-primitives`

## Delivered primitives

- `createPublicId()` creates monotonic ULID-compatible 26-character Crockford Base32 identifiers without encoding internal database IDs.
- `toUtcIso()` accepts explicit, calendar-valid timestamps and produces normalized UTC ISO strings with millisecond precision.
- `deriveBusinessDate()` derives a calendar date using an IANA time zone; no fixed Bangladesh offset is embedded.
- `toMinorUnits()` converts non-negative decimal amounts to exact integer minor units.
- `toSignedMinorUnits()` is the explicit signed path for credits, adjustments, and reversals.
- `createRequestFingerprint()` produces a stable SHA-256 fingerprint from canonical JSON.
- `runCanonicalBatch()` executes the idempotency claim/outbox event, domain statements, and optional reconciliation statements through one atomic D1-compatible batch adapter.

## ID guarantees

The public-ID generator:

- validates a 48-bit millisecond timestamp;
- remains lexicographically monotonic for increasing timestamps;
- increments the 80-bit random component for multiple IDs in one millisecond;
- remains monotonic if the process clock moves backwards;
- uses `crypto.getRandomValues()` when a new timestamp is observed;
- rejects invalid, fractional, negative, and out-of-range timestamps.

## Time guarantees

The time helpers:

- require explicit ISO UTC or numeric-offset timestamp strings;
- reject invalid calendar dates instead of accepting JavaScript date normalization;
- reject fractional epoch milliseconds and non-finite numeric timestamps;
- validate clock values and numeric UTC offsets;
- support IANA time zones through `Intl.DateTimeFormat`;
- correctly handle the `Asia/Dhaka` midnight boundary without a hard-coded `+06:00` conversion.

## Money guarantees

The money helpers:

- parse plain decimal notation only;
- allow at most two fractional digits;
- use `BigInt` during conversion, avoiding floating-point accumulation;
- reject negative values on the normal posted-money path;
- permit negative values only through the explicitly signed reversal path;
- reject exponent notation, malformed values, `NaN`, infinity, excess scale, and safe-integer overflow;
- return JavaScript safe integers suitable for D1 `INTEGER` minor-unit columns.

## Idempotency and atomic batch contract

`canonical_outbox_events` acts as both the outbox record and tenant-scoped idempotency claim through the existing unique key `(tenant_id, idempotency_key)`.

The stored payload uses a versioned envelope:

- semantic request SHA-256 fingerprint;
- canonical command name;
- replay-safe result metadata;
- the domain event payload.

A duplicate request:

- replays the stored result when tenant, command name, and request fingerprint match;
- throws `CanonicalIdempotencyConflictError` when the key is reused for a different request;
- remains independently scoped for another tenant;
- handles a race where another request wins the unique claim after the initial precheck.

The adapter contract is structurally compatible with Cloudflare `D1Database`. The domain command does not depend on a global D1 binding.

The outbox claim, domain writes, reconciliation statements, and event are submitted in one batch. The SQLite transaction harness proves that any statement failure rolls back domain, reconciliation, and outbox state together.

## Serialization safety

Stable canonical JSON:

- sorts object keys;
- rejects `undefined`, `bigint`, functions, symbols, non-finite numbers, non-plain objects, sparse arrays, and circular references;
- makes equivalent object-key order produce the same request fingerprint.

Command results stored for replay must contain minimal replay-safe response metadata only. PHI, diagnosis text, clinical notes, phone numbers, and arbitrary free text must not be placed in the replay result envelope.

## Verification

- Initial TDD run: both suites failed because the modules did not exist.
- Hardening RED runs caught sparse-array serialization, surrounding-whitespace identifiers, impossible business dates, invalid calendar timestamps, and fractional epoch timestamps.
- Focused primitives/batch tests: `20` passed.
- Full canonical and migration-manifest tests: `10` files, `70` tests, `0` failures.
- Migration manifest build: `433` conforming migrations.
- TypeScript: `0` errors.
- Compile-time assertion confirms `D1Database` satisfies the canonical batch adapter contract.
- No migration was applied to production or rehearsal during CDB-021.
- No production mutation, Worker deployment, Git push, `main` merge, Time Travel restore, or local-server activation occurred.

## Production boundary

CDB-021 is application-library work only. Migration `0423_canonical_program_foundation.sql` remains absent from production and must not be applied without a separate explicit production authorization and rollback gate.
