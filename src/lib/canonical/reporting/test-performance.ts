import { deriveBusinessDate } from '../time';
import {
  addCurrencyAmount,
  addSafe,
  all,
  exact,
  isInBusinessDateRange,
  reportingRange,
  safeNonNegativeInteger,
  utcEnvelope,
  type CanonicalReportingDatabase,
} from './common';

export interface CanonicalTestPerformanceInput {
  tenantId: string;
  startDate: string;
  endDate: string;
  timeZone: string;
}

export interface CanonicalTestPerformanceRow {
  serviceEventPublicId: string;
  requestPublicId: string | null;
  servicePublicId: string;
  displayName: string;
  itemKind: 'laboratory' | 'radiology';
  quantity: number;
  occurredAtUtc: string;
  businessDate: string;
  performerPublicIds: string[];
  invoicePublicId: string | null;
  invoiceLinePublicId: string | null;
  billedMinor: number;
  currencyCode: string | null;
}

export interface CanonicalTestPerformanceReport {
  rows: CanonicalTestPerformanceRow[];
  summary: {
    eventCount: number;
    quantity: number;
    billedByCurrency: Record<string, number>;
    unbilledQuantity: number;
  };
  queryContract: {
    eventIdentity: 'latest_posted_event_per_request_and_service_or_standalone_event';
    statusFilter: 'posted_non_cancelled_non_reversed';
    dateBasis: 'service_event_occurred_at_tenant_business_date';
    readOnly: true;
  };
}

interface SourceRow {
  event_public_id: string;
  request_public_id: string | null;
  service_public_id: string;
  display_name: string;
  item_kind: 'laboratory' | 'radiology';
  quantity: number;
  occurred_at_utc: string;
  performer_public_ids: string | null;
  invoice_public_id: string | null;
  invoice_line_public_id: string | null;
  billed_minor: number | null;
  currency_code: string | null;
}

const ELIGIBLE_EVENT_TYPES = ['accepted', 'delivered', 'completed'] as const;

function identity(row: SourceRow): string {
  return `${row.request_public_id ?? row.event_public_id}|${row.service_public_id}`;
}

export async function getCanonicalTestPerformance(
  db: CanonicalReportingDatabase,
  input: CanonicalTestPerformanceInput,
): Promise<CanonicalTestPerformanceReport> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const range = reportingRange(input.startDate, input.endDate);
  const timeZone = exact(input.timeZone, 'timeZone');
  const envelope = utcEnvelope(range.startDate, range.endDate);
  const placeholders = ELIGIBLE_EVENT_TYPES.map(() => '?').join(',');

  const sourceRows = await all<SourceRow>(db.prepare(`
    SELECT
      e.event_public_id,
      e.request_public_id,
      e.service_public_id,
      s.display_name,
      s.item_kind,
      e.quantity,
      e.occurred_at_utc,
      (
        SELECT GROUP_CONCAT(practitioner_public_id, ',')
        FROM (
          SELECT DISTINCT sp.practitioner_public_id
          FROM canonical_service_participants sp
          WHERE sp.tenant_id=e.tenant_id
            AND sp.participant_role='performing'
            AND (
              (sp.event_public_id=e.event_public_id AND sp.request_public_id IS NULL)
              OR (
                e.request_public_id IS NOT NULL
                AND sp.request_public_id=e.request_public_id
                AND sp.event_public_id IS NULL
              )
            )
          ORDER BY sp.practitioner_public_id
        )
      ) performer_public_ids,
      i.invoice_public_id,
      CASE WHEN i.invoice_public_id IS NULL THEN NULL ELSE il.line_public_id END invoice_line_public_id,
      CASE WHEN i.invoice_public_id IS NULL THEN 0 ELSE COALESCE(il.line_amount_minor,0) END billed_minor,
      i.currency_code
    FROM canonical_service_events e
    LEFT JOIN canonical_service_requests sr
      ON sr.tenant_id=e.tenant_id AND sr.request_public_id=e.request_public_id
    JOIN canonical_service_catalog_items s
      ON s.tenant_id=e.tenant_id AND s.service_public_id=e.service_public_id
    LEFT JOIN canonical_invoice_lines il
      ON il.tenant_id=e.tenant_id
     AND il.service_event_public_id=e.event_public_id
     AND il.line_type='service'
    LEFT JOIN canonical_invoices i
      ON i.tenant_id=il.tenant_id
     AND i.invoice_public_id=il.invoice_public_id
     AND i.status='posted'
    WHERE e.tenant_id=?
      AND (
        e.request_public_id IS NULL
        OR sr.last_event_public_id=e.event_public_id
        OR (
          sr.last_event_public_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM canonical_service_events newer
            WHERE newer.tenant_id=e.tenant_id
              AND newer.request_public_id=e.request_public_id
              AND newer.service_public_id=e.service_public_id
              AND (
                newer.occurred_at_utc>e.occurred_at_utc
                OR (newer.occurred_at_utc=e.occurred_at_utc AND newer.event_public_id>e.event_public_id)
              )
          )
        )
      )
      AND e.status='posted'
      AND e.event_type IN (${placeholders})
      AND s.item_kind IN ('laboratory','radiology')
      AND e.occurred_at_utc>=?
      AND e.occurred_at_utc<?
    ORDER BY e.occurred_at_utc,e.event_public_id
  `).bind(
    tenantId,
    ...ELIGIBLE_EVENT_TYPES,
    envelope.startUtc,
    envelope.endExclusiveUtc,
  ));

  const latest = new Map<string, SourceRow>();
  for (const row of sourceRows) {
    if (!isInBusinessDateRange(row.occurred_at_utc, timeZone, range.startDate, range.endDate)) continue;
    const key = identity(row);
    const current = latest.get(key);
    if (
      !current
      || row.occurred_at_utc > current.occurred_at_utc
      || (row.occurred_at_utc === current.occurred_at_utc && row.event_public_id > current.event_public_id)
    ) latest.set(key, row);
  }

  const rows = [...latest.values()]
    .map<CanonicalTestPerformanceRow>((row) => ({
      serviceEventPublicId: exact(row.event_public_id, 'serviceEventPublicId'),
      requestPublicId: row.request_public_id,
      servicePublicId: exact(row.service_public_id, 'servicePublicId'),
      displayName: exact(row.display_name, 'displayName'),
      itemKind: row.item_kind,
      quantity: safeNonNegativeInteger(row.quantity, 'diagnostic quantity'),
      occurredAtUtc: exact(row.occurred_at_utc, 'occurredAtUtc'),
      businessDate: deriveBusinessDate(row.occurred_at_utc, timeZone),
      performerPublicIds: row.performer_public_ids
        ? [...new Set(row.performer_public_ids.split(',').filter(Boolean))]
        : [],
      invoicePublicId: row.invoice_public_id,
      invoiceLinePublicId: row.invoice_line_public_id,
      billedMinor: safeNonNegativeInteger(row.billed_minor, 'diagnostic billed amount'),
      currencyCode: row.currency_code,
    }))
    .sort((left, right) => (
      left.occurredAtUtc.localeCompare(right.occurredAtUtc)
      || left.serviceEventPublicId.localeCompare(right.serviceEventPublicId)
    ));

  const summary: CanonicalTestPerformanceReport['summary'] = {
    eventCount: rows.length,
    quantity: 0,
    billedByCurrency: {},
    unbilledQuantity: 0,
  };
  for (const row of rows) {
    summary.quantity = addSafe(summary.quantity, row.quantity, 'diagnostic summary quantity');
    if (row.invoiceLinePublicId && row.currencyCode) {
      addCurrencyAmount(summary.billedByCurrency, row.currencyCode, row.billedMinor, 'diagnostic billed summary');
    } else {
      summary.unbilledQuantity = addSafe(summary.unbilledQuantity, row.quantity, 'diagnostic unbilled quantity');
    }
  }

  return {
    rows,
    summary,
    queryContract: {
      eventIdentity: 'latest_posted_event_per_request_and_service_or_standalone_event',
      statusFilter: 'posted_non_cancelled_non_reversed',
      dateBasis: 'service_event_occurred_at_tenant_business_date',
      readOnly: true,
    },
  };
}
