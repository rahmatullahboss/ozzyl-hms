import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';
import { createAuditLog } from '../lib/accounting-helpers';

type AppEnv = { Bindings: Env; Variables: Variables };

const EXCLUDED_PATH_PREFIXES = [
  '/api/auth/login',
  '/api/auth/login-direct',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/health',
  '/api/seed',
  '/api/init',
  '/api/patient-auth',
  '/api/patient-phr',
  '/api/patient-portal',
  '/api/global-portal',
  '/api/v1/marketplace',
  '/api/v1/doctor-auth',
  '/api/invite',
  '/api/register',
  '/api/onboarding',
];

// Paths that already have explicit createAuditLog calls — skip auto-audit to avoid duplicates
const EXPLICIT_AUDIT_PATHS = [
  '/api/users',
  '/api/billing',
  '/api/billing-counter',
  '/api/billing-handover',
  '/api/credit-notes',
  '/api/appointments',
  '/api/admissions',
  '/api/patients',
  '/api/doctors',
  '/api/lab',
  '/api/radiology',
  '/api/expenses',
  '/api/fractions',
  '/api/income',
  '/api/reception',
  '/api/ip-billing',
  '/api/billing-provisional',
  '/api/doctor-schedule',
];

function methodToAction(method: string): string {
  switch (method) {
    case 'POST': return 'CREATE';
    case 'PUT':
    case 'PATCH': return 'UPDATE';
    case 'DELETE': return 'DELETE';
    default: return '';
  }
}

function extractTableName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  if (apiIndex >= 0 && segments.length > apiIndex + 1) {
    return segments[apiIndex + 1];
  }
  return segments[0] || 'unknown';
}

function extractRecordId(path: string): number {
  const segments = path.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  if (apiIndex >= 0 && segments.length > apiIndex + 2) {
    const potentialId = segments[apiIndex + 2];
    const num = parseInt(potentialId, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 0;
}

export function autoAuditMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method;

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }

    const path = c.req.path;
    if (EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
      await next();
      return;
    }

    // Skip auto-audit for routes that already have explicit createAuditLog calls
    if (EXPLICIT_AUDIT_PATHS.some(prefix => path.startsWith(prefix))) {
      await next();
      return;
    }

    const action = methodToAction(method);
    if (!action) {
      await next();
      return;
    }

    await next();

    const status = c.res.status;
    if (status >= 400) return;

    try {
      const tenantId = c.get('tenantId');
      const userId = c.get('userId');

      if (!tenantId || !userId) return;

      const tableName = extractTableName(path);
      const recordId = extractRecordId(path);
      const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined;
      const userAgent = c.req.header('user-agent') ?? undefined;

      createAuditLog(
        c.env, tenantId, userId, action, tableName, recordId,
        null, null, ipAddress, userAgent,
      );
    } catch (err) {
      console.error('Auto-audit middleware error:', err);
    }
  };
}
