import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { resolveReceivableAuthority } from './authority';
import type {
  CollectionCurrencySummary,
  CollectionListQuery,
  CollectionQueueRow,
  CollectionStatus,
  CollectionSummary,
  PaginationMeta,
  ReceivableAuthorityMode,
  ReceivableFinancialStatus,
  ReceivableSourceRef,
} from './types';

interface NameRow {
  name: string;
}

interface SourceSql {
  sql: string;
  binds: unknown[];
}

interface SummaryRow {
  totalInvoices: number;
  followupDue: number;
  currentCount: number;
  days30Count: number;
  days60Count: number;
  days90PlusCount: number;
  currencyCount: number;
  shadowMismatchCount: number;
}

interface CurrencySummaryRow {
  currencyCode: string;
  totalDueMinor: number;
  totalInvoices: number;
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  promisedAmountMinor: number;
  disputedAmountMinor: number;
}

interface QueueDbRow {
  sourceKey: string;
  canonicalInvoicePublicId: string | null;
  legacyBillId: number | null;
  invoiceNumber: string;
  patientId: number;
  patientName: string;
  patientMobile: string | null;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  dueMinor: number;
  issuedAtUtc: string;
  financialStatus: string;
  caseId: number | null;
  collectionStatus: string;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  updatedAtUtc: string | null;
  daysOutstanding: number;
}

const COLLECTION_STATUSES = new Set<CollectionStatus>([
  'new',
  'contact_due',
  'contacted',
  'promised',
  'disputed',
  'escalated',
  'write_off_requested',
  'closed',
]);

const FINANCIAL_STATUSES = new Set<ReceivableFinancialStatus>([
  'open',
  'paid',
  'cancelled',
  'reversed',
]);

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

async function tableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  if (!await tableExists(db, tableName)) return new Set();
  const result = await db.prepare(`PRAGMA table_info('${tableName}')`).all<NameRow>();
  return new Set((result.results ?? []).map((row) => row.name));
}

function mappedCanonicalIdExpression(invoiceAlias: string, mappingsAvailable: boolean): string {
  if (!mappingsAvailable) return 'NULL';
  return `(
    SELECT m.canonical_public_id
    FROM canonical_source_mappings m
    WHERE m.tenant_id = ${invoiceAlias}.tenant_id
      AND m.entity_type = 'invoice'
      AND m.source_table = 'bills'
      AND m.source_public_id = CAST(${invoiceAlias}.id AS TEXT)
      AND m.mapping_status = 'mapped'
    ORDER BY m.id ASC
    LIMIT 1
  )`;
}

function mappedLegacyBillExpression(invoiceAlias: string, mappingsAvailable: boolean): string {
  if (!mappingsAvailable) return 'NULL';
  return `(
    SELECT CASE
      WHEN m.source_public_id <> ''
       AND m.source_public_id NOT GLOB '*[^0-9]*'
      THEN CAST(m.source_public_id AS INTEGER)
      ELSE NULL
    END
    FROM canonical_source_mappings m
    WHERE m.tenant_id = ${invoiceAlias}.tenant_id
      AND m.entity_type = 'invoice'
      AND m.canonical_public_id = ${invoiceAlias}.invoice_public_id
      AND m.source_table = 'bills'
      AND m.mapping_status = 'mapped'
    ORDER BY m.id ASC
    LIMIT 1
  )`;
}

async function buildLegacySourceSql(input: {
  db: D1Database;
  tenantId: string;
  shadow: boolean;
}): Promise<SourceSql> {
  const mappingsAvailable = await tableExists(input.db, 'canonical_source_mappings');
  const canonicalColumns = input.shadow
    ? await tableColumns(input.db, 'canonical_invoices')
    : new Set<string>();
  const shadowAvailable = input.shadow && mappingsAvailable && canonicalColumns.has('due_minor');
  const canonicalDueColumn = canonicalColumns.has('net_due_minor') ? 'net_due_minor' : 'due_minor';
  const canonicalId = mappedCanonicalIdExpression('b', mappingsAvailable);

  const shadowMismatch = shadowAvailable
    ? `CASE WHEN EXISTS (
        SELECT 1
        FROM canonical_source_mappings m
        JOIN canonical_invoices ci
          ON ci.tenant_id = m.tenant_id
         AND ci.invoice_public_id = m.canonical_public_id
        WHERE m.tenant_id = b.tenant_id
          AND m.entity_type = 'invoice'
          AND m.source_table = 'bills'
          AND m.source_public_id = CAST(b.id AS TEXT)
          AND m.mapping_status = 'mapped'
          AND (
            ci.total_minor <> CAST(ROUND(COALESCE(b.total, 0) * 100) AS INTEGER)
            OR ci.paid_minor <> CAST(ROUND(COALESCE(b.paid, 0) * 100) AS INTEGER)
            OR ci.${canonicalDueColumn} <> CAST(ROUND(COALESCE(b.due, 0) * 100) AS INTEGER)
          )
      ) THEN 1 ELSE 0 END`
    : '0';

  return {
    sql: `
      SELECT
        b.tenant_id,
        'legacy-bill:' || b.id AS source_key,
        ${canonicalId} AS canonical_invoice_public_id,
        b.id AS legacy_bill_id,
        COALESCE(NULLIF(trim(b.invoice_no), ''), 'Bill #' || b.id) AS invoice_number,
        b.patient_id,
        COALESCE(p.name, 'Unknown') AS patient_name,
        p.mobile AS patient_mobile,
        'BDT' AS currency_code,
        CAST(ROUND(COALESCE(b.total, 0) * 100) AS INTEGER) AS total_minor,
        CAST(ROUND(COALESCE(b.paid, 0) * 100) AS INTEGER) AS paid_minor,
        0 AS credited_minor,
        CAST(ROUND(COALESCE(b.due, 0) * 100) AS INTEGER) AS due_minor,
        CASE
          WHEN b.created_at IS NULL THEN NULL
          WHEN substr(trim(b.created_at), -1) = 'Z'
            THEN strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at)
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ', datetime(b.created_at, '-6 hours'))
        END AS issued_at_utc,
        CASE
          WHEN lower(COALESCE(b.status, 'open')) IN ('cancelled', 'canceled') THEN 'cancelled'
          WHEN lower(COALESCE(b.status, 'open')) IN ('refunded', 'reversed') THEN 'reversed'
          WHEN lower(COALESCE(b.status, 'open')) = 'paid'
            OR CAST(ROUND(COALESCE(b.due, 0) * 100) AS INTEGER) <= 0 THEN 'paid'
          ELSE 'open'
        END AS financial_status,
        ${shadowMismatch} AS shadow_mismatch
      FROM bills b
      LEFT JOIN patients p
        ON p.id = b.patient_id
       AND p.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND lower(COALESCE(b.status, 'open')) <> 'draft'
    `,
    binds: [input.tenantId],
  };
}

async function buildCanonicalSourceSql(input: {
  db: D1Database;
  tenantId: string;
}): Promise<SourceSql> {
  const columns = await tableColumns(input.db, 'canonical_invoices');
  const mappingsAvailable = await tableExists(input.db, 'canonical_source_mappings');
  const creditedExpression = columns.has('credited_minor') ? 'ci.credited_minor' : '0';
  const dueExpression = columns.has('net_due_minor') ? 'ci.net_due_minor' : 'ci.due_minor';
  const legacyBillId = mappedLegacyBillExpression('ci', mappingsAvailable);

  return {
    sql: `
      SELECT
        ci.tenant_id,
        'canonical-invoice:' || ci.invoice_public_id AS source_key,
        ci.invoice_public_id AS canonical_invoice_public_id,
        ${legacyBillId} AS legacy_bill_id,
        ci.invoice_number,
        ci.legacy_patient_id AS patient_id,
        COALESCE(p.name, 'Unknown') AS patient_name,
        p.mobile AS patient_mobile,
        ci.currency_code,
        ci.total_minor,
        ci.paid_minor,
        ${creditedExpression} AS credited_minor,
        ${dueExpression} AS due_minor,
        ci.issued_at_utc,
        CASE
          WHEN ci.status = 'cancelled' THEN 'cancelled'
          WHEN ci.status = 'reversed' THEN 'reversed'
          WHEN ci.status = 'posted' AND ${dueExpression} <= 0 THEN 'paid'
          ELSE 'open'
        END AS financial_status,
        0 AS shadow_mismatch
      FROM canonical_invoices ci
      LEFT JOIN patients p
        ON p.id = ci.legacy_patient_id
       AND p.tenant_id = ci.tenant_id
      WHERE ci.tenant_id = ?
        AND ci.status <> 'draft'
    `,
    binds: [input.tenantId],
  };
}

function validateQuery(query: CollectionListQuery): void {
  if (!Number.isSafeInteger(query.page) || query.page < 1) {
    throw new Error('Collection page must be a positive integer');
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new Error('Collection limit must be an integer between 1 and 100');
  }
  if (query.assignee !== undefined && (!Number.isSafeInteger(query.assignee) || query.assignee <= 0)) {
    throw new Error('Collection assignee must be a positive integer');
  }
  for (const [field, value] of [
    ['minAmountMinor', query.minAmountMinor],
    ['maxAmountMinor', query.maxAmountMinor],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  if (
    query.minAmountMinor !== undefined
    && query.maxAmountMinor !== undefined
    && query.minAmountMinor > query.maxAmountMinor
  ) {
    throw new Error('minAmountMinor cannot exceed maxAmountMinor');
  }
}

function validateNowUtc(nowUtc: string): void {
  if (!nowUtc.endsWith('Z') || Number.isNaN(new Date(nowUtc).getTime())) {
    throw new Error('nowUtc must be a valid UTC timestamp');
  }
}

function buildFilter(query: CollectionListQuery): { sql: string; binds: unknown[] } {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  const status = query.status ?? 'active';

  if (status === 'active') {
    conditions.push("collection_status <> 'closed'", "financial_status = 'open'", 'due_minor > 0');
  } else if (status !== 'all') {
    conditions.push('collection_status = ?');
    binds.push(status);
    if (status !== 'closed') {
      conditions.push("financial_status = 'open'", 'due_minor > 0');
    }
  }

  if (query.assignee !== undefined) {
    conditions.push('assigned_to = ?');
    binds.push(query.assignee);
  }

  if (query.followup === 'due') {
    conditions.push('next_followup_at_utc IS NOT NULL', 'next_followup_at_utc <= as_of_utc');
  } else if (query.followup === 'upcoming') {
    conditions.push('next_followup_at_utc IS NOT NULL', 'next_followup_at_utc > as_of_utc');
  } else if (query.followup === 'none') {
    conditions.push('next_followup_at_utc IS NULL');
  }

  if (query.ageBucket === '0-7') {
    conditions.push('days_outstanding BETWEEN 0 AND 7');
  } else if (query.ageBucket === '8-30') {
    conditions.push('days_outstanding BETWEEN 8 AND 30');
  } else if (query.ageBucket === '31-60') {
    conditions.push('days_outstanding BETWEEN 31 AND 60');
  } else if (query.ageBucket === '60+') {
    conditions.push('days_outstanding > 60');
  }

  if (query.minAmountMinor !== undefined) {
    conditions.push('due_minor >= ?');
    binds.push(query.minAmountMinor);
  }
  if (query.maxAmountMinor !== undefined) {
    conditions.push('due_minor <= ?');
    binds.push(query.maxAmountMinor);
  }

  const search = query.search?.trim().toLowerCase();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`(
      lower(invoice_number) LIKE ?
      OR lower(patient_name) LIKE ?
      OR lower(COALESCE(patient_mobile, '')) LIKE ?
      OR lower(source_key) LIKE ?
    )`);
    binds.push(pattern, pattern, pattern, pattern);
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1 = 1',
    binds,
  };
}

function sortSql(sort: CollectionListQuery['sort']): string {
  if (sort === 'oldest') {
    return 'issued_at_utc ASC, source_key ASC';
  }
  if (sort === 'followup') {
    return `
      CASE WHEN next_followup_at_utc IS NULL THEN 1 ELSE 0 END ASC,
      next_followup_at_utc ASC,
      due_minor DESC,
      source_key ASC
    `;
  }
  return 'due_minor DESC, issued_at_utc ASC, source_key ASC';
}

function queryCte(source: SourceSql, filterSql: string): string {
  return `
    WITH receivables AS (
      ${source.sql}
    ),
    joined AS (
      SELECT
        r.*,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.id
          ELSE legacy_case.id
        END AS case_id,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.status
          WHEN legacy_case.id IS NOT NULL THEN legacy_case.status
          ELSE 'new'
        END AS collection_status,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.assigned_to
          ELSE legacy_case.assigned_to
        END AS assigned_to,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.next_followup_at_utc
          ELSE legacy_case.next_followup_at_utc
        END AS next_followup_at_utc,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.promise_date
          ELSE legacy_case.promise_date
        END AS promise_date,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.promise_amount_minor
          ELSE legacy_case.promise_amount_minor
        END AS promise_amount_minor,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.latest_note
          ELSE legacy_case.latest_note
        END AS latest_note,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.last_contacted_at_utc
          ELSE legacy_case.last_contacted_at_utc
        END AS last_contacted_at_utc,
        CASE
          WHEN canonical_case.id IS NOT NULL THEN canonical_case.updated_at_utc
          ELSE legacy_case.updated_at_utc
        END AS updated_at_utc,
        ? AS as_of_utc,
        MAX(0, COALESCE(CAST(julianday(?) - julianday(r.issued_at_utc) AS INTEGER), 0)) AS days_outstanding
      FROM receivables r
      LEFT JOIN collection_cases canonical_case
        ON r.canonical_invoice_public_id IS NOT NULL
       AND canonical_case.tenant_id = r.tenant_id
       AND canonical_case.canonical_invoice_public_id = r.canonical_invoice_public_id
      LEFT JOIN collection_cases legacy_case
        ON r.legacy_bill_id IS NOT NULL
       AND legacy_case.tenant_id = r.tenant_id
       AND legacy_case.legacy_bill_id = r.legacy_bill_id
    ),
    eligible AS (
      SELECT *
      FROM joined
      WHERE (financial_status = 'open' AND due_minor > 0)
         OR collection_status = 'closed'
    ),
    filtered AS (
      SELECT *
      FROM eligible
      WHERE ${filterSql}
    )
  `;
}

function safeInteger(value: unknown, field: string, options: { nullable?: boolean } = {}): number | null {
  if (value === null || value === undefined) {
    if (options.nullable) return null;
    throw new Error(`Collection query returned null ${field}`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`Collection query returned unsafe ${field}`);
  }
  return numeric;
}

function collectionStatus(value: string): CollectionStatus {
  if (!COLLECTION_STATUSES.has(value as CollectionStatus)) {
    throw new Error(`Collection query returned invalid status: ${value}`);
  }
  return value as CollectionStatus;
}

function financialStatus(value: string): ReceivableFinancialStatus {
  if (!FINANCIAL_STATUSES.has(value as ReceivableFinancialStatus)) {
    throw new Error(`Collection query returned invalid financial status: ${value}`);
  }
  return value as ReceivableFinancialStatus;
}

function mapQueueRow(row: QueueDbRow, mode: ReceivableAuthorityMode): CollectionQueueRow {
  const canonicalInvoicePublicId = row.canonicalInvoicePublicId?.trim() || undefined;
  const legacyBillId = safeInteger(row.legacyBillId, 'legacyBillId', { nullable: true }) ?? undefined;
  const source: ReceivableSourceRef = { sourceType: 'invoice' };
  if (canonicalInvoicePublicId) source.canonicalInvoicePublicId = canonicalInvoicePublicId;
  if (legacyBillId !== undefined && legacyBillId > 0) source.legacyBillId = legacyBillId;

  const sourceKey = mode === 'canonical'
    ? `canonical-invoice:${encodeURIComponent(canonicalInvoicePublicId ?? '')}`
    : `legacy-bill:${legacyBillId ?? ''}`;

  if (sourceKey.endsWith(':')) {
    throw new Error('Collection query returned an incomplete source identity');
  }

  return {
    source,
    sourceKey,
    caseId: safeInteger(row.caseId, 'caseId', { nullable: true }),
    invoiceNumber: row.invoiceNumber,
    patientId: safeInteger(row.patientId, 'patientId') as number,
    patientName: row.patientName,
    patientMobile: row.patientMobile,
    currencyCode: row.currencyCode,
    totalMinor: safeInteger(row.totalMinor, 'totalMinor') as number,
    paidMinor: safeInteger(row.paidMinor, 'paidMinor') as number,
    creditedMinor: safeInteger(row.creditedMinor, 'creditedMinor') as number,
    dueMinor: safeInteger(row.dueMinor, 'dueMinor') as number,
    issuedAtUtc: row.issuedAtUtc,
    financialStatus: financialStatus(row.financialStatus),
    collectionStatus: collectionStatus(row.collectionStatus),
    assignedTo: safeInteger(row.assignedTo, 'assignedTo', { nullable: true }),
    nextFollowupAtUtc: row.nextFollowupAtUtc,
    promiseDate: row.promiseDate,
    promiseAmountMinor: safeInteger(row.promiseAmountMinor, 'promiseAmountMinor', { nullable: true }),
    latestNote: row.latestNote,
    lastContactedAtUtc: row.lastContactedAtUtc,
    updatedAtUtc: row.updatedAtUtc,
    daysOutstanding: safeInteger(row.daysOutstanding, 'daysOutstanding') as number,
  };
}

export async function listCollectionCases(input: {
  db: D1Database;
  tenantId: string;
  query: CollectionListQuery;
  nowUtc?: string;
}): Promise<{
  data: CollectionQueueRow[];
  summary: CollectionSummary;
  pagination: PaginationMeta;
}> {
  validateQuery(input.query);
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  validateNowUtc(nowUtc);

  const authority = await resolveReceivableAuthority({
    db: input.db,
    tenantId: input.tenantId,
  });
  const source = authority.mode === 'canonical'
    ? await buildCanonicalSourceSql({ db: input.db, tenantId: input.tenantId })
    : await buildLegacySourceSql({
        db: input.db,
        tenantId: input.tenantId,
        shadow: authority.mode === 'shadow',
      });
  const filter = buildFilter(input.query);
  const cte = queryCte(source, filter.sql);
  const commonBinds = [...source.binds, nowUtc, nowUtc, ...filter.binds];

  const summaryStatement = input.db.prepare(`${cte}
    SELECT
      COUNT(*) AS "totalInvoices",
      COALESCE(SUM(CASE WHEN collection_status <> 'closed' AND next_followup_at_utc IS NOT NULL AND next_followup_at_utc <= as_of_utc THEN 1 ELSE 0 END), 0) AS "followupDue",
      COALESCE(SUM(CASE WHEN days_outstanding BETWEEN 0 AND 7 THEN 1 ELSE 0 END), 0) AS "currentCount",
      COALESCE(SUM(CASE WHEN days_outstanding BETWEEN 8 AND 30 THEN 1 ELSE 0 END), 0) AS "days30Count",
      COALESCE(SUM(CASE WHEN days_outstanding BETWEEN 31 AND 60 THEN 1 ELSE 0 END), 0) AS "days60Count",
      COALESCE(SUM(CASE WHEN days_outstanding > 60 THEN 1 ELSE 0 END), 0) AS "days90PlusCount",
      COUNT(DISTINCT currency_code) AS "currencyCount",
      COALESCE(SUM(shadow_mismatch), 0) AS "shadowMismatchCount"
    FROM filtered
  `).bind(...commonBinds);

  const currencySummaryStatement = input.db.prepare(`${cte}
    SELECT
      currency_code AS "currencyCode",
      COUNT(*) AS "totalInvoices",
      COALESCE(SUM(CASE WHEN financial_status = 'open' AND due_minor > 0 THEN due_minor ELSE 0 END), 0) AS "totalDueMinor",
      COALESCE(SUM(CASE WHEN financial_status = 'open' AND due_minor > 0 AND days_outstanding BETWEEN 0 AND 7 THEN due_minor ELSE 0 END), 0) AS "currentMinor",
      COALESCE(SUM(CASE WHEN financial_status = 'open' AND due_minor > 0 AND days_outstanding BETWEEN 8 AND 30 THEN due_minor ELSE 0 END), 0) AS "days30Minor",
      COALESCE(SUM(CASE WHEN financial_status = 'open' AND due_minor > 0 AND days_outstanding BETWEEN 31 AND 60 THEN due_minor ELSE 0 END), 0) AS "days60Minor",
      COALESCE(SUM(CASE WHEN financial_status = 'open' AND due_minor > 0 AND days_outstanding > 60 THEN due_minor ELSE 0 END), 0) AS "days90PlusMinor",
      COALESCE(SUM(CASE WHEN collection_status = 'promised' THEN COALESCE(promise_amount_minor, 0) ELSE 0 END), 0) AS "promisedAmountMinor",
      COALESCE(SUM(CASE WHEN collection_status = 'disputed' AND financial_status = 'open' THEN due_minor ELSE 0 END), 0) AS "disputedAmountMinor"
    FROM filtered
    GROUP BY currency_code
    ORDER BY currency_code ASC
  `).bind(...commonBinds);

  const offset = (input.query.page - 1) * input.query.limit;
  const pageStatement = input.db.prepare(`${cte}
    SELECT
      source_key AS "sourceKey",
      canonical_invoice_public_id AS "canonicalInvoicePublicId",
      legacy_bill_id AS "legacyBillId",
      invoice_number AS "invoiceNumber",
      patient_id AS "patientId",
      patient_name AS "patientName",
      patient_mobile AS "patientMobile",
      currency_code AS "currencyCode",
      total_minor AS "totalMinor",
      paid_minor AS "paidMinor",
      credited_minor AS "creditedMinor",
      due_minor AS "dueMinor",
      issued_at_utc AS "issuedAtUtc",
      financial_status AS "financialStatus",
      case_id AS "caseId",
      collection_status AS "collectionStatus",
      assigned_to AS "assignedTo",
      next_followup_at_utc AS "nextFollowupAtUtc",
      promise_date AS "promiseDate",
      promise_amount_minor AS "promiseAmountMinor",
      latest_note AS "latestNote",
      last_contacted_at_utc AS "lastContactedAtUtc",
      updated_at_utc AS "updatedAtUtc",
      days_outstanding AS "daysOutstanding"
    FROM filtered
    ORDER BY ${sortSql(input.query.sort)}
    LIMIT ? OFFSET ?
  `).bind(...commonBinds, input.query.limit, offset);

  const [summaryResult, currencySummaryResult, pageResult] = await input.db.batch([
    summaryStatement,
    currencySummaryStatement,
    pageStatement,
  ]) as [
    D1Result<SummaryRow>,
    D1Result<CurrencySummaryRow>,
    D1Result<QueueDbRow>,
  ];

  const summaryRow = summaryResult.results?.[0] ?? {
    totalInvoices: 0,
    followupDue: 0,
    currentCount: 0,
    days30Count: 0,
    days60Count: 0,
    days90PlusCount: 0,
    currencyCount: 0,
    shadowMismatchCount: 0,
  };
  const total = safeInteger(summaryRow.totalInvoices, 'totalInvoices') as number;
  const currencyCount = safeInteger(summaryRow.currencyCount, 'currencyCount') as number;
  const amountsByCurrency: CollectionCurrencySummary[] = (currencySummaryResult.results ?? []).map((row) => ({
    currencyCode: row.currencyCode,
    totalDueMinor: safeInteger(row.totalDueMinor, 'currency.totalDueMinor') as number,
    totalInvoices: safeInteger(row.totalInvoices, 'currency.totalInvoices') as number,
    currentMinor: safeInteger(row.currentMinor, 'currency.currentMinor') as number,
    days30Minor: safeInteger(row.days30Minor, 'currency.days30Minor') as number,
    days60Minor: safeInteger(row.days60Minor, 'currency.days60Minor') as number,
    days90PlusMinor: safeInteger(row.days90PlusMinor, 'currency.days90PlusMinor') as number,
    promisedAmountMinor: safeInteger(row.promisedAmountMinor, 'currency.promisedAmountMinor') as number,
    disputedAmountMinor: safeInteger(row.disputedAmountMinor, 'currency.disputedAmountMinor') as number,
  }));
  const flatAmounts = currencyCount === 1 ? amountsByCurrency[0] : null;
  const noCurrencyRows = currencyCount === 0;

  return {
    data: (pageResult.results ?? []).map((row) => mapQueueRow(row, authority.mode)),
    summary: {
      totalDueMinor: noCurrencyRows ? 0 : flatAmounts?.totalDueMinor ?? null,
      totalInvoices: total,
      currentMinor: noCurrencyRows ? 0 : flatAmounts?.currentMinor ?? null,
      days30Minor: noCurrencyRows ? 0 : flatAmounts?.days30Minor ?? null,
      days60Minor: noCurrencyRows ? 0 : flatAmounts?.days60Minor ?? null,
      days90PlusMinor: noCurrencyRows ? 0 : flatAmounts?.days90PlusMinor ?? null,
      followupDue: safeInteger(summaryRow.followupDue, 'followupDue') as number,
      promisedAmountMinor: noCurrencyRows ? 0 : flatAmounts?.promisedAmountMinor ?? null,
      disputedAmountMinor: noCurrencyRows ? 0 : flatAmounts?.disputedAmountMinor ?? null,
      currencyCode: flatAmounts?.currencyCode ?? null,
      amountsByCurrency,
      supportedSourceTypes: ['invoice'],
      authorityMode: authority.mode,
      shadowMismatchCount: safeInteger(summaryRow.shadowMismatchCount, 'shadowMismatchCount') as number,
      agingCounts: {
        '0-7': safeInteger(summaryRow.currentCount, 'aging.currentCount') as number,
        '8-30': safeInteger(summaryRow.days30Count, 'aging.days30Count') as number,
        '31-60': safeInteger(summaryRow.days60Count, 'aging.days60Count') as number,
        '60+': safeInteger(summaryRow.days90PlusCount, 'aging.days90PlusCount') as number,
      },
    },
    pagination: {
      page: input.query.page,
      limit: input.query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / input.query.limit),
    },
  };
}
