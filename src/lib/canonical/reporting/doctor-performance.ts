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
  type CanonicalReportingPreparedStatement,
} from './common';

export type CanonicalDoctorPerformancePreparedStatement = CanonicalReportingPreparedStatement;
export type CanonicalDoctorPerformanceDatabase = CanonicalReportingDatabase;

export type CanonicalDoctorPerformanceRole =
  | 'performing'
  | 'referring'
  | 'prescribing'
  | 'reporting';

export interface CanonicalDoctorPerformanceInput {
  tenantId: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  practitionerRole: CanonicalDoctorPerformanceRole;
}

export interface CanonicalDoctorPerformanceRow {
  practitionerPublicId: string;
  displayName: string;
  practitionerRole: CanonicalDoctorPerformanceRole;
  currencyCode: string | null;
  eventCount: number;
  quantity: number;
  billedMinor: number;
  compensationEarnedMinor: number;
}

export interface CanonicalDoctorPerformanceReport {
  rows: CanonicalDoctorPerformanceRow[];
  summary: {
    practitionerCount: number;
    eventCount: number;
    quantity: number;
    billedByCurrency: Record<string, number>;
    compensationByCurrency: Record<string, number>;
  };
  queryContract: {
    explicitPractitionerRole: CanonicalDoctorPerformanceRole;
    dateBasis: 'service_event_or_compensation_accrual_tenant_business_date';
    readOnly: true;
  };
}

interface SourceRow {
  event_public_id: string;
  request_public_id: string | null;
  service_public_id: string;
  occurred_at_utc: string;
  quantity: number;
  practitioner_public_id: string;
  display_name: string;
  currency_code: string | null;
  billed_minor: number | null;
  compensation_earned_minor: number | null;
}

interface EventContribution {
  identity: string;
  eventPublicId: string;
  occurredAtUtc: string;
  practitionerPublicId: string;
  displayName: string;
  currencyCode: string | null;
  quantity: number;
  billedMinor: number;
  compensationEarnedMinor: number;
}

const ELIGIBLE_EVENT_TYPES = ['accepted', 'delivered', 'completed', 'dispensed', 'occupied'] as const;

function role(value: string): CanonicalDoctorPerformanceRole {
  if (!['performing', 'referring', 'prescribing', 'reporting'].includes(value)) {
    throw new RangeError('practitionerRole is not supported by canonical doctor performance');
  }
  return value as CanonicalDoctorPerformanceRole;
}

function contributionIdentity(row: SourceRow): string {
  return `${row.request_public_id ?? row.event_public_id}|${row.service_public_id}|${row.practitioner_public_id}`;
}

export async function getCanonicalDoctorPerformance(
  db: CanonicalDoctorPerformanceDatabase,
  input: CanonicalDoctorPerformanceInput,
): Promise<CanonicalDoctorPerformanceReport> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const range = reportingRange(input.startDate, input.endDate);
  const practitionerRole = role(input.practitionerRole);
  const timeZone = exact(input.timeZone, 'timeZone');
  const envelope = utcEnvelope(range.startDate, range.endDate);
  const placeholders = ELIGIBLE_EVENT_TYPES.map(() => '?').join(',');

  const sourceRows = await all<SourceRow>(db.prepare(`
    WITH exact_participants AS (
      SELECT DISTINCT
        e.tenant_id,
        e.event_public_id,
        e.request_public_id,
        e.service_public_id,
        sp.practitioner_public_id
      FROM canonical_service_events e
      LEFT JOIN canonical_service_requests sr
        ON sr.tenant_id=e.tenant_id AND sr.request_public_id=e.request_public_id
      JOIN canonical_service_participants sp
        ON sp.tenant_id=e.tenant_id
       AND sp.participant_role=?
       AND (
         (sp.event_public_id=e.event_public_id AND sp.request_public_id IS NULL)
         OR (
           e.request_public_id IS NOT NULL
           AND sp.request_public_id=e.request_public_id
           AND sp.event_public_id IS NULL
         )
       )
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
        AND e.occurred_at_utc>=?
        AND e.occurred_at_utc<?
    ),
    event_contributions AS (
      SELECT
        e.event_public_id,
        e.request_public_id,
        e.service_public_id,
        e.occurred_at_utc,
        e.quantity,
        p.practitioner_public_id,
        p.display_name,
        COALESCE(i.currency_code,(
          SELECT MIN(c.currency_code)
          FROM canonical_compensation_accruals c
          WHERE c.tenant_id=e.tenant_id
            AND (
              c.service_event_public_id=e.event_public_id
              OR (
                c.service_event_public_id IS NULL
                AND il.line_public_id IS NOT NULL
                AND c.invoice_line_public_id=il.line_public_id
              )
            )
            AND c.practitioner_public_id=p.practitioner_public_id
            AND c.practitioner_role=?
            AND c.status NOT IN ('cancelled','reversed')
        )) currency_code,
        CASE WHEN i.invoice_public_id IS NULL THEN 0 ELSE COALESCE(il.line_amount_minor,0) END billed_minor,
        COALESCE((
          SELECT SUM(c.earned_minor)
          FROM canonical_compensation_accruals c
          WHERE c.tenant_id=e.tenant_id
            AND (
              c.service_event_public_id=e.event_public_id
              OR (
                c.service_event_public_id IS NULL
                AND il.line_public_id IS NOT NULL
                AND c.invoice_line_public_id=il.line_public_id
              )
            )
            AND c.practitioner_public_id=p.practitioner_public_id
            AND c.practitioner_role=?
            AND c.status NOT IN ('cancelled','reversed')
        ),0) compensation_earned_minor
      FROM exact_participants ep
      JOIN canonical_service_events e
        ON e.tenant_id=ep.tenant_id AND e.event_public_id=ep.event_public_id
      JOIN canonical_practitioners p
        ON p.tenant_id=ep.tenant_id AND p.practitioner_public_id=ep.practitioner_public_id
      LEFT JOIN canonical_invoice_lines il
        ON il.tenant_id=e.tenant_id
       AND il.service_event_public_id=e.event_public_id
       AND il.line_type='service'
      LEFT JOIN canonical_invoices i
        ON i.tenant_id=il.tenant_id
       AND i.invoice_public_id=il.invoice_public_id
       AND i.status='posted'
    )
    SELECT * FROM event_contributions
    UNION ALL
    SELECT
      c.accrual_public_id event_public_id,
      NULL request_public_id,
      COALESCE(e.service_public_id,c.invoice_line_public_id) service_public_id,
      c.accrued_at_utc occurred_at_utc,
      COALESCE(il.quantity,1) quantity,
      p.practitioner_public_id,
      p.display_name,
      c.currency_code,
      MAX(0,c.gross_minor-c.discount_minor) billed_minor,
      c.earned_minor compensation_earned_minor
    FROM canonical_compensation_accruals c
    JOIN canonical_practitioners p
      ON p.tenant_id=c.tenant_id
     AND p.practitioner_public_id=c.practitioner_public_id
    JOIN canonical_invoice_lines il
      ON il.tenant_id=c.tenant_id
     AND il.invoice_public_id=c.invoice_public_id
     AND il.line_public_id=c.invoice_line_public_id
    JOIN canonical_invoices i
      ON i.tenant_id=il.tenant_id
     AND i.invoice_public_id=il.invoice_public_id
     AND i.status='posted'
    LEFT JOIN canonical_service_events e
      ON e.tenant_id=c.tenant_id
     AND e.event_public_id=COALESCE(c.service_event_public_id,il.service_event_public_id)
    WHERE c.tenant_id=?
      AND c.practitioner_role=?
      AND c.status NOT IN ('cancelled','reversed')
      AND c.accrued_at_utc>=?
      AND c.accrued_at_utc<?
      AND NOT EXISTS (
        SELECT 1
        FROM exact_participants ep
        WHERE ep.event_public_id=COALESCE(c.service_event_public_id,il.service_event_public_id)
          AND ep.practitioner_public_id=c.practitioner_public_id
      )
    ORDER BY occurred_at_utc,event_public_id,practitioner_public_id
  `).bind(
    practitionerRole,
    tenantId,
    ...ELIGIBLE_EVENT_TYPES,
    envelope.startUtc,
    envelope.endExclusiveUtc,
    practitionerRole,
    practitionerRole,
    tenantId,
    practitionerRole,
    envelope.startUtc,
    envelope.endExclusiveUtc,
  ));

  const latestByIdentity = new Map<string, EventContribution>();
  for (const row of sourceRows) {
    if (!isInBusinessDateRange(row.occurred_at_utc, timeZone, range.startDate, range.endDate)) continue;
    const contribution: EventContribution = {
      identity: contributionIdentity(row),
      eventPublicId: row.event_public_id,
      occurredAtUtc: row.occurred_at_utc,
      practitionerPublicId: exact(row.practitioner_public_id, 'practitionerPublicId'),
      displayName: exact(row.display_name, 'displayName'),
      currencyCode: row.currency_code,
      quantity: safeNonNegativeInteger(row.quantity, 'service event quantity'),
      billedMinor: safeNonNegativeInteger(row.billed_minor, 'billed amount'),
      compensationEarnedMinor: safeNonNegativeInteger(row.compensation_earned_minor, 'compensation earned amount'),
    };
    const current = latestByIdentity.get(contribution.identity);
    if (
      !current
      || contribution.occurredAtUtc > current.occurredAtUtc
      || (
        contribution.occurredAtUtc === current.occurredAtUtc
        && contribution.eventPublicId > current.eventPublicId
      )
    ) {
      latestByIdentity.set(contribution.identity, contribution);
    }
  }

  const grouped = new Map<string, CanonicalDoctorPerformanceRow>();
  for (const contribution of latestByIdentity.values()) {
    const key = `${contribution.practitionerPublicId}|${contribution.currencyCode ?? ''}`;
    const row = grouped.get(key) ?? {
      practitionerPublicId: contribution.practitionerPublicId,
      displayName: contribution.displayName,
      practitionerRole,
      currencyCode: contribution.currencyCode,
      eventCount: 0,
      quantity: 0,
      billedMinor: 0,
      compensationEarnedMinor: 0,
    };
    row.eventCount = addSafe(row.eventCount, 1, 'doctor event count');
    row.quantity = addSafe(row.quantity, contribution.quantity, 'doctor service quantity');
    row.billedMinor = addSafe(row.billedMinor, contribution.billedMinor, 'doctor billed amount');
    row.compensationEarnedMinor = addSafe(
      row.compensationEarnedMinor,
      contribution.compensationEarnedMinor,
      'doctor compensation amount',
    );
    grouped.set(key, row);
  }

  const rows = [...grouped.values()].sort((left, right) => (
    right.billedMinor - left.billedMinor
    || left.displayName.localeCompare(right.displayName)
    || left.practitionerPublicId.localeCompare(right.practitionerPublicId)
  ));
  const summary: CanonicalDoctorPerformanceReport['summary'] = {
    practitionerCount: new Set(rows.map((row) => row.practitionerPublicId)).size,
    eventCount: 0,
    quantity: 0,
    billedByCurrency: {},
    compensationByCurrency: {},
  };
  for (const row of rows) {
    summary.eventCount = addSafe(summary.eventCount, row.eventCount, 'doctor summary event count');
    summary.quantity = addSafe(summary.quantity, row.quantity, 'doctor summary quantity');
    if (row.currencyCode) {
      addCurrencyAmount(summary.billedByCurrency, row.currencyCode, row.billedMinor, 'doctor billed summary');
      addCurrencyAmount(
        summary.compensationByCurrency,
        row.currencyCode,
        row.compensationEarnedMinor,
        'doctor compensation summary',
      );
    }
  }

  return {
    rows,
    summary,
    queryContract: {
      explicitPractitionerRole: practitionerRole,
      dateBasis: 'service_event_or_compensation_accrual_tenant_business_date',
      readOnly: true,
    },
  };
}
