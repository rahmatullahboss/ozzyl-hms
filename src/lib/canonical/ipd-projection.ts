export interface CanonicalIpdProjectionPreparedStatement {
  bind(...values: unknown[]): CanonicalIpdProjectionPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CanonicalIpdProjectionDatabase {
  prepare(sql: string): CanonicalIpdProjectionPreparedStatement;
}

export class CanonicalIpdAdmissionNotFoundError extends Error {
  constructor(tenantId: string, legacyAdmissionId: number) {
    super(`Canonical IPD admission not found for tenant ${tenantId} and admission ${legacyAdmissionId}`);
    this.name = 'CanonicalIpdAdmissionNotFoundError';
  }
}

export type CanonicalIpdProjectionIssueCode =
  | 'IPD_SERVICE_PRICE_MISSING'
  | 'IPD_SERVICE_PRICE_AMBIGUOUS'
  | 'IPD_MIXED_ENCOUNTER_INVOICE'
  | 'IPD_MULTI_CURRENCY'
  | 'IPD_PAYMENT_COMPONENT_VARIANCE'
  | 'IPD_CREDIT_COMPONENT_VARIANCE';

export interface CanonicalIpdProjectionIssue {
  code: CanonicalIpdProjectionIssueCode;
  identity: string;
  summary: string;
}

export interface CanonicalIpdProjectionItem {
  serviceEventPublicId: string;
  servicePublicId: string;
  displayName: string;
  itemKind: string;
  eventType: string;
  quantity: number;
  occurredAtUtc: string;
  status: 'projected' | 'invoiced' | 'unpriced';
  amountMinor: number | null;
  currencyCode: string | null;
  invoicePublicId: string | null;
  invoiceLinePublicId: string | null;
}

export interface CanonicalIpdProjectedInvoice {
  invoicePublicId: string;
  invoiceNumber: string;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
  issuedAtUtc: string;
}

export interface CanonicalIpdProjectionSummary {
  currencyCode: string | null;
  invoicedGrossMinor: number;
  invoicedPaidMinor: number;
  invoicedCreditedMinor: number;
  invoicedNetDueMinor: number;
  unInvoicedServiceMinor: number;
  admissionBalanceMinor: number;
  paymentAllocatedMinor: number;
  depositAppliedMinor: number;
  availableDepositMinor: number;
  potentialAfterAvailableDepositMinor: number;
  paymentReversedMinor: number;
  paymentRefundedMinor: number;
  compensationEarnedMinor: number;
  compensationSettledMinor: number;
  compensationPayableMinor: number;
}

export interface CanonicalIpdLegacyComparison {
  legacyPendingMinor: number;
  legacyLedgerBalanceMinor: number;
  pendingVarianceMinor: number;
  balanceVarianceMinor: number;
  classification: 'matched' | 'different';
}

export interface CanonicalIpdAdmissionProjection {
  admission: {
    legacyAdmissionId: number;
    admissionNo: string;
    encounterPublicId: string;
    legacyPatientId: number;
    status: string;
    startedAtUtc: string;
    endedAtUtc: string | null;
  };
  bedStays: Array<{
    bedStayPublicId: string;
    legacyPatientBedInfoId: number;
    legacyBedId: number;
    startedAtUtc: string;
    endedAtUtc: string | null;
    status: string;
  }>;
  items: CanonicalIpdProjectionItem[];
  invoices: CanonicalIpdProjectedInvoice[];
  summary: CanonicalIpdProjectionSummary;
  issues: CanonicalIpdProjectionIssue[];
  legacyComparison: CanonicalIpdLegacyComparison | null;
}

export interface ProjectCanonicalIpdAdmissionInput {
  tenantId: string;
  legacyAdmissionId: number;
  includeLegacyComparison?: boolean;
}

export interface ListCanonicalIpdAdmissionInput {
  tenantId: string;
  includeCompleted?: boolean;
  includeLegacyComparison?: boolean;
}

export interface CanonicalIpdAdmissionSummary {
  legacyAdmissionId: number;
  admissionNo: string;
  encounterPublicId: string;
  legacyPatientId: number;
  status: string;
  startedAtUtc: string;
  endedAtUtc: string | null;
  summary: CanonicalIpdProjectionSummary;
  issueCount: number;
  legacyComparison: CanonicalIpdLegacyComparison | null;
}

interface AdmissionRow {
  legacy_admission_id: number;
  admission_no: string;
  encounter_public_id: string;
  legacy_patient_id: number;
  status: string;
  started_at_utc: string;
  ended_at_utc: string | null;
}

interface BedStayRow {
  bed_stay_public_id: string;
  legacy_patient_bed_info_id: number;
  legacy_bed_id: number;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string;
}

interface EventRow {
  event_public_id: string;
  service_public_id: string;
  event_type: string;
  quantity: number;
  occurred_at_utc: string;
  display_name: string;
  item_kind: string;
}

interface PriceRow {
  event_public_id: string;
  price_public_id: string;
  price_context_type: string;
  amount_minor: number;
  currency_code: string;
}

interface InvoiceLineRow {
  invoice_public_id: string;
  line_public_id: string;
  service_event_public_id: string;
  line_amount_minor: number;
  encounter_public_id: string | null;
}

interface InvoiceRow {
  invoice_public_id: string;
  invoice_number: string;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  issued_at_utc: string;
}

interface AggregateRow {
  amount: number | null;
}

interface LegacyComparisonRow {
  pending_minor: number | null;
  ledger_minor: number | null;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} must be a non-empty exact string`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function safeAmount(value: unknown, label: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return amount;
}

function signedSafeAmount(value: unknown, label: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} must be a safe integer`);
  return amount;
}

async function all<T>(statement: CanonicalIpdProjectionPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

function placeholders(values: readonly unknown[]): string {
  if (values.length === 0) throw new Error('Cannot build an empty SQL placeholder list');
  return values.map(() => '?').join(',');
}

function pricePriority(itemKind: string, context: string): number | null {
  if (itemKind === 'product') {
    if (context === 'sale') return 0;
    if (context === 'base') return 1;
    return null;
  }
  if (itemKind === 'bed') {
    if (context === 'bed_rate') return 0;
    if (context === 'base') return 1;
    return null;
  }
  return context === 'base' ? 0 : null;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += safeAmount(value, 'projection amount');
    if (!Number.isSafeInteger(total)) throw new RangeError('Projection total exceeds safe integer range');
  }
  return total;
}

async function aggregateForInvoices(
  db: CanonicalIpdProjectionDatabase,
  sql: string,
  tenantId: string,
  invoiceIds: string[],
): Promise<number> {
  if (invoiceIds.length === 0) return 0;
  const row = await db.prepare(sql.replace('/*INVOICES*/', placeholders(invoiceIds)))
    .bind(tenantId, ...invoiceIds)
    .first<AggregateRow>();
  return safeAmount(row?.amount ?? 0, 'invoice aggregate');
}

async function loadLegacyComparison(
  db: CanonicalIpdProjectionDatabase,
  tenantId: string,
  legacyAdmissionId: number,
  unInvoicedServiceMinor: number,
  admissionBalanceMinor: number,
): Promise<CanonicalIpdLegacyComparison | null> {
  try {
    const row = await db.prepare(`
      SELECT
        CAST(ROUND((
          COALESCE((
            SELECT SUM(total_amount)
            FROM billing_provisional_items
            WHERE tenant_id=? AND admission_id=? AND bill_status='provisional' AND is_active=1
          ),0) +
          COALESCE((
            SELECT SUM(charge_amount)
            FROM patient_bed_infos
            WHERE tenant_id=? AND admission_id=? AND is_billed=0
          ),0)
        ) * 100) AS INTEGER) pending_minor,
        CAST(ROUND(COALESCE((
          SELECT SUM(debit_amount-credit_amount)
          FROM ipd_ledger_entries
          WHERE tenant_id=? AND admission_id=?
        ),0) * 100) AS INTEGER) ledger_minor
    `).bind(
      tenantId,
      legacyAdmissionId,
      tenantId,
      legacyAdmissionId,
      tenantId,
      legacyAdmissionId,
    ).first<LegacyComparisonRow>();
    const legacyPendingMinor = safeAmount(row?.pending_minor ?? 0, 'legacy pending amount');
    const legacyLedgerBalanceMinor = signedSafeAmount(row?.ledger_minor ?? 0, 'legacy ledger amount');
    const pendingVarianceMinor = legacyPendingMinor - unInvoicedServiceMinor;
    const balanceVarianceMinor = legacyLedgerBalanceMinor - admissionBalanceMinor;
    return {
      legacyPendingMinor,
      legacyLedgerBalanceMinor,
      pendingVarianceMinor,
      balanceVarianceMinor,
      classification: pendingVarianceMinor === 0 && balanceVarianceMinor === 0 ? 'matched' : 'different',
    };
  } catch {
    return null;
  }
}

export async function projectCanonicalIpdAdmission(
  db: CanonicalIpdProjectionDatabase,
  input: ProjectCanonicalIpdAdmissionInput,
): Promise<CanonicalIpdAdmissionProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyAdmissionId = positiveInteger(input.legacyAdmissionId, 'legacyAdmissionId');

  const admission = await db.prepare(`
    SELECT l.legacy_admission_id,l.admission_no,l.encounter_public_id,
           e.legacy_patient_id,e.status,e.started_at_utc,e.ended_at_utc
    FROM canonical_encounter_admission_links l
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.legacy_admission_id=? AND l.link_status='active'
      AND e.encounter_type IN ('inpatient','emergency')
    LIMIT 1
  `).bind(tenantId, legacyAdmissionId).first<AdmissionRow>();
  if (!admission) throw new CanonicalIpdAdmissionNotFoundError(tenantId, legacyAdmissionId);

  const bedStayRows = await all<BedStayRow>(db.prepare(`
    SELECT bed_stay_public_id,legacy_patient_bed_info_id,legacy_bed_id,
           started_at_utc,ended_at_utc,status
    FROM canonical_bed_stays
    WHERE tenant_id=? AND encounter_public_id=? AND status IN ('active','completed')
    ORDER BY started_at_utc,bed_stay_public_id
  `).bind(tenantId, admission.encounter_public_id));

  const events = await all<EventRow>(db.prepare(`
    SELECT e.event_public_id,e.service_public_id,e.event_type,e.quantity,e.occurred_at_utc,
           s.display_name,s.item_kind
    FROM canonical_service_events e
    JOIN canonical_service_catalog_items s
      ON s.tenant_id=e.tenant_id AND s.service_public_id=e.service_public_id
    WHERE e.tenant_id=? AND e.encounter_public_id=? AND e.status='posted'
      AND e.event_type IN ('delivered','completed','dispensed','occupied')
    ORDER BY e.occurred_at_utc,e.id
  `).bind(tenantId, admission.encounter_public_id));

  const explicitInvoiceRows = await all<InvoiceRow>(db.prepare(`
    SELECT i.invoice_public_id,i.invoice_number,i.currency_code,i.total_minor,i.paid_minor,
           i.due_minor,i.credited_minor,i.net_due_minor,i.issued_at_utc
    FROM canonical_invoice_encounter_links l
    JOIN canonical_invoices i
      ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
    WHERE l.tenant_id=? AND l.encounter_public_id=? AND l.legacy_admission_id=?
      AND l.link_type='discharge_invoice' AND i.status='posted'
    ORDER BY i.issued_at_utc,i.invoice_public_id
  `).bind(tenantId, admission.encounter_public_id, legacyAdmissionId));
  const explicitInvoiceIds = new Set(explicitInvoiceRows.map((invoice) => invoice.invoice_public_id));

  const eventIds = events.map((event) => event.event_public_id);
  const candidateInvoiceLines = eventIds.length === 0
    ? []
    : await all<InvoiceLineRow>(db.prepare(`
        SELECT il.invoice_public_id,il.line_public_id,il.service_event_public_id,
               il.line_amount_minor,e.encounter_public_id
        FROM canonical_invoice_lines il
        JOIN canonical_service_events e
          ON e.tenant_id=il.tenant_id AND e.event_public_id=il.service_event_public_id
        WHERE il.tenant_id=? AND il.line_type='service'
          AND il.service_event_public_id IN (${placeholders(eventIds)})
      `).bind(tenantId, ...eventIds));

  const inferredCandidateInvoiceIds = [
    ...new Set(candidateInvoiceLines.map((line) => line.invoice_public_id)),
  ].filter((invoiceId) => !explicitInvoiceIds.has(invoiceId));
  const allServiceInvoiceIds = [
    ...new Set([...explicitInvoiceIds, ...inferredCandidateInvoiceIds]),
  ];
  const allCandidateServiceLines = allServiceInvoiceIds.length === 0
    ? []
    : await all<InvoiceLineRow>(db.prepare(`
        SELECT il.invoice_public_id,il.line_public_id,il.service_event_public_id,
               il.line_amount_minor,e.encounter_public_id
        FROM canonical_invoice_lines il
        LEFT JOIN canonical_service_events e
          ON e.tenant_id=il.tenant_id AND e.event_public_id=il.service_event_public_id
        WHERE il.tenant_id=? AND il.line_type='service'
          AND il.invoice_public_id IN (${placeholders(allServiceInvoiceIds)})
        ORDER BY il.invoice_public_id,il.id
      `).bind(tenantId, ...allServiceInvoiceIds));

  const issues: CanonicalIpdProjectionIssue[] = [];
  const inferredExactInvoiceIds: string[] = [];
  for (const invoiceId of inferredCandidateInvoiceIds) {
    const lines = allCandidateServiceLines.filter((line) => line.invoice_public_id === invoiceId);
    if (lines.length > 0 && lines.every((line) => line.encounter_public_id === admission.encounter_public_id)) {
      inferredExactInvoiceIds.push(invoiceId);
    } else {
      issues.push({
        code: 'IPD_MIXED_ENCOUNTER_INVOICE',
        identity: invoiceId,
        summary: 'Invoice contains service lines outside the target inpatient encounter.',
      });
    }
  }

  const inferredInvoiceRows = inferredExactInvoiceIds.length === 0
    ? []
    : await all<InvoiceRow>(db.prepare(`
        SELECT invoice_public_id,invoice_number,currency_code,total_minor,paid_minor,due_minor,
               credited_minor,net_due_minor,issued_at_utc
        FROM canonical_invoices
        WHERE tenant_id=? AND status='posted'
          AND invoice_public_id IN (${placeholders(inferredExactInvoiceIds)})
        ORDER BY issued_at_utc,invoice_public_id
      `).bind(tenantId, ...inferredExactInvoiceIds));
  const invoiceRows = [...explicitInvoiceRows, ...inferredInvoiceRows]
    .sort((left, right) => left.issued_at_utc.localeCompare(right.issued_at_utc)
      || left.invoice_public_id.localeCompare(right.invoice_public_id));
  const postedExactInvoiceIds = new Set(invoiceRows.map((invoice) => invoice.invoice_public_id));
  const exactLineByEvent = new Map<string, InvoiceLineRow>();
  for (const line of allCandidateServiceLines) {
    if (postedExactInvoiceIds.has(line.invoice_public_id)) exactLineByEvent.set(line.service_event_public_id, line);
  }

  const prices = events.length === 0
    ? []
    : await all<PriceRow>(db.prepare(`
        SELECT e.event_public_id,p.price_public_id,p.price_context_type,p.amount_minor,p.currency_code
        FROM canonical_service_events e
        JOIN canonical_service_prices p
          ON p.tenant_id=e.tenant_id AND p.service_public_id=e.service_public_id
         AND p.status='active' AND p.valid_from_utc<=e.occurred_at_utc
         AND (p.valid_to_utc IS NULL OR p.valid_to_utc>e.occurred_at_utc)
        WHERE e.tenant_id=? AND e.encounter_public_id=? AND e.status='posted'
          AND e.event_type IN ('delivered','completed','dispensed','occupied')
        ORDER BY e.event_public_id,p.valid_from_utc DESC,p.price_public_id
      `).bind(tenantId, admission.encounter_public_id));
  const pricesByEvent = new Map<string, PriceRow[]>();
  for (const price of prices) {
    const existing = pricesByEvent.get(price.event_public_id) ?? [];
    existing.push(price);
    pricesByEvent.set(price.event_public_id, existing);
  }

  const items: CanonicalIpdProjectionItem[] = [];
  const currencies = new Set(invoiceRows.map((invoice) => invoice.currency_code));
  for (const event of events) {
    const invoiceLine = exactLineByEvent.get(event.event_public_id);
    if (invoiceLine) {
      const invoice = invoiceRows.find((row) => row.invoice_public_id === invoiceLine.invoice_public_id);
      if (!invoice) continue;
      currencies.add(invoice.currency_code);
      items.push({
        serviceEventPublicId: event.event_public_id,
        servicePublicId: event.service_public_id,
        displayName: event.display_name,
        itemKind: event.item_kind,
        eventType: event.event_type,
        quantity: event.quantity,
        occurredAtUtc: event.occurred_at_utc,
        status: 'invoiced',
        amountMinor: safeAmount(invoiceLine.line_amount_minor, 'invoice line amount'),
        currencyCode: invoice.currency_code,
        invoicePublicId: invoiceLine.invoice_public_id,
        invoiceLinePublicId: invoiceLine.line_public_id,
      });
      continue;
    }

    const candidates = (pricesByEvent.get(event.event_public_id) ?? [])
      .map((price) => ({ price, priority: pricePriority(event.item_kind, price.price_context_type) }))
      .filter((candidate): candidate is { price: PriceRow; priority: number } => candidate.priority != null);
    if (candidates.length === 0) {
      issues.push({
        code: 'IPD_SERVICE_PRICE_MISSING',
        identity: event.event_public_id,
        summary: 'Posted service event has no exact effective canonical price.',
      });
      items.push({
        serviceEventPublicId: event.event_public_id,
        servicePublicId: event.service_public_id,
        displayName: event.display_name,
        itemKind: event.item_kind,
        eventType: event.event_type,
        quantity: event.quantity,
        occurredAtUtc: event.occurred_at_utc,
        status: 'unpriced',
        amountMinor: null,
        currencyCode: null,
        invoicePublicId: null,
        invoiceLinePublicId: null,
      });
      continue;
    }
    const bestPriority = Math.min(...candidates.map((candidate) => candidate.priority));
    const best = candidates.filter((candidate) => candidate.priority === bestPriority);
    if (best.length !== 1) {
      issues.push({
        code: 'IPD_SERVICE_PRICE_AMBIGUOUS',
        identity: event.event_public_id,
        summary: 'Posted service event has multiple equally authoritative effective prices.',
      });
      items.push({
        serviceEventPublicId: event.event_public_id,
        servicePublicId: event.service_public_id,
        displayName: event.display_name,
        itemKind: event.item_kind,
        eventType: event.event_type,
        quantity: event.quantity,
        occurredAtUtc: event.occurred_at_utc,
        status: 'unpriced',
        amountMinor: null,
        currencyCode: null,
        invoicePublicId: null,
        invoiceLinePublicId: null,
      });
      continue;
    }
    const unitAmount = safeAmount(best[0].price.amount_minor, 'service price');
    if (event.quantity > 0 && unitAmount > Math.floor(Number.MAX_SAFE_INTEGER / event.quantity)) {
      throw new RangeError('Projected service amount exceeds safe integer range');
    }
    const amountMinor = unitAmount * event.quantity;
    currencies.add(best[0].price.currency_code);
    items.push({
      serviceEventPublicId: event.event_public_id,
      servicePublicId: event.service_public_id,
      displayName: event.display_name,
      itemKind: event.item_kind,
      eventType: event.event_type,
      quantity: event.quantity,
      occurredAtUtc: event.occurred_at_utc,
      status: 'projected',
      amountMinor,
      currencyCode: best[0].price.currency_code,
      invoicePublicId: null,
      invoiceLinePublicId: null,
    });
  }

  if (currencies.size > 1) {
    issues.push({
      code: 'IPD_MULTI_CURRENCY',
      identity: admission.encounter_public_id,
      summary: 'Admission projection contains more than one currency and cannot be aggregated safely.',
    });
  }
  const currencyCode = currencies.size === 1 ? [...currencies][0] : null;
  const invoiceIds = invoiceRows.map((invoice) => invoice.invoice_public_id);
  const invoicedGrossMinor = sum(invoiceRows.map((invoice) => invoice.total_minor));
  const invoicedPaidMinor = sum(invoiceRows.map((invoice) => invoice.paid_minor));
  const invoicedCreditedMinor = sum(invoiceRows.map((invoice) => invoice.credited_minor));
  const invoicedNetDueMinor = sum(invoiceRows.map((invoice) => invoice.net_due_minor));
  const unInvoicedServiceMinor = currencyCode == null && currencies.size > 1
    ? 0
    : sum(items.filter((item) => item.status === 'projected').map((item) => item.amountMinor ?? 0));

  const paymentAllocatedMinor = await aggregateForInvoices(db, `
    SELECT COALESCE(SUM(remaining_minor),0) amount
    FROM canonical_payment_allocations
    WHERE tenant_id=? AND status='active' AND invoice_public_id IN (/*INVOICES*/)
  `, tenantId, invoiceIds);
  const depositAppliedMinor = await aggregateForInvoices(db, `
    SELECT COALESCE(SUM(amount_minor),0) amount
    FROM canonical_deposit_applications
    WHERE tenant_id=? AND status='active' AND invoice_public_id IN (/*INVOICES*/)
  `, tenantId, invoiceIds);
  const paymentReversedMinor = await aggregateForInvoices(db, `
    SELECT COALESCE(SUM(amount_minor),0) amount
    FROM canonical_payment_reversals
    WHERE tenant_id=? AND status='posted' AND invoice_public_id IN (/*INVOICES*/)
  `, tenantId, invoiceIds);
  const paymentRefundedMinor = invoiceIds.length === 0 ? 0 : safeAmount((await db.prepare(`
    SELECT COALESCE(SUM(r.amount_minor),0) amount
    FROM canonical_refunds r
    JOIN canonical_payment_reversals pr
      ON pr.tenant_id=r.tenant_id AND pr.reversal_public_id=r.payment_reversal_public_id
    WHERE r.tenant_id=? AND r.status='posted' AND r.source_type='payment'
      AND pr.invoice_public_id IN (${placeholders(invoiceIds)})
  `).bind(tenantId, ...invoiceIds).first<AggregateRow>())?.amount ?? 0, 'payment refund amount');
  const creditComponentMinor = await aggregateForInvoices(db, `
    SELECT COALESCE(SUM(total_minor),0) amount
    FROM canonical_credit_notes
    WHERE tenant_id=? AND status='posted' AND invoice_public_id IN (/*INVOICES*/)
  `, tenantId, invoiceIds);

  if (paymentAllocatedMinor + depositAppliedMinor !== invoicedPaidMinor) {
    issues.push({
      code: 'IPD_PAYMENT_COMPONENT_VARIANCE',
      identity: admission.encounter_public_id,
      summary: 'Canonical allocation and deposit-application components do not equal invoice paid projection.',
    });
  }
  if (creditComponentMinor !== invoicedCreditedMinor) {
    issues.push({
      code: 'IPD_CREDIT_COMPONENT_VARIANCE',
      identity: admission.encounter_public_id,
      summary: 'Canonical credit-note components do not equal invoice credited projection.',
    });
  }

  const availableDepositRow = currencyCode == null
    ? null
    : await db.prepare(`
        SELECT COALESCE(SUM(available_minor),0) amount
        FROM canonical_deposits
        WHERE tenant_id=? AND legacy_patient_id=? AND currency_code=? AND status='posted'
      `).bind(tenantId, admission.legacy_patient_id, currencyCode).first<AggregateRow>();
  const availableDepositMinor = safeAmount(availableDepositRow?.amount ?? 0, 'available deposit amount');

  const compensation = await db.prepare(`
    SELECT COALESCE(SUM(c.earned_minor),0) earned,
           COALESCE(SUM(c.settled_minor),0) settled,
           COALESCE(SUM(c.payable_minor),0) payable
    FROM canonical_compensation_accruals c
    JOIN canonical_service_events e
      ON e.tenant_id=c.tenant_id AND e.event_public_id=c.service_event_public_id
    WHERE c.tenant_id=? AND e.encounter_public_id=?
      AND c.status NOT IN ('cancelled','reversed')
  `).bind(tenantId, admission.encounter_public_id).first<{
    earned: number | null;
    settled: number | null;
    payable: number | null;
  }>();
  const compensationEarnedMinor = safeAmount(compensation?.earned ?? 0, 'compensation earned amount');
  const compensationSettledMinor = safeAmount(compensation?.settled ?? 0, 'compensation settled amount');
  const compensationPayableMinor = safeAmount(compensation?.payable ?? 0, 'compensation payable amount');

  const admissionBalanceMinor = invoicedNetDueMinor + unInvoicedServiceMinor;
  if (!Number.isSafeInteger(admissionBalanceMinor)) throw new RangeError('Admission balance exceeds safe integer range');
  const summary: CanonicalIpdProjectionSummary = {
    currencyCode,
    invoicedGrossMinor,
    invoicedPaidMinor,
    invoicedCreditedMinor,
    invoicedNetDueMinor,
    unInvoicedServiceMinor,
    admissionBalanceMinor,
    paymentAllocatedMinor,
    depositAppliedMinor,
    availableDepositMinor,
    potentialAfterAvailableDepositMinor: Math.max(0, admissionBalanceMinor - availableDepositMinor),
    paymentReversedMinor,
    paymentRefundedMinor,
    compensationEarnedMinor,
    compensationSettledMinor,
    compensationPayableMinor,
  };

  const legacyComparison = input.includeLegacyComparison === false
    ? null
    : await loadLegacyComparison(
        db,
        tenantId,
        legacyAdmissionId,
        unInvoicedServiceMinor,
        admissionBalanceMinor,
      );

  return {
    admission: {
      legacyAdmissionId: admission.legacy_admission_id,
      admissionNo: admission.admission_no,
      encounterPublicId: admission.encounter_public_id,
      legacyPatientId: admission.legacy_patient_id,
      status: admission.status,
      startedAtUtc: admission.started_at_utc,
      endedAtUtc: admission.ended_at_utc,
    },
    bedStays: bedStayRows.map((row) => ({
      bedStayPublicId: row.bed_stay_public_id,
      legacyPatientBedInfoId: row.legacy_patient_bed_info_id,
      legacyBedId: row.legacy_bed_id,
      startedAtUtc: row.started_at_utc,
      endedAtUtc: row.ended_at_utc,
      status: row.status,
    })),
    items,
    invoices: invoiceRows.map((row) => ({
      invoicePublicId: row.invoice_public_id,
      invoiceNumber: row.invoice_number,
      currencyCode: row.currency_code,
      totalMinor: row.total_minor,
      paidMinor: row.paid_minor,
      dueMinor: row.due_minor,
      creditedMinor: row.credited_minor,
      netDueMinor: row.net_due_minor,
      issuedAtUtc: row.issued_at_utc,
    })),
    summary,
    issues,
    legacyComparison,
  };
}

export async function listCanonicalIpdAdmissionSummaries(
  db: CanonicalIpdProjectionDatabase,
  input: ListCanonicalIpdAdmissionInput,
): Promise<CanonicalIpdAdmissionSummary[]> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const statusSql = input.includeCompleted
    ? "e.status IN ('in_progress','completed')"
    : "e.status='in_progress'";
  const rows = await all<AdmissionRow>(db.prepare(`
    SELECT l.legacy_admission_id,l.admission_no,l.encounter_public_id,
           e.legacy_patient_id,e.status,e.started_at_utc,e.ended_at_utc
    FROM canonical_encounter_admission_links l
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.link_status='active' AND e.encounter_type IN ('inpatient','emergency')
      AND ${statusSql}
    ORDER BY e.started_at_utc DESC,l.legacy_admission_id DESC
  `).bind(tenantId));

  const results: CanonicalIpdAdmissionSummary[] = [];
  for (const row of rows) {
    const projection = await projectCanonicalIpdAdmission(db, {
      tenantId,
      legacyAdmissionId: row.legacy_admission_id,
      includeLegacyComparison: input.includeLegacyComparison,
    });
    results.push({
      legacyAdmissionId: projection.admission.legacyAdmissionId,
      admissionNo: projection.admission.admissionNo,
      encounterPublicId: projection.admission.encounterPublicId,
      legacyPatientId: projection.admission.legacyPatientId,
      status: projection.admission.status,
      startedAtUtc: projection.admission.startedAtUtc,
      endedAtUtc: projection.admission.endedAtUtc,
      summary: projection.summary,
      issueCount: projection.issues.length,
      legacyComparison: projection.legacyComparison,
    });
  }
  return results;
}
