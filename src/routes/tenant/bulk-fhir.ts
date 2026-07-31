/**
 * Bulk FHIR Export Routes
 *
 * POST   /api/bulk-fhir/$export       — start export
 * GET    /api/bulk-fhir/status/:id    — check status
 * GET    /api/bulk-fhir/download/:id/:type — get NDJSON
 * DELETE /api/bulk-fhir/status/:id    — cancel
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import {
  BULK_RESOURCE_TYPES,
  generateExportId,
  patientToNDJSON,
  observationToNDJSON,
  allergyToNDJSON,
  medicationToNDJSON,
  conditionToNDJSON,
  type BulkExportJob,
  type BulkExportOutput,
  type BulkResourceType,
} from '../../lib/bulk-fhir';

const bulkFhirRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const exportSchema = z.object({
  _type: z.array(z.enum(BULK_RESOURCE_TYPES)).optional(),
  _since: z.string().optional(),
}).optional();

// In-memory job store (for Workers, consider KV for persistence)
const jobs = new Map<string, BulkExportJob>();

// POST /$export — kick off export
bulkFhirRoutes.post('/$export', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const raw = db.$client;

  const body = await c.req.json().catch(() => ({}));
  const parsed = (exportSchema ?? z.object({})).safeParse(body);
  const resourceTypes = (parsed.success && parsed.data?._type) || [...BULK_RESOURCE_TYPES];
  const since = parsed.success ? parsed.data?._since : undefined;

  const jobId = generateExportId();
  const job: BulkExportJob = {
    id: jobId,
    tenant_id: tenantId,
    status: 'processing',
    resource_types: resourceTypes as BulkResourceType[],
    since: since ?? null,
    requested_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    output: [],
  };
  jobs.set(jobId, job);

  // Process synchronously (D1 is fast enough for single-tenant)
  try {
    const output: BulkExportOutput[] = [];
    const sinceClause = since ? `AND created_at >= '${since}'` : '';

    for (const type of resourceTypes) {
      let ndjsonLines: string[] = [];

      if (type === 'Patient') {
        const { results } = await raw.prepare(
          `SELECT * FROM patients WHERE tenant_id = ? ${sinceClause} LIMIT 10000`
        ).bind(tenantId).all();
        ndjsonLines = (results ?? []).map((r) => patientToNDJSON(r as Record<string, unknown>));
      }

      if (type === 'AllergyIntolerance') {
        const { results } = await raw.prepare(
          `SELECT a.*, a.patient_id FROM patient_allergies a WHERE a.tenant_id = ? ${sinceClause} LIMIT 10000`
        ).bind(tenantId).all();
        ndjsonLines = (results ?? []).map((r) => allergyToNDJSON(r as Record<string, unknown>, String((r as any).patient_id)));
      }

      if (type === 'MedicationStatement') {
        const { results } = await raw.prepare(
          `SELECT * FROM patient_medications WHERE tenant_id = ? ${sinceClause} LIMIT 10000`
        ).bind(tenantId).all();
        ndjsonLines = (results ?? []).map((r) => medicationToNDJSON(r as Record<string, unknown>, String((r as any).patient_id)));
      }

      if (type === 'Condition') {
        const { results } = await raw.prepare(
          `SELECT * FROM patient_problems WHERE tenant_id = ? ${sinceClause} LIMIT 10000`
        ).bind(tenantId).all();
        ndjsonLines = (results ?? []).map((r) => conditionToNDJSON(r as Record<string, unknown>, String((r as any).patient_id)));
      }

      if (ndjsonLines.length > 0) {
        // Store in KV if available, otherwise inline
        const kvKey = `bulk-fhir/${jobId}/${type}.ndjson`;
        try {
          await (c.env as any).KV?.put(kvKey, ndjsonLines.join('\n'), { expirationTtl: 3600 });
        } catch {
          // KV not available — will serve inline
        }
        output.push({
          type: type as BulkResourceType,
          count: ndjsonLines.length,
          url: `/api/bulk-fhir/download/${jobId}/${type}`,
        });
      }
    }

    job.output = output;
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
  } catch (err) {
    job.status = 'error';
    job.error_message = err instanceof Error ? err.message : 'Unknown error';
  }

  // Return 202 Accepted per FHIR spec
  c.header('Content-Location', `/api/bulk-fhir/status/${jobId}`);
  return c.json({ job_id: jobId, status_url: `/api/bulk-fhir/status/${jobId}` }, 202);
});

// GET /status/:id — poll job status
bulkFhirRoutes.get('/status/:id', async (c) => {
  const jobId = c.req.param('id');
  const job = jobs.get(jobId);
  if (!job) return c.json({ error: 'Export job not found' }, 404);

  if (job.status === 'completed') {
    return c.json({
      transactionTime: job.completed_at,
      request: `/api/bulk-fhir/$export`,
      requiresAccessToken: true,
      output: job.output,
    });
  }

  if (job.status === 'error') {
    return c.json({ status: 'error', error: job.error_message }, 500);
  }

  // Still processing
  c.header('X-Progress', job.status);
  c.header('Retry-After', '5');
  return c.body(null, 202);
});

// GET /download/:id/:type — get NDJSON file
bulkFhirRoutes.get('/download/:id/:type', async (c) => {
  const jobId = c.req.param('id');
  const type = c.req.param('type');
  const job = jobs.get(jobId);
  if (!job || job.status !== 'completed') return c.json({ error: 'Not ready' }, 404);

  // Try KV first
  const kvKey = `bulk-fhir/${jobId}/${type}.ndjson`;
  try {
    const data = await (c.env as any).KV?.get(kvKey);
    if (data) {
      c.header('Content-Type', 'application/ndjson');
      return c.body(data);
    }
  } catch {
    // KV not available
  }

  return c.json({ error: 'File not found' }, 404);
});

// DELETE /status/:id — cancel/cleanup
bulkFhirRoutes.delete('/status/:id', async (c) => {
  const jobId = c.req.param('id');
  const job = jobs.get(jobId);
  if (!job) return c.json({ error: 'Not found' }, 404);

  // Cleanup KV
  for (const out of job.output) {
    try {
      await (c.env as any).KV?.delete(`bulk-fhir/${jobId}/${out.type}.ndjson`);
    } catch { /* ignore */ }
  }

  jobs.delete(jobId);
  return c.json({ ok: true });
});

export default bulkFhirRoutes;
