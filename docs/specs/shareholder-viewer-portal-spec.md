# Shareholder Viewer Portal — Security and Product Specification

Status: approved for implementation
Date: 2026-07-16
Owner: HMS / Finance & Access Control

## 1. Problem

Hospital shareholders need a simple account where they can review aggregate financial performance and export reports without receiving operational, clinical, accounting-write, or shareholder-management access.

The current system already calculates shareholder profit from verified GL totals, but its existing pages and APIs are designed for hospital administrators, directors, MDs, and accountants. Those surfaces also expose management actions and are therefore unsuitable for a shared or board-viewer account.

## 2. Security position on a common account

A shared credential is not the preferred identity model because it weakens individual accountability. The product therefore implements a dedicated `shareholder_viewer` role that supports both:

1. Named viewer accounts — recommended for production.
2. One tenant-managed common viewer account — allowed only as an explicit fallback.

A common account must never inherit administrative, accounting-write, shareholder-write, approval, payment, patient, HR, inventory, or clinical permissions.

## 3. Goals

- Provide a dedicated, read-only shareholder financial dashboard.
- Show aggregate income, expense, profit/loss, retained earnings, distributable profit, dividend status, and period trends.
- Support CSV and spreadsheet-compatible exports.
- Enforce tenant isolation and server-side authorization on every request.
- Minimize exposure of personal and operational data.
- Audit dashboard access and every export.
- Keep the implementation compatible with the existing Cloudflare Worker + D1 architecture.

## 4. Non-goals

- Creating, editing, deleting, importing, or deactivating shareholders.
- Calculating, approving, declaring, paying, or reversing dividends.
- Viewing patient, employee, doctor, vendor, invoice, receipt, bank account, or transaction-level records.
- Viewing individual shareholder NID, phone, address, nominee, bank details, or investment records.
- Editing accounting periods, mappings, journals, vouchers, settings, or reports.
- Public or unauthenticated sharing links.

## 5. Role and permission model

### Role

`shareholder_viewer`

### Permissions

- `shareholder_portal:read`
- `shareholder_portal:export`

The role must not receive generic `accounting:read`, `reports:read`, `shareholders:read`, or `profit:calculate`, because those permissions provide broader access than this portal requires.

### Default route

`shareholder/dashboard`

### Server-side policy

All portal endpoints must:

- require authentication;
- require the exact portal permission;
- derive `tenant_id` from the authenticated request context;
- never accept a tenant identifier from query/body parameters;
- use parameterized queries;
- return aggregate data only;
- use deny-by-default behavior;
- create an audit event for exports.

## 6. Data contract

### Dashboard summary

For a requested inclusive date range:

- total income;
- total expense;
- net profit or loss;
- retained earnings amount;
- distributable profit estimate;
- latest finalized dividend month;
- finalized dividend total;
- paid dividend total;
- unpaid dividend total;
- number of active dividend-eligible shareholders;
- total eligible shares.

### Trend

Monthly rows for the selected date range:

- month;
- income;
- expense;
- profit/loss;
- finalized distributable dividend, when available;
- paid dividend;
- unpaid dividend.

### Distribution history

Aggregate only:

- month;
- total profit;
- distributable profit;
- retained amount;
- status;
- approved date;
- shareholder count;
- gross dividend;
- tax withheld;
- net payable;
- paid amount;
- unpaid amount.

No shareholder names or personal details are returned by the common portal endpoints.

## 7. API

### `GET /api/shareholder-portal/summary`

Query:

- `from`: `YYYY-MM-DD`
- `to`: `YYYY-MM-DD`

Validation:

- both dates are required;
- `from <= to`;
- maximum range is 36 months;

Response:

```json
{
  "range": { "from": "2026-01-01", "to": "2026-07-16" },
  "summary": {},
  "trend": [],
  "distributions": []
}
```

### `GET /api/shareholder-portal/export.csv`

Same query and authorization as summary. Returns UTF-8 CSV with BOM.

Required protections:

- CSV formula-injection neutralization for values beginning with `=`, `+`, `-`, `@`, tab, carriage return, or line feed;
- quoted fields;
- safe filename;
- no user-controlled response headers;
- `Cache-Control: private, no-store`;
- audit event recording user, tenant, range, format, IP, and user agent.

### `GET /api/shareholder-portal/export.xlsx`

Spreadsheet export is implemented only when the repository's approved edge-compatible XLSX dependency is available. Until then, CSV is the canonical export and opens correctly in Excel and Google Sheets. The UI labels this as “CSV (Excel/Sheets compatible)” rather than claiming a native XLSX file.

## 8. UI

A new `ShareholderViewerDashboard` page contains:

- date presets: current month, previous month, current year, custom;
- KPI cards for income, expense, net profit/loss, distributable profit, paid dividend, unpaid dividend;
- monthly trend table/chart;
- aggregate dividend distribution history;
- CSV export button;
- last refreshed timestamp;
- clear read-only notice.

The page must not render management navigation or hidden management buttons. Navigation is based on role/permission, but backend authorization remains authoritative.

## 9. Common account controls

When a tenant chooses a shared account:

- the account is created by an authorized administrator;
- the credential is not hard-coded or seeded with a universal password;
- first login requires password change where supported;
- MFA should be enabled where supported;
- session lifetime should be shorter than normal staff sessions;
- concurrent sessions should be limited where supported;
- credential rotation is required when an authorized viewer leaves;
- export events are retained in the audit log;
- named accounts remain the recommended migration path.

## 10. Privacy and minimization

The portal exposes only board-level aggregate financial data. It excludes:

- patient identifiers and encounters;
- invoice and receipt details;
- employee and doctor compensation details;
- vendor details;
- shareholder PII and bank details;
- journal line-level data;
- free-text notes and remarks.

## 11. Performance

- Reuse GL reporting helpers as the financial source of truth.
- Limit ranges to 36 months.
- Build monthly trend queries in bounded batches.
- Avoid transaction-level result sets.
- Do not generate or persist export files synchronously in R2 for the initial version; stream bounded CSV directly from the Worker.

## 12. Audit events

At minimum:

- `SHAREHOLDER_PORTAL_VIEW`
- `SHAREHOLDER_PORTAL_EXPORT`

Export audit payload:

```json
{
  "format": "csv",
  "from": "2026-01-01",
  "to": "2026-07-16",
  "rowCount": 12
}
```

No financial values or PII need to be copied into the audit payload.

## 13. Acceptance criteria

1. `shareholder_viewer` can log in and lands on the dedicated dashboard.
2. The role cannot access any existing shareholder management, accounting, report, patient, HR, inventory, billing, or settings route.
3. Summary values come from tenant-scoped GL totals and finalized shareholder distributions.
4. A viewer cannot change the tenant by manipulating request parameters.
5. No individual shareholder PII is returned.
6. CSV exports open in Excel/Google Sheets and neutralize spreadsheet formulas.
7. Every export creates an audit record.
8. Unauthorized and cross-role requests return 403.
9. Date validation and 36-month range limits are enforced.
10. Backend, authorization, CSV-safety, and UI tests pass.

## 14. Rollout

1. Deploy role and API behind the normal release process.
2. Create a named test viewer account in staging.
3. Verify tenant isolation with two tenants.
4. Verify all denied routes for the new role.
5. Verify CSV formula-injection test cases.
6. Enable the role for the first hospital.
7. Create a common account only when the hospital explicitly accepts the accountability trade-off.
