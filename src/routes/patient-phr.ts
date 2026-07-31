import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { z } from 'zod';
import type { Env } from '../types';
import { adverseReactionSchema, lifestyleLogSchema, vitalsLogSchema } from '../schemas/patientReported';
import {
  buildReportedMedicationName,
  extractMedicationCandidatesFromPrescriptionText,
} from '../lib/patient-medication-reconciliation';
import { buildWellnessContext } from '../lib/ai-wellness-context';
import { detectCrisis, CRISIS_SAFETY_PROMPT } from '../lib/crisis-detection';

const patientPhrRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
const VAULT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const VAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

patientPhrRoutes.use('*', async (c, next) => {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope?: string; role?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as { userId: string; scope?: string; role?: string };
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global' || decoded.role !== 'patient') {
    throw new HTTPException(403, { message: 'Patient access required' });
  }

  c.set('userId', decoded.userId);
  await next();
});

/**
 * Helper: Resolve the patient's UHID from their global_patient_auth ID
 */
async function resolvePatientUhid(c: any): Promise<string | null> {
  const userId = c.get('userId');
  const result: any = await c.env.DB.prepare(
    'SELECT uhid FROM global_patient_auth WHERE id = ? AND is_active = 1'
  )
    .bind(userId)
    .first();
  return result?.uhid || null;
}

function buildVaultFileUrl(documentId: number | string): string {
  return `/api/patient-phr/vault/${documentId}/file`;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(`no such table: ${tableName.toLowerCase()}`);
}

async function upsertCurrentMedication(
  c: any,
  uhid: string,
  medicationName: string,
  notes?: string | null,
) {
  const normalizedName = medicationName.trim();
  if (!normalizedName) return;

  try {
    const existing = await c.env.DB.prepare(
      `SELECT id, notes
       FROM global_patient_reported_data
       WHERE uhid = ?
         AND category = 'current_medication'
         AND LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND COALESCE(clinical_status, 'active') = 'active'
         AND COALESCE(verification_status, 'unconfirmed') != 'entered-in-error'
       ORDER BY id DESC
       LIMIT 1`
    ).bind(uhid, normalizedName).first() as { id: number; notes: string | null } | null;

    if (existing?.id) {
      const nextNotes = notes && notes.trim()
        ? existing.notes?.includes(notes.trim())
          ? existing.notes
          : [existing.notes?.trim(), notes.trim()].filter(Boolean).join('\n')
        : existing.notes;

      await c.env.DB.prepare(
        `UPDATE global_patient_reported_data
         SET notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND uhid = ?`
      ).bind(nextNotes ?? null, existing.id, uhid).run();
      return;
    }

    await c.env.DB.prepare(
      `INSERT INTO global_patient_reported_data
        (uhid, category, name, clinical_status, verification_status, notes)
       VALUES (?, 'current_medication', ?, 'active', 'unconfirmed', ?)`
    ).bind(uhid, normalizedName, notes?.trim() || null).run();
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_reported_data')) return;
    throw error;
  }
}

async function extractPrescriptionTextWithOcr(
  c: any,
  uploadFile: File,
): Promise<string | null> {
  if (!c.env.OCR_SPACE_API_KEY) return null;

  const ocrForm = new FormData();
  ocrForm.append('apikey', c.env.OCR_SPACE_API_KEY);
  ocrForm.append('isOverlayRequired', 'false');
  ocrForm.append('detectOrientation', 'true');
  ocrForm.append('scale', 'true');
  ocrForm.append('OCREngine', '2');
  ocrForm.append('language', 'eng');
  if (uploadFile.type === 'application/pdf') {
    ocrForm.append('filetype', 'PDF');
  }
  ocrForm.append('file', uploadFile, uploadFile.name || 'prescription-upload');

  try {
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: ocrForm,
    });
    if (!response.ok) {
      console.error('[patient-phr] OCR.space HTTP error:', response.status);
      return null;
    }

    const payload = await response.json<{
      IsErroredOnProcessing?: boolean;
      ParsedResults?: Array<{ ParsedText?: string }>;
      ErrorMessage?: string | string[];
    }>();

    if (payload.IsErroredOnProcessing) {
      console.error('[patient-phr] OCR.space processing error:', payload.ErrorMessage);
      return null;
    }

    const rawText = (payload.ParsedResults ?? [])
      .map((entry) => entry.ParsedText ?? '')
      .join('\n')
      .trim();

    return rawText.length >= 10 ? rawText : null;
  } catch (error) {
    console.error('[patient-phr] OCR extraction failed:', error);
    return null;
  }
}

async function maybeImportPrescriptionMedications(
  c: any,
  uhid: string,
  uploadFile: File,
  documentType: string,
  documentTitle: string,
) {
  if (documentType !== 'prescription') {
    return { status: 'skipped', extracted_count: 0, medications: [] as string[] };
  }

  const rawText = await extractPrescriptionTextWithOcr(c, uploadFile);
  if (!rawText) {
    return {
      status: c.env.OCR_SPACE_API_KEY ? 'no_text' : 'unavailable',
      extracted_count: 0,
      medications: [] as string[],
    };
  }

  const medications = extractMedicationCandidatesFromPrescriptionText(rawText);
  if (medications.length === 0) {
    return { status: 'no_match', extracted_count: 0, medications: [] as string[] };
  }

  const note = `Prescription upload: ${documentTitle}`;
  for (const medication of medications) {
    await upsertCurrentMedication(c, uhid, medication, note);
  }

  return {
    status: 'imported',
    extracted_count: medications.length,
    medications,
  };
}

async function getVaultDocument(
  c: any,
  uhid: string,
  documentId: string,
): Promise<{
  id: number;
  document_url: string | null;
  storage_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size?: number | null;
  source_kind: string | null;
  title?: string | null;
  document_type?: string | null;
  document_date?: string | null;
  notes?: string | null;
} | null> {
  return c.env.DB.prepare(
    `SELECT id, document_url, storage_key, file_name, mime_type, file_size, source_kind, title, document_type, document_date, notes
     FROM global_patient_vault_documents
     WHERE id = ? AND uhid = ?`
  ).bind(documentId, uhid).first();
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient Health Vault (PHV)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/patient-phr/vault
 * List patient's uploaded historical documents
 */
patientPhrRoutes.get('/vault', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  let results: Record<string, unknown>[] = [];
  try {
    const response = await c.env.DB.prepare(
      `SELECT * FROM global_patient_vault_documents 
       WHERE uhid = ? 
       ORDER BY entered_at DESC`
    )
      .bind(uhid)
      .all<Record<string, unknown>>();
    results = response.results ?? [];
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_vault_documents')) {
      return c.json({ documents: [] });
    }
    throw error;
  }

  const documents = results.map((row: Record<string, unknown>) => {
    const sourceKind = typeof row.source_kind === 'string'
      ? row.source_kind
      : row.storage_key
        ? 'uploaded_file'
        : 'external_link';

    return {
      ...row,
      source_kind: sourceKind,
      document_url: sourceKind === 'uploaded_file' && row.id
        ? buildVaultFileUrl(row.id as number)
        : row.document_url,
    };
  });

  return c.json({ documents });
});

/**
 * POST /api/patient-phr/vault
 * Record a new vaulted document (Note: File upload direct to R2 is separate, this stores metadata)
 */
const vaultSchema = z.object({
  document_url: z.string().url(),
  document_type: z.enum(['prescription', 'lab_report', 'discharge_summary', 'other']),
  document_date: z.string().optional(),
  title: z.string().max(255),
  notes: z.string().optional()
});

patientPhrRoutes.post('/vault', zValidator('json', vaultSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');

  const { success } = await c.env.DB.prepare(
    `INSERT INTO global_patient_vault_documents 
    (uhid, document_url, document_type, document_date, title, notes, source_kind) 
    VALUES (?, ?, ?, ?, ?, ?, 'external_link')`
  )
    .bind(uhid, data.document_url, data.document_type, data.document_date || null, data.title, data.notes || null)
    .run();

  if (!success) return c.json({ error: 'Failed to insert document' }, 500);

  return c.json({ success: true, message: 'Document added to vault' }, 201);
});

patientPhrRoutes.post('/vault/upload', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const formData = await c.req.formData();
  const file = formData.get('file');
  const title = formData.get('title');
  const documentType = formData.get('document_type');
  const documentDate = formData.get('document_date');
  const notes = formData.get('notes');

  if (!file || typeof file === 'string') {
    return c.json({ error: 'File is required' }, 400);
  }

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Document title is required' }, 400);
  }

  const uploadFile = file as unknown as File;
  const normalizedDocumentType = typeof documentType === 'string' && ['prescription', 'lab_report', 'discharge_summary', 'other'].includes(documentType)
    ? documentType
    : 'other';

  if (!VAULT_ALLOWED_MIME_TYPES.includes(uploadFile.type as (typeof VAULT_ALLOWED_MIME_TYPES)[number])) {
    return c.json({ error: `File type not allowed. Allowed: ${VAULT_ALLOWED_MIME_TYPES.join(', ')}` }, 400);
  }

  if (uploadFile.size > VAULT_MAX_FILE_SIZE) {
    return c.json({ error: 'File size exceeds 10MB limit' }, 400);
  }

  const sanitizedName = sanitizeFileName(uploadFile.name || 'vault-upload');
  const key = `global-patient-vault/${uhid}/${Date.now()}_${sanitizedName}`;

  await c.env.UPLOADS.put(key, uploadFile.stream(), {
    httpMetadata: { contentType: uploadFile.type },
  });

  const insertResult = await c.env.DB.prepare(
    `INSERT INTO global_patient_vault_documents
      (uhid, document_url, document_type, document_date, title, notes, storage_key, file_name, mime_type, file_size, source_kind)
     VALUES (?, 'pending://vault-upload', ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded_file')`
  ).bind(
    uhid,
    normalizedDocumentType,
    typeof documentDate === 'string' && documentDate ? documentDate : null,
    title.trim(),
    typeof notes === 'string' && notes ? notes : null,
    key,
    uploadFile.name,
    uploadFile.type,
    uploadFile.size,
  ).run();

  const documentId = Number(insertResult.meta.last_row_id);
  const documentUrl = buildVaultFileUrl(documentId);

  await c.env.DB.prepare(
    `UPDATE global_patient_vault_documents
     SET document_url = ?
     WHERE id = ? AND uhid = ?`
  ).bind(documentUrl, documentId, uhid).run();

  const medicationImport = await maybeImportPrescriptionMedications(
    c,
    uhid,
    uploadFile,
    normalizedDocumentType,
    title.trim(),
  );

  return c.json({
    success: true,
    message: 'Document uploaded to vault',
    document: {
      id: documentId,
      title: title.trim(),
      document_type: normalizedDocumentType,
      document_date: typeof documentDate === 'string' && documentDate ? documentDate : null,
      notes: typeof notes === 'string' && notes ? notes : null,
      document_url: documentUrl,
      file_name: uploadFile.name,
      mime_type: uploadFile.type,
      file_size: uploadFile.size,
      source_kind: 'uploaded_file',
    },
    medication_import: medicationImport,
  }, 201);
});

const updateVaultSchema = z.object({
  title: z.string().trim().min(1).max(255),
  document_type: z.enum(['prescription', 'lab_report', 'discharge_summary', 'other']),
  document_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  document_url: z.string().url().optional(),
});

patientPhrRoutes.patch('/vault/:id', zValidator('json', updateVaultSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const documentId = c.req.param('id');
  const existing = await getVaultDocument(c, uhid, documentId);
  if (!existing) {
    return c.json({ error: 'Document not found' }, 404);
  }

  const data = c.req.valid('json');
  const documentUrl = existing.source_kind === 'external_link'
    ? data.document_url ?? existing.document_url
    : buildVaultFileUrl(documentId);

  await c.env.DB.prepare(
    `UPDATE global_patient_vault_documents
     SET title = ?, document_type = ?, document_date = ?, notes = ?, document_url = ?
     WHERE id = ? AND uhid = ?`
  ).bind(
    data.title,
    data.document_type,
    data.document_date ?? null,
    data.notes ?? null,
    documentUrl,
    documentId,
    uhid,
  ).run();

  return c.json({
    success: true,
    message: 'Vault document updated',
    document: {
      id: Number(documentId),
      title: data.title,
      document_type: data.document_type,
      document_date: data.document_date ?? null,
      notes: data.notes ?? null,
      document_url: documentUrl,
      source_kind: existing.source_kind || (existing.storage_key ? 'uploaded_file' : 'external_link'),
    },
  });
});

patientPhrRoutes.post('/vault/:id/replace', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const documentId = c.req.param('id');
  const existing = await getVaultDocument(c, uhid, documentId);
  if (!existing) {
    return c.json({ error: 'Document not found' }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get('file');
  const title = formData.get('title');
  const documentType = formData.get('document_type');
  const documentDate = formData.get('document_date');
  const notes = formData.get('notes');
  const externalUrl = formData.get('document_url');

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Document title is required' }, 400);
  }

  const normalizedDocumentType = typeof documentType === 'string' && ['prescription', 'lab_report', 'discharge_summary', 'other'].includes(documentType)
    ? documentType
    : 'other';

  if (file && typeof file !== 'string') {
    const uploadFile = file as unknown as File;
    if (!VAULT_ALLOWED_MIME_TYPES.includes(uploadFile.type as (typeof VAULT_ALLOWED_MIME_TYPES)[number])) {
      return c.json({ error: `File type not allowed. Allowed: ${VAULT_ALLOWED_MIME_TYPES.join(', ')}` }, 400);
    }
    if (uploadFile.size > VAULT_MAX_FILE_SIZE) {
      return c.json({ error: 'File size exceeds 10MB limit' }, 400);
    }

    const sanitizedName = sanitizeFileName(uploadFile.name || 'vault-replacement');
    const nextStorageKey = `global-patient-vault/${uhid}/${Date.now()}_${sanitizedName}`;
    await c.env.UPLOADS.put(nextStorageKey, uploadFile.stream(), {
      httpMetadata: { contentType: uploadFile.type },
    });

    const nextDocumentUrl = buildVaultFileUrl(documentId);
    await c.env.DB.prepare(
      `UPDATE global_patient_vault_documents
       SET document_url = ?, title = ?, document_type = ?, document_date = ?, notes = ?, storage_key = ?, file_name = ?, mime_type = ?, file_size = ?, source_kind = 'uploaded_file'
       WHERE id = ? AND uhid = ?`
    ).bind(
      nextDocumentUrl,
      title.trim(),
      normalizedDocumentType,
      typeof documentDate === 'string' && documentDate ? documentDate : null,
      typeof notes === 'string' && notes ? notes : null,
      nextStorageKey,
      uploadFile.name,
      uploadFile.type,
      uploadFile.size,
      documentId,
      uhid,
    ).run();

    if (existing.storage_key) {
      await c.env.UPLOADS.delete(existing.storage_key);
    }

    const medicationImport = await maybeImportPrescriptionMedications(
      c,
      uhid,
      uploadFile,
      normalizedDocumentType,
      title.trim(),
    );

    return c.json({
      success: true,
      message: 'Vault document replaced',
      document: {
        id: Number(documentId),
        title: title.trim(),
        document_type: normalizedDocumentType,
        document_date: typeof documentDate === 'string' && documentDate ? documentDate : null,
        notes: typeof notes === 'string' && notes ? notes : null,
        document_url: nextDocumentUrl,
        file_name: uploadFile.name,
        mime_type: uploadFile.type,
        file_size: uploadFile.size,
        source_kind: 'uploaded_file',
      },
      medication_import: medicationImport,
    });
  }

  if (typeof externalUrl === 'string' && externalUrl.startsWith('http')) {
    await c.env.DB.prepare(
      `UPDATE global_patient_vault_documents
       SET title = ?, document_type = ?, document_date = ?, notes = ?, document_url = ?, storage_key = NULL, file_name = NULL, mime_type = NULL, file_size = NULL, source_kind = 'external_link'
       WHERE id = ? AND uhid = ?`
    ).bind(
      title.trim(),
      normalizedDocumentType,
      typeof documentDate === 'string' && documentDate ? documentDate : null,
      typeof notes === 'string' && notes ? notes : null,
      externalUrl,
      documentId,
      uhid,
    ).run();

    if (existing.storage_key) {
      await c.env.UPLOADS.delete(existing.storage_key);
    }

    return c.json({
      success: true,
      message: 'Vault document replaced',
      document: {
        id: Number(documentId),
        title: title.trim(),
        document_type: normalizedDocumentType,
        document_date: typeof documentDate === 'string' && documentDate ? documentDate : null,
        notes: typeof notes === 'string' && notes ? notes : null,
        document_url: externalUrl,
        source_kind: 'external_link',
      },
    });
  }

  return c.json({ error: 'Replacement file or link is required' }, 400);
});

patientPhrRoutes.delete('/vault/:id', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const documentId = c.req.param('id');
  const existing = await getVaultDocument(c, uhid, documentId);
  if (!existing) {
    return c.json({ error: 'Document not found' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM global_patient_vault_documents WHERE id = ? AND uhid = ?'
  ).bind(documentId, uhid).run();

  if (existing.storage_key) {
    await c.env.UPLOADS.delete(existing.storage_key);
  }

  return c.json({ success: true, message: 'Vault document deleted' });
});

patientPhrRoutes.get('/vault/:id/file', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const documentId = c.req.param('id');
  const document = await getVaultDocument(c, uhid, documentId);

  if (!document) {
    return c.json({ error: 'Document not found' }, 404);
  }

  const sourceKind = document.source_kind || (document.storage_key ? 'uploaded_file' : 'external_link');
  if (sourceKind !== 'uploaded_file' || !document.storage_key) {
    if (document.document_url?.startsWith('http://') || document.document_url?.startsWith('https://')) {
      return c.redirect(document.document_url, 302);
    }
    return c.json({ error: 'Document file is not stored in vault storage' }, 400);
  }

  const object = await c.env.UPLOADS.get(document.storage_key);
  if (!object) {
    return c.json({ error: 'Document file missing from storage' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': document.mime_type || object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${sanitizeFileName(document.file_name || 'vault-file')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Patient-Reported Clinical Data (PRD)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/patient-phr/reported-data
 * List patient-reported data (Allergies, Meds, Conditions)
 */
patientPhrRoutes.get('/reported-data', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    try {
      const reminderResult = await c.env.DB.prepare(
        `SELECT medicine_name, strength
         FROM global_patient_medicine_reminders
         WHERE uhid = ? AND is_active = 1`
      ).bind(uhid).all();
      const activeReminders = (reminderResult.results ?? []) as Array<{ medicine_name: string; strength: string | null }>;

      for (const reminder of activeReminders ?? []) {
        await upsertCurrentMedication(
          c,
          uhid,
          buildReportedMedicationName(reminder.medicine_name, reminder.strength),
          'Backfilled from medicine reminder',
        );
      }
    } catch (error) {
      if (!isMissingTableError(error, 'global_patient_medicine_reminders')) throw error;
    }

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM global_patient_reported_data 
       WHERE uhid = ? 
       ORDER BY created_at DESC`
    )
      .bind(uhid)
      .all();

    return c.json({ reported_data: results ?? [] });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_reported_data')) {
      return c.json({ reported_data: [] });
    }
    throw error;
  }
});

/**
 * POST /api/patient-phr/reported-data
 * Submit new PRD. Starts with FHIR status 'unconfirmed'
 */
const prdSchema = z.object({
  category: z.enum(['allergy', 'chronic_condition', 'current_health_issue', 'current_medication']),
  name: z.string().min(1),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  clinical_status: z.enum(['active', 'inactive', 'resolved']).default('active'),
  start_date: z.string().optional(),
  notes: z.string().optional(),
});

patientPhrRoutes.post('/reported-data', zValidator('json', prdSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');

  const { success } = await c.env.DB.prepare(
    `INSERT INTO global_patient_reported_data 
    (uhid, category, name, severity, clinical_status, verification_status, start_date, notes) 
    VALUES (?, ?, ?, ?, ?, 'unconfirmed', ?, ?)`
  )
    .bind(
      uhid, 
      data.category, 
      data.name, 
      data.severity || null, 
      data.clinical_status, 
      data.start_date || null, 
      data.notes || null
    )
    .run();

  if (!success) return c.json({ error: 'Failed to record reported data' }, 500);

  return c.json({ success: true, message: 'Data reported successfully' }, 201);
});

patientPhrRoutes.get('/adverse-reactions', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT id, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes,
             source, review_status, reviewed_at, review_notes, created_at, updated_at
      FROM global_patient_adverse_reactions
      WHERE uhid = ?
      ORDER BY created_at DESC
    `).bind(uhid).all();

    return c.json({ adverse_reactions: results ?? [] });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_adverse_reactions')) {
      return c.json({ adverse_reactions: [] });
    }
    throw error;
  }
});

patientPhrRoutes.post('/adverse-reactions', zValidator('json', adverseReactionSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');
  const result = await c.env.DB.prepare(`
    INSERT INTO global_patient_adverse_reactions
      (uhid, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes, source, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'patient_reported', 'pending_review')
  `).bind(
    uhid,
    data.medication_name,
    data.generic_name ?? null,
    data.reaction,
    data.severity,
    data.onset_date ?? null,
    data.outcome_status ?? null,
    data.notes ?? null,
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Adverse reaction reported' }, 201);
});

patientPhrRoutes.get('/lifestyle-logs', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT id, logged_on, sleep_hours, exercise_minutes, mood, energy_level, water_glasses,
             symptom_score, symptoms, diet_notes, notes, source, review_status, reviewed_at, review_notes, created_at, updated_at
      FROM global_patient_lifestyle_logs
      WHERE uhid = ?
      ORDER BY logged_on DESC, created_at DESC
    `).bind(uhid).all();

    return c.json({ lifestyle_logs: results ?? [] });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_lifestyle_logs')) {
      return c.json({ lifestyle_logs: [] });
    }
    throw error;
  }
});

patientPhrRoutes.post('/lifestyle-logs', zValidator('json', lifestyleLogSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');
  const patientId = parseInt(c.get('userId'), 10);
  const result = await c.env.DB.prepare(`
    INSERT INTO global_patient_lifestyle_logs
      (uhid, logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms, diet_notes, water_glasses, notes, source, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'patient_reported', 'pending_review')
  `).bind(
    uhid,
    data.logged_on,
    data.sleep_hours ?? null,
    data.exercise_minutes ?? null,
    data.mood ?? null,
    data.energy_level ?? null,
    data.symptom_score ?? null,
    data.symptoms ?? null,
    data.diet_notes ?? null,
    data.water_glasses ?? null,
    data.notes ?? null,
  ).run();

  // Dual-write into normalized wellness log tables
  const db = c.env.DB;
  if (data.mood) {
    const moodMap: Record<string, string> = {
      excellent: 'great', very_low: 'struggling', low: 'low',
      neutral: 'okay', good: 'good',
    };
    await db.prepare(
      'INSERT INTO mood_log (patient_id, mood, energy_level, note) VALUES (?, ?, ?, ?)',
    ).bind(patientId, moodMap[data.mood] ?? data.mood, data.energy_level ? ({ very_low: 2, low: 4, moderate: 6, high: 8 }[data.energy_level] ?? null) : null, data.notes ?? null).run();
  }
  if (data.sleep_hours != null) {
    const durationMin = Math.round(data.sleep_hours * 60);
    await db.prepare(
      'INSERT INTO sleep_log (patient_id, duration_min, source) VALUES (?, ?, ?)',
    ).bind(patientId, durationMin, 'manual').run();
  }
  if (data.exercise_minutes != null && data.exercise_minutes > 0) {
    await db.prepare(
      'INSERT INTO activity_log (patient_id, activity_type, duration_min, source) VALUES (?, ?, ?, ?)',
    ).bind(patientId, 'walk', data.exercise_minutes, 'manual').run();
  }
  if (data.water_glasses != null && data.water_glasses > 0) {
    const amountMl = data.water_glasses * 250;
    await db.prepare(
      'INSERT INTO water_log (patient_id, amount_ml) VALUES (?, ?)',
    ).bind(patientId, amountMl).run();
  }
  if (data.symptoms) {
    await db.prepare(
      'INSERT INTO symptom_log (patient_id, symptom, severity) VALUES (?, ?, ?)',
    ).bind(patientId, data.symptoms, data.symptom_score ?? null).run();
  }

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Lifestyle log added' }, 201);
});

patientPhrRoutes.get('/vitals', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT id, logged_on, systolic, diastolic, heart_rate, blood_sugar, blood_sugar_context, notes,
             source, review_status, reviewed_at, review_notes, created_at, updated_at
      FROM global_patient_vitals
      WHERE uhid = ?
      ORDER BY logged_on DESC, created_at DESC
    `).bind(uhid).all();

    return c.json({ vitals: results ?? [] });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_vitals')) {
      return c.json({ vitals: [] });
    }
    throw error;
  }
});

patientPhrRoutes.post('/vitals', zValidator('json', vitalsLogSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');
  const result = await c.env.DB.prepare(`
    INSERT INTO global_patient_vitals
      (uhid, logged_on, systolic, diastolic, heart_rate, blood_sugar, blood_sugar_context, notes, source, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'patient_reported', 'pending_review')
  `).bind(
    uhid,
    data.logged_on,
    data.systolic ?? null,
    data.diastolic ?? null,
    data.heart_rate ?? null,
    data.blood_sugar ?? null,
    data.blood_sugar_context ?? null,
    data.notes ?? null,
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Vitals logged successfully' }, 201);
});

// ─── Wellness Trends (computed from lifestyle-logs) ──────────────────────────
patientPhrRoutes.get('/wellness-trends', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const period = Number(c.req.query('period') ?? 7);
  const validPeriods = [7, 30, 90];
  const days = validPeriods.includes(period) ? period : 7;

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT logged_on, sleep_hours, exercise_minutes, mood, energy_level, water_glasses
      FROM global_patient_lifestyle_logs
      WHERE uhid = ?
        AND logged_on >= date('now', '-' || ? || ' days')
      ORDER BY logged_on ASC
    `).bind(uhid, days).all();

    const logs = results ?? [];
    const totalLogs = logs.length;

    // Compute aggregates
    const moodMap: Record<string, number> = { very_low: 1, low: 2, neutral: 3, good: 4, excellent: 5 };
    const energyMap: Record<string, number> = { very_low: 1, low: 2, moderate: 3, high: 4 };

    let sleepSum = 0, exerciseSum = 0, moodSum = 0, energySum = 0, waterSum = 0;
    let sleepCount = 0, moodCount = 0, energyCount = 0;

    for (const log of logs as any[]) {
      if (log.sleep_hours != null) { sleepSum += log.sleep_hours; sleepCount++; }
      if (log.exercise_minutes != null) { exerciseSum += log.exercise_minutes; }
      if (log.mood && moodMap[log.mood]) { moodSum += moodMap[log.mood]; moodCount++; }
      if (log.energy_level && energyMap[log.energy_level]) { energySum += energyMap[log.energy_level]; energyCount++; }
      if (log.water_glasses != null) { waterSum += log.water_glasses; }
    }

    const trends = {
      period: days,
      total_checkins: totalLogs,
      consistency: days > 0 ? Math.round((totalLogs / days) * 100) : 0,
      avg_sleep: sleepCount > 0 ? Math.round((sleepSum / sleepCount) * 10) / 10 : null,
      total_exercise: exerciseSum,
      avg_mood: moodCount > 0 ? Math.round((moodSum / moodCount) * 10) / 10 : null,
      avg_energy: energyCount > 0 ? Math.round((energySum / energyCount) * 10) / 10 : null,
      total_water: waterSum,
      daily_data: logs,
    };

    return c.json({ trends });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_lifestyle_logs')) {
      return c.json({ trends: { period: days, total_checkins: 0, consistency: 0, daily_data: [] } });
    }
    throw error;
  }
});

// ─── Health Tips (personalized + Bengali) ────────────────────────────────────
patientPhrRoutes.get('/health-tips', async (c) => {
  const uhid = await resolvePatientUhid(c);

  // Full tip bank — each tip has a relevance_tags array for data-driven scoring
  const ALL_TIPS = [
    { id: 'tip-1', category: 'nutrition', categoryBn: 'পুষ্টি', title: 'প্রতিদিন ৫ রঙের সবজি', summary: 'প্রতিদিন কমপক্ষে ৫ ধরনের রঙিন সবজি খান — লাল, সবুজ, হলুদ, বেগুনি ও সাদা। প্রতিটি রঙ ভিন্ন ভিন্ন পুষ্টি উপাদান সরবরাহ করে।', emoji: '🥗', readTime: '৩ মিনিট', tags: ['nutrition'] },
    { id: 'tip-2', category: 'exercise', categoryBn: 'ব্যায়াম', title: 'সকালে ১৫ মিনিট হাঁটুন', summary: 'সকালের হালকা হাঁটা রক্তচাপ নিয়ন্ত্রণে, মানসিক চাপ কমাতে এবং শরীরের এনার্জি বাড়াতে কার্যকর।', emoji: '🚶', readTime: '২ মিনিট', tags: ['low_exercise', 'high_bp'] },
    { id: 'tip-3', category: 'mental', categoryBn: 'মানসিক', title: 'গভীর শ্বাস-প্রশ্বাসের কৌশল', summary: '৪-৭-৮ পদ্ধতিতে শ্বাস নিন: ৪ সেকেন্ড শ্বাস নিন, ৭ সেকেন্ড ধরে রাখুন, ৮ সেকেন্ডে ছাড়ুন। উদ্বেগ কমায় ও ঘুমের মান উন্নত করে।', emoji: '🧘', readTime: '৪ মিনিট', tags: ['low_mood', 'low_sleep', 'stress'] },
    { id: 'tip-4', category: 'sleep', categoryBn: 'ঘুম', title: 'ঘুমের আগে স্ক্রিন বন্ধ রাখুন', summary: 'ঘুমানোর অন্তত ১ ঘণ্টা আগে ফোন ও ল্যাপটপ বন্ধ করুন। নীল আলো মেলাটোনিন উৎপাদনে বাধা দেয়।', emoji: '😴', readTime: '৩ মিনিট', tags: ['low_sleep'] },
    { id: 'tip-5', category: 'nutrition', categoryBn: 'পুষ্টি', title: 'পর্যাপ্ত পানি পান করুন', summary: 'প্রতিদিন কমপক্ষে ৮ গ্লাস (২ লিটার) পানি পান করুন। ডিহাইড্রেশন মাথাব্যথা ও ক্লান্তির কারণ।', emoji: '💧', readTime: '২ মিনিট', tags: ['low_energy', 'nutrition'] },
    { id: 'tip-6', category: 'exercise', categoryBn: 'ব্যায়াম', title: 'প্রতি ঘণ্টায় উঠে দাঁড়ান', summary: 'দীর্ঘক্ষণ বসে থাকা হৃদরোগ ও ডায়াবেটিসের ঝুঁকি বাড়ায়। প্রতি ঘণ্টায় ৫ মিনিট হালকা স্ট্রেচিং করুন।', emoji: '🧍', readTime: '২ মিনিট', tags: ['low_exercise'] },
    { id: 'tip-7', category: 'sleep', categoryBn: 'ঘুম', title: 'নিয়মিত ঘুমের সময়সূচী মানুন', summary: 'প্রতিদিন একই সময়ে ঘুমান ও একই সময়ে উঠুন — এমনকি ছুটির দিনেও। এটি আপনার বায়োলজিক্যাল ক্লক ঠিক রাখে।', emoji: '⏰', readTime: '৩ মিনিট', tags: ['low_sleep'] },
    { id: 'tip-8', category: 'mental', categoryBn: 'মানসিক', title: 'প্রকৃতিতে সময় কাটান', summary: 'প্রতিদিন ২০ মিনিট গাছপালা বা প্রকৃতির মাঝে কাটালে কর্টিসল (স্ট্রেস হরমোন) কমে ও মানসিক শান্তি আসে।', emoji: '🌳', readTime: '২ মিনিট', tags: ['low_mood', 'stress'] },
    { id: 'tip-9', category: 'nutrition', categoryBn: 'পুষ্টি', title: 'রাতে ভারি খাবার এড়িয়ে চলুন', summary: 'রাত ৮টার পর হালকা খাবার খেলে হজমশক্তি ভালো থাকে ও ঘুমের মান ৪০% উন্নত হয়।', emoji: '🍽️', readTime: '৩ মিনিট', tags: ['low_sleep', 'nutrition'] },
    { id: 'tip-10', category: 'exercise', categoryBn: 'ব্যায়াম', title: 'সিঁড়ি ব্যবহার করুন', summary: 'লিফটের বদলে সিঁড়ি ব্যবহার করলে প্রতিদিন অতিরিক্ত ১০০-১৫০ ক্যালোরি বার্ন হয় ও হৃদপিণ্ড সুস্থ থাকে।', emoji: '🏃', readTime: '২ মিনিট', tags: ['low_exercise'] },
    { id: 'tip-11', category: 'mental', categoryBn: 'মানসিক', title: 'কৃতজ্ঞতার ডায়েরি লিখুন', summary: 'প্রতি রাতে ঘুমানোর আগে ৩টি বিষয় লিখুন যার জন্য আপনি আজ কৃতজ্ঞ। এটি ইতিবাচক মানসিকতা তৈরি করে।', emoji: '📝', readTime: '২ মিনিট', tags: ['low_mood'] },
    { id: 'tip-12', category: 'nutrition', categoryBn: 'পুষ্টি', title: 'সকালে লেবু পানি পান করুন', summary: 'উষ্ণ লেবু পানি হজমশক্তি বাড়ায়, শরীরের টক্সিন বের করে ও ভিটামিন সি সরবরাহ করে।', emoji: '🍋', readTime: '২ মিনিট', tags: ['nutrition'] },
  ];

  // Default persona flags
  let persona = { low_sleep: false, low_mood: false, low_exercise: false, low_energy: false, high_bp: false, stress: false };

  // If authenticated, fetch recent data to personalize
  if (uhid) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      // Fetch recent lifestyle logs
      const { results: logs } = await c.env.DB.prepare(`
        SELECT sleep_hours, exercise_minutes, mood_score, energy_level
        FROM global_patient_lifestyle_logs
        WHERE uhid = ? AND logged_on >= ?
        ORDER BY logged_on DESC LIMIT 7
      `).bind(uhid, sevenDaysAgo).all() as { results: Array<{ sleep_hours?: number; exercise_minutes?: number; mood_score?: number; energy_level?: number }> };

      if (logs.length > 0) {
        const avgSleep = logs.reduce((s, l) => s + (l.sleep_hours ?? 7), 0) / logs.length;
        const avgExercise = logs.reduce((s, l) => s + (l.exercise_minutes ?? 30), 0) / logs.length;
        const avgMood = logs.reduce((s, l) => s + (l.mood_score ?? 3), 0) / logs.length;
        const avgEnergy = logs.reduce((s, l) => s + (l.energy_level ?? 3), 0) / logs.length;

        if (avgSleep < 6.5) persona.low_sleep = true;
        if (avgExercise < 15) persona.low_exercise = true;
        if (avgMood < 3) persona.low_mood = true;
        if (avgEnergy < 3) persona.low_energy = true;
        if (avgMood < 2.5 || avgEnergy < 2) persona.stress = true;
      }

      // Check for high BP
      const { results: vitals } = await c.env.DB.prepare(`
        SELECT systolic_bp FROM global_patient_vitals
        WHERE uhid = ? AND logged_on >= ? AND systolic_bp IS NOT NULL
        ORDER BY logged_on DESC LIMIT 3
      `).bind(uhid, sevenDaysAgo).all() as { results: Array<{ systolic_bp?: number }> };

      if (vitals.length > 0) {
        const avgBp = vitals.reduce((s, v) => s + (v.systolic_bp ?? 120), 0) / vitals.length;
        if (avgBp > 135) persona.high_bp = true;
      }
    } catch { /* silently fall back to generic tips */ }
  }

  // Score each tip by matching tags to persona
  const activeFlags = Object.entries(persona).filter(([, v]) => v).map(([k]) => k);

  const scored = ALL_TIPS.map((tip) => {
    let score = 0;
    for (const tag of tip.tags) {
      if (activeFlags.includes(tag)) score += 10;
    }
    // Baseline score for variety
    score += Math.random() * 2;
    return { ...tip, _score: score, personalized: score >= 10 };
  });

  // Sort: personalized first, then by score descending
  scored.sort((a, b) => b._score - a._score);

  // Return tips without internal scoring fields
  const tips = scored.map(({ _score, tags, personalized, ...rest }) => ({
    ...rest,
    personalized,
  }));

  return c.json({
    tips,
    persona_summary: activeFlags.length > 0 ? activeFlags : null,
  });
});

// ─── Medicine Reminders CRUD ─────────────────────────────────────────────────
const medicineReminderSchema = z.object({
  medicine_name: z.string().min(1),
  dosage: z.string().optional(),
  strength: z.string().optional(),
  dose_amount: z.string().optional(),
  time_slot: z.string().min(1),
  time_label: z.string().optional(),
  instruction: z.enum(['before_meal', 'after_meal', 'with_meal', 'anytime']).optional(),
  instruction_label: z.string().optional(),
});

patientPhrRoutes.get('/medicine-reminders', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT id, medicine_name, dosage, strength, dose_amount, time_slot, time_label, instruction, instruction_label, is_active, created_at
      FROM global_patient_medicine_reminders
      WHERE uhid = ? AND is_active = 1
      ORDER BY time_slot ASC
    `).bind(uhid).all();

    // Get today's adherence
    const today = new Date().toISOString().slice(0, 10);
    const { results: adherence } = await c.env.DB.prepare(`
      SELECT reminder_id, taken_at, skipped
      FROM global_patient_medicine_adherence
      WHERE uhid = ? AND taken_date = ?
    `).bind(uhid, today).all();

    const adherenceMap = new Map((adherence ?? []).map((a: any) => [a.reminder_id, a]));
    const reminders = (results ?? []).map((r: any) => ({
      ...r,
      taken_today: adherenceMap.has(r.id),
      taken_at: (adherenceMap.get(r.id) as any)?.taken_at ?? null,
      skipped: (adherenceMap.get(r.id) as any)?.skipped === 1,
    }));

    return c.json({ reminders });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_medicine_reminders')) {
      return c.json({ reminders: [] });
    }
    throw error;
  }
});

patientPhrRoutes.post('/medicine-reminders', zValidator('json', medicineReminderSchema), async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const data = c.req.valid('json');
  const result = await c.env.DB.prepare(`
    INSERT INTO global_patient_medicine_reminders
      (uhid, medicine_name, dosage, strength, dose_amount, time_slot, time_label, instruction, instruction_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    uhid,
    data.medicine_name,
    data.dosage ?? data.dose_amount ?? null,
    data.strength ?? null,
    data.dose_amount ?? null,
    data.time_slot,
    data.time_label ?? null,
    data.instruction ?? 'after_meal',
    data.instruction_label ?? null,
  ).run();

  await upsertCurrentMedication(
    c,
    uhid,
    buildReportedMedicationName(data.medicine_name, data.strength ?? null),
    'Added from medicine reminder',
  );

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Medicine reminder added' }, 201);
});

patientPhrRoutes.delete('/medicine-reminders/:id', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const id = c.req.param('id');
  await c.env.DB.prepare(`
    UPDATE global_patient_medicine_reminders SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND uhid = ?
  `).bind(id, uhid).run();

  return c.json({ success: true, message: 'Medicine reminder removed' });
});

// Mark medicine as taken
patientPhrRoutes.post('/medicine-reminders/:id/take', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  const reminderId = c.req.param('id');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Check if already taken today
  const existing = await c.env.DB.prepare(`
    SELECT id FROM global_patient_medicine_adherence
    WHERE uhid = ? AND reminder_id = ? AND taken_date = ?
  `).bind(uhid, reminderId, today).first();

  if (existing) {
    return c.json({ success: true, message: 'Already marked as taken today' });
  }

  await c.env.DB.prepare(`
    INSERT INTO global_patient_medicine_adherence (uhid, reminder_id, taken_date, taken_at)
    VALUES (?, ?, ?, ?)
  `).bind(uhid, reminderId, today, now).run();

  return c.json({ success: true, message: 'Medicine marked as taken' }, 201);
});

// Weekly adherence summary
patientPhrRoutes.get('/medicine-adherence/weekly', async (c) => {
  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  try {
    // Total active reminders
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM global_patient_medicine_reminders WHERE uhid = ? AND is_active = 1
    `).bind(uhid).first() as any;
    const totalReminders = countResult?.total ?? 0;

    if (totalReminders === 0) {
      return c.json({ weekly: { days: [], avg: 0, total_reminders: 0 } });
    }

    // Last 7 days adherence
    const { results } = await c.env.DB.prepare(`
      SELECT taken_date, COUNT(*) as taken_count
      FROM global_patient_medicine_adherence
      WHERE uhid = ? AND taken_date >= date('now', '-7 days')
      GROUP BY taken_date
      ORDER BY taken_date ASC
    `).bind(uhid).all();

    const adherenceMap = new Map((results ?? []).map((r: any) => [r.taken_date, r.taken_count]));
    const days: { date: string; percent: number }[] = [];
    let totalPercent = 0;

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const taken = (adherenceMap.get(dateStr) as number) ?? 0;
      const pct = Math.round((taken / totalReminders) * 100);
      days.push({ date: dateStr, percent: pct });
      totalPercent += pct;
    }

    return c.json({
      weekly: {
        days,
        avg: Math.round(totalPercent / 7),
        total_reminders: totalReminders,
      },
    });
  } catch (error) {
    if (isMissingTableError(error, 'global_patient_medicine_reminders') ||
        isMissingTableError(error, 'global_patient_medicine_adherence')) {
      return c.json({ weekly: { days: [], avg: 0, total_reminders: 0 } });
    }
    throw error;
  }
});

// ─── AI Health Buddy ─────────────────────────────────────────────────────────

const aiBuddyMessageSchema = z.object({
  message: z.string().min(1).max(500),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(10).optional(),
});

patientPhrRoutes.post('/ai-buddy/chat', zValidator('json', aiBuddyMessageSchema), async (c) => {
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'AI সার্ভিস বর্তমানে অনুপলব্ধ' }, 503);
  }

  const uhid = await resolvePatientUhid(c);
  if (!uhid) return c.json({ error: 'Patient identity not verified' }, 403);

  // Simple rate limit: 20 messages per 5 minutes per patient via KV
  const rateLimitKey = `ai_buddy_rl:${uhid}`;
  try {
    const current = await c.env.KV.get(rateLimitKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 20) {
      return c.json({
        reply: '⏳ আপনি অনেক মেসেজ পাঠিয়েছেন। কয়েক মিনিট পর আবার চেষ্টা করুন।',
        rateLimited: true,
      });
    }
    await c.env.KV.put(rateLimitKey, String(count + 1), { expirationTtl: 300 });
  } catch {
    // KV failure shouldn't block the request
  }

  const { message, conversationHistory } = c.req.valid('json');

  // Crisis detection — intercept before AI call
  const crisisResponse = detectCrisis(message);
  if (crisisResponse) {
    const helplineText = crisisResponse.helplines
      .map((h) => `📞 ${h.name}: ${h.number}\n   ${h.description_bn}`)
      .join('\n\n');
    return c.json({
      reply: `${crisisResponse.message_bn}\n\n${helplineText}`,
      isCrisis: true,
    });
  }

  // Fetch recent lifestyle context for personalized advice
  let lifestyleContext = '';
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT logged_on, sleep_hours, exercise_minutes, mood, energy_level, water_glasses
      FROM global_patient_lifestyle_logs
      WHERE uhid = ?
      ORDER BY logged_on DESC
      LIMIT 7
    `).bind(uhid).all();

    if (results && results.length > 0) {
      const logs = results as Array<{
        logged_on: string; sleep_hours: number | null; exercise_minutes: number | null;
        mood: string | null; energy_level: string | null; water_glasses: number | null;
      }>;
      const summary = logs.map(l =>
        `${l.logged_on}: ঘুম ${l.sleep_hours ?? '?'}h, ব্যায়াম ${l.exercise_minutes ?? 0}m, মুড ${l.mood ?? '?'}, এনার্জি ${l.energy_level ?? '?'}, পানি ${l.water_glasses ?? 0} গ্লাস`
      ).join('\n');
      lifestyleContext = `\n\nUser's recent lifestyle data (last ${logs.length} days):\n${summary}`;
    }
  } catch {
    // If lifestyle data is unavailable, continue without it
  }

  // Fetch wellness context (health score, streaks, goals, trends, clinical data)
  let wellnessContext = '';
  try {
    const patient = await c.env.DB.prepare(
      'SELECT id FROM global_patient_auth WHERE uhid = ? AND is_active = 1',
    ).bind(uhid).first() as any;
    if (patient?.id) {
      wellnessContext = await buildWellnessContext(c.env.DB, patient.id, uhid);
    }
  } catch {
    // Wellness context is optional
  }

  const systemPrompt = `তুমি "ওজল বাডি" — Ozzyl Health অ্যাপের AI ওয়েলনেস সহকারী। তুমি একজন উষ্ণ, বন্ধুসুলভ সঙ্গী যে ব্যবহারকারীকে তাদের দৈনন্দিন স্বাস্থ্য অভ্যাস উন্নত করতে সাহায্য করে।

গুরুত্বপূর্ণ নিয়মাবলী:
1. তুমি কোনো ডাক্তার বা চিকিৎসক নও। কখনই রোগ নির্ণয় বা ওষুধ প্রেসক্রিপশন করো না।
2. সবসময় বাংলায় উত্তর দাও (ব্যবহারকারী ইংরেজিতে লিখলেও)।
3. উত্তর সংক্ষেপ রাখো (২-৩ বাক্য)। দরকার হলে সর্বোচ্চ ৪-৫ বাক্য।
4. গুরুতর উপসর্গ (বুকে ব্যথা, শ্বাসকষ্ট, রক্তপাত ইত্যাদি) জানালে অবশ্যই জরুরি চিকিৎসা নিতে বলো।
5. ব্যবহারকারীর লাইফস্টাইল ডেটা দেওয়া থাকলে সেটা ব্যবহার করে ব্যক্তিগত পরামর্শ দাও।
6. ইমোজি ব্যবহার করো — কিন্তু অতিরিক্ত নয়।
7. এটি একটি ওয়েলনেস চ্যাট, মেডিকেল পরামর্শ নয় — সবসময় এই সীমানা মেনে চলো।

তোমার দক্ষতার ক্ষেত্র:
- ঘুমের অভ্যাস ও হাইজিন
- ব্যায়াম ও শারীরিক কার্যকলাপ
- মানসিক স্বাস্থ্য (স্ট্রেস ম্যানেজমেন্ট, মাইন্ডফুলনেস)
- খাদ্যাভ্যাস ও পুষ্টি
- পানি পান
- দৈনন্দিন রুটিন
- সাধারণ ওয়েলনেস টিপস${lifestyleContext}${wellnessContext}
${CRISIS_SAFETY_PROMPT}

ডিসক্লেইমার: প্রয়োজনে মনে করিয়ে দাও — "এটি AI ভিত্তিক সাধারণ পরামর্শ, চিকিৎসা পরামর্শ নয়। সমস্যা থাকলে ডাক্তারের সাথে কথা বলুন।"`;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (max last 10 messages)
  if (conversationHistory && conversationHistory.length > 0) {
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: message });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ozzyl-hms.app',
        'X-Title': 'Ozzyl Health AI Buddy',
      },
      body: JSON.stringify({
        model: c.env.AI_MODEL ?? 'google/gemini-2.0-flash-001',
        messages,
        temperature: 0.7,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[AI Buddy] OpenRouter error ${response.status}: ${errText}`);
      return c.json({
        reply: '😔 দুঃখিত, এই মুহূর্তে আমি উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন!',
        error: true,
      });
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return c.json({
        reply: '🤔 আমি উত্তরটি ঠিকমতো তৈরি করতে পারিনি। আবার জিজ্ঞেস করুন!',
        error: true,
      });
    }

    return c.json({ reply, error: false });
  } catch (err) {
    console.error('[AI Buddy] Error:', err);
    return c.json({
      reply: '😔 সাময়িক সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন!',
      error: true,
    });
  }
});

// ─── Master Drugs Search (Patient Read-Only) ─────────────────────────────────
patientPhrRoutes.get('/master-drugs/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ results: [] });
  
  const results: any[] = [];
  
  // 1. Search local master_drugs
  try {
    const local = await c.env.DB.prepare(`
      SELECT d.id, d.brand_name, d.form, d.strength, d.price, d.pack_size,
             g.name as generic_name, co.name as company_name
      FROM master_drugs d
      LEFT JOIN master_generics g ON d.generic_id = g.id
      LEFT JOIN master_companies co ON d.company_id = co.id
      WHERE d.brand_name LIKE ? || '%'
      ORDER BY d.brand_name ASC
      LIMIT 10
    `).bind(q).all();
    if (local.results) {
      results.push(...local.results.map((r: any) => ({
        id: r.id,
        brand_name: r.brand_name,
        form: r.form,
        strength: r.strength,
        generic_name: r.generic_name,
        company_name: r.company_name,
        source: 'local'
      })));
    }
  } catch (err) {
    if (!isMissingTableError(err, 'master_drugs')) {
      console.error('Local master_drugs search error:', err);
    }
  }

  // 2. Fetch from Medex BD
  try {
    const res = await fetch(`https://medex.com.bd/search?search=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    
    const regex = /<div class="search-result-title">.*?<a[^>]*>(.*?)<\/a>.*?<\/div>\s*<p>(.*?)<\/p>/gs;
    let match;
    
    const dbInserts: any[] = [];
    
    while ((match = regex.exec(html)) !== null) {
      const rawTitle = match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const descMatch = match[2].replace(/\n/g, ' ').trim();
      
      let brand_name = rawTitle;
      let form = 'Tablet';
      // parse out form inside parenthesis if it exists at end: e.g. "Reef-D 500 mg+200 IU (Tablet)"
      const formMatch = rawTitle.match(/\(([^)]+)\)$/);
      if (formMatch) {
         form = formMatch[1].trim();
         brand_name = rawTitle.replace(/\s*\([^)]+\)$/, '').trim();
      }
      
      const genericMatch = /<i>\((.*?)\)<\/i>/.exec(descMatch);
      // More robust match for manufacturer
      const mfgMatch = /(?:is manufactured by|by)\s+([^<]+?)(?:\.|$)/.exec(descMatch);
      
      if (genericMatch && mfgMatch) {
         const gen_name = genericMatch[1].trim();
         const com_name = mfgMatch[1].trim();
         
         if (!results.some((r: any) => r.brand_name.toLowerCase() === brand_name.toLowerCase())) {
           dbInserts.push({
               brand: brand_name,
               form: form,
               generic: gen_name,
               company: com_name
           });
           
           results.push({
             id: Math.floor(Math.random() * 1000000) * -1,
             brand_name: brand_name,
             form: form,
             generic_name: gen_name,
             company_name: com_name,
             source: 'medex'
           });
         }
      }
    }
    
    // Save scraped results silently to local DB if we have proper access
    if (dbInserts.length > 0 && c.executionCtx) {
      c.executionCtx.waitUntil((async () => {
         try {
           for (const item of dbInserts) {
             let genId: number;
             const existingGen = await c.env.DB.prepare(`SELECT id FROM master_generics WHERE name = ? COLLATE NOCASE`).bind(item.generic).first<{id: number}>();
             if (existingGen) {
               genId = existingGen.id;
             } else {
               const genInfo = await c.env.DB.prepare(`INSERT INTO master_generics (name) VALUES (?) RETURNING id`).bind(item.generic).first<{id: number}>();
               genId = genInfo!.id;
             }
             
             let comId: number;
             const existingCom = await c.env.DB.prepare(`SELECT id FROM master_companies WHERE name = ? COLLATE NOCASE`).bind(item.company).first<{id: number}>();
             if (existingCom) {
               comId = existingCom.id;
             } else {
               const comInfo = await c.env.DB.prepare(`INSERT INTO master_companies (name) VALUES (?) RETURNING id`).bind(item.company).first<{id: number}>();
               comId = comInfo!.id;
             }
             
             await c.env.DB.prepare(`
               INSERT INTO master_drugs (brand_name, generic_id, company_id, form) 
               SELECT ?, ?, ?, ? WHERE NOT EXISTS (
                   SELECT 1 FROM master_drugs WHERE brand_name = ? COLLATE NOCASE AND form = ? COLLATE NOCASE
               )
             `).bind(item.brand, genId, comId, item.form, item.brand, item.form).run();
           }
         } catch (insertErr) {
           console.error('Async medex cache insert error', insertErr);
         }
      })());
    }

  } catch (error) {
    console.error('Medex search error:', error);
  }

  return c.json({ results: results.slice(0, 20) });
});

import { BLUE_BUTTON_SECTIONS, buildBlueButtonBundle } from '../lib/blue-button';

// ─── Blue Button — Download Complete Health Record ────────────────
patientPhrRoutes.get('/blue-button', async (c) => {
  const patientId = parseInt(c.get('userId'), 10);
  const db = c.env.DB;
  const format = c.req.query('format') ?? 'json'; // json or fhir

  const sections: { key: string; entries: Record<string, unknown>[] }[] = [];

  for (const section of BLUE_BUTTON_SECTIONS) {
    try {
      const { results } = await db.prepare(section.query).bind(patientId).all();
      const entries = (results ?? []).map((row) => section.mapper(row as Record<string, unknown>));
      sections.push({ key: section.key, entries });
    } catch {
      // Skip sections where the table may not exist yet
      sections.push({ key: section.key, entries: [] });
    }
  }

  const bundle = buildBlueButtonBundle(patientId, sections);

  if (format === 'download') {
    const filename = `health-record-${patientId}-${new Date().toISOString().slice(0, 10)}.json`;
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Type', 'application/json');
    return c.body(JSON.stringify(bundle, null, 2));
  }

  return c.json(bundle);
});

// ─── Blue Button — List available sections ────────────────────────
patientPhrRoutes.get('/blue-button/sections', async (c) => {
  return c.json({
    sections: BLUE_BUTTON_SECTIONS.map((s) => ({
      key: s.key,
      label: s.label,
    })),
  });
});

export default patientPhrRoutes;
