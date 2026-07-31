import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type DictEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createDictationSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  DictationText: z.string().optional(),
  AdditionalNotes: z.string().optional(),
  Priority: z.enum(['normal', 'urgent', 'stat']).default('normal'),
  IsSpeechToTextEnabled: z.boolean().default(false),
});

const assignSchema = z.object({
  TranscriberId: z.number().int().positive(),
  Priority: z.enum(['normal', 'urgent', 'stat']).optional(),
  DueDate: z.string().optional(),
  Notes: z.string().optional(),
});

const updateStatusSchema = z.object({
  Status: z.enum(['pending', 'in-progress', 'transcribing', 'completed', 'cancelled']),
});

const transcriptionSchema = z.object({
  TranscriptionText: z.string().min(1),
  TranscriptionNotes: z.string().optional(),
  AccuracyScore: z.number().min(0).max(100).optional(),
  QualityFlags: z.array(z.string()).optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const dictationRoutes = new Hono<DictEnv>();

// GET / — list dictations
dictationRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, priority, patientId, assignedTo, limit: lim, offset: off } = c.req.query();

  let query = 'SELECT * FROM Dictation WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (status) { query += ' AND Status = ?'; params.push(status); }
  if (priority) { query += ' AND Priority = ?'; params.push(priority); }
  if (patientId) { query += ' AND PatientId = ?'; params.push(Number(patientId)); }
  if (assignedTo) { query += ' AND AssignedToTranscriberId = ?'; params.push(Number(assignedTo)); }

  query += ' ORDER BY CreatedAt DESC';
  const limit = parseInt(lim || '50');
  const offset = parseInt(off || '0');
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM Dictation WHERE tenant_id = ? AND IsActive = 1'
  ).bind(tenantId).first<{ total: number }>();

  return c.json({ Results: results, total: countResult?.total || 0 });
});

// GET /stats — dictation statistics
dictationRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const statusCounts = await db.$client.prepare(`
    SELECT Status, COUNT(*) as count FROM Dictation
    WHERE tenant_id = ? AND IsActive = 1 GROUP BY Status
  `).bind(tenantId).all<{ Status: string; count: number }>();

  const statusMap: Record<string, number> = {};
  statusCounts.results?.forEach(row => { statusMap[row.Status] = row.count; });

  return c.json({
    Results: {
      pending: statusMap['pending'] || 0,
      inProgress: statusMap['in-progress'] || 0,
      transcribing: statusMap['transcribing'] || 0,
      completed: statusMap['completed'] || 0,
      cancelled: statusMap['cancelled'] || 0,
    },
  });
});

// GET /:id — single dictation with transcriptions
dictationRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const dictation = await db.$client.prepare(
    'SELECT * FROM Dictation WHERE tenant_id = ? AND DictationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!dictation) throw new HTTPException(404, { message: 'Dictation not found' });

  const [transcriptions, assignments] = await Promise.all([
    db.$client.prepare(
      'SELECT * FROM DictationTranscription WHERE tenant_id = ? AND DictationId = ? ORDER BY Version DESC'
    ).bind(tenantId, id).all(),
    db.$client.prepare(
      'SELECT * FROM DictationAssignment WHERE tenant_id = ? AND DictationId = ? ORDER BY AssignedAt DESC'
    ).bind(tenantId, id).all(),
  ]);

  return c.json({
    Results: {
      ...dictation,
      transcriptions: transcriptions.results,
      assignments: assignments.results,
    },
  });
});

// POST / — create dictation
dictationRoutes.post('/', zValidator('json', createDictationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO Dictation (
      tenant_id, PatientId, EncounterId, DictationText, AdditionalNotes,
      Priority, IsSpeechToTextEnabled, CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.EncounterId ?? null,
    data.DictationText ?? null, data.AdditionalNotes ?? null,
    data.Priority, data.IsSpeechToTextEnabled ? 1 : 0, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id/assign — assign to transcriber
dictationRoutes.put('/:id/assign', zValidator('json', assignSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const dictation = await db.$client.prepare(
    'SELECT DictationId, AssignedToTranscriberId FROM Dictation WHERE tenant_id = ? AND DictationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first<{ DictationId: number; AssignedToTranscriberId: number | null }>();
  if (!dictation) throw new HTTPException(404, { message: 'Dictation not found' });

  await db.$client.prepare(`
    UPDATE Dictation SET
      AssignedToTranscriberId = ?, AssignedById = ?, AssignedAt = datetime('now', '+6 hours'),
      Priority = COALESCE(?, Priority),
      Status = CASE WHEN Status = 'pending' THEN 'in-progress' ELSE Status END
    WHERE tenant_id = ? AND DictationId = ?
  `).bind(data.TranscriberId, userId, data.Priority ?? null, tenantId, id).run();

  await db.$client.prepare(`
    INSERT INTO DictationAssignment (tenant_id, DictationId, FromTranscriberId, ToTranscriberId, AssignedById, Priority, DueDate, Notes, Status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    tenantId, id, dictation.AssignedToTranscriberId ?? null,
    data.TranscriberId, userId, data.Priority ?? 'normal',
    data.DueDate ?? null, data.Notes ?? null,
  ).run();

  return c.json({ Results: { success: true } });
});

// PUT /:id/status — update status
dictationRoutes.put('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const dictation = await db.$client.prepare(
    'SELECT DictationId, Status FROM Dictation WHERE tenant_id = ? AND DictationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first<{ DictationId: number; Status: string }>();
  if (!dictation) throw new HTTPException(404, { message: 'Dictation not found' });

  const updates = ['Status = ?'];
  const params: (string | number | null)[] = [data.Status];

  if (data.Status === 'in-progress' && dictation.Status === 'pending') {
    updates.push("StartedAt = datetime('now', '+6 hours')");
  }
  if (data.Status === 'completed') {
    updates.push("CompletedAt = datetime('now', '+6 hours')");
    updates.push("TurnaroundTimeMinutes = CAST((julianday(datetime('now', '+6 hours')) - julianday(CreatedAt)) * 24 * 60 AS INTEGER)");
  }

  params.push(tenantId, id);
  await db.$client.prepare(
    `UPDATE Dictation SET ${updates.join(', ')} WHERE tenant_id = ? AND DictationId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// PUT /:id/transcription — add/update transcription
dictationRoutes.put('/:id/transcription', zValidator('json', transcriptionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const dictation = await db.$client.prepare(
    'SELECT DictationId, Status FROM Dictation WHERE tenant_id = ? AND DictationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!dictation) throw new HTTPException(404, { message: 'Dictation not found' });

  const maxVersion = await db.$client.prepare(
    'SELECT COALESCE(MAX(Version), 0) as maxVersion FROM DictationTranscription WHERE tenant_id = ? AND DictationId = ?'
  ).bind(tenantId, id).first<{ maxVersion: number }>();

  const newVersion = (maxVersion?.maxVersion || 0) + 1;

  // Mark previous version as not current
  await db.$client.prepare(
    'UPDATE DictationTranscription SET IsCurrentVersion = 0 WHERE tenant_id = ? AND DictationId = ? AND IsCurrentVersion = 1'
  ).bind(tenantId, id).run();

  // Insert new transcription
  await db.$client.prepare(`
    INSERT INTO DictationTranscription (
      tenant_id, DictationId, TranscriptionText, TranscriptionNotes,
      Version, IsCurrentVersion, AccuracyScore, QualityFlags,
      TranscriberId, CompletedAt
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, id, data.TranscriptionText, data.TranscriptionNotes ?? null,
    newVersion, data.AccuracyScore ?? null,
    data.QualityFlags ? JSON.stringify(data.QualityFlags) : null, userId,
  ).run();

  // Auto-complete dictation
  await db.$client.prepare(`
    UPDATE Dictation SET Status = 'completed', CompletedAt = datetime('now', '+6 hours'),
      TurnaroundTimeMinutes = CAST((julianday(datetime('now', '+6 hours')) - julianday(CreatedAt)) * 24 * 60 AS INTEGER)
    WHERE tenant_id = ? AND DictationId = ? AND Status != 'completed'
  `).bind(tenantId, id).run();

  return c.json({ Results: { version: newVersion } }, 201);
});

// GET /:id/transcription — get current transcription
dictationRoutes.get('/:id/transcription', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const transcription = await db.$client.prepare(
    'SELECT * FROM DictationTranscription WHERE tenant_id = ? AND DictationId = ? AND IsCurrentVersion = 1'
  ).bind(tenantId, id).first();

  return c.json({ Results: transcription || null });
});

// DELETE /:id — soft delete
dictationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT DictationId FROM Dictation WHERE tenant_id = ? AND DictationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Dictation not found' });

  await db.$client.prepare(
    "UPDATE Dictation SET IsActive = 0, DeletedAt = datetime('now', '+6 hours'), DeletedById = ? WHERE tenant_id = ? AND DictationId = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default dictationRoutes;
