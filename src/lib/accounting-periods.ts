import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';
import { recordAccountingAudit } from './accounting-hardening';

interface FiscalYearPeriodParams {
  tenantId: string;
  fiscalYearId: number;
  fiscalYearName?: string;
  startDate: string;
  endDate: string;
  userId: string | number;
  remark?: string;
}

function parseYearMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) {
    throw new Error(`Invalid accounting period date: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function toPeriodName(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function nextPeriod(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function comparePeriod(a: { year: number; month: number }, b: { year: number; month: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function lastDateOfPeriod(periodName: string): string {
  const { year, month } = parseYearMonth(periodName);
  const lastDate = new Date(Date.UTC(year, month, 0));
  return lastDate.toISOString().slice(0, 10);
}

export function listFiscalYearPeriodNames(startDate: string, endDate: string): string[] {
  const start = parseYearMonth(startDate);
  const end = parseYearMonth(endDate);
  const periods: string[] = [];
  let cursor = start;

  while (comparePeriod(cursor, end) <= 0) {
    periods.push(toPeriodName(cursor.year, cursor.month));
    cursor = nextPeriod(cursor.year, cursor.month);
  }

  return periods;
}

export function buildCloseFiscalYearPeriodStatements(
  db: D1Database,
  params: FiscalYearPeriodParams,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const periodName of listFiscalYearPeriodNames(params.startDate, params.endDate)) {
    const closeDate = lastDateOfPeriod(periodName);
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO accounting_period_closes
          (tenant_id, fiscal_year_id, period_name, close_date, closed_at, closed_by, status)
        VALUES (?, ?, ?, ?, datetime('now', '+6 hours'), ?, 'closed')
      `).bind(
        params.tenantId,
        params.fiscalYearId,
        periodName,
        closeDate,
        String(params.userId),
      ),
      db.prepare(`
        UPDATE accounting_period_closes
        SET status = 'closed',
            close_date = ?,
            closed_at = datetime('now', '+6 hours'),
            closed_by = ?
        WHERE tenant_id = ?
          AND fiscal_year_id = ?
          AND period_name = ?
          AND status = 'open'
      `).bind(
        closeDate,
        String(params.userId),
        params.tenantId,
        params.fiscalYearId,
        periodName,
      ),
    );
  }

  return statements;
}

export async function closeFiscalYearAccountingPeriods(
  db: D1Database,
  params: FiscalYearPeriodParams,
): Promise<void> {
  const statements = buildCloseFiscalYearPeriodStatements(db, params);
  for (const statement of statements) {
    await statement.run();
  }

  await recordAccountingAudit(db, {
    tenantId: params.tenantId,
    entityType: 'period',
    entityId: String(params.fiscalYearId),
    action: 'close',
    newValue: {
      fiscalYearName: params.fiscalYearName,
      startDate: params.startDate,
      endDate: params.endDate,
      periods: listFiscalYearPeriodNames(params.startDate, params.endDate),
    },
    performedBy: String(params.userId),
  });
}

export async function reopenFiscalYearAccountingPeriods(
  db: D1Database,
  params: FiscalYearPeriodParams,
): Promise<void> {
  const audited = await db.prepare(`
    SELECT period_name
    FROM accounting_period_closes
    WHERE tenant_id = ?
      AND fiscal_year_id = ?
      AND status = 'audited'
    ORDER BY period_name
    LIMIT 1
  `).bind(params.tenantId, params.fiscalYearId).first<{ period_name: string }>();

  if (audited) {
    throw new HTTPException(409, {
      message: `Fiscal year contains audited accounting period ${audited.period_name}; audited periods cannot be reopened.`,
    });
  }

  await db.prepare(`
    UPDATE accounting_period_closes
    SET status = 'open'
    WHERE tenant_id = ?
      AND fiscal_year_id = ?
      AND status = 'closed'
  `).bind(params.tenantId, params.fiscalYearId).run();

  await recordAccountingAudit(db, {
    tenantId: params.tenantId,
    entityType: 'period',
    entityId: String(params.fiscalYearId),
    action: 'update',
    oldValue: { status: 'closed' },
    newValue: {
      status: 'open',
      fiscalYearName: params.fiscalYearName,
      remark: params.remark,
      periods: listFiscalYearPeriodNames(params.startDate, params.endDate),
    },
    performedBy: String(params.userId),
  });
}
