# Visit Collection and Admission Registration Canonical Shadow Release

Date: 2026-07-23

## Release identity

- Deployed source commit: `09d73ec88c3a5d64847da1d00d83996fd79dbf05`
- Release tag: `release-20260723T123131Z-09d73ec88`
- Worker version: `fcdf738d-d7d6-4d3e-9005-be45363d2f44`
- Final deployment: `4e3191db-d5b6-44b8-a053-a5054bd2ced6`
- Rollback Worker version: `6be19cd4-e6bc-4ba9-995d-48fdeabb928c`
- Final allocation: candidate `100%`, rollback baseline `0%`

## Release scope

- Doctor Performance displays sortable `Visit Collection` using the existing dashboard data contract.
- IPD admission patient lookup shows a highlighted no-match registration action in English and Bangla.
- Canonical admission deposit handling and financial batch assertions included in the commits published with this release.
- No canonical-read promotion, strict-mode activation, legacy-authority retirement, production data import, or feature-flag mutation was performed.

## Source and quality gates

- Minimum canonical-safe ancestor check: passed.
- Focused canonical/admission tests: `36/36` passed.
- Focused reception/dashboard tests: `100/100` passed.
- Full suite: `1,026/1,026` files and `16,612/16,612` tests passed.
- TypeScript: passed.
- Canonical schema governance: passed with `0` issues.
- Full web, patient and admin production build: passed.
- Release source tree was clean.

Two pre-existing timing-sensitive release tests were hardened before deployment in commit `09d73ec88`: the canonical reconciliation test received a local timeout appropriate for its SQLite subprocess work, and the doctor-auth test now validates the actual platform timing-safe primitive instead of a CPU-contention-sensitive wall-clock microbenchmark.

## Migration

- Reviewed pending migration: `0532_canonical_financial_batch_assertions.sql`.
- Migration classification: additive and backward-compatible; creates a new assertion table and index without removing or narrowing live schema.
- Applied to production D1 database `hms-super-admin-production-apac` (`c68a5360-a2c1-44cc-9e71-f21057bea102`).
- Wrangler reported the migration successful.
- Final migration ledger check: `No migrations to apply`.

The legacy CDB-101 migration wrapper was not used because it is deliberately restricted to the historical ordered `0505`–`0515` cutover set and rejects later routine migrations. The current canonical shadow-safe release runbook's separately approved additive-migration procedure was followed instead.

## Canonical safety evidence

Tenant 100 remained:

- flag: `canonical_financial_dual_write_v1`
- domain: `financial`
- mode: `shadow`
- enabled: `1`
- version: `6`
- config: `{"tenantScope":["100"],"writePolicy":"shadow"}`

Tenant 101 and Tenant 102 also remained on their existing enabled shadow flags with `writePolicy=shadow`; no flag row was changed by this release.

Financial reconciliation was captured after migration, after candidate-bound smoke, at `5%`, at `50%`, and after final promotion. Every successful capture reported:

- `evidenceReady=true`
- `activationReady=true`
- `issueCount=0`
- `rowsWritten=0`
- aggregate-only read evidence

Transient Cloudflare GraphQL `429` responses occurred during read-only reconciliation identity checks. Promotion remained fail-closed until a fresh reconciliation capture succeeded.

## Candidate and traffic verification

The candidate was uploaded without traffic and installed beside the prior baseline at `0%`. Candidate-bound verification passed:

- `/api/health` returned HTTP 200 with the exact candidate version ID and release tag.
- Hospital Admin authenticated API/browser smoke passed.
- MD authenticated API/browser smoke passed.
- Director authenticated API/browser smoke passed.
- Reception authenticated API/browser smoke passed.
- Doctor Performance accepted `sortBy=visitCollection` and returned the `visitCollection` totals/row contract.
- Admission patient lookup, available-bed pricing and reception dashboard snapshot returned HTTP 200.
- No controlled admission, payment or other business mutation was executed during smoke verification.

Traffic promotion followed the required stages:

1. baseline `100%`, candidate `0%`
2. baseline `95%`, candidate `5%`
3. baseline `50%`, candidate `50%`
4. baseline `0%`, candidate `100%`

Candidate health and zero reconciliation were required before each promotion. After final promotion, normal production Hospital Admin and Reception authenticated smoke passed.

## Final state

- Production health: `ok` on Worker `fcdf738d-d7d6-4d3e-9005-be45363d2f44`.
- Release tag: `release-20260723T123131Z-09d73ec88`.
- New Worker traffic: `100%`.
- Previous known-good Worker retained at `0%` for deterministic rollback.
- Canonical shadow flags unchanged.
- Legacy financial authority unchanged.
- Canonical reads remain unpromoted.
- Pending production migrations: none.

## Non-blocking warning

Wrangler continues to warn that `sqlite_classes` is an unexpected field under `migrations`. It did not prevent migration application, version upload, staged deployment, health checks, authenticated smoke, reconciliation, or final allocation verification.
