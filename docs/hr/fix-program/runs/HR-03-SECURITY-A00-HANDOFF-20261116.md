# HR-03 — Salary and Banking Authorization | A00 handoff | 2026-11-16

**Owner:** HR-03 (authorization/DTO only)  
**Branch:** `task/hr03-salary-rbac-security-20261116`  
**Release verdict:** **NO-GO / integration blocked**. No main merge, deployment or production migration.

## Root cause and compatibility warning

`workforce:read` staff directory routes returned legacy/canonical records containing `salary` and `bank_account`. The staff create/update API also accepted compensation/bank data on an operational-write grant. Old generic audit records stored raw compensation/banking values.

**Critical baseline discrepancy:** the GitHub `main` branch from which this task branch was created is materially behind the currently open HMS workspace detached HEAD `26ce22771f9333e1d329fbc97dd942bda4312f28`, which is not available via GitHub. The task branch implements fixes against the GitHub baseline, **not** the unpublished local canonical payroll rewrite. A00 must reconcile these changes against the latest canonical integration source; never overwrite newer payroll compensation/settlement logic with this branch's older `staff.ts`.

## Endpoint-by-endpoint permission matrix

| Endpoint | Verb | Required capability | Confidential data / rules |
|---|---|---|---|
| `/api/staff` | GET | `workforce:read` | Operational allowlisted DTO; salary only if separately `payroll:read`, masked bank only if `staff:bank:read`; never raw bank |
| `/api/staff/:id` | GET | `workforce:read` | Same field-level policy; record lookup hospital-scoped |
| `/api/staff/:id/bank-account` | GET | `staff:bank:reveal` | Explicit full-value workflow only; same-hospital record required, no-store |
| `/api/staff` | POST | `workforce:write` | Additional `payroll:configure` if positive salary; `staff:bank:write` if bank supplied |
| `/api/staff/:id` | PUT | `workforce:write` | Additional `payroll:configure` if salary field changed, `staff:bank:write` if bank supplied |
| `/api/staff/:id` | DELETE | `workforce:deactivate` | No salary/bank disclosure |
| `/api/staff/salary-report` | GET | `payroll:read` | Confidential salary rollup; no-store; tenant-filtered SQL |
| `/api/staff/:id/salary` | GET | `payroll:read` | Confidential history; tenant-scoped join |
| `/api/staff/:id/salary` | POST | `payroll:payout` | Finance payout; generic audit redacts amounts |
| `/api/staff/:id/invite` | POST | `staff:write` | Existing privileged-role invite restrictions remain |
| `/api/staff/workforce-context` | GET | `workforce:read` | Operational date/time context only |
| `/api/hr/payroll/salary-heads` | GET / mutate | `payroll:read` / `payroll:configure` | Newer canonical HR module: verify after rebase |
| `/api/hr/payroll/structure/:staffId` | GET | `payroll:read` | Compensation structure; canonical tenant lookup |
| `/api/hr/payroll/structure` | POST | `payroll:configure` | Versioned compensation profile |
| `/api/hr/payroll/compensation/adopt-protected-salary` | POST | `payroll:configure` | Explicit protected compensation migration |
| `/api/hr/payroll/runs` | GET / POST | `payroll:read` / `payroll:write` | Confidential payroll run list/create |
| `/api/hr/payroll/runs/:id` | GET | `payroll:read` | Read one payroll run |
| `/api/hr/payroll/runs/:id/lock` | POST | `payroll:lock` | Separate authority from preparation |
| `/api/hr/payroll/runs/:id/approve` | POST | `payroll:approve` | Separate approval authority |
| `/api/hr/payroll/payslips/:staffId` | GET | `payroll:read` | Confidential payslip history |
| `/api/hr/payroll/payslips/:id` | PATCH | `payroll:revise` | Draft adjustment only |
| `/api/hr/payroll/payslips/:id/settle` | POST | `payroll:payout` | Canonical settlement; preserve payout evidence |
| `/api/hr/payroll/payouts/:publicId/reconcile-reversal` | POST | `payroll:payout` | Reconciliation authority |
| `/api/hr/payroll/overtime-integrate` | POST | `payroll:revise` | Canonical HR-02 output contract belongs to HR-01/02 |
| `/api/hr/payroll/dashboard` | GET | `payroll:read` | Current run totals confidential |
| `/api/bank-book/payroll-payouts` and reversal | POST | `payroll:payout` | Preserve protected Bank Book authority (newer canonical) |

**No new self-service grant is implicitly authorized.** HR-06 must implement ownership-bound `self` read after an authenticated user ↔ active workforce member link is confirmed in the same tenant. A guessed staffId or query parameter never establishes ownership. An operational manager can read the team directory only; salary/bank permissions require separate explicit grants.

## Files on task branch

- `src/lib/hr-staff-confidentiality.ts` — allowlist-only operational DTO; strips unknown/nested salary/bank fields, masked account metadata.
- `src/routes/tenant/staff.ts` — staff directory projection; confidential input guards; separate bank reveal endpoint; tighter report/history/payout permissions; tenant salary-history join; no-store response; generic audit value minimization.
- `src/lib/route-permissions.ts` — separate capabilities and sensitive route matrix entries.
- `test/integration/routes/hr03-staff-confidentiality.test.ts` — DTO negative/positive, nested leakage, short account masking.
- `test/integration/routes/hr03-confidential-permissions.test.ts` — endpoint matrix regressions.
- `test/integration/routes/hr03-sensitive-route-denials.test.ts` — unauthorized salary/bank GET, bank write, and manipulated direct-ID cases.

No payroll calculation, transactional payout writer, SQL migration, source bank account data or canonical ledger has been changed.

## Evidence and test ledger

| Check | Verdict | Evidence |
|---|---|---|
| Reproduce original leak by source audit | **FAIL — baseline** | Legacy directory projected raw `salary` and `bank_account` to `workforce:read` clients |
| GitHub branch source static invariant inspection | **PASS (16/16 checks)** | Route/permission/DTO source assertions; static-only, not an HTTP authorization proof |
| Pure projection smoke test | **PASS (5 assertions)** | Node 22 `--experimental-strip-types` on local new helper: operational redaction, payroll-only salary, masked bank, short mask |
| New Vitest regression suite | **SKIP/BLOCKED** | `pnpm exec vitest` fails environment resolution: `Cannot find module '/node_modules/vitest/vitest.mjs'`; not a test failure/success verdict |
| Exact candidate TypeScript | **SKIP/BLOCKED** | GitHub task branch and local detached HEAD differ; no clean dependencies-ready QA checkout |
| Route HTTP 403/200 authorization, cross-tenant and direct-ID tests | **SKIP/BLOCKED** | No runnable full app + D1 test harness on exact remote SHA |
| Mobile, Chromium, PDF/CSV export, caching, payroll logs | **SKIP/BLOCKED** | Must verify on A00 reconciled exact canonical commit |
| Main merge / production deploy | **NOT PERFORMED** | Explicit owner restriction |

## A00 release blockers / integration checklist

1. Rebase/cherry-pick **the security intent**, not older `staff.ts` wholesale, onto the latest canonical HMS branch. Current GitHub `main` does not contain local canonical `hr/payroll.ts` implementation. Revalidate its finer `payroll:read/configure/write/lock/approve/revise/payout` matrix.
2. Make `/api/staff` mandatory central RBAC alongside route-local guards on the reconciled source. Verify effective user/role overrides and explicit revocation precedence.
3. Run same-hospital positive + other-hospital negative, raw direct ID, query-param tamper, role-revoke and operational-read-only denial tests for **both** legacy-protected and canonical-greenfield staff repositories.
4. Prove sensitive input is denied before any write for operational-only staff editors; no bank account is unintentionally overwritten by blank/unmodified browser forms.
5. Reconcile `payroll:read/configure/payout` and `staff:bank:read/reveal/write` with canonical effective permission grant catalogs and role/user overrides, without silently granting operational roles. Supply explicit bank reveal workflow UI only to granted roles; mask by default. Confirm payroll processing, payout approval and payment reconciliation remain available to the intentionally granted finance roles.
6. Keep API `Cache-Control: private, no-store`; verify browser/mobile service-worker and local persistence do not cache sensitive responses or signed exports.
7. Audit remaining salary/bank exports, nested DTOs, errors, reports and old audit records. Never destructively rewrite historical audit evidence: restrict historical raw-record readers and introduce appropriate retention/redaction controls.
8. Coordinate HR-06 employee self-service identity contract; no trust in caller-supplied staff IDs.
9. Run focused Vitest, TypeScript, SQL tenant-isolation, Chromium/mobile and D1 cost/security gates against one exact A00 integration SHA; obtain PASS receipts before any GO.

**NO-GO** until all applicable security regression checks are executable and pass, and the version discrepancy is resolved.

## Exact candidate evidence

- Last verified staff route code commit: `74e899b750399a413d54b92593c00dbd58c1e4fe`.
- Latest negative route test commit: `ab93b22ef5bd3eadc59b77443f557d1fd1c1c638`.
- The document commit may advance the branch head without changing runtime code. Read branch HEAD when A00 begins integration.
