import { zValidator } from '@hono/zod-validator';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requirePermission, requireRole, resolveUserPermissions } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import {
  getReceivableAdjustmentReadiness,
  ReceivableAuthorityConfigurationError,
} from '../../services/actionCenter/collections/authority';
import { getLiveReceivable } from '../../services/actionCenter/collections/liveSource';
import { listCollectionCases } from '../../services/actionCenter/collections/query';
import { reconcileCollectionCase } from '../../services/actionCenter/collections/reconcile';
import {
  createReceivableWriteOffRequest,
  ReceivableWriteOffRequestConflictError,
  ReceivableWriteOffRequestValidationError,
} from '../../services/actionCenter/collections/writeOff';
import {
  CollectionTransitionValidationError,
  transitionCollectionCase,
  type CollectionAction,
} from '../../services/actionCenter/collections/transitions';
import type {
  CollectionListQuery,
  ReceivableAuthorityMode,
  ReceivableSourceRef,
} from '../../services/actionCenter/collections/types';

const collectionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const COLLECTION_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;

const utcTimestampSchema = z.string()
  .trim()
  .max(40)
  .refine((value) => value.endsWith('Z') && Number.isFinite(Date.parse(value)), {
    message: 'Expected a valid UTC timestamp.',
  });

const expectedTimestampSchema = utcTimestampSchema.optional();

const writeOffRequestSchema = z.object({
  amountMinor: z.number().int().safe().positive(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  reasonCode: z.enum([
    'uncollectible',
    'financial_hardship',
    'billing_dispute',
    'deceased',
    'administrative_adjustment',
    'other',
  ]),
  note: z.string().trim().min(10).max(2000),
  evidenceUrls: z.array(z.string().url()).max(10).optional(),
});

const listQuerySchema = z.object({
  status: z.enum([
    'new',
    'contact_due',
    'contacted',
    'promised',
    'disputed',
    'escalated',
    'write_off_requested',
    'closed',
    'active',
    'all',
  ]).optional(),
  assignee: z.coerce.number().int().safe().positive().optional(),
  followup: z.enum(['due', 'upcoming', 'none']).optional(),
  ageBucket: z.enum(['0-7', '8-30', '31-60', '60+']).optional(),
  minAmountMinor: z.coerce.number().int().safe().nonnegative().optional(),
  maxAmountMinor: z.coerce.number().int().safe().nonnegative().optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['exposure', 'oldest', 'followup']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((query, ctx) => {
  if (
    query.minAmountMinor !== undefined
    && query.maxAmountMinor !== undefined
    && query.minAmountMinor > query.maxAmountMinor
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxAmountMinor'],
      message: 'maxAmountMinor must be greater than or equal to minAmountMinor.',
    });
  }
});

type CollectionQueryInput = z.infer<typeof listQuerySchema>;

const contactSchema = z.object({
  channel: z.enum(['phone', 'sms', 'whatsapp', 'in_person', 'other']),
  outcome: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(2000),
  nextFollowupAtUtc: utcTimestampSchema.optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const followUpSchema = z.object({
  nextFollowupAtUtc: utcTimestampSchema,
  note: z.string().trim().max(2000).optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const promiseSchema = z.object({
  promiseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  promiseAmountMinor: z.number().int().safe().positive(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  note: z.string().trim().min(1).max(2000),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const disputeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(2000),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

const escalateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(2000),
  assignedTo: z.number().int().safe().positive().optional(),
  expectedUpdatedAtUtc: expectedTimestampSchema,
});

interface CaseDetailRow {
  caseId: number | null;
  collectionStatus: string | null;
  assignedTo: number | null;
  assignedToName: string | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  promiseCurrencyCode: string | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  closedAtUtc: string | null;
  createdAtUtc: string | null;
  updatedAtUtc: string | null;
}

interface EventRow {
  id: number;
  eventType: string;
  actorId: number | null;
  actorName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  metadataJson: string;
  createdAtUtc: string;
}

export class CollectionSourceKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionSourceKeyError';
  }
}

function decodeSourceValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new CollectionSourceKeyError('Collection source key is not valid URL encoding.');
  }
}

export function parseCollectionSourceKey(rawValue: string): ReceivableSourceRef {
  const value = decodeSourceValue(rawValue.trim());
  const legacy = /^legacy-bill:(\d+)$/.exec(value);
  if (legacy) {
    const legacyBillId = Number(legacy[1]);
    if (!Number.isSafeInteger(legacyBillId) || legacyBillId <= 0) {
      throw new CollectionSourceKeyError('Legacy bill source ID must be a positive safe integer.');
    }
    return { sourceType: 'invoice', legacyBillId };
  }

  const canonical = /^canonical-invoice:(.+)$/.exec(value);
  if (canonical) {
    const canonicalInvoicePublicId = canonical[1].trim();
    if (
      canonicalInvoicePublicId.length < 1
      || canonicalInvoicePublicId.length > 200
      || /[\\/\u0000-\u001f\u007f]/.test(canonicalInvoicePublicId)
    ) {
      throw new CollectionSourceKeyError('Canonical invoice source ID is invalid.');
    }
    return { sourceType: 'invoice', canonicalInvoicePublicId };
  }

  throw new CollectionSourceKeyError('Collection source key is invalid.');
}

function collectionQuery(query: CollectionQueryInput): CollectionListQuery {
  return {
    status: query.status,
    assignee: query.assignee,
    followup: query.followup,
    ageBucket: query.ageBucket,
    minAmountMinor: query.minAmountMinor,
    maxAmountMinor: query.maxAmountMinor,
    search: query.search,
    sort: query.sort,
    page: query.page,
    limit: query.limit,
  };
}

function sourceWhere(source: ReceivableSourceRef): { sql: string; binds: unknown[] } {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (source.canonicalInvoicePublicId) {
    conditions.push('cc.canonical_invoice_public_id = ?');
    binds.push(source.canonicalInvoicePublicId);
  }
  if (source.legacyBillId !== undefined) {
    conditions.push('cc.legacy_bill_id = ?');
    binds.push(source.legacyBillId);
  }
  return {
    sql: conditions.length === 2
      ? `(${conditions[0]} OR ${conditions[1]})`
      : conditions[0] ?? '0 = 1',
    binds,
  };
}

async function loadCaseDetail(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
}): Promise<CaseDetailRow | null> {
  const where = sourceWhere(input.source);
  const canonicalId = input.source.canonicalInvoicePublicId ?? null;
  return input.db.prepare(`
    SELECT
      cc.id AS "caseId",
      cc.status AS "collectionStatus",
      cc.assigned_to AS "assignedTo",
      assignee.name AS "assignedToName",
      cc.next_followup_at_utc AS "nextFollowupAtUtc",
      cc.promise_date AS "promiseDate",
      cc.promise_amount_minor AS "promiseAmountMinor",
      cc.currency_code AS "promiseCurrencyCode",
      cc.latest_note AS "latestNote",
      cc.last_contacted_at_utc AS "lastContactedAtUtc",
      cc.closed_at_utc AS "closedAtUtc",
      cc.created_at_utc AS "createdAtUtc",
      cc.updated_at_utc AS "updatedAtUtc"
    FROM collection_cases cc
    LEFT JOIN users assignee
      ON assignee.id = cc.assigned_to
     AND assignee.tenant_id = cc.tenant_id
    WHERE cc.tenant_id = ?
      AND ${where.sql}
    ORDER BY
      CASE
        WHEN ? IS NOT NULL AND cc.canonical_invoice_public_id = ? THEN 0
        ELSE 1
      END,
      cc.id ASC
    LIMIT 1
  `).bind(
    input.tenantId,
    ...where.binds,
    canonicalId,
    canonicalId,
  ).first<CaseDetailRow>();
}

function paymentCapability(input: {
  authorityMode: 'legacy' | 'shadow' | 'canonical';
  source: ReceivableSourceRef;
}): { paymentHref: string | null; paymentCapability: 'available' | 'canonical_command_required' } {
  if (input.authorityMode === 'canonical') {
    return {
      paymentHref: null,
      paymentCapability: 'canonical_command_required',
    };
  }
  if (!input.source.legacyBillId) {
    return {
      paymentHref: null,
      paymentCapability: 'canonical_command_required',
    };
  }
  return {
    paymentHref: `/billing?collectBillId=${encodeURIComponent(String(input.source.legacyBillId))}`,
    paymentCapability: 'available',
  };
}

async function loadCollectionDetail(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  reconcile?: boolean;
  actorId?: number;
}): Promise<Record<string, unknown> | null> {
  const live = await getLiveReceivable({
    db: input.db,
    tenantId: input.tenantId,
    source: input.source,
  });
  if (!live) return null;

  if (input.reconcile) {
    await reconcileCollectionCase({
      db: input.db,
      tenantId: input.tenantId,
      source: live.record.source,
      actorId: input.actorId,
    });
  }

  const workflow = await loadCaseDetail({
    db: input.db,
    tenantId: input.tenantId,
    source: live.record.source,
  });
  const sourceKey = live.authorityMode === 'canonical'
    ? `canonical-invoice:${encodeURIComponent(live.record.source.canonicalInvoicePublicId ?? '')}`
    : `legacy-bill:${live.record.source.legacyBillId ?? ''}`;
  const payment = paymentCapability({
    authorityMode: live.authorityMode,
    source: live.record.source,
  });

  return {
    ...live.record,
    sourceKey,
    authorityMode: live.authorityMode,
    caseId: workflow?.caseId ?? null,
    collectionStatus: workflow?.collectionStatus ?? 'new',
    assignedTo: workflow?.assignedTo ?? null,
    assignedToName: workflow?.assignedToName ?? null,
    nextFollowupAtUtc: workflow?.nextFollowupAtUtc ?? null,
    promiseDate: workflow?.promiseDate ?? null,
    promiseAmountMinor: workflow?.promiseAmountMinor ?? null,
    promiseCurrencyCode: workflow?.promiseCurrencyCode ?? null,
    latestNote: workflow?.latestNote ?? null,
    lastContactedAtUtc: workflow?.lastContactedAtUtc ?? null,
    closedAtUtc: workflow?.closedAtUtc ?? null,
    createdAtUtc: workflow?.createdAtUtc ?? null,
    updatedAtUtc: workflow?.updatedAtUtc ?? null,
    ...payment,
  };
}

function authorityError(c: Context<{ Bindings: Env; Variables: Variables }>, error: unknown) {
  if (error instanceof ReceivableAuthorityConfigurationError) {
    return c.json({
      error: error.message,
      code: 'RECEIVABLE_AUTHORITY_UNAVAILABLE',
      requestedMode: error.requestedMode,
      missingRequirements: error.missingRequirements,
    }, 503);
  }
  throw error;
}

collectionRoutes.use('*', requireRole(...COLLECTION_ROLES));

collectionRoutes.get('/', requirePermission('receivables.view'), zValidator('query', listQuerySchema), async (c) => {
  try {
    const tenantId = requireTenantId(c);
    const result = await listCollectionCases({
      db: c.env.DB,
      tenantId,
      query: collectionQuery(c.req.valid('query')),
    });
    return c.json({
      data: {
        items: result.data,
        summary: result.summary,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    return authorityError(c, error);
  }
});

collectionRoutes.get('/summary', requirePermission('receivables.view'), zValidator('query', listQuerySchema), async (c) => {
  try {
    const tenantId = requireTenantId(c);
    const result = await listCollectionCases({
      db: c.env.DB,
      tenantId,
      query: {
        ...collectionQuery(c.req.valid('query')),
        page: 1,
        limit: 1,
      },
    });
    return c.json({ data: result.summary });
  } catch (error) {
    return authorityError(c, error);
  }
});

collectionRoutes.get('/invoice/:sourceKey', requirePermission('receivables.view'), async (c) => {
  let source: ReceivableSourceRef;
  try {
    source = parseCollectionSourceKey(c.req.param('sourceKey'));
  } catch (error) {
    if (error instanceof CollectionSourceKeyError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }

  try {
    const tenantId = requireTenantId(c);
    const userId = String(c.get('userId'));
    const role = String(c.get('role') ?? '');
    const detail = await loadCollectionDetail({
      db: c.env.DB,
      tenantId,
      source,
      reconcile: true,
      actorId: Number(userId),
    });
    if (!detail) return c.json({ error: 'Collection source not found.' }, 404);
    const permissions = await resolveUserPermissions(c.env.DB, tenantId, role, userId);
    const canRequestWriteOff = permissions.includes('*')
      || permissions.includes('receivables.write_off.request');
    const adjustmentReadiness = await getReceivableAdjustmentReadiness({
      db: c.env.DB,
      authorityMode: detail.authorityMode as ReceivableAuthorityMode,
    });
    const liveDueMinor = Number(detail.dueMinor);
    const writeOffRequestCapability = !canRequestWriteOff
      ? 'forbidden'
      : detail.collectionStatus === 'write_off_requested'
        ? 'pending'
        : adjustmentReadiness.ready
          && detail.financialStatus === 'open'
          && Number.isSafeInteger(liveDueMinor)
          && liveDueMinor > 0
          ? 'available'
          : 'unavailable';
    return c.json({ data: { ...detail, writeOffRequestCapability } });
  } catch (error) {
    return authorityError(c, error);
  }
});

collectionRoutes.post(
  '/invoice/:sourceKey/write-off-request',
  requirePermission('receivables.write_off.request'),
  zValidator('json', writeOffRequestSchema),
  async (c) => {
    let source: ReceivableSourceRef;
    try {
      source = parseCollectionSourceKey(c.req.param('sourceKey'));
    } catch (error) {
      if (error instanceof CollectionSourceKeyError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }

    try {
      const result = await createReceivableWriteOffRequest({
        db: c.env.DB,
        tenantId: requireTenantId(c),
        source,
        requesterId: Number(c.get('userId')),
        ...c.req.valid('json'),
      });
      return c.json({ data: result }, 201);
    } catch (error) {
      if (error instanceof ReceivableWriteOffRequestConflictError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof ReceivableWriteOffRequestValidationError) {
        const status = /not found/i.test(error.message) ? 404 : 422;
        return c.json({ error: error.message }, status);
      }
      return authorityError(c, error);
    }
  },
);

collectionRoutes.get('/invoice/:sourceKey/events', requirePermission('receivables.view'), async (c) => {
  let source: ReceivableSourceRef;
  try {
    source = parseCollectionSourceKey(c.req.param('sourceKey'));
  } catch (error) {
    if (error instanceof CollectionSourceKeyError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }

  try {
    const tenantId = requireTenantId(c);
    const live = await getLiveReceivable({ db: c.env.DB, tenantId, source });
    if (!live) return c.json({ error: 'Collection source not found.' }, 404);
    const workflow = await loadCaseDetail({
      db: c.env.DB,
      tenantId,
      source: live.record.source,
    });
    if (!workflow?.caseId) return c.json({ data: [] });

    const result = await c.env.DB.prepare(`
      SELECT
        e.id,
        e.event_type AS "eventType",
        e.actor_id AS "actorId",
        actor.name AS "actorName",
        e.old_status AS "oldStatus",
        e.new_status AS "newStatus",
        e.note,
        e.metadata_json AS "metadataJson",
        e.created_at_utc AS "createdAtUtc"
      FROM collection_case_events e
      LEFT JOIN users actor
        ON actor.id = e.actor_id
       AND actor.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.case_id = ?
      ORDER BY e.created_at_utc ASC, e.id ASC
    `).bind(tenantId, workflow.caseId).all<EventRow>();

    return c.json({
      data: (result.results ?? []).map((event) => ({
        id: Number(event.id),
        eventType: event.eventType,
        actorId: event.actorId == null ? null : Number(event.actorId),
        actorName: event.actorName,
        oldStatus: event.oldStatus,
        newStatus: event.newStatus,
        note: event.note,
        metadata: (() => {
          try {
            return JSON.parse(event.metadataJson || '{}');
          } catch {
            return {};
          }
        })(),
        createdAtUtc: event.createdAtUtc,
      })),
    });
  } catch (error) {
    return authorityError(c, error);
  }
});

async function runAction(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  sourceKey: string,
  action: CollectionAction,
  expectedUpdatedAtUtc?: string,
) {
  let source: ReceivableSourceRef;
  try {
    source = parseCollectionSourceKey(sourceKey);
  } catch (error) {
    if (error instanceof CollectionSourceKeyError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }

  try {
    const tenantId = requireTenantId(c);
    const actorId = Number(c.get('userId'));
    const result = await transitionCollectionCase({
      db: c.env.DB,
      tenantId,
      source,
      actorId,
      expectedUpdatedAtUtc,
      action,
    });
    if (result === 'not_found') return c.json({ error: 'Collection source not found.' }, 404);
    if (result === 'conflict') return c.json({ error: 'Collection case changed or is no longer actionable.' }, 409);

    const detail = await loadCollectionDetail({
      db: c.env.DB,
      tenantId,
      source,
    });
    if (!detail) return c.json({ error: 'Collection source not found.' }, 404);
    return c.json({ data: detail });
  } catch (error) {
    if (error instanceof CollectionTransitionValidationError) {
      return c.json({ error: error.message }, 422);
    }
    return authorityError(c, error);
  }
}

collectionRoutes.post('/invoice/:sourceKey/contact', requirePermission('receivables.followup.manage'), zValidator('json', contactSchema), async (c) => {
  const body = c.req.valid('json');
  return runAction(c, c.req.param('sourceKey'), {
    action: 'contact',
    channel: body.channel,
    outcome: body.outcome,
    note: body.note,
    nextFollowupAtUtc: body.nextFollowupAtUtc,
  }, body.expectedUpdatedAtUtc);
});

collectionRoutes.put('/invoice/:sourceKey/follow-up', requirePermission('receivables.followup.manage'), zValidator('json', followUpSchema), async (c) => {
  const body = c.req.valid('json');
  return runAction(c, c.req.param('sourceKey'), {
    action: 'follow_up',
    nextFollowupAtUtc: body.nextFollowupAtUtc,
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

collectionRoutes.put('/invoice/:sourceKey/promise', requirePermission('receivables.followup.manage'), zValidator('json', promiseSchema), async (c) => {
  const body = c.req.valid('json');
  return runAction(c, c.req.param('sourceKey'), {
    action: 'promise',
    promiseDate: body.promiseDate,
    promiseAmountMinor: body.promiseAmountMinor,
    currencyCode: body.currencyCode,
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

collectionRoutes.put('/invoice/:sourceKey/dispute', requirePermission('receivables.followup.manage'), zValidator('json', disputeSchema), async (c) => {
  const body = c.req.valid('json');
  return runAction(c, c.req.param('sourceKey'), {
    action: 'dispute',
    reason: body.reason,
    note: body.note,
  }, body.expectedUpdatedAtUtc);
});

collectionRoutes.put('/invoice/:sourceKey/escalate', requirePermission('receivables.followup.manage'), zValidator('json', escalateSchema), async (c) => {
  const body = c.req.valid('json');
  return runAction(c, c.req.param('sourceKey'), {
    action: 'escalate',
    reason: body.reason,
    note: body.note,
    assignedTo: body.assignedTo,
  }, body.expectedUpdatedAtUtc);
});

export default collectionRoutes;
