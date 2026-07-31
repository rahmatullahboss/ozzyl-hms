import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import {
  getCanonicalDoctorPerformance,
  type CanonicalDoctorPerformanceRole,
} from '../../lib/canonical/reporting/doctor-performance';
import { getCanonicalTestPerformance } from '../../lib/canonical/reporting/test-performance';
import { getCanonicalDoctorCompensation } from '../../lib/canonical/reporting/doctor-compensation';
import { getCanonicalCollectionsReport } from '../../lib/canonical/reporting/collections';
import { getCanonicalIpdFinanceReport } from '../../lib/canonical/reporting/ipd-finance';
import type { CanonicalReportingDatabase } from '../../lib/canonical/reporting/common';
import type { CanonicalIpdProjectionDatabase } from '../../lib/canonical/ipd-projection';
import type { Env, Variables } from '../../types';

const canonicalReporting = new Hono<{ Bindings: Env; Variables: Variables }>();

const REPORTING_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;
const REPORTING_FLAG_KEY = 'canonical_reporting_v1';
const METRIC_COUNT = 10;
const DOCTOR_ROLES = new Set<CanonicalDoctorPerformanceRole>([
  'performing',
  'referring',
  'prescribing',
  'reporting',
]);

type ReportingMode = 'shadow' | 'canonical';

interface ReportingQuery {
  startDate: string;
  endDate: string;
  timeZone: string;
}

function parseMode(value: string | null | undefined): ReportingMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'shadow' || normalized === 'canonical') return normalized;
  return null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function parseReportingQuery(
  query: (name: string) => string | undefined,
): ReportingQuery {
  const startDate = query('startDate') ?? '';
  const endDate = query('endDate') ?? '';
  const timeZone = query('timeZone') ?? '';
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new HTTPException(400, {
      message: 'startDate and endDate must use YYYY-MM-DD',
    });
  }
  if (startDate > endDate) {
    throw new HTTPException(400, {
      message: 'startDate must be on or before endDate',
    });
  }
  if (!timeZone || !validTimeZone(timeZone)) {
    throw new HTTPException(400, { message: 'timeZone must be a valid IANA zone' });
  }
  return { startDate, endDate, timeZone };
}

async function reportingMode(
  db: CanonicalReportingDatabase,
  tenantId: string,
): Promise<ReportingMode> {
  let flag: { mode: string; is_enabled: number } | null;
  try {
    flag = await db.prepare(`
      SELECT mode,is_enabled
      FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=?
        AND (effective_at_utc IS NULL OR effective_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND (expires_at_utc IS NULL OR expires_at_utc >= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY version DESC,id DESC
      LIMIT 1
    `).bind(tenantId, REPORTING_FLAG_KEY).first<{
      mode: string;
      is_enabled: number;
    }>();
  } catch (error) {
    if (canonicalUnavailable(error)) {
      throw new HTTPException(404, { message: 'Not found' });
    }
    throw error;
  }
  const mode = flag?.is_enabled === 1 ? parseMode(flag.mode) : null;
  if (!mode) throw new HTTPException(404, { message: 'Not found' });
  return mode;
}

function canonicalUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*canonical_/i.test(message);
}

async function canonicalResponse<T>(
  operation: () => Promise<T>,
  mode: ReportingMode,
): Promise<{
  data: T;
  canonical: true;
  mode: ReportingMode;
  readOnly: true;
  activeRouteSwitched: false;
}> {
  try {
    return {
      data: await operation(),
      canonical: true,
      mode,
      readOnly: true,
      activeRouteSwitched: false,
    };
  } catch (error) {
    if (canonicalUnavailable(error)) {
      throw new HTTPException(503, {
        message: 'Canonical reporting schema is not available',
      });
    }
    if (error instanceof RangeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
}

canonicalReporting.use('*', requireRole(...REPORTING_ROLES));

canonicalReporting.get('/status', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalReportingDatabase;
  const mode = await reportingMode(db, tenantId);
  return c.json({
    data: {
      mode,
      metricCount: METRIC_COUNT,
      readOnly: true,
      activeRouteSwitched: false,
    },
    canonical: true,
  });
});

canonicalReporting.get('/doctor-performance', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalReportingDatabase;
  const mode = await reportingMode(db, tenantId);
  const query = parseReportingQuery((name) => c.req.query(name));
  const role = c.req.query('role') as CanonicalDoctorPerformanceRole | undefined;
  if (!role || !DOCTOR_ROLES.has(role)) {
    throw new HTTPException(400, {
      message: 'role must be performing, referring, prescribing, or reporting',
    });
  }
  return c.json(await canonicalResponse(
    () => getCanonicalDoctorPerformance(db, {
      tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
      practitionerRole: role,
    }),
    mode,
  ));
});

canonicalReporting.get('/doctor-compensation', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalReportingDatabase;
  const mode = await reportingMode(db, tenantId);
  const query = parseReportingQuery((name) => c.req.query(name));
  return c.json(await canonicalResponse(
    () => getCanonicalDoctorCompensation(db, {
      tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
    }),
    mode,
  ));
});

canonicalReporting.get('/test-performance', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalReportingDatabase;
  const mode = await reportingMode(db, tenantId);
  const query = parseReportingQuery((name) => c.req.query(name));
  return c.json(await canonicalResponse(
    () => getCanonicalTestPerformance(db, {
      tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
    }),
    mode,
  ));
});

canonicalReporting.get('/collections', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB as unknown as CanonicalReportingDatabase;
  const mode = await reportingMode(db, tenantId);
  const query = parseReportingQuery((name) => c.req.query(name));
  const currencyCode = c.req.query('currencyCode') ?? '';
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new HTTPException(400, {
      message: 'currencyCode must use three uppercase letters',
    });
  }
  return c.json(await canonicalResponse(
    () => getCanonicalCollectionsReport(db, {
      tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
      currencyCode,
    }),
    mode,
  ));
});

canonicalReporting.get('/ipd-finance', async (c) => {
  const tenantId = requireTenantId(c);
  const reportingDb = c.env.DB as unknown as CanonicalReportingDatabase;
  const projectionDb = c.env.DB as unknown as CanonicalIpdProjectionDatabase;
  const mode = await reportingMode(reportingDb, tenantId);
  const query = parseReportingQuery((name) => c.req.query(name));
  const currencyCode = c.req.query('currencyCode') ?? '';
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new HTTPException(400, {
      message: 'currencyCode must use three uppercase letters',
    });
  }
  return c.json(await canonicalResponse(
    () => getCanonicalIpdFinanceReport(projectionDb, {
      tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
      timeZone: query.timeZone,
      currencyCode,
      includeCompleted: true,
      includeLegacyComparison: false,
    }),
    mode,
  ));
});

export default canonicalReporting;
