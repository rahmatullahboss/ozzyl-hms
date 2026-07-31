import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import type { CanonicalBatchDatabase } from '../../lib/canonical/command-batch';
import { executeTenant100FinancialSmokeFixture } from '../../lib/canonical/tenant-100-financial-smoke-fixture';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { requireRole } from '../../middleware/rbac';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const FINANCIAL_STRICT_FLAG_KEY = 'canonical_financial_dual_write_v1';
const FINANCIAL_DISABLED_VERSION = 2;
const FINANCIAL_DISABLED_CONFIG = '{"tenantScope":["100"],"writePolicy":"canonical-only"}';
const FINANCIAL_SMOKE_CANDIDATE_TAG = 'cdb101-financial-smoke-fix-20260719-c1';

const requestSchema = z.object({
  runId: z.string().regex(/^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/),
  patientId: z.number().int().positive(),
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function assertStrictFlagStillDisabled(db: D1Database): Promise<void> {
  const flag = await db.prepare(`
    SELECT flag_key,domain,mode,is_enabled,version,config_json
    FROM canonical_feature_flags
    WHERE tenant_id='100' AND flag_key=?
      AND (effective_at_utc IS NULL OR effective_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND (expires_at_utc IS NULL OR expires_at_utc >= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ORDER BY version DESC,id DESC
    LIMIT 1
  `).bind(FINANCIAL_STRICT_FLAG_KEY).first<{
    flag_key: string;
    domain: string;
    mode: string;
    is_enabled: number;
    version: number;
    config_json: string | null;
  }>();
  if (!flag) {
    throw new HTTPException(409, {
      message: 'Tenant-100 strict financial flag row is missing',
    });
  }
  if (
    flag.flag_key !== FINANCIAL_STRICT_FLAG_KEY
    || flag.domain !== 'financial'
    || flag.mode !== 'disabled'
    || flag.is_enabled !== 0
    || flag.version !== FINANCIAL_DISABLED_VERSION
    || flag.config_json !== FINANCIAL_DISABLED_CONFIG
  ) {
    throw new HTTPException(409, {
      message: 'Tenant-100 strict financial flag is not in the exact pre-activation disabled state',
    });
  }
}

routes.post(
  '/tenant-100/reversible',
  requireRole('hospital_admin'),
  zValidator('json', requestSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    if (tenantId !== '100') {
      throw new HTTPException(404, { message: 'Not found' });
    }

    const configuredGuard = c.env.CDB101_FINANCIAL_SMOKE_GUARD?.trim() ?? '';
    const suppliedGuard = c.req.header('x-cdb101-financial-smoke-guard') ?? '';
    if (!configuredGuard) {
      throw new HTTPException(503, { message: 'Protected financial smoke execution is not configured' });
    }
    if (!constantTimeEqual(configuredGuard, suppliedGuard)) {
      throw new HTTPException(403, { message: 'Protected financial smoke authorization failed' });
    }

    const actualWorkerVersionId = c.env.CF_VERSION_METADATA?.id ?? '';
    const actualWorkerVersionTag = c.env.CF_VERSION_METADATA?.tag ?? '';
    if (!actualWorkerVersionId || !actualWorkerVersionTag) {
      throw new HTTPException(409, { message: 'Worker version metadata is unavailable' });
    }
    if (actualWorkerVersionTag !== FINANCIAL_SMOKE_CANDIDATE_TAG) {
      throw new HTTPException(409, { message: 'Request did not reach the approved candidate Worker version' });
    }

    const data = c.req.valid('json');
    const actorId = Number(requireUserId(c));
    if (!Number.isSafeInteger(actorId) || actorId <= 0) {
      throw new HTTPException(409, { message: 'Authenticated actor must have a numeric user ID' });
    }

    await assertStrictFlagStillDisabled(c.env.DB);

    const result = await executeTenant100FinancialSmokeFixture(
      c.env.DB as unknown as CanonicalBatchDatabase,
      {
        tenantId: '100',
        runId: data.runId,
        patientId: data.patientId,
        actorId,
        amountMinor: 100,
        atUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
        expectedWorkerVersionTag: FINANCIAL_SMOKE_CANDIDATE_TAG,
        actualWorkerVersionTag,
      },
    );

    return c.json({
      ok: true,
      workerVersionId: actualWorkerVersionId,
      workerVersionTag: actualWorkerVersionTag,
      productionTrafficChanged: false,
      strictFlagChanged: false,
      canonicalReadPromotionPerformed: false,
      result,
    });
  },
);

export default routes;
