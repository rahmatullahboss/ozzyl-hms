import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { createVisitPassSchema } from '../schemas/visitPass';
import {
  createDependentSchema,
  createFamilyProxyInviteSchema,
  linkExistingFamilySchema,
  respondFamilyProxyInviteSchema,
} from '../schemas/familyGraph';
import type { Env } from '../types';
import { composePatientGuidance } from '../lib/patient-guidance';
import { saveInteraction } from '../lib/ai-memory';
import { buildEmergencyHealthProfile } from '../lib/emergency-profile';
import { composeFamilyRiskOverview, loadDiagnosesForPatientLink } from '../lib/family-risk';
import {
  buildPatientAiActionChecklist,
  buildPatientAiPlannerSnapshot,
  buildPatientWellnessSeedFromPlan,
  generatePatientAiPlan,
  parseSavedPatientAiPlan,
  refinePatientAiPlan,
  type PatientAiPlanProgressRow,
} from '../lib/patient-ai-planner';
import { patientAiPlanSchema } from '../schemas/patientAiPlanner';
import { resolveVerifiedBridgeLink, resolveWithBlockedFallback, upsertVerifiedLink } from '../lib/portal-link-bridge';
import { recordHospitalLinkAudit } from '../lib/portal-consent-audit';
import {
  buildEmergencyPackWalletExport,
  buildVisitPassWalletExport,
  decryptWalletSnapshot,
  encryptWalletSnapshot,
  type EmergencyPackWalletSnapshot,
  type VisitPassWalletSnapshot,
} from '../lib/wallet-passes';
import {
  createFamilyProxyInvite,
  createManagedDependent,
  getCurrentAuthIdentity,
  getIdentitySnapshot,
  listActiveFamilyManagers,
  listFamilyProxyInvites,
  linkExistingManagedProfile,
  respondToFamilyProxyInvite,
  revokeFamilyManagerLink,
  resolveActingPortalContext,
  transferPrimaryFamilyManager,
} from '../lib/family-graph';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Universal Patient Portal API
 * 
 * Fetches cross-tenant data across ALL hospitals an Ozzyl user is registered in.
 * Data monopoly design: Ozzyl serves as the central hub.
 */
const globalPortal = new Hono<{
  Bindings: Env;
  Variables: {
    globalUserId: number;
    authIdentity: { identityId: number; email: string | null; phone: string | null; uhid: string | null; name: string | null };
  };
}>();

type VisitPassHistoryRow = {
  id: number;
  code_last4: string;
  is_active: number;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_tenant_id: string | null;
  revoked_at: string | null;
  created_at: string;
  wallet_payload_encrypted?: string | null;
};

const tableExistsCache = new WeakMap<D1Database, Map<string, boolean>>();
const tableColumnCache = new WeakMap<D1Database, Map<string, Set<string>>>();

function buildPatientClauseParams(
  links: { tenantId: string; patientId: number }[],
  alias: string,
): { clause: string; values: any[] } {
  if (!links.length) return { clause: '1 = 0', values: [] };

  const clause = links
    .map(() => `(${alias}.tenant_id = ? AND ${alias}.patient_id = ?)`)
    .join(' OR ');

  const values = links.flatMap(link => [link.tenantId, link.patientId]);

  return { clause, values };
}

async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hasTable(db: D1Database, tableName: string): Promise<boolean> {
  let dbCache = tableExistsCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, boolean>();
    tableExistsCache.set(db, dbCache);
  }

  const cached = dbCache.get(tableName);
  if (typeof cached === 'boolean') return cached;

  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(tableName).first<{ name: string }>();

  const exists = Boolean(row?.name);
  dbCache.set(tableName, exists);
  return exists;
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  let dbCache = tableColumnCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, Set<string>>();
    tableColumnCache.set(db, dbCache);
  }

  const cached = dbCache.get(tableName);
  if (cached) return cached;

  const { results } = await db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all<{ name: string }>();
  const columns = new Set((results ?? []).map((row) => String(row.name)));
  dbCache.set(tableName, columns);
  return columns;
}

function generateVisitPassToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function generateVisitPassCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `VP-${code}`;
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPatientAiDailyLimit(): number {
  return 1;
}

function readCountRow(row: Record<string, unknown> | null | undefined): number {
  return Number(row?.total ?? row?.count ?? row?.cnt ?? 0);
}

async function loadPatientAiPlanProgressMap(
  db: D1Database,
  globalUserId: number,
  planIds: number[],
): Promise<Map<number, PatientAiPlanProgressRow>> {
  if (planIds.length === 0) return new Map();
  if (!(await hasTable(db, 'patient_ai_plan_progress'))) return new Map();

  const query = `
    SELECT plan_id, completed_items_json
    FROM patient_ai_plan_progress
    WHERE global_user_id = ? AND plan_id IN (SELECT value FROM json_each(?))
  `;
  const { results } = await db.prepare(query).bind(globalUserId, JSON.stringify(planIds)).all<PatientAiPlanProgressRow>();
  return new Map((results ?? []).map((row) => [Number(row.plan_id), row]));
}

const updatePatientAiChecklistSchema = z.object({
  completed_items: z.array(z.string().min(1)).max(12).default([]),
});

const updateWellnessHubSchema = z.object({
  medication_reminders: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  daily_routines: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
});

const updateWellnessHubChecklistSchema = z.object({
  completed_items: z.array(z.string().trim().min(1).max(160)).max(16).default([]),
});

const createEmergencyPackSchema = z.object({
  duration_hours: z.number().int().min(24).max(24 * 365).default(24 * 30),
  managed_identity_id: z.number().int().positive().optional(),
});

function getManagedIdentityIdFromRequest(c: any): number | null {
  const value = c.req.query('managed_identity_id');
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function ensurePatientWellnessTables(db: D1Database) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS patient_wellness_preferences (
      global_user_id INTEGER PRIMARY KEY,
      uhid TEXT,
      medication_reminders_json TEXT NOT NULL DEFAULT '[]',
      daily_routines_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patient_wellness_progress (
      global_user_id INTEGER NOT NULL,
      tracker_date TEXT NOT NULL,
      completed_items_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (global_user_id, tracker_date)
    );
  `);
}

// ─── Middleware: Global Auth & Link Resolver ──────────────────────────
globalPortal.use('*', async (c, next) => {
  const db = c.env.DB;
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const globalUserId = parseInt(decoded.userId, 10);
  const authIdentity = await getCurrentAuthIdentity(db, globalUserId);

  c.set('globalUserId', globalUserId);
  c.set('authIdentity', authIdentity);

  await next();
});

// ─── GET /dashboard ─── Aggregated Data ──────────────────────────────
globalPortal.get('/dashboard', async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;
  const managedIdentityId = getManagedIdentityIdFromRequest(c);
  const acting = await resolveActingPortalContext(db, globalUserId, managedIdentityId);
  // P0-30 (fix/portal-consent): explicit verified-link only.
  // Auto-match by UHID/email/phone is removed. We resolve each tenant
  // the patient has explicitly linked.
  const verifiedLinks = await db.prepare(`
    SELECT id, tenant_id, national_id, verification_method, verified_at
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND revoked_at IS NULL
  `).bind(globalUserId).all<{
    id: number; tenant_id: string; national_id: string | null;
    verification_method: string; verified_at: string;
  }>();
  const links: Array<{ tenantId: string; patientId: number; hospitalName: string }> = [];
  for (const link of verifiedLinks.results ?? []) {
    // For each verified tenant, find the patient row.
    const patientRow = link.national_id
      ? await db.prepare('SELECT id, name FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
          .bind(link.national_id, link.tenant_id).first<{ id: number; name: string }>()
      : null;
    if (!patientRow) continue;
    const tenantRow = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(link.tenant_id).first<{ name: string }>();
    links.push({
      tenantId: String(link.tenant_id),
      patientId: Number(patientRow.id),
      hospitalName: tenantRow?.name ?? String(link.tenant_id),
    });
  }
  await recordHospitalLinkAudit(db, {
    patientId: globalUserId,
    action: 'link_list',
    outcome: links.length > 0 ? 'success' : 'not_found',
    details: { resolved_via: 'verified_link', link_count: links.length },
  });
  const profileRow = await db.prepare(
    'SELECT national_id FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(globalUserId).first<{ national_id: string | null }>();
  
  const zeroGuidance = composePatientGuidance({
    hasPhone: Boolean(acting.actingIdentity.primaryPhone ?? authIdentity?.phone),
    hasNationalId: Boolean(profileRow?.national_id),
    upcomingAppointments: 0,
    recentPrescriptions: 0,
    pendingReviewItems: 0,
    verifiedItems: 0,
    vaultDocuments: 0,
    hasActiveVisitPass: false,
    recentLifestyleLog: false,
    recentAdr: false,
  });
  
  if (!links || links.length === 0) {
    return c.json({
      acting_profile: {
        identity_id: acting.actingIdentityId,
        name: acting.actingIdentity.primaryName ?? authIdentity?.name ?? 'Patient',
        uhid: acting.actingIdentity.uhid,
        managed: acting.managed,
        relationship: acting.relationship,
        claim_status: acting.actingIdentity.claimStatus ?? 'unclaimed',
      },
      hospitalsCount: 0,
      appointments: [],
      prescriptions: [],
      reports: [],
      bills: [],
      patient_guidance: zeroGuidance,
    });
  }
  
  // Build dynamic WHERE clause matching any (tenant_id, patient_id) pair
  // e.g., "(tenant_id = 1 AND patient_id = 10) OR (tenant_id = 2 AND patient_id = 45)"
  const { clause: appointmentClause, values: appointmentValues } = buildPatientClauseParams(links, 'a');
  const { clause: prescriptionClause, values: prescriptionValues } = buildPatientClauseParams(links, 'p');
  const { clause: labClause, values: labValues } = buildPatientClauseParams(links, 'lo');
  const { clause: billClause, values: billValues } = buildPatientClauseParams(links, 'b');

  // Fetch Cross-Tenant Appointments
  const { results: appointments } = await db.prepare(`
    SELECT a.id, a.tenant_id, a.patient_id, a.appt_date AS appointment_date, a.appt_time AS appointment_time,
           a.status, a.chief_complaint AS reason,
           t.name AS hospital_name,
           d.name AS doctor_name,
           d.specialty AS department_name
    FROM appointments a
    LEFT JOIN tenants t ON t.id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    WHERE ${appointmentClause}
    ORDER BY
      CASE WHEN date(a.appt_date) >= date('now') THEN 0 ELSE 1 END,
      CASE WHEN date(a.appt_date) >= date('now') THEN a.appt_date END ASC,
      CASE WHEN date(a.appt_date) >= date('now') THEN a.appt_time END ASC,
      CASE WHEN date(a.appt_date) < date('now') THEN a.appt_date END DESC,
      CASE WHEN date(a.appt_date) < date('now') THEN a.appt_time END DESC
    LIMIT 5
  `).bind(...appointmentValues).all();

  // Fetch Cross-Tenant Prescriptions
  const { results: prescriptions } = await db.prepare(`
    SELECT p.id, p.tenant_id, p.patient_id, p.created_at AS date, p.chief_complaint, p.diagnosis,
           t.name AS hospital_name,
           d.name AS doctor_name
    FROM prescriptions p
    LEFT JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN doctors d ON d.id = p.doctor_id AND d.tenant_id = p.tenant_id
    WHERE ${prescriptionClause}
      AND LOWER(COALESCE(p.status, '')) = 'final'
    ORDER BY p.created_at DESC
    LIMIT 5
  `).bind(...prescriptionValues).all();

  const { results: reports } = await db.prepare(`
    SELECT lo.id, lo.tenant_id, lo.patient_id, lo.order_no, lo.created_at AS result_date,
           lo.status,
           t.name AS hospital_name,
           GROUP_CONCAT(COALESCE(ltc.name, 'Test #' || loi.lab_test_id), ', ') AS test_names,
           SUM(CASE WHEN LOWER(COALESCE(loi.abnormal_flag, '')) IN ('high', 'low', 'critical', 'abnormal') THEN 1 ELSE 0 END) AS abnormal_count
    FROM lab_orders lo
    JOIN lab_order_items loi ON loi.lab_order_id = lo.id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
    LEFT JOIN tenants t ON t.id = lo.tenant_id
    WHERE ${labClause}
      AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
      AND LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')
    GROUP BY lo.id, lo.tenant_id, lo.patient_id, lo.order_no, lo.created_at, lo.status, t.name
    ORDER BY lo.created_at DESC
    LIMIT 5
  `).bind(...labValues).all();

  // Bills are the closest current cross-tenant financial summary available.
  const { results: bills } = await db.prepare(`
    SELECT b.id, b.tenant_id, b.invoice_no, b.created_at AS bill_date,
           b.total AS grand_total, b.status AS payment_status,
           t.name AS hospital_name
    FROM bills b
    LEFT JOIN tenants t ON t.id = b.tenant_id
    WHERE ${billClause}
    ORDER BY b.created_at DESC
    LIMIT 5
  `).bind(...billValues).all();

  const uhid = acting.actingIdentity.uhid;
  const [
    hasVaultDocumentsTable,
    hasReportedDataTable,
    hasAdverseReactionsTable,
    hasLifestyleLogsTable,
    hasVisitPassesTable,
  ] = await Promise.all([
    hasTable(db, 'global_patient_vault_documents'),
    hasTable(db, 'global_patient_reported_data'),
    hasTable(db, 'global_patient_adverse_reactions'),
    hasTable(db, 'global_patient_lifestyle_logs'),
    hasTable(db, 'patient_visit_passes'),
  ]);

  const [
    vaultRow,
    pendingReviewRow,
    verifiedRow,
    activeVisitPassRow,
    lifestyleRow,
    adrRow,
  ] = await Promise.all([
    uhid && hasVaultDocumentsTable
      ? db.prepare(`
          SELECT COUNT(*) AS vault_documents
          FROM global_patient_vault_documents
          WHERE uhid = ?
        `).bind(uhid).first<{ vault_documents: number }>()
      : Promise.resolve({ vault_documents: 0 }),
    uhid
      ? Promise.all([
          hasReportedDataTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_reported_data
                WHERE uhid = ? AND verification_status IN ('unconfirmed', 'pending_review')
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
          hasAdverseReactionsTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_adverse_reactions
                WHERE uhid = ? AND review_status = 'pending_review'
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
          hasLifestyleLogsTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_lifestyle_logs
                WHERE uhid = ? AND review_status = 'pending_review'
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
        ]).then(([reported, adr, lifestyle]) => ({
          pending_review_items:
            Number(reported?.total ?? 0) +
            Number(adr?.total ?? 0) +
            Number(lifestyle?.total ?? 0),
        }))
      : Promise.resolve({ pending_review_items: 0 }),
    uhid
      ? Promise.all([
          hasReportedDataTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_reported_data
                WHERE uhid = ? AND verification_status = 'confirmed'
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
          hasAdverseReactionsTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_adverse_reactions
                WHERE uhid = ? AND review_status = 'verified'
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
          hasLifestyleLogsTable
            ? db.prepare(`
                SELECT COUNT(*) AS total
                FROM global_patient_lifestyle_logs
                WHERE uhid = ? AND review_status = 'verified'
              `).bind(uhid).first<{ total: number }>()
            : Promise.resolve({ total: 0 }),
        ]).then(([reported, adr, lifestyle]) => ({
          verified_items:
            Number(reported?.total ?? 0) +
            Number(adr?.total ?? 0) +
            Number(lifestyle?.total ?? 0),
        }))
      : Promise.resolve({ verified_items: 0 }),
    hasVisitPassesTable
      ? db.prepare(`
          SELECT COUNT(*) AS active_visit_pass FROM patient_visit_passes
          WHERE global_user_id = ? AND is_active = 1 AND revoked_at IS NULL AND redeemed_at IS NULL AND datetime(expires_at) >= datetime('now')
        `).bind(globalUserId).first<{ active_visit_pass: number }>()
      : Promise.resolve({ active_visit_pass: 0 }),
    uhid && hasLifestyleLogsTable
      ? db.prepare(`
          SELECT COUNT(*) AS recent_lifestyle_log FROM global_patient_lifestyle_logs
          WHERE uhid = ? AND datetime(logged_on) >= datetime('now', '-30 day')
        `).bind(uhid).first<{ recent_lifestyle_log: number }>()
      : Promise.resolve({ recent_lifestyle_log: 0 }),
    uhid && hasAdverseReactionsTable
      ? db.prepare(`
          SELECT COUNT(*) AS recent_adr FROM global_patient_adverse_reactions
          WHERE uhid = ? AND datetime(created_at) >= datetime('now', '-90 day')
        `).bind(uhid).first<{ recent_adr: number }>()
      : Promise.resolve({ recent_adr: 0 }),
  ]);

  const patientGuidance = composePatientGuidance({
    hasPhone: Boolean(acting.actingIdentity.primaryPhone ?? authIdentity?.phone),
    hasNationalId: Boolean(profileRow?.national_id),
    upcomingAppointments: appointments?.length ?? 0,
    recentPrescriptions: prescriptions?.length ?? 0,
    pendingReviewItems: Number(pendingReviewRow?.pending_review_items ?? 0),
    verifiedItems: Number(verifiedRow?.verified_items ?? 0),
    vaultDocuments: Number(vaultRow?.vault_documents ?? 0),
    hasActiveVisitPass: Number(activeVisitPassRow?.active_visit_pass ?? 0) > 0,
    recentLifestyleLog: Number(lifestyleRow?.recent_lifestyle_log ?? 0) > 0,
    recentAdr: Number(adrRow?.recent_adr ?? 0) > 0,
  });

  return c.json({
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? authIdentity?.name ?? 'Patient',
      uhid: acting.actingIdentity.uhid,
      managed: acting.managed,
      relationship: acting.relationship,
      claim_status: acting.actingIdentity.claimStatus ?? 'unclaimed',
    },
    hospitalsCount: links.length,
    appointments: appointments ?? [],
    prescriptions: prescriptions ?? [],
    reports: reports ?? [],
    labResults: reports ?? [],
    bills: bills ?? [],
    patient_guidance: patientGuidance,
  });
});

// ─── GET /hospitals ─── List of hospitals connected to this patient ──
globalPortal.get('/hospitals', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const managedIdentityId = getManagedIdentityIdFromRequest(c);
  const acting = await resolveActingPortalContext(db, globalUserId, managedIdentityId);
  // P0-30: explicit verified-link only
  const verifiedHospitals = await db.prepare(`
    SELECT id, tenant_id, national_id, verification_method, verified_at
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND revoked_at IS NULL
  `).bind(globalUserId).all<{
    id: number; tenant_id: string; national_id: string | null;
    verification_method: string; verified_at: string;
  }>();
  const hospitals: Array<{
    tenantId: string; patientId: number; hospitalName: string;
    verifiedAt: string; method: string;
  }> = [];
  for (const link of verifiedHospitals.results ?? []) {
    const patientRow = link.national_id
      ? await db.prepare('SELECT id, name FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
          .bind(link.national_id, link.tenant_id).first<{ id: number; name: string }>()
      : null;
    if (!patientRow) continue;
    const tenantRow = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(link.tenant_id).first<{ name: string }>();
    hospitals.push({
      tenantId: String(link.tenant_id),
      patientId: Number(patientRow.id),
      hospitalName: tenantRow?.name ?? String(link.tenant_id),
      verifiedAt: link.verified_at,
      method: link.verification_method,
    });
  }
  await recordHospitalLinkAudit(db, {
    patientId: globalUserId,
    action: 'link_list',
    outcome: hospitals.length > 0 ? 'success' : 'not_found',
    details: { endpoint: 'hospitals', link_count: hospitals.length },
  });
  return c.json({
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? 'Patient',
      managed: acting.managed,
      relationship: acting.relationship,
    },
    hospitals,
  });
});

globalPortal.get('/ai-plans', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const dailyLimit = getPatientAiDailyLimit();

  const [plansResult, usageRow] = await Promise.all([
    db.prepare(`
      SELECT id, headline, summary, confidence, plan_json, source_snapshot_json, created_at
      FROM patient_ai_plans
      WHERE global_user_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 12
    `).bind(globalUserId).all<{
      id: number;
      headline: string;
      summary: string;
      confidence: 'low' | 'medium' | 'high';
      plan_json: string;
      source_snapshot_json?: string | null;
      created_at: string;
    }>(),
    db.prepare(`
      SELECT COUNT(*) as total
      FROM patient_ai_plans
      WHERE global_user_id = ? AND date(created_at) = date('now')
    `).bind(globalUserId).first<{ total: number }>(),
  ]);

  const planRows = plansResult.results ?? [];
  const progressMap = await loadPatientAiPlanProgressMap(db, globalUserId, planRows.map((row) => Number(row.id)));
  const plans = planRows.map((row) => parseSavedPatientAiPlan(row, progressMap.get(Number(row.id)) ?? null));
  const usedToday = readCountRow(usageRow as Record<string, unknown> | null | undefined);

  return c.json({
    latest_plan: plans[0] ?? null,
    plans,
    remaining_generations_today: Math.max(0, dailyLimit - usedToday),
    daily_limit: dailyLimit,
  });
});

globalPortal.get('/ai-plans/:id', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const planId = Number(c.req.param('id'));

  const row = await db.prepare(`
    SELECT id, headline, summary, confidence, plan_json, source_snapshot_json, created_at
    FROM patient_ai_plans
    WHERE id = ? AND global_user_id = ?
    LIMIT 1
  `).bind(planId, globalUserId).first<{
    id: number;
    headline: string;
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    plan_json: string;
    source_snapshot_json?: string | null;
    created_at: string;
  }>();

  if (!row) {
    throw new HTTPException(404, { message: 'AI plan not found' });
  }

  const progressRow = await hasTable(db, 'patient_ai_plan_progress')
    ? await db.prepare(`
    SELECT plan_id, completed_items_json
    FROM patient_ai_plan_progress
    WHERE global_user_id = ? AND plan_id = ?
    LIMIT 1
  `).bind(globalUserId, planId).first<PatientAiPlanProgressRow>()
    : null;

  return c.json({ plan: parseSavedPatientAiPlan(row, progressRow) });
});

globalPortal.post('/ai-plans/:id/checklist', zValidator('json', updatePatientAiChecklistSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const planId = Number(c.req.param('id'));
  const body = c.req.valid('json');

  if (!(await hasTable(db, 'patient_ai_plan_progress'))) {
    throw new HTTPException(503, { message: 'AI plan progress is not ready yet' });
  }

  const row = await db.prepare(`
    SELECT id, headline, summary, confidence, plan_json, source_snapshot_json, created_at
    FROM patient_ai_plans
    WHERE id = ? AND global_user_id = ?
    LIMIT 1
  `).bind(planId, globalUserId).first<{
    id: number;
    headline: string;
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    plan_json: string;
    source_snapshot_json?: string | null;
    created_at: string;
  }>();

  if (!row) {
    throw new HTTPException(404, { message: 'AI plan not found' });
  }

  const parsedPlan = parseSavedPatientAiPlan(row);
  const allowedItems = new Set(buildPatientAiActionChecklist(parsedPlan.plan));
  const completedItems = Array.from(
    new Set(body.completed_items.map((item) => item.trim()).filter((item) => allowedItems.has(item))),
  );

  await db.prepare(`
    INSERT INTO patient_ai_plan_progress
      (plan_id, global_user_id, completed_items_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(plan_id, global_user_id)
    DO UPDATE SET
      completed_items_json = excluded.completed_items_json,
      updated_at = datetime('now')
  `).bind(planId, globalUserId, JSON.stringify(completedItems)).run();

  const savedPlan = parseSavedPatientAiPlan(row, {
    plan_id: planId,
    completed_items_json: JSON.stringify(completedItems),
  });

  return c.json({ plan: savedPlan });
});

globalPortal.post('/ai-plans/:id/refine', async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;
  const planId = Number(c.req.param('id'));
  const dailyLimit = getPatientAiDailyLimit();

  const usageRow = await db.prepare(`
    SELECT COUNT(*) as total
    FROM patient_ai_plans
    WHERE global_user_id = ? AND date(created_at) = date('now')
  `).bind(globalUserId).first<{ total: number }>();

  const usedToday = readCountRow(usageRow as Record<string, unknown> | null | undefined);
  if (usedToday >= dailyLimit) {
    throw new HTTPException(429, { message: 'Daily AI planner limit reached. Please try again tomorrow.' });
  }

  const existingRow = await db.prepare(`
    SELECT id, headline, summary, confidence, plan_json, source_snapshot_json, created_at
    FROM patient_ai_plans
    WHERE id = ? AND global_user_id = ?
    LIMIT 1
  `).bind(planId, globalUserId).first<{
    id: number;
    headline: string;
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    plan_json: string;
    source_snapshot_json?: string | null;
    created_at: string;
  }>();

  if (!existingRow) {
    throw new HTTPException(404, { message: 'AI plan not found' });
  }

  const snapshot = await buildPatientAiPlannerSnapshot(c.env, db, globalUserId);
  if (!snapshot.identity.uhid) {
    throw new HTTPException(403, { message: 'Patient identity not verified' });
  }

  const currentPlan = parseSavedPatientAiPlan(existingRow).plan;
  const refinedPlan = await refinePatientAiPlan(c.env, snapshot, currentPlan);
  const sourceSnapshotJson = JSON.stringify(snapshot);
  const planJson = JSON.stringify(refinedPlan);

  const result = await db.prepare(`
    INSERT INTO patient_ai_plans
      (global_user_id, uhid, patient_name, status, headline, summary, confidence, plan_json, source_snapshot_json)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).bind(
    globalUserId,
    snapshot.identity.uhid,
    snapshot.identity.name ?? authIdentity?.name ?? null,
    refinedPlan.headline,
    refinedPlan.summary,
    refinedPlan.confidence,
    planJson,
    sourceSnapshotJson,
  ).run();

  try {
    await saveInteraction(c.env, 'global', String(globalUserId), 'patient_health_planner', `Refined patient planner for ${snapshot.identity.uhid}`, planJson);
  } catch {
    // Non-fatal.
  }

  const savedPlan = parseSavedPatientAiPlan({
    id: Number(result.meta.last_row_id),
    headline: refinedPlan.headline,
    summary: refinedPlan.summary,
    confidence: refinedPlan.confidence,
    created_at: new Date().toISOString(),
    plan_json: planJson,
    source_snapshot_json: sourceSnapshotJson,
  });

  return c.json({
    plan: savedPlan,
    remaining_generations_today: Math.max(0, dailyLimit - usedToday - 1),
    daily_limit: dailyLimit,
  }, 201);
});

globalPortal.post('/ai-plans/generate', async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;
  const dailyLimit = getPatientAiDailyLimit();

  const usageRow = await db.prepare(`
    SELECT COUNT(*) as total
    FROM patient_ai_plans
    WHERE global_user_id = ? AND date(created_at) = date('now')
  `).bind(globalUserId).first<{ total: number }>();

  const usedToday = readCountRow(usageRow as Record<string, unknown> | null | undefined);
  if (usedToday >= dailyLimit) {
    throw new HTTPException(429, { message: 'Daily AI planner limit reached. Please try again tomorrow.' });
  }

  const snapshot = await buildPatientAiPlannerSnapshot(c.env, db, globalUserId);
  if (!snapshot.identity.uhid) {
    throw new HTTPException(403, { message: 'Patient identity not verified' });
  }

  const plan = await generatePatientAiPlan(c.env, snapshot);
  const sourceSnapshotJson = JSON.stringify(snapshot);
  const planJson = JSON.stringify(plan);

  const result = await db.prepare(`
    INSERT INTO patient_ai_plans
      (global_user_id, uhid, patient_name, status, headline, summary, confidence, plan_json, source_snapshot_json)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).bind(
    globalUserId,
    snapshot.identity.uhid,
    snapshot.identity.name ?? authIdentity?.name ?? null,
    plan.headline,
    plan.summary,
    plan.confidence,
    planJson,
    sourceSnapshotJson,
  ).run();

  try {
    await saveInteraction(c.env, 'global', String(globalUserId), 'patient_health_planner', `Patient planner for ${snapshot.identity.uhid}`, planJson);
  } catch {
    // Do not fail the patient plan if AI memory persistence fails.
  }

  const savedPlan = parseSavedPatientAiPlan({
    id: Number(result.meta.last_row_id),
    headline: plan.headline,
    summary: plan.summary,
    confidence: plan.confidence,
    created_at: new Date().toISOString(),
    plan_json: planJson,
    source_snapshot_json: sourceSnapshotJson,
  });

  return c.json({
    plan: savedPlan,
    remaining_generations_today: Math.max(0, dailyLimit - usedToday - 1),
    daily_limit: dailyLimit,
  }, 201);
});

globalPortal.get('/wellness-hub', async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;

  await ensurePatientWellnessTables(db);

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.batch() for fetching patient wellness data.
  // Why: Promise.all() sends 3 separate HTTP network requests to Cloudflare D1.
  //      db.batch() sends a single network request containing all 3 queries.
  // Impact: Eliminates 2 network round-trips, significantly reducing latency and
  //         making the wellness hub load faster.
  const batchResults = await db.batch([
    db.prepare(`
      SELECT medication_reminders_json, daily_routines_json, updated_at
      FROM patient_wellness_preferences
      WHERE global_user_id = ?
      LIMIT 1
    `).bind(globalUserId),
    db.prepare(`
      SELECT completed_items_json, updated_at
      FROM patient_wellness_progress
      WHERE global_user_id = ? AND tracker_date = date('now')
      LIMIT 1
    `).bind(globalUserId),
    db.prepare(`
      SELECT plan_json
      FROM patient_ai_plans
      WHERE global_user_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1
    `).bind(globalUserId),
  ]);

  const preferencesRow = batchResults[0]?.results?.[0] as {
    medication_reminders_json: string;
    daily_routines_json: string;
    updated_at: string;
  } | undefined;

  const progressRow = batchResults[1]?.results?.[0] as {
    completed_items_json: string;
    updated_at: string;
  } | undefined;

  const latestPlanRow = batchResults[2]?.results?.[0] as {
    plan_json: string;
  } | undefined;

  const parseJsonArray = (value: string | null | undefined) => {
    try {
      const parsed = JSON.parse(value ?? '[]');
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  let suggestedMedicationReminders: string[] = [];
  let suggestedDailyRoutines: string[] = [];
  try {
    if (latestPlanRow?.plan_json) {
      const parsedPlan = patientAiPlanSchema.parse(JSON.parse(latestPlanRow.plan_json));
      const seeded = buildPatientWellnessSeedFromPlan(parsedPlan);
      suggestedMedicationReminders = seeded.medicationReminders;
      suggestedDailyRoutines = seeded.dailyRoutines;
    }
  } catch {
    // Ignore invalid planner rows here.
  }

  return c.json({
    medication_reminders: parseJsonArray(preferencesRow?.medication_reminders_json),
    daily_routines: parseJsonArray(preferencesRow?.daily_routines_json),
    suggested_medication_reminders: suggestedMedicationReminders,
    suggested_daily_routines: suggestedDailyRoutines,
    completed_items: parseJsonArray(progressRow?.completed_items_json),
    tracker_date: new Date().toISOString().slice(0, 10),
    updated_at: preferencesRow?.updated_at ?? progressRow?.updated_at ?? null,
    patient_name: authIdentity?.name ?? null,
  });
});

globalPortal.put('/wellness-hub', zValidator('json', updateWellnessHubSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;
  const body = c.req.valid('json');

  await ensurePatientWellnessTables(db);

  const medicationReminders = Array.from(new Set(body.medication_reminders.map((item) => item.trim()).filter(Boolean))).slice(0, 8);
  const dailyRoutines = Array.from(new Set(body.daily_routines.map((item) => item.trim()).filter(Boolean))).slice(0, 8);

  await db.prepare(`
    INSERT INTO patient_wellness_preferences
      (global_user_id, uhid, medication_reminders_json, daily_routines_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(global_user_id)
    DO UPDATE SET
      uhid = excluded.uhid,
      medication_reminders_json = excluded.medication_reminders_json,
      daily_routines_json = excluded.daily_routines_json,
      updated_at = datetime('now')
  `).bind(
    globalUserId,
    authIdentity?.uhid ?? null,
    JSON.stringify(medicationReminders),
    JSON.stringify(dailyRoutines),
  ).run();

  return c.json({
    medication_reminders: medicationReminders,
    daily_routines: dailyRoutines,
    updated_at: new Date().toISOString(),
  });
});

globalPortal.post('/wellness-hub/checklist', zValidator('json', updateWellnessHubChecklistSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const body = c.req.valid('json');

  await ensurePatientWellnessTables(db);

  const preferencesRow = await db.prepare(`
    SELECT medication_reminders_json, daily_routines_json
    FROM patient_wellness_preferences
    WHERE global_user_id = ?
    LIMIT 1
  `).bind(globalUserId).first<{
    medication_reminders_json: string;
    daily_routines_json: string;
  }>();

  const parseJsonArray = (value: string | null | undefined) => {
    try {
      const parsed = JSON.parse(value ?? '[]');
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const allowedItems = new Set([
    ...parseJsonArray(preferencesRow?.medication_reminders_json),
    ...parseJsonArray(preferencesRow?.daily_routines_json),
  ]);

  const completedItems = Array.from(
    new Set(body.completed_items.map((item) => item.trim()).filter((item) => allowedItems.has(item))),
  ).slice(0, 16);

  await db.prepare(`
    INSERT INTO patient_wellness_progress
      (global_user_id, tracker_date, completed_items_json, updated_at)
    VALUES (?, date('now'), ?, datetime('now'))
    ON CONFLICT(global_user_id, tracker_date)
    DO UPDATE SET
      completed_items_json = excluded.completed_items_json,
      updated_at = datetime('now')
  `).bind(globalUserId, JSON.stringify(completedItems)).run();

  return c.json({
    completed_items: completedItems,
    tracker_date: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  });
});

globalPortal.get('/family', async (c) => {
  const globalUserId = c.get('globalUserId');
  const authIdentity = c.get('authIdentity');
  const db = c.env.DB;
  const [hasFamilyLinksTable, hasFamilyInvitesTable] = await Promise.all([
    hasTable(db, 'global_family_links'),
    hasTable(db, 'global_family_proxy_invites'),
  ]);

  if (!hasFamilyLinksTable || !hasFamilyInvitesTable) {
    return c.json({
      self: {
        identity_id: authIdentity.identityId,
        name: authIdentity.name,
        uhid: authIdentity.uhid,
      },
      managed_profiles: [],
      risk_overview: composeFamilyRiskOverview([]),
      incoming_invites: [],
      outgoing_invites: [],
    });
  }

  const { results } = await db.prepare(`
    SELECT gfl.id, gfl.patient_identity_id, gfl.relationship, gfl.access_role, gfl.verification_basis,
           gfl.status, gfl.created_at, gpi.uhid, gpi.primary_name, gpi.date_of_birth, gpi.gender, gpi.claim_status
    FROM global_family_links gfl
    JOIN global_patient_identity gpi ON gpi.id = gfl.patient_identity_id
    WHERE gfl.manager_auth_user_id = ? AND gfl.status = 'active'
    ORDER BY datetime(gfl.created_at) DESC
  `).bind(globalUserId).all<{
    id: number;
    patient_identity_id: number;
    relationship: string;
    access_role: string;
    verification_basis: string;
    status: string;
    created_at: string;
    uhid: string | null;
    primary_name: string | null;
    date_of_birth: string | null;
    gender: string | null;
    claim_status: string | null;
  }>();

  const managedProfiles = await Promise.all((results ?? []).map(async (row) => {
    // P0-30: only consider explicit verified links (no UHID/email/phone fallback)
    const familyLinkRows = await db.prepare(`
      SELECT tenant_id, national_id FROM patient_hospital_link_verifications
      WHERE revoked_at IS NULL
    `).all<{ tenant_id: string; national_id: string | null }>();
    const hospitalLinks: Array<{ tenantId: string; patientId: number; hospitalName: string }> = [];
    for (const fl of familyLinkRows.results ?? []) {
      if (!fl.national_id) continue;
      const pr = await db.prepare('SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
        .bind(fl.national_id, fl.tenant_id).first<{ id: number }>();
      if (!pr) continue;
      const tr = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
        .bind(fl.tenant_id).first<{ name: string }>();
      hospitalLinks.push({
        tenantId: String(fl.tenant_id),
        patientId: Number(pr.id),
        hospitalName: tr?.name ?? String(fl.tenant_id),
      });
    }
    const diagnoses = (
      await Promise.all(hospitalLinks.map((link) => loadDiagnosesForPatientLink(db, link.tenantId, link.patientId)))
    ).flat();
    const managers = await listActiveFamilyManagers(db, row.patient_identity_id);

    return {
      link_id: row.id,
      identity_id: row.patient_identity_id,
      uhid: row.uhid,
      name: row.primary_name,
      relationship: row.relationship,
      access_role: row.access_role,
      verification_basis: row.verification_basis,
      claim_status: row.claim_status ?? 'unclaimed',
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      hospitals_count: hospitalLinks.length,
      created_at: row.created_at,
      managers: managers.map((manager) => ({
        link_id: manager.linkId,
        manager_auth_user_id: manager.managerAuthUserId,
        name: manager.managerName,
        email: manager.managerEmail,
        phone: manager.managerPhone,
        relationship: manager.relationship,
        access_role: manager.accessRole,
        verification_basis: manager.verificationBasis,
        created_at: manager.createdAt,
      })),
      _risk_diagnoses: diagnoses,
    };
  }));

  const riskOverview = composeFamilyRiskOverview(managedProfiles.map((profile) => ({
    relationship: profile.relationship,
    name: profile.name,
    uhid: profile.uhid,
    hospitalsCount: profile.hospitals_count,
    diagnoses: profile._risk_diagnoses,
  })));

  const invites = await listFamilyProxyInvites(db, globalUserId);

  return c.json({
    self: {
      identity_id: authIdentity.identityId,
      name: authIdentity.name,
      uhid: authIdentity.uhid,
    },
    managed_profiles: managedProfiles.map(({ _risk_diagnoses, ...profile }) => profile),
    risk_overview: riskOverview,
    incoming_invites: invites.incoming.map((invite) => ({
      id: invite.id,
      patient_identity_id: invite.patientIdentityId,
      patient_name: invite.patientName,
      patient_uhid: invite.patientUhid,
      inviter_auth_user_id: invite.inviterAuthUserId,
      inviter_name: invite.inviterName,
      relationship: invite.relationship,
      access_role: invite.accessRole,
      status: invite.status,
      notes: invite.notes,
      expires_at: invite.expiresAt,
      created_at: invite.createdAt,
    })),
    outgoing_invites: invites.outgoing.map((invite) => ({
      id: invite.id,
      patient_identity_id: invite.patientIdentityId,
      patient_name: invite.patientName,
      patient_uhid: invite.patientUhid,
      invitee_auth_user_id: invite.inviteeAuthUserId,
      invitee_name: invite.inviteeName,
      relationship: invite.relationship,
      access_role: invite.accessRole,
      status: invite.status,
      notes: invite.notes,
      expires_at: invite.expiresAt,
      created_at: invite.createdAt,
    })),
  });
});

async function createDependentHandler(c: any) {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const data = c.req.valid('json');

  const dependent = await createManagedDependent(db, {
    managerAuthUserId: globalUserId,
    name: data.name,
    relationship: data.relationship,
    dateOfBirth: data.date_of_birth ?? null,
    gender: data.gender ?? null,
    phone: data.phone ?? null,
    nationalId: data.national_id ?? null,
    notes: data.notes ?? null,
  });

  const snapshot = await getIdentitySnapshot(db, dependent.identityId);

  return c.json({
    dependent: {
      identity_id: dependent.identityId,
      uhid: dependent.uhid,
      name: snapshot.primary_name,
      relationship: data.relationship,
      access_role: dependent.accessRole,
      date_of_birth: snapshot.date_of_birth,
      gender: snapshot.gender,
      claim_status: snapshot.claim_status ?? 'unclaimed',
    },
  }, 201);
}

globalPortal.post('/family/dependents', zValidator('json', createDependentSchema), createDependentHandler);
globalPortal.post('/family/members', zValidator('json', createDependentSchema), createDependentHandler);

globalPortal.post('/family/link-existing', zValidator('json', linkExistingFamilySchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const data = c.req.valid('json');

  const linked = await linkExistingManagedProfile(db, {
    managerAuthUserId: globalUserId,
    uhid: data.uhid,
    relationship: data.relationship,
    claimCode: data.claim_code ?? null,
    phone: data.phone ?? null,
    nationalId: data.national_id ?? null,
    notes: data.notes ?? null,
  });

  const snapshot = await getIdentitySnapshot(db, linked.identityId);

  return c.json({
    linked_profile: {
      identity_id: linked.identityId,
      uhid: snapshot.uhid,
      name: snapshot.primary_name,
      relationship: data.relationship,
      access_role: linked.accessRole,
      verification_basis: linked.verificationBasis,
      claim_status: snapshot.claim_status ?? 'unclaimed',
    },
  }, 201);
});

globalPortal.post('/family/proxy-invites', zValidator('json', createFamilyProxyInviteSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const data = c.req.valid('json');

  const invite = await createFamilyProxyInvite(db, {
    inviterAuthUserId: globalUserId,
    uhid: data.uhid,
    relationship: data.relationship,
    notes: data.notes ?? null,
  });

  return c.json({
    invite: {
      id: invite.id,
      patient_identity_id: invite.patientIdentityId,
      inviter_auth_user_id: invite.inviterAuthUserId,
      invitee_auth_user_id: invite.inviteeAuthUserId,
      relationship: invite.relationship,
      access_role: invite.accessRole,
      status: invite.status,
      notes: invite.notes,
      expires_at: invite.expiresAt,
      created_at: invite.createdAt,
    },
  }, 201);
});

globalPortal.get('/family/proxy-invites', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;

  if (!(await hasTable(db, 'global_family_proxy_invites'))) {
    return c.json({
      incoming: [],
      outgoing: [],
    });
  }

  const invites = await listFamilyProxyInvites(db, globalUserId);

  return c.json({
    incoming: invites.incoming.map((invite) => ({
      id: invite.id,
      patient_identity_id: invite.patientIdentityId,
      patient_name: invite.patientName,
      patient_uhid: invite.patientUhid,
      inviter_name: invite.inviterName,
      relationship: invite.relationship,
      access_role: invite.accessRole,
      status: invite.status,
      notes: invite.notes,
      expires_at: invite.expiresAt,
      created_at: invite.createdAt,
    })),
    outgoing: invites.outgoing.map((invite) => ({
      id: invite.id,
      patient_identity_id: invite.patientIdentityId,
      patient_name: invite.patientName,
      patient_uhid: invite.patientUhid,
      invitee_name: invite.inviteeName,
      relationship: invite.relationship,
      access_role: invite.accessRole,
      status: invite.status,
      notes: invite.notes,
      expires_at: invite.expiresAt,
      created_at: invite.createdAt,
    })),
  });
});

globalPortal.post('/family/proxy-invites/:id/respond', zValidator('json', respondFamilyProxyInviteSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const inviteId = Number(c.req.param('id'));

  if (!Number.isFinite(inviteId) || inviteId <= 0) {
    throw new HTTPException(400, { message: 'Invalid family invite id' });
  }

  const data = c.req.valid('json');
  const result = await respondToFamilyProxyInvite(c.env.DB, {
    inviteId,
    inviteeAuthUserId: globalUserId,
    action: data.action,
  });

  return c.json({
    accepted: result.accepted,
    link: result.link ? {
      patient_identity_id: result.link.patientIdentityId,
      manager_auth_user_id: result.link.managerAuthUserId,
      access_role: result.link.accessRole,
    } : null,
  });
});

globalPortal.post('/family/links/:id/make-primary', async (c) => {
  const globalUserId = c.get('globalUserId');
  const linkId = Number(c.req.param('id'));

  if (!Number.isFinite(linkId) || linkId <= 0) {
    throw new HTTPException(400, { message: 'Invalid family link id' });
  }

  const transfer = await transferPrimaryFamilyManager(c.env.DB, {
    currentManagerAuthUserId: globalUserId,
    targetLinkId: linkId,
  });

  return c.json({
    transferred: true,
    patient_identity_id: transfer.patientIdentityId,
    primary_manager_link_id: transfer.primaryManagerLinkId,
  });
});

globalPortal.delete('/family/links/:id', async (c) => {
  const globalUserId = c.get('globalUserId');
  const linkId = Number(c.req.param('id'));

  if (!Number.isFinite(linkId) || linkId <= 0) {
    throw new HTTPException(400, { message: 'Invalid family link id' });
  }

  const result = await revokeFamilyManagerLink(c.env.DB, {
    linkId,
    actingAuthUserId: globalUserId,
  });

  return c.json(result);
});

globalPortal.get('/visit-pass', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const hasVisitPassesTable = await hasTable(db, 'patient_visit_passes');

  if (!hasVisitPassesTable) {
    return c.json({
      active_pass: null,
      recent_passes: [],
    });
  }

  const visitPassColumns = await getTableColumns(db, 'patient_visit_passes');
  const walletSelect = visitPassColumns.has('wallet_payload_encrypted')
    ? 'wallet_payload_encrypted'
    : 'NULL AS wallet_payload_encrypted';

  const { results } = await db.prepare(`
    SELECT id, code_last4, is_active, expires_at, redeemed_at, redeemed_by_tenant_id, revoked_at, created_at, ${walletSelect}
    FROM patient_visit_passes
    WHERE global_user_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 8
  `).bind(globalUserId).all<VisitPassHistoryRow>();

  const tenantIds = Array.from(new Set((results ?? [])
    .map((row) => row.redeemed_by_tenant_id)
    .filter((value): value is string => Boolean(value))));

  const tenantNameMap = new Map<string, string>();
  if (tenantIds.length > 0) {
    const { results: tenantRows } = await db.prepare(`
      SELECT id, name FROM tenants WHERE id IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(tenantIds)).all<{ id: string; name: string }>();
    for (const tenant of tenantRows ?? []) {
      tenantNameMap.set(String(tenant.id), String(tenant.name));
    }
  }

  const now = Date.now();
  const recentPasses = (results ?? []).map((row) => {
    let status: 'active' | 'expired' | 'redeemed' | 'revoked';
    if (row.revoked_at) status = 'revoked';
    else if (row.redeemed_at) status = 'redeemed';
    else if (new Date(row.expires_at).getTime() < now) status = 'expired';
    else status = 'active';

    return {
      id: row.id,
      pass_code_hint: `VP-**${row.code_last4}`,
      is_active: row.is_active === 1,
      status,
      expires_at: row.expires_at,
      redeemed_at: row.redeemed_at,
      redeemed_hospital: row.redeemed_by_tenant_id ? (tenantNameMap.get(row.redeemed_by_tenant_id) ?? row.redeemed_by_tenant_id) : null,
      revoked_at: row.revoked_at,
      created_at: row.created_at,
    };
  });

  const activePass = recentPasses.find((row) => row.status === 'active') ?? null;
  let activeWalletExport: Awaited<ReturnType<typeof buildVisitPassWalletExport>> | null = null;
  let activePassCode: string | null = null;
  let activeHospitals: VisitPassWalletSnapshot['hospitals'] = [];
  let activeScope: string | null = null;
  let activeQrValue: string | null = null;
  let activeActingProfile: VisitPassWalletSnapshot['acting_profile'] | undefined;

  if (activePass) {
    const rawRow = (results ?? []).find((row) => row.id === activePass.id);
    if (rawRow?.wallet_payload_encrypted) {
      try {
        const snapshot = await decryptWalletSnapshot<VisitPassWalletSnapshot>(c.env.JWT_SECRET, rawRow.wallet_payload_encrypted);
        activeWalletExport = await buildVisitPassWalletExport(c.env, snapshot);
        activePassCode = snapshot.pass_code;
        activeHospitals = snapshot.hospitals;
        activeScope = snapshot.scope;
        activeQrValue = snapshot.qrcode_value;
        activeActingProfile = snapshot.acting_profile;
      } catch {
        activeWalletExport = null;
        activePassCode = null;
      }
    }
  }

  return c.json({
    active_pass: activePass ? {
      ...activePass,
      pass_code: activePassCode,
      scope: activeScope ?? 'summary',
      qr_payload: activeQrValue ?? activePass.pass_code_hint,
      acting_profile: activeActingProfile,
      hospitals: activeHospitals,
      wallet_export: activeWalletExport,
    } : null,
    recent_passes: recentPasses,
  });
});

globalPortal.get('/emergency-pack', async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const managedIdentityId = getManagedIdentityIdFromRequest(c);
  const acting = await resolveActingPortalContext(db, globalUserId, managedIdentityId);
  // P0-30: verified-link only
  const verifiedEp = await db.prepare(`
    SELECT id, tenant_id, national_id, verification_method
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND revoked_at IS NULL LIMIT 1
  `).bind(globalUserId).first<{ id: number; tenant_id: string; national_id: string | null; verification_method: string }>();
  const links: Array<{ tenantId: string; patientId: number; hospitalName: string }> = [];
  if (verifiedEp?.national_id) {
    const pr = await db.prepare('SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
      .bind(verifiedEp.national_id, verifiedEp.tenant_id).first<{ id: number }>();
    const tr = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(verifiedEp.tenant_id).first<{ name: string }>();
    if (pr) links.push({
      tenantId: String(verifiedEp.tenant_id),
      patientId: Number(pr.id),
      hospitalName: tr?.name ?? String(verifiedEp.tenant_id),
    });
  }
  await recordHospitalLinkAudit(db, {
    patientId: globalUserId,
    action: 'lookup_data',
    outcome: links.length > 0 ? 'success' : 'not_found',
    details: { endpoint: 'emergency-pack' },
  });

  if (!links?.length) {
    return c.json({ emergency_pack: null });
  }

  const primaryLink = links[0];
  const row = await db.prepare(`
    SELECT hc.wallet_payload_encrypted
    FROM health_cards hc
    LEFT JOIN health_record_access_tokens hrat ON hrat.id = hc.token_id
    WHERE hc.tenant_id = ? AND hc.patient_id = ? AND hc.card_type = 'emergency' AND hc.status = 'active'
      AND (hrat.expires_at IS NULL OR datetime(hrat.expires_at) > datetime('now'))
      AND hc.wallet_payload_encrypted IS NOT NULL
    ORDER BY hc.id DESC
    LIMIT 1
  `).bind(primaryLink.tenantId, primaryLink.patientId).first<{ wallet_payload_encrypted: string | null }>();

  if (!row?.wallet_payload_encrypted) {
    return c.json({ emergency_pack: null });
  }

  const snapshot = await decryptWalletSnapshot<EmergencyPackWalletSnapshot>(c.env.JWT_SECRET, row.wallet_payload_encrypted);
  const walletExport = await buildEmergencyPackWalletExport(c.env, snapshot);

  return c.json({
    emergency_pack: {
      card_type: 'emergency',
      profile_kind: 'emergency',
      acting_profile: snapshot.acting_profile,
      expires_at: snapshot.expires_at,
      public_url: snapshot.public_url,
      qr_payload: snapshot.public_url,
      source_hospital: snapshot.source_hospital,
      profile: snapshot.profile,
      wallet_export: walletExport,
    },
  });
});

globalPortal.post('/emergency-pack', zValidator('json', createEmergencyPackSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const db = c.env.DB;
  const data = c.req.valid('json');
  const acting = await resolveActingPortalContext(db, globalUserId, data.managed_identity_id ?? null);
  // P0-30: verified-link only
  const verifiedPep = await db.prepare(`
    SELECT id, tenant_id, national_id
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND revoked_at IS NULL
  `).bind(globalUserId).all<{ id: number; tenant_id: string; national_id: string | null }>();
  const links: Array<{ tenantId: string; patientId: number; hospitalName: string }> = [];
  for (const link of verifiedPep.results ?? []) {
    if (!link.national_id) continue;
    const pr = await db.prepare('SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
      .bind(link.national_id, link.tenant_id).first<{ id: number }>();
    if (!pr) continue;
    const tr = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(link.tenant_id).first<{ name: string }>();
    links.push({
      tenantId: String(link.tenant_id),
      patientId: Number(pr.id),
      hospitalName: tr?.name ?? String(link.tenant_id),
    });
  }
  await recordHospitalLinkAudit(db, {
    patientId: globalUserId,
    action: 'lookup_data',
    outcome: links.length > 0 ? 'success' : 'not_found',
    details: { endpoint: 'post-emergency-pack' },
  });

  if (!links || links.length === 0) {
    throw new HTTPException(404, { message: 'No verified hospital link found. Verify a hospital before generating an emergency pack.' });
  }

  const primaryLink = links[0];

  const patient = await db.prepare(`
    SELECT id, national_id
    FROM patients
    WHERE id = ? AND tenant_id = ?
  `).bind(primaryLink.patientId, primaryLink.tenantId).first<{ id: number; national_id: string | null }>();

  if (!patient?.national_id) {
    throw new HTTPException(400, { message: 'Linked patient is missing National ID for emergency pack generation' });
  }

  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();

  const tokenResult = await db.prepare(`
    INSERT INTO health_record_access_tokens
      (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
    VALUES (?, ?, ?, ?, 'summary', 'patient', ?, ?)
  `).bind(tokenHash, patient.national_id, primaryLink.tenantId, primaryLink.patientId, globalUserId, expiresAt).run();

  const maxVersion = await db.prepare(
    'SELECT MAX(version) AS mv FROM health_cards WHERE tenant_id = ? AND patient_id = ?',
  ).bind(primaryLink.tenantId, primaryLink.patientId).first<{ mv: number | null }>();

  const version = (maxVersion?.mv ?? 0) + 1;

  await db.prepare(`
    INSERT INTO health_cards (tenant_id, patient_id, card_type, version, status, token_id, issued_by)
    VALUES (?, ?, 'emergency', ?, 'active', ?, ?)
  `).bind(primaryLink.tenantId, primaryLink.patientId, version, tokenResult.meta?.last_row_id, globalUserId).run();

  const profile = await buildEmergencyHealthProfile(c.env.DB, primaryLink.tenantId, primaryLink.patientId);
  if (!profile) {
    throw new HTTPException(404, { message: 'Emergency profile could not be generated' });
  }

  const publicUrl = `/api/public/emergency/${rawToken}`;
  const emergencySnapshot: EmergencyPackWalletSnapshot = {
    kind: 'emergency_pack',
    public_url: publicUrl,
    expires_at: expiresAt,
    source_hospital: primaryLink.hospitalName,
    patient_name: profile.patient.name,
    uhid: profile.patient.uhid,
    blood_group: profile.patient.blood_group,
    profile,
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? 'Patient',
      managed: acting.managed,
      relationship: acting.relationship,
    },
  };
  const walletPayloadEncrypted = await encryptWalletSnapshot(c.env.JWT_SECRET, emergencySnapshot);
  const walletExport = await buildEmergencyPackWalletExport(c.env, emergencySnapshot);

  if (tokenResult.meta?.last_row_id) {
    await db.prepare(`
      UPDATE health_cards
      SET wallet_payload_encrypted = ?
      WHERE token_id = ? AND tenant_id = ? AND patient_id = ? AND card_type = 'emergency'
    `).bind(
      walletPayloadEncrypted,
      tokenResult.meta.last_row_id,
      primaryLink.tenantId,
      primaryLink.patientId,
    ).run();
  }

  return c.json({
    card_type: 'emergency',
    profile_kind: 'emergency',
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? 'Patient',
      managed: acting.managed,
      relationship: acting.relationship,
    },
    expires_at: expiresAt,
    public_url: publicUrl,
    qr_payload: publicUrl,
    source_hospital: primaryLink.hospitalName,
    profile,
    wallet_export: walletExport,
    message: 'Emergency pack generated. Save or print it now because the token cannot be shown again.',
  }, 201);
});

globalPortal.post('/visit-pass', zValidator('json', createVisitPassSchema), async (c) => {
  const globalUserId = c.get('globalUserId');
  const { duration_hours, managed_identity_id } = c.req.valid('json');
  const db = c.env.DB;
  const hasVisitPassesTable = await hasTable(db, 'patient_visit_passes');

  if (!hasVisitPassesTable) {
    throw new HTTPException(503, { message: 'Visit pass feature is not available in this environment yet' });
  }

  const visitPassColumns = await getTableColumns(db, 'patient_visit_passes');

  const acting = await resolveActingPortalContext(db, globalUserId, managed_identity_id ?? null);

  if (!acting.actingIdentity.uhid) {
    throw new HTTPException(400, { message: 'Health card not linked to this patient account' });
  }

  // P0-30: verified-link only
  const verifiedVp = await db.prepare(`
    SELECT id, tenant_id, national_id, verification_method
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND revoked_at IS NULL
  `).bind(globalUserId).all<{ id: number; tenant_id: string; national_id: string | null; verification_method: string }>();
  const hospitals: Array<{ tenantId: string; patientId: number; hospitalName: string }> = [];
  for (const link of verifiedVp.results ?? []) {
    if (!link.national_id) continue;
    const pr = await db.prepare('SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1')
      .bind(link.national_id, link.tenant_id).first<{ id: number }>();
    if (!pr) continue;
    const tr = await db.prepare('SELECT name FROM tenants WHERE id = ? LIMIT 1')
      .bind(link.tenant_id).first<{ name: string }>();
    hospitals.push({
      tenantId: String(link.tenant_id),
      patientId: Number(pr.id),
      hospitalName: tr?.name ?? String(link.tenant_id),
    });
  }
  await recordHospitalLinkAudit(db, {
    patientId: globalUserId,
    action: 'lookup_data',
    outcome: hospitals.length > 0 ? 'success' : 'not_found',
    details: { endpoint: 'visit-pass' },
  });

  if (!hospitals.length) {
    throw new HTTPException(404, { message: 'No verified hospital link found for this health card' });
  }

  await db.prepare(`
    UPDATE patient_visit_passes
    SET is_active = 0, revoked_at = datetime('now')
    WHERE global_user_id = ? AND uhid = ? AND is_active = 1 AND revoked_at IS NULL AND expires_at > datetime('now')
  `).bind(globalUserId, acting.actingIdentity.uhid).run();

  const rawToken = generateVisitPassToken();
  const passCode = generateVisitPassCode();
  const expiresAt = new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString();
  const visitPassSnapshot: VisitPassWalletSnapshot = {
    kind: 'visit_pass',
    pass_code: passCode,
    expires_at: expiresAt,
    scope: 'summary',
    qrcode_value: passCode,
    uhid: acting.actingIdentity.uhid,
    patient_name: acting.actingIdentity.primaryName ?? 'Patient',
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? 'Patient',
      managed: acting.managed,
      relationship: acting.relationship,
    },
    hospitals: hospitals.map((row) => ({
      tenant_id: row.tenantId,
      hospital_name: row.hospitalName,
      patient_id: row.patientId,
    })),
  };
  const walletPayloadEncrypted = await encryptWalletSnapshot(c.env.JWT_SECRET, visitPassSnapshot);

  const insertColumns = [
    'token_hash',
    'code_hash',
    'code_last4',
    'global_user_id',
    'uhid',
    'is_active',
    'expires_at',
  ];
  const insertValues: Array<string | number> = [
    await sha256(rawToken),
    await sha256(passCode),
    passCode.slice(-4),
    globalUserId,
    acting.actingIdentity.uhid,
    1,
    expiresAt,
  ];

  if (visitPassColumns.has('wallet_payload_encrypted')) {
    insertColumns.push('wallet_payload_encrypted');
    insertValues.push(walletPayloadEncrypted);
  }

  await db.prepare(`
    INSERT INTO patient_visit_passes (
      ${insertColumns.join(', ')}
    ) VALUES (${insertColumns.map(() => '?').join(', ')})
  `).bind(...insertValues).run();
  const createdPass = await db.prepare(`
    SELECT id FROM patient_visit_passes WHERE token_hash = ? LIMIT 1
  `).bind(await sha256(rawToken)).first<{ id: number }>();

  const walletExport = await buildVisitPassWalletExport(c.env, visitPassSnapshot);

  return c.json({
    id: createdPass?.id ?? null,
    token: rawToken,
    pass_code: passCode,
    scope: 'summary',
    expires_at: expiresAt,
    acting_profile: {
      identity_id: acting.actingIdentityId,
      name: acting.actingIdentity.primaryName ?? 'Patient',
      managed: acting.managed,
      relationship: acting.relationship,
    },
    hospitals: hospitals.map((row) => ({
      tenant_id: row.tenantId,
      hospital_name: row.hospitalName,
      patient_id: row.patientId,
    })),
    qr_payload: JSON.stringify({
      type: 'visit_pass',
      token: rawToken,
      expires_at: expiresAt,
      scope: 'summary',
    }),
    wallet_export: walletExport,
  }, 201);
});

globalPortal.delete('/visit-pass/:id', async (c) => {
  const globalUserId = c.get('globalUserId');
  const passId = Number(c.req.param('id'));

  if (!Number.isFinite(passId) || passId <= 0) {
    throw new HTTPException(400, { message: 'Invalid visit pass id' });
  }

  const result = await c.env.DB.prepare(`
    UPDATE patient_visit_passes
    SET is_active = 0, revoked_at = datetime('now')
    WHERE id = ? AND global_user_id = ? AND is_active = 1
  `).bind(passId, globalUserId).run();

  if (!result.meta?.changes) {
    throw new HTTPException(404, { message: 'Active visit pass not found' });
  }

  return c.json({ revoked: true });
});

export default globalPortal;
