import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import {
  createValidationRuleSchema,
  updateValidationRuleSchema,
  validateResultSchema,
} from '../../schemas/lab';

const labValidationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

labValidationRoutes.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION RULES CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labValidationRoutes.get('/rules', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = c.req.query('lab_test_id');

  let where = 'WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (testId) {
    where += ' AND lab_test_id = ?';
    params.push(Number(testId));
  }

  const rows = await db.$client.prepare(`
    SELECT r.*, t.name as test_name, c.component_name
    FROM lab_validation_rules r
    LEFT JOIN lab_test_catalog t ON r.lab_test_id = t.id
    LEFT JOIN lab_test_components c ON r.component_id = c.id
    ${where}
    ORDER BY r.lab_test_id, r.rule_type
  `).bind(...params).all();

  return c.json({ data: rows.results });
});

labValidationRoutes.post('/rules', zValidator('json', createValidationRuleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_validation_rules
      (lab_test_id, component_id, rule_type, rule_config, error_message, is_blocking, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.lab_test_id ?? null,
    data.component_id ?? null,
    data.rule_type,
    JSON.stringify(data.rule_config),
    data.error_message,
    data.is_blocking ? 1 : 0,
    tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Validation rule created' }, 201);
});

labValidationRoutes.put('/rules/:id', zValidator('json', updateValidationRuleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM lab_validation_rules WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Validation rule not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  const fields: Array<[string, unknown]> = [
    ['lab_test_id', data.lab_test_id],
    ['component_id', data.component_id],
    ['rule_type', data.rule_type],
    ['rule_config', data.rule_config !== undefined ? JSON.stringify(data.rule_config) : undefined],
    ['error_message', data.error_message],
    ['is_blocking', data.is_blocking !== undefined ? (data.is_blocking ? 1 : 0) : undefined],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val as string | number | null); }
  }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_validation_rules SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  return c.json({ message: 'Validation rule updated' });
});

labValidationRoutes.delete('/rules/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  await db.$client.prepare(
    'UPDATE lab_validation_rules SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  return c.json({ message: 'Validation rule deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ValidationOutcome {
  blocking: string[];
  warnings: string[];
}

export async function validateLabResult(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  labTestId: number,
  componentId: number | null | undefined,
  resultValue: string,
  resultNumeric: number | null,
  patientId?: number | null
): Promise<ValidationOutcome> {
  const rules = await db.$client.prepare(`
    SELECT * FROM lab_validation_rules
    WHERE tenant_id = ? AND is_active = 1
      AND (lab_test_id = ? OR lab_test_id IS NULL)
      AND (component_id = ? OR component_id IS NULL)
  `).bind(tenantId, labTestId, componentId ?? null).all<{
    id: number;
    rule_type: string;
    rule_config: string;
    error_message: string | null;
    is_blocking: number;
  }>();

  const blocking: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules.results ?? []) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(rule.rule_config);
    } catch {
      continue;
    }

    let failed = false;

    switch (rule.rule_type) {
      case 'range': {
        if (resultNumeric !== null && typeof config.min === 'number' && typeof config.max === 'number') {
          if (resultNumeric < config.min || resultNumeric > config.max) {
            failed = true;
          }
        }
        break;
      }
      case 'mandatory': {
        if (!resultValue || resultValue.trim() === '') {
          failed = true;
        }
        break;
      }
      case 'delta': {
        if (resultNumeric !== null && patientId && typeof config.max_change_percent === 'number') {
          const prev = await db.$client.prepare(`
            SELECT lr.result_numeric
            FROM lab_results lr
            JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
            JOIN lab_orders lo ON lrp.lab_order_id = lo.id
            WHERE lo.patient_id = ? AND lr.lab_test_id = ? AND lo.tenant_id = ?
              ${componentId ? 'AND lr.component_id = ?' : 'AND lr.component_id IS NULL'}
              AND lr.result_numeric IS NOT NULL
              AND COALESCE(lr.result_status, '') <> 'retracted'
            ORDER BY lr.created_at DESC
            LIMIT 1
          `).bind(...[patientId, labTestId, tenantId, ...(componentId ? [componentId] : [])]).first<{ result_numeric: number }>();

          if (prev && prev.result_numeric !== null && prev.result_numeric !== undefined && prev.result_numeric !== 0) {
            const changePercent = Math.abs((resultNumeric - prev.result_numeric) / prev.result_numeric) * 100;
            if (changePercent > config.max_change_percent) {
              failed = true;
            }
          }
        }
        break;
      }
      case 'dependency': {
        // Basic dependency: if config.depends_on_test_id has config.expected_value
        if (config.depends_on_test_id && config.expected_value && patientId) {
          const dep = await db.$client.prepare(`
            SELECT lr.result_value
            FROM lab_results lr
            JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
            JOIN lab_orders lo ON lrp.lab_order_id = lo.id
            WHERE lo.patient_id = ? AND lr.lab_test_id = ? AND lo.tenant_id = ?
              AND COALESCE(lr.result_status, '') <> 'retracted'
            ORDER BY lr.created_at DESC
            LIMIT 1
          `).bind(patientId, Number(config.depends_on_test_id), tenantId).first<{ result_value: string }>();

          if (!dep || dep.result_value !== String(config.expected_value)) {
            failed = true;
          }
        }
        break;
      }
    }

    if (failed) {
      const msg = rule.error_message || `Validation failed: ${rule.rule_type}`;
      if (rule.is_blocking) blocking.push(msg);
      else warnings.push(msg);
    }
  }

  return { blocking, warnings };
}

labValidationRoutes.post('/validate', zValidator('json', validateResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const outcome = await validateLabResult(
    db,
    Number(tenantId),
    data.lab_test_id,
    data.component_id ?? null,
    data.result_value,
    data.result_numeric ?? null,
    data.patient_id ?? null
  );

  if (outcome.blocking.length > 0) {
    return c.json({ error: outcome.blocking.join('; '), blocking: true, warnings: outcome.warnings }, 400);
  }

  return c.json({ valid: true, blocking: false, warnings: outcome.warnings });
});

export default labValidationRoutes;
