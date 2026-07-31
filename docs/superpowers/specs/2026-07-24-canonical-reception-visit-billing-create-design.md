# Canonical Reception Visit Billing Create Design

**Checkpoint:** CDB-116

**Boundary:** `reception.visit-billing.create`

**Base:** reviewed local `main` at `31b3ca6be0812dad46393cf6cbe43f6d5143c483`

## Objective

Integrate reception visit-service bill generation with the strict financial coordinator without changing disabled or shadow behavior.

The route must preserve the existing pending-service claim workflow, discount and scheme validation, request idempotency, lab linkage, commission linkage, post-commit billing side effects, accounting queue, audit log and response contract. Strict mode must atomically commit guarded legacy authority plus canonical service-request, accepted-event and invoice authority.

## Existing workflow

`POST /visits/:visitId/generate-bill` currently:

1. validates the visit and discount authorization;
2. reserves or replays optional request idempotency;
3. loads every pending `visit_services` row for the visit;
4. validates accounting period, subtotal, bill discount, high-discount referral and optional Billing Master scheme;
5. normalizes bill discount allocations;
6. allocates an invoice number;
7. claims all selected services from `pending` to `billing`;
8. inserts one bill only when every selected service was claimed;
9. inserts discount-allocation rows;
10. inserts one invoice item per service;
11. links every service to the bill and marks it `billed`;
12. links lab commission accruals and the corresponding lab order where applicable;
13. restores temporary claims if no bill was inserted;
14. records scheme usage, performer reserve/commission and accounting side effects;
15. completes request idempotency, audit and the existing response.

The financial batch is concurrency-aware, but strict mode is currently blocked because it has no reviewed canonical service and invoice projection.

## Approaches considered

### 1. Generic `issueInvoice()` only

Rejected. A canonical invoice without canonical service requests/events would leave service delivery authority disconnected from the visit and would not provide deterministic source mappings for `visit_services`.

### 2. Canonicalize all add-service routes first

Rejected for this checkpoint. Moving canonical ownership into generic, bulk, lab and procedure add-service routes would expand CDB-116 into several independent mutation boundaries and delay removal of the registered strict blocker.

The new command uses deterministic IDs based on `visit_service.id`, so a later add-service integration can converge on the same identities.

### 3. Commit legacy first and project canonical post-commit

Rejected. Strict mode requires one atomic transaction. Post-commit canonical failure would leave a successful legacy bill without canonical authority.

### 4. Reception-specific composite command

Selected. A dedicated command prepares canonical service mappings, creates deterministic service requests and accepted events for the exact claimed `visit_services`, prepares the discount-aware canonical invoice, and runs all canonical and guarded legacy statements through one `runCanonicalBatch()` call.

## Components

### `src/lib/canonical/reception-visit-billing.ts`

Owns compatibility behavior.

It exposes:

```ts
export interface ReceptionVisitBillingPreparationInput { /* validated route evidence */ }
export interface ReceptionVisitBillingContext { /* invoice and selected-service authority */ }

export async function executeReceptionVisitBillingOriginalLegacy(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<ReceptionVisitBillingLegacyResult>

export async function prepareReceptionVisitBillingStrictContext(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<ReceptionVisitBillingContext>

export function prepareReceptionVisitBillingStrictStatements(
  db: Pick<ReceptionVisitBillingDatabase, 'prepare'>,
  context: ReceptionVisitBillingContext,
): readonly CanonicalPreparedStatement[]
```

The original executor contains no canonical schema reads, financial assertion rows, stricter ownership predicates or canonical catalog requirements.

The strict preparation is lazy. Before invoice-number allocation it verifies:

- the visit still belongs to the same tenant and patient;
- the canonical encounter mapping exists, matches the patient and remains active;
- every selected service has a positive ID and service-item ID;
- every selected service belongs to the same tenant, visit and patient;
- quantity is a positive safe integer;
- unit amount, item discount and line total use exact cent precision;
- `amount × quantity - discount_amount = total_amount`;
- the service type and description are non-empty;
- every billing-service mapping can be prepared;
- every lab reference resolves to a tenant-owned lab order item and lab order for the same visit/patient;
- the accounting period remains open.

Only after those checks does strict preparation allocate the invoice number.

### `src/lib/canonical/commands/create-reception-visit-billing.ts`

Owns canonical service and invoice authority.

```ts
export interface CreateReceptionVisitBillingLineInput {
  lineNumber: number;
  visitServiceId: number;
  billingServiceItemId: number;
  serviceType: string;
  description: string;
  legacyReferenceId: number | null;
  quantity: number;
  lineTotalMinor: number;
}

export interface CreateReceptionVisitBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoiceNo: string;
  legacyPatientId: number;
  legacyVisitId: number;
  issuedAtUtc: string;
  businessDate: string;
  billDiscountMinor: number;
  lines: readonly CreateReceptionVisitBillingLineInput[];
}

export async function createReceptionVisitBilling(
  db: CanonicalBatchDatabase,
  input: CreateReceptionVisitBillingInput,
  execution?: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CreateReceptionVisitBillingResult>>
```

The command:

- resolves the mapped active canonical encounter for `legacyVisitId`;
- prepares one canonical service mapping per unique billing service item;
- derives deterministic request/event IDs from the tenant and `visitServiceId`;
- creates one active service request and one accepted event per line;
- maps both canonical entities to the actual `visit_services.id` using source type `legacy_visit_service`;
- creates invoice service lines from each stored net `total_amount`;
- uses `buildLegacyLiveInvoiceSourceLineId()` with the same line number, item category and legacy reference ID used by `recordBillFinalizationSideEffects()`;
- creates one negative adjustment line for the bill-level discount;
- prepares canonical invoice authority with `prepareInvoiceSettlementBatch()`;
- commits guarded legacy statements, canonical facts, source mappings, outbox records and command evidence atomically.

Item-level discounts are already reflected in `visit_services.total_amount`; they are not subtracted again. The bill-level discount is represented once as a canonical discount line.

A fully discounted bill is valid when subtotal is positive and final total is zero.

## Original legacy authority

The original executor preserves the existing SQL and order:

1. bulk claim selected pending service IDs;
2. conditional bill insertion after full claim;
3. discount-allocation insertion;
4. invoice-item insertion;
5. service linkage and `billed` status;
6. optional lab commission and lab-order linkage;
7. failed-bill temporary-claim reset;
8. committed bill ID resolution.

A concurrent request that cannot claim every selected service produces no bill. Its temporary `billing` claims are restored before the original batch commits, matching current behavior.

## Strict legacy authority

Strict mode uses per-service guarded claims so every service produces a one-row financial assertion. The batch then:

- inserts the bill only when every exact service is claimed and the invoice number is absent;
- inserts each discount allocation with one-row evidence;
- inserts each invoice item from the exact claimed source row;
- links each exact service to the bill;
- updates matching lab commission accruals without requiring an accrual to exist;
- links each referenced lab order with a one-row assertion;
- clears all assertion rows before commit.

Exact service evidence includes patient, visit, service item, service type, amount, discount, quantity, total, reference type and reference ID. Any post-preflight change rolls back the entire strict batch, including the production bill-insert accounting trigger event.

The original failed-claim reset statement is unnecessary in strict mode because assertion failure rolls the transaction back.

## Route orchestration

The route remains responsible for:

- authorization and Zod validation;
- optional request-idempotency reserve/replay/completion;
- discount authorization, scheme eligibility and allocation normalization;
- common pending-service snapshot preparation;
- mode orchestration through `executeStrictFinancialMutation()`;
- committed bill and invoice-item identity reload;
- scheme usage, billing finalization, accounting queue and audit;
- the existing `201` response.

Mode behavior:

- **disabled:** execute only the original legacy executor;
- **shadow:** commit the original executor, attempt canonical projection, record a shadow issue on failure and preserve the original response;
- **strict:** lazily prepare strict context and statements, then pass them as `authoritativeStatements` to `createReceptionVisitBilling()`.

Strict mode passes actual committed invoice-item IDs into post-commit performer-reserve processing and skips the duplicate application-side bill-created event. The canonical source-line ID is already identical to the helper default, so legacy/shadow payloads need no new field.

## Error handling

Historical validation errors remain `400`, `403` or `404`.

Strict assertion, mapping, replay-conflict or canonical-authority failures return a sanitized `409` and do not expose SQL or patient details.

Optional request idempotency is marked failed on unsuccessful route execution, preserving the existing contract.

## Governance

After integration:

```text
reception.visit-billing.create
status: integrated
canonicalCommand: createReceptionVisitBilling
```

The route-level allowance for direct bill and invoice-item insertion moves to the adapter where possible. Any remaining route allowance must be justified by another reception workflow and documented rather than removed blindly.

Cross-route shadow-isolation tests must prove the original executor contains no canonical tables, financial assertions or strict-only mapping checks.

## Verification

Required focused coverage:

- original SQL sequence and failed-claim reset;
- disabled response parity;
- shadow success despite canonical mapping failure;
- strict rejection before invoice allocation for missing encounter/service mapping;
- strict multi-service success with bill-level discount;
- exact visit-service race rollback;
- lab-reference race rollback;
- production bill-trigger parity;
- command replay and changed-evidence conflict;
- canonical arithmetic and source-line identity;
- idempotency replay and existing scheme behavior;
- coverage registry and cross-route shadow isolation.

Final gates:

- focused reception/canonical tests;
- full canonical suite;
- TypeScript;
- canonical schema governance;
- generated migration manifest;
- web, patient and admin builds;
- worktree policy and diff checks;
- replay onto current local `main` followed by the same current-main gates.

## Safety

No push, deployment, production migration, backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement is authorized by this checkpoint.
