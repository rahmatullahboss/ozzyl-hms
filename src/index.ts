import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { DashboardDO } from './do/dashboard-state';
import { securityHeaders } from './middleware/security';
import { tenantMiddleware } from './middleware/tenant';
import { authMiddleware } from './middleware/auth';
import { hardenDirectLoginResponse } from './middleware/direct-login-hardening';
import { hardenStaffLoginResponse } from './middleware/staff-login-hardening';
import { hardenStaffLogout, hardenStaffRefresh } from './middleware/staff-session-lifecycle';
import { rejectNonAccessBearerCredential } from './middleware/staff-token-purpose';
import { lisBridgeAuthMiddleware } from './middleware/lis-bridge-auth';
import { autoAuditMiddleware } from './middleware/audit';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { centralRoutePermissionFromEnv } from './lib/route-permissions';
import { resolvePatientAssetPath } from './lib/patient-asset-routing';
import { shouldBypassPatientAuthRateLimit } from './lib/patient-auth-rate-limit';
import {
  logServerError,
  shouldLogServerErrorResponse,
} from './lib/server-error-logging';
import { CanonicalStrictFinancialError } from './lib/canonical/strict-financial-policy';
import adminRoutes from './routes/admin/withActionCenterCollections';
import platformStaffRoutes from './routes/admin/platform-staff';
import { csrfOriginGuard } from './middleware/csrf';
import onboardingRoutes from './routes/onboarding';
import authRoutes from './routes/tenant/auth';
import patientRoutes from './routes/tenant/patients';
import testRoutes from './routes/tenant/tests';
import billingRoutes from './routes/tenant/billing';
import billingCounterRoutes from './routes/tenant/billingCounter';
import pharmacyRoutes from './routes/tenant/pharmacy';
import pharmacyReturnsRoutes from './routes/tenant/pharmacyReturns';
import dailyCollectionRoutes from './routes/tenant/dailyCollection';
import shiftHandoverReportRoutes from './routes/tenant/shiftHandoverReport';
import staffRoutes from './routes/tenant/staff';
import hrRoutes from './routes/tenant/hr';
import dashboardRoutes from './routes/tenant/dashboard';
import managerDashboardRoutes from './routes/tenant/managerDashboard';
import operationsMonitorRoutes from './routes/tenant/operationsMonitor';
import settingsRoutes from './routes/tenant/settings';
import backupRoutes from './routes/tenant/backup';
import shareholderRoutes from './routes/tenant/shareholders';
import shareholderPortalRoutes from './routes/tenant/shareholderPortal';
import seedRoutes from './routes/seed';
import initRoutes from './routes/init';
import accountingRoutes from './routes/tenant/accounting';
import accountingRecoveryRoutes from './routes/tenant/accountingRecovery';
import incomeRoutes from './routes/tenant/income';
import expenseRoutes from './routes/tenant/expenses';
import accountsRoutes from './routes/tenant/accounts';
import reportsRoutes from './routes/tenant/reports';
import auditRoutes from './routes/tenant/audit';
import profitRoutes from './routes/tenant/profit';
import journalRoutes from './routes/tenant/journal';
import recurringRoutes from './routes/tenant/recurring';
import costCenterRoutes from './routes/tenant/costCenters';
import subLedgerRoutes from './routes/tenant/subLedgers';
import voucherRoutes from './routes/tenant/vouchers';
import inventoryAccountingRoutes from './routes/tenant/inventoryAccounting';
import cashBookRoutes from './routes/tenant/cash-book';
import cashOperationsRoutes from './routes/tenant/cashOperations';
import cashLedgerRoutes from './routes/tenant/cashLedger';
import bankBookRoutes from './routes/tenant/bank-book';
import dueAgingRoutes from './routes/tenant/due-aging';
import approvalsRoutes from './routes/tenant/approvals';
import refundDisputesRoutes from './routes/tenant/refundDisputes';
import actionCenterRoutes from './routes/tenant/actionCenter';
import billVersionsRoutes from './routes/tenant/bill-versions';
import shiftClosingRoutes from './routes/tenant/shift-closing';
import scheduledHandler from './scheduled';
import doctorRoutes from './routes/tenant/doctors';
import { requireTenantId } from './lib/context-helpers';
import visitRoutes from './routes/tenant/visits';
import globalSearchRoute from './routes/tenant/global-search';
import labRoutes from './routes/tenant/lab';
import labMachineRoutes from './routes/tenant/labMachines';
import labMachineDowntimeRoutes from './routes/tenant/labMachineDowntime';
import labNotificationsRoutes from './routes/tenant/labNotifications';
import labBarcodeRoutes from './routes/tenant/labBarcode';
import clinicalReminderRoutes from './routes/tenant/clinicalReminders';
import permissionRoutes from './routes/tenant/permissions';
import accessControlRoutes from './routes/tenant/access-control';
import userRoutes from './routes/tenant/users';
import doseTemplateRoutes from './routes/tenant/dose-templates';
import adviceTemplateRoutes from './routes/tenant/advice-templates';
import orderSetRoutes from './routes/tenant/orderSets';
import testPackagesRoutes from './routes/tenant/test-packages';
import consentRoutes from './routes/tenant/consents';
import documentRoutes from './routes/tenant/documents';
import qualityKpiRoutes from './routes/tenant/qualityKpi';
import commissionRoutes from './routes/tenant/commissions';
import fractionRoutes from './routes/tenant/fractions';
import registerRoutes from './routes/register';
import loginDirectRoutes from './routes/login-direct';
import staffPasswordResetRoutes from './routes/staff-password-reset';
import publicInviteRoutes from './routes/public-invite';
import invitationRoutes from './routes/tenant/invitations';
import notificationRoutes from './routes/tenant/notifications';
import pdfRoutes from './routes/tenant/pdf';
import branchRoutes from './routes/tenant/branches';
import paymentRoutes from './routes/tenant/payments';
import consultationRoutes from './routes/tenant/consultations';
import appointmentRoutes from './routes/tenant/appointments-with-paid-context';
import admissionRoutes from './routes/tenant/admissions';
import ipdReportRoutes from './routes/tenant/ipdReports';
import nurseStationRoutes from './routes/tenant/nurseStation';
import doctorScheduleRoutes from './routes/tenant/doctorSchedules';
import prescriptionRoutes from './routes/tenant/prescriptions';
import dischargeRoutes from './routes/tenant/discharge';
import telemedicineRoutes from './routes/tenant/telemedicine';
import patientPortalRoutes from './routes/tenant/patientPortal';
import aiRoutes from './routes/tenant/ai';
import predictiveRoutes from './routes/tenant/predictiveAnalytics';
import cdsRoutes from './routes/tenant/clinicalDecisionSupport';
import insuranceRoutes from './routes/tenant/insurance';
import billingInsuranceRoutes from './routes/tenant/billingInsurance';
import ipdDoctorRoundRoutes from './routes/tenant/ipdDoctorRounds';
import inboxRoutes from './routes/tenant/inbox';
import pushRoutes from './routes/tenant/push';
import fhirRoutes from './routes/tenant/fhir';
import ccdaRoutes from './routes/tenant/ccda';
import bulkFhirRoutes from './routes/tenant/bulk-fhir';
import deviceRoutes from './routes/tenant/devices';
import allergyRoutes from './routes/tenant/allergies';
import billingCancellationRoutes from './routes/tenant/billingCancellation';
import billingHandoverRoutes from './routes/tenant/billingHandover';
import billingReportsRoutes from './routes/tenant/billingReports';
import creditNoteRoutes from './routes/tenant/creditNotes';
import globalPortalRoutes from './routes/global-portal';
import depositRoutes from './routes/tenant/deposits';
import empCashRoutes from './routes/tenant/empCash';
import doctorShiftRoutes from './routes/tenant/doctor-schedule';
import doctorScheduleRoutes2 from './routes/tenant/doctorSchedule';
import emergencyRoutes from './routes/tenant/emergency';
import ipBillingRoutes from './routes/tenant/ipBilling';
import canonicalIpdBillingRoutes from './routes/tenant/canonicalIpdBilling';
import canonicalReportingRoutes from './routes/tenant/canonicalReporting';
import canonicalFinancialSmokeRoutes from './routes/tenant/canonicalFinancialSmoke';
import fiscalYearRoutes from './routes/tenant/fiscalYears';
import otRoutes from './routes/tenant/ot';
import pushNotificationRoutes from './routes/tenant/pushNotifications';
import settlementRoutes from './routes/tenant/settlements';
import creditStatusRoutes from './routes/tenant/billingCreditStatus';
import agingRoutes from './routes/tenant/billingAging';
import vitalsRoutes from './routes/tenant/vitals';
import websiteRoutes from './routes/tenant/website';
import inventoryRoutes from './routes/tenant/inventory';
import billingMasterRoutes from './routes/tenant/billingMaster';
import discountRoutes from './routes/tenant/discounts';
import billingProvisionalRoutes from './routes/tenant/billingProvisional';
import receptionRoutes from './routes/tenant/reception';
import priceCategoryRoutes from './routes/tenant/priceCategories';
import labSettingsRoutes from './routes/tenant/labSettings';
import labMonitoringRoutes from './routes/tenant/labMonitoring';
import labQcRoutes from './routes/tenant/labQc';
import labCalibrationsRoutes from './routes/tenant/labCalibrations';
import labComponentsRoutes from './routes/tenant/labComponents';
import labWorkflowRoutes from './routes/tenant/labWorkflow';
import labValidationRoutes from './routes/tenant/labValidation';
import reportLabRoutes from './routes/tenant/reportLab';
import reportPharmacyRoutes from './routes/tenant/reportPharmacy';
import reportAppointmentRoutes from './routes/tenant/reportAppointment';
import nursingRoutes from './routes/tenant/nursing';
import ePrescribingRoutes from './routes/tenant/ePrescribing';
import medicalRecordsRoutes from './routes/tenant/medicalRecords';
import clinicalRoutes from './routes/tenant/clinical';
import radiologyRoutes from './routes/tenant/radiology';
import vaccinationRoutes from './routes/tenant/vaccinations';
import healthRecordRoutes from './routes/tenant/healthRecord';
import globalHealthRoutes from './routes/tenant/globalHealth';
import reminderRoutes from './routes/tenant/reminders';
import procedureOrderRoutes from './routes/tenant/procedureOrders';
import queueRoutes from './routes/tenant/queue';
import kitchenRoutes from './routes/tenant/kitchen';
import bloodBankRoutes from './routes/tenant/bloodBank';
import mlcRoutes from './routes/tenant/mlc';
import cssdRoutes from './routes/tenant/cssd';
import mfaRoutes from './routes/tenant/mfa';
import mfaLoginVerifyRoutes from './routes/mfa-login-verify';
import laundryRoutes from './routes/tenant/laundry';
import housekeepingRoutes from './routes/tenant/housekeeping';
import ambulanceRoutes from './routes/tenant/ambulance';
import mortuaryRoutes from './routes/tenant/mortuary';
import deathRecordRoutes from './routes/tenant/deathRecords';
import maternityRoutes from './routes/tenant/maternity';
import patientDuplicatesRoutes from './routes/tenant/patientDuplicates';
import whatsappRoutes from './routes/tenant/whatsapp';
import printTemplateRoutes from './routes/tenant/printTemplates';
import dischargePlanningRoutes from './routes/tenant/dischargePlanning';
import biomedicalWasteRoutes from './routes/tenant/biomedicalWaste';
import trackAnythingRoutes from './routes/tenant/trackAnything';
import lbfFormRoutes from './routes/tenant/lbfForms';
import questionnaireRoutes from './routes/tenant/questionnaires';
import priorAuthRoutes from './routes/tenant/priorAuth';
import physicalExamRoutes from './routes/tenant/physicalExam';
import feeSheetRoutes from './routes/tenant/feeSheet';
import dentalRoutes from './routes/tenant/dental';
import wardSupplyRoutes from './routes/tenant/wardSupply';
import helpdeskRoutes from './routes/tenant/helpdesk';
import psychiatryRoutes from './routes/tenant/psychiatry';
import dictationRoutes from './routes/tenant/dictation';
import requisitionRoutes from './routes/tenant/requisitions';
import groupAttendanceRoutes from './routes/tenant/groupAttendance';
import camosRoutes from './routes/tenant/camos';
import clinicalImageRoutes from './routes/tenant/clinicalImages';
import inputOutputRoutes from './routes/tenant/inputOutput';
import marketingReferralRoutes from './routes/tenant/marketingReferral';
import externalReferringDoctorRoutes from './routes/tenant/externalReferringDoctors';
import doctorCertificateRoutes from './routes/tenant/doctorCertificates';
import hospitalSiteRoutes from './routes/public/hospitalSite';
import publicHealthRecordRoutes from './routes/public/healthRecord';
import patientAuthRoutes from './routes/patient-auth';
import patientPhrRoutes from './routes/patient-phr';
import patientCardRoutes from './routes/patient-card';
import wellnessRoutes from './routes/wellness';
import foodRoutes from './routes/food';
import hospitalLinkRoutes from './routes/hospital-links';
import deviceNotificationRoutes from './routes/notifications';
import patientAmendmentRoutes, { staffAmendmentRoutes } from './routes/patient-amendments';
import patientReportedRoutes from './routes/tenant/patientReported';
import terminologyRoutes from './routes/tenant/terminology';
import mpiRoutes from './routes/tenant/mpi';
import visitPassRoutes from './routes/tenant/visitPass';
import marketplaceRoutes from './routes/marketplace';
import marketplacePatientRoutes from './routes/marketplace-patient';
import marketplaceAdminRoutes from './routes/marketplace-admin';
import marketplaceReviewRoutes from './routes/marketplace-reviews';
import referralRoutes from './routes/tenant/referrals';
import doctorAuthRoutes from './routes/doctor-auth';
import healthArticlesRoutes from './routes/public/healthArticles';
import publicHospitalRoutes from './routes/public/hospitals';
import patientHospitalLinkRoutes from './routes/tenant/patientHospitalLinks';
import departmentRoutes from './routes/tenant/departments';
import paymentMethodRoutes from './routes/tenant/payment-methods';
import referralHospitalsRoutes from './routes/tenant/referralHospitals';
import settingsImportExportRoutes from './routes/tenant/settings-import-export';
import syncRoutes from './routes/sync';
import schemaSyncRoutes from './routes/local-server/schema-sync';
import uploadRoutes from './routes/uploads';

import type { Env, Variables } from './types';

const app = new Hono<{ 
  Bindings: Env;
  Variables: Variables;
}>();

// Security headers on all responses
app.use('*', securityHeaders);

// Note: CORS removed — running as single-origin Worker.
// API and frontend are served from the same domain, so CORS is not needed.
// If you expose the API to external clients, add CORS back selectively.


app.use('*', logger());

app.use('*', async (c, next) => {
  await next();

  if (shouldLogServerErrorResponse(c.res.status)) {
    logServerError({
      request: c.req.raw,
      status: c.res.status,
      environment: c.env.ENVIRONMENT,
      source: 'response',
      message: `HTTP ${c.res.status} response`,
      tenantId: c.get('tenantId'),
      userId: c.get('userId'),
      requestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? undefined,
      tags: ['http_5xx_response'],
    });
  }
});

// Health check (public — useful for uptime monitors and version-bound smoke tests)
app.get('/api/health', (c) => c.json({
  status: 'ok',
  version: '1.0.0',
  workerVersionId: c.env.CF_VERSION_METADATA?.id ?? null,
  workerVersionTag: c.env.CF_VERSION_METADATA?.tag ?? null,
  timestamp: new Date().toISOString(),
}));

app.get('/api/local-server/status', (c) => {
  const isLocalServer = c.env.ENVIRONMENT === 'local_server';

  c.header('Cache-Control', 'no-store');
  return c.json({
    mode: c.env.ENVIRONMENT,
    localServer: isLocalServer,
    localServerId: c.env.LOCAL_SERVER_ID ?? null,
    cloudSyncConfigured: Boolean(c.env.CLOUD_SYNC_BASE_URL && c.env.CLOUD_SYNC_TOKEN),
    offlineOperational: isLocalServer,
    disabledWhenOffline: ['sms', 'email', 'online_payment', 'workers_ai', 'vectorize'],
    timestamp: new Date().toISOString(),
  });
});

app.route('/api/sync', syncRoutes);
app.route('/api/local-server/schema-sync', schemaSyncRoutes);
app.route('/api/uploads', uploadRoutes);

// Tutorial Page is served as static asset from web/dist/tutorial-page/

app.get('/api/health/deep', async (c) => {
  // P1-53: deep health is gated by DEEP_HEALTH_TOKEN for non-local callers.
  // - Local development (ENVIRONMENT in {development, local_server}):
  //   unauthenticated access is allowed for developer ergonomics.
  // - Staging / production: callers MUST present a matching token in
  //   the `X-Health-Token` header. If the secret is unset, all non-local
  //   callers are denied (fail-closed). See docs/INCIDENT_RUNBOOK.md.
  const env = c.env.ENVIRONMENT ?? '';
  const isLocalEnv = env === 'development' || env === 'local_server';
  const expectedToken = (c.env as { DEEP_HEALTH_TOKEN?: string }).DEEP_HEALTH_TOKEN;
  const providedToken = c.req.header('x-health-token');
  if (!isLocalEnv) {
    if (!expectedToken) {
      return c.json(
        { error: 'deep health disabled', reason: 'DEEP_HEALTH_TOKEN not configured' },
        403,
      );
    }
    if (providedToken !== expectedToken) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  const startedAt = Date.now();
  const probeKey = `health:${crypto.randomUUID()}`;

  const [dbCheck, kvCheck, r2Check] = await Promise.allSettled([
    c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>(),
    c.env.KV.put(probeKey, 'ok', { expirationTtl: 60 })
      .then(() => c.env.KV.get(probeKey))
      .then((value) => value === 'ok')
      .finally(() => c.env.KV.delete(probeKey).catch(() => undefined)),
    c.env.UPLOADS.list({ limit: 1 }).then(() => true),
  ]);

  const checks = {
    db: dbCheck.status === 'fulfilled' && dbCheck.value?.ok === 1 ? 'ok' : 'error',
    kv: kvCheck.status === 'fulfilled' && kvCheck.value === true ? 'ok' : 'error',
    r2: r2Check.status === 'fulfilled' && r2Check.value === true ? 'ok' : 'error',
  };
  const healthy = Object.values(checks).every((status) => status === 'ok');

  c.header('Cache-Control', 'no-store');
  return c.json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    duration_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503);
});

// ─── Dev-only routes (guarded by ENVIRONMENT check) ─────────────────
app.use('/api/seed/*', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Not available in this environment' }, 403);
  }
  return next();
});
app.use('/api/init/*', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Not available in this environment' }, 403);
  }
  return next();
});

app.route('/api/seed', seedRoutes);
app.route('/api/init', initRoutes);

// ─── Public: Onboarding applications (from landing page) ─────────────
// CORS preflight for landing page cross-origin requests
app.options('/api/onboarding/*', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/onboarding/*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
});
app.use('/api/onboarding/*', (c, next) => rateLimitMiddleware(c, next, { window: 3600, max: 5 }));
app.route('/api/onboarding', onboardingRoutes);

// ─── Public: Hospital self-signup ──────────────────────────────────────
// Rate limit: max 10 registrations per IP per hour
app.use('/api/register', (c, next) => rateLimitMiddleware(c, next, { window: 3600, max: 10 }));
app.route('/api/register', registerRoutes);

// ─── Public: Invitation validation + acceptance (no auth needed) ────────
// Separate path /api/invite/ so it's registered before the catch-all
// '/api/*' tenant+auth middleware and doesn't require JWT.
app.use('/api/invite/*', (c, next) => rateLimitMiddleware(c, next, { window: 900, max: 10 }));
app.route('/api/invite', publicInviteRoutes);

// ─── Public: Hospital site SSR (no auth needed) ──────────────────────
app.route('/site', hospitalSiteRoutes);

// ─── Public: Health record summary via token (no auth) ────────────────
app.use('/api/health-record/summary/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 10 }));
app.route('/api/health-record', publicHealthRecordRoutes);

// ─── Public: Shared prescription view (no auth) ─────────────────────────
app.get('/api/rx/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || token.length < 16) {
    return c.json({ error: 'Invalid share link' }, 400);
  }

  const rx = await c.env.DB.prepare(`
    SELECT p.*, pt.name AS patient_name, pt.patient_code, pt.date_of_birth, pt.gender,
           d.name AS doctor_name, d.specialty, d.bmdc_reg_no, d.qualifications
    FROM prescriptions p
    LEFT JOIN patients pt ON p.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    LEFT JOIN doctors d ON p.doctor_id = d.id AND d.tenant_id = p.tenant_id
    WHERE p.share_token = ?
  `).bind(token).first();

  if (!rx) return c.json({ error: 'Prescription not found or link expired' }, 404);

  // Check expiry
  const expiresAt = (rx as Record<string, unknown>).share_expires_at as string | null;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return c.json({ error: 'This share link has expired' }, 410);
  }

  // Fetch items
  const { results: items } = await c.env.DB.prepare(
    'SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order'
  ).bind((rx as Record<string, unknown>).id).all();

  // Fetch hospital name
  const setting = await c.env.DB.prepare(
    `SELECT value FROM settings WHERE tenant_id = ? AND key = 'hospital_name'`
  ).bind((rx as Record<string, unknown>).tenant_id).first<{ value: string }>();

  return c.json({
    prescription: {
      ...rx,
      hospital_name: setting?.value ?? 'Hospital',
      items,
    },
  });
});

// ─── Admin routes ─────────────────────────────────────────────────────
// Note: Rate limiting for login should be configured in Cloudflare WAF instead of KV.
// Worker middleware enforces auth (login) only. Per-route role gates
// live inside src/routes/admin/index.ts (super_admin-only for
// platform operations, all-admin-roles for tenant-scoped endpoints).
app.use('/api/admin/*', async (c, next) => {
  const path = c.req.path;
  // Allow login without auth
  if (path === '/api/admin/login' || path === '/api/admin/platform-staff/login') {
    return next();
  }
  // All other admin routes require auth
  return authMiddleware(c, next);
});

// CSRF defense-in-depth: verify Origin on state-changing /api/admin/* requests.
// SameSite=Strict cookies already block most cross-site requests, but
// checking Origin closes the gap for same-site subdomains and browser bugs.
app.use('/api/admin/*', csrfOriginGuard);

app.route('/api/admin/platform-staff', platformStaffRoutes);
app.route('/api/admin', adminRoutes);

// ─── Direct login (no tenant slug needed) ─────────────────────────────
// Slug-free login: resolves tenant from email automatically.
// ─── Public routes ──────────────────────────────────────────────────────
app.use('/api/auth/forgot-password', (c, next) => rateLimitMiddleware(c, next, { window: 900, max: 5 }));
app.route('/api/auth', staffPasswordResetRoutes);
app.use('/api/auth/login-direct', hardenDirectLoginResponse);
app.route('/api/auth/login-direct', loginDirectRoutes);

app.get('/api/downloads/android', async (c) => {
  const object = await c.env.UPLOADS.get('releases/ozzyl-lifestyle.apk');
  if (!object) {
    return c.json({ error: 'App not found. Please try again later.' }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', 'attachment; filename="Ozzyl-Lifestyle.apk"');
  headers.set('Content-Type', 'application/vnd.android.package-archive');
  return new Response(object.body, { headers });
});

// ─── CORS helper for patient portal endpoints ────────────────────────
function originMatchesPattern(origin: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;

  // Support simple wildcard hosts like https://*.ozzyl.com
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(origin);
}

function getPatientPortalCorsOrigin(c: { req: { header: (name: string) => string | undefined }; env: Env }): string | null {
  const requestOrigin = c.req.header('Origin');
  if (!requestOrigin) return null;

  const configuredOrigins = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const defaultOrigins = c.env.ENVIRONMENT === 'development'
    ? ['http://localhost:4321']
    : ['https://ozzyl.com', 'https://ozzyl-hms.pages.dev'];

  const allowedOrigins = [...configuredOrigins, ...defaultOrigins];
  return allowedOrigins.some((pattern) => originMatchesPattern(requestOrigin, pattern))
    ? requestOrigin
    : null;
}

// ─── Patient Health Portal Auth (tenant-agnostic, global) ─────────────
app.options('/api/patient-auth/*', (c) => {
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID, X-HMS-Workstation-ID');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/patient-auth/*', async (c, next) => {
  await next();
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
app.use('/api/patient-auth/*', (c, next) => {
  if (shouldBypassPatientAuthRateLimit(c.req.path, c.req.method)) {
    return next();
  }

  return rateLimitMiddleware(c, next, { window: 900, max: 10 });
});
app.route('/api/patient-auth', patientAuthRoutes);
app.route('/api/patient-phr', patientPhrRoutes);
app.route('/api/patient-card', patientCardRoutes);
app.route('/api/wellness', wellnessRoutes);
app.route('/api/food', foodRoutes);
app.route('/api/hospital-links', hospitalLinkRoutes);
app.route('/api/device-notifications', deviceNotificationRoutes);
app.route('/api/v1/push-notifications', deviceNotificationRoutes);
app.route('/api/patient-amendments', patientAmendmentRoutes);

// ─── Global Universal Patient Portal (Aggregated Data) ─────────────────
app.options('/api/global-portal/*', (c) => {
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/global-portal/*', async (c, next) => {
  await next();
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
app.route('/api/global-portal', globalPortalRoutes);

// ─── Patient Portal Data Routes (uses own globalPatientAuthMiddleware) ─
// CORS + mount BEFORE catch-all tenant/auth middleware
app.options('/api/patient-portal/*', (c) => {
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID, X-HMS-Workstation-ID');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/patient-portal/*', async (c, next) => {
  await next();
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
app.route('/api/patient-portal', patientPortalRoutes);

// Marketplace: Public Routes (no auth needed)
app.use('/api/v1/marketplace/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 60 }));
app.route('/api/v1/marketplace', marketplaceRoutes);

// Public: Health Articles (no auth needed)
app.use('/api/v1/public/health-articles/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 120 }));
app.route('/api/v1/public/health-articles', healthArticlesRoutes);

// Public: Hospital Discovery (no auth needed)
app.use('/api/v1/public/hospitals/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 120 }));
app.route('/api/v1/public/hospitals', publicHospitalRoutes);

// Marketplace: Patient Actions (global patient JWT, CORS enabled)
app.options('/api/v1/marketplace-patient/*', (c) => {
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/v1/marketplace-patient/*', async (c, next) => {
  await next();
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
app.route('/api/v1/marketplace-patient', marketplacePatientRoutes);

// Doctor Auth: Independent Chamber Registration/Login
app.use('/api/v1/doctor-auth/*', (c, next) => rateLimitMiddleware(c, next, { window: 900, max: 10 }));
app.route('/api/v1/doctor-auth', doctorAuthRoutes);

// Patient: Hospital Linking (global patient JWT)
app.use('/api/v1/patients/link-hospital/*', (c, next) => rateLimitMiddleware(c, next, { window: 900, max: 20 }));
app.route('/api/v1/patients/link-hospital', patientHospitalLinkRoutes);

// ─── Tenant auth routes ──────────────────────────────────────────────
// Login and logout are public; register requires authentication
app.route('/api/auth/login', authRoutes);
app.use('/api/auth/*', tenantMiddleware);
app.use('/api/auth/login', hardenStaffLoginResponse);
app.use('/api/auth/refresh', hardenStaffRefresh);
app.use('/api/auth/logout', hardenStaffLogout);
app.use('/api/auth/register', authMiddleware);
app.route('/api/auth', authRoutes);

// Public only for completing a password-bound, one-time MFA login challenge.
app.use('/api/mfa/verify', tenantMiddleware);
app.use('/api/mfa/verify', (c, next) => rateLimitMiddleware(c, next, { window: 300, max: 10 }));
app.route('/api/mfa', mfaLoginVerifyRoutes);

// SECURITY (P0-01): Force authentication on /api/auth/register.
// authMiddleware's skip list now only allows login/refresh/logout/verify-email.
// The redundant explicit mount here is defense-in-depth — even if the
// skip list regresses, this mount still requires a JWT.

// ─── Protected tenant routes ─────────────────────────────────────────
app.use('/api/*', tenantMiddleware);
app.use('/api/*', lisBridgeAuthMiddleware);
app.use('/api/*', rejectNonAccessBearerCredential);
app.use('/api/*', async (c, next) => {
  if (c.get('lisBridgeAuth')) {
    await next();
    return;
  }
  return authMiddleware(c, next);
});
app.use('/api/*', centralRoutePermissionFromEnv());
app.use('/api/*', autoAuditMiddleware());

app.route('/api/accounting-recovery', accountingRecoveryRoutes);

// Marketplace: Hospital Admin Routes (requires tenant + auth)
app.route('/api/v1/marketplace-admin', marketplaceAdminRoutes);
app.route('/api/v1/marketplace/reviews', marketplaceReviewRoutes);
app.route('/api/v1/referrals', referralRoutes);

app.route('/api/patients', patientRoutes);
app.route('/api/tests', testRoutes);
app.route('/api/billing', billingRoutes);
app.route('/api/billing-counter', billingCounterRoutes);
app.route('/api/pharmacy', pharmacyRoutes);
app.route('/api/pharmacy/returns', pharmacyReturnsRoutes);
app.route('/api/staff', staffRoutes);
app.route('/api/amendments', staffAmendmentRoutes);
app.route('/api/hr', hrRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/manager', managerDashboardRoutes);
app.route('/api/operations-monitor', operationsMonitorRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/shareholders', shareholderRoutes);
app.use('/api/shareholder-portal/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 60 }));
app.route('/api/shareholder-portal', shareholderPortalRoutes);
app.route('/api/accounting', accountingRoutes);
app.route('/api/income', incomeRoutes);
app.route('/api/expenses', expenseRoutes);
app.route('/api/accounts', accountsRoutes);
app.route('/api/reports/daily-collection', dailyCollectionRoutes);
app.route('/api/reports/shift-handover', shiftHandoverReportRoutes);
app.use('/api/cash-book/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/cash-book', cashBookRoutes);
app.use('/api/cash-operations/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/cash-operations', cashOperationsRoutes);
app.use('/api/cash-ledger/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/cash-ledger', cashLedgerRoutes);
app.use('/api/bank-book/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/bank-book', bankBookRoutes);
app.use('/api/due-aging/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/due-aging', dueAgingRoutes);
app.use('/api/approvals/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/approvals', approvalsRoutes);
app.use('/api/refund-disputes/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/refund-disputes', refundDisputesRoutes);
app.use('/api/action-center/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/action-center', actionCenterRoutes);
app.use('/api/bill-versions/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/bill-versions', billVersionsRoutes);
app.use('/api/shift-closing/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/shift-closing', shiftClosingRoutes);
app.route('/api/reports', reportsRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/profit', profitRoutes);
app.route('/api/journal', journalRoutes);
app.route('/api/cost-centers', costCenterRoutes);
app.route('/api/sub-ledgers', subLedgerRoutes);
app.route('/api/vouchers', voucherRoutes);
app.route('/api/inventory-accounting', inventoryAccountingRoutes);
app.route('/api/recurring', recurringRoutes);
app.route('/api/doctors', doctorRoutes);
app.route('/api/departments', departmentRoutes);
app.route('/api/payment-methods', paymentMethodRoutes);
app.route('/api/referral-hospitals', referralHospitalsRoutes);
app.route('/api', settingsImportExportRoutes);

// GET /api/tenant/setup-status — check hospital onboarding progress
app.get('/api/tenant/setup-status', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;

  try {
    // Count doctors
    const doctorCount = await db.prepare(
      `SELECT COUNT(*) as count FROM doctors WHERE tenant_id = ? AND is_active = 1`
    ).bind(tenantId).first<{ count: number }>();

    // Count marketplace-published doctors
    const publishedDoctorCount = await db.prepare(
      `SELECT COUNT(*) as count FROM doctors WHERE tenant_id = ? AND is_active = 1 AND is_marketplace_visible = 1`
    ).bind(tenantId).first<{ count: number }>();

    // Check hospital marketplace status
    const hospital = await db.prepare(
      `SELECT is_published, public_description, specialties, public_photos, latitude, longitude FROM tenants WHERE id = ?`
    ).bind(tenantId).first<Record<string, unknown>>();

    // Check if any schedules exist
    const scheduleCount = await db.prepare(
      `SELECT COUNT(*) as count FROM doctor_schedules WHERE tenant_id = ?`
    ).bind(tenantId).first<{ count: number }>();

    return c.json({
      doctors: {
        total: doctorCount?.count ?? 0,
        published: publishedDoctorCount?.count ?? 0,
      },
      hospital: {
        isPublished: hospital?.is_published === 1,
        hasDescription: Boolean(hospital?.public_description),
        hasSpecialties: Boolean(hospital?.specialties),
        hasPhotos: Boolean(hospital?.public_photos),
        hasLocation: hospital?.latitude != null && hospital?.longitude != null,
      },
      schedules: {
        total: scheduleCount?.count ?? 0,
      },
      steps: {
        addDoctors: (doctorCount?.count ?? 0) > 0,
        publishHospital: hospital?.is_published === 1,
        addSchedules: (scheduleCount?.count ?? 0) > 0,
        publishDoctors: (publishedDoctorCount?.count ?? 0) > 0,
      },
      isComplete: (doctorCount?.count ?? 0) > 0 && hospital?.is_published === 1 && (publishedDoctorCount?.count ?? 0) > 0,
    });
  } catch {
    return c.json({ error: 'Failed to fetch setup status' }, 500);
  }
});

app.route('/api/visits', visitRoutes);
app.route('/api/lab', labRoutes);
app.route('/api/lab-workflow', labWorkflowRoutes);
app.route('/api/lab-machines', labMachineRoutes);
app.route('/api/lab-machine-downtime', labMachineDowntimeRoutes);
app.route('/api/lab-notifications', labNotificationsRoutes);
app.route('/api/lab-barcode', labBarcodeRoutes);
app.route('/api/lab-validation', labValidationRoutes);
app.route('/api/clinical-reminders', clinicalReminderRoutes);
app.route('/api/permissions', permissionRoutes);
app.route('/api/access-control', accessControlRoutes);
app.route('/api/users', userRoutes);
app.route('/api/dose-templates', doseTemplateRoutes);
app.route('/api/advice-templates', adviceTemplateRoutes);
app.route('/api/order-sets', orderSetRoutes);
app.route('/api/test-packages', testPackagesRoutes);
app.route('/api/consents', consentRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/quality-kpi', qualityKpiRoutes);
app.route('/api/commissions', commissionRoutes);
app.route('/api/fractions', fractionRoutes);
app.route('/api/invitations', invitationRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/pdf', pdfRoutes);
app.route('/api/branches', branchRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/consultations', consultationRoutes);
app.route('/api/appointments', appointmentRoutes);
app.route('/api/admissions', admissionRoutes);
app.route('/api/ipd-reports', ipdReportRoutes);
app.route('/api/nurse-station', nurseStationRoutes);
app.route('/api/doctor-schedules', doctorScheduleRoutes);
app.route('/api/prescriptions', prescriptionRoutes);
app.route('/api/discharge', dischargeRoutes);
app.route('/api/telemedicine', telemedicineRoutes);
app.use('/api/search/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 100 }));
app.route('/api/search', globalSearchRoute);
// patient-portal is now mounted above (before catch-all middleware)
app.route('/api/ai', aiRoutes);
app.route('/api/insurance', insuranceRoutes);
app.route('/api/billing/insurance', billingInsuranceRoutes);
app.route('/api/ipd-doctor-rounds', ipdDoctorRoundRoutes);
app.route('/api/inbox', inboxRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/fhir', fhirRoutes);
app.route('/api/ccda', ccdaRoutes);
app.route('/api/bulk-fhir', bulkFhirRoutes);
app.route('/api/devices', deviceRoutes);
app.route('/api/allergies', allergyRoutes);
app.route('/api/billing-cancellation', billingCancellationRoutes);
app.route('/api/billing-handover', billingHandoverRoutes);
app.route('/api/billing-reports', billingReportsRoutes);
app.route('/api/credit-notes', creditNoteRoutes);
app.route('/api/deposits', depositRoutes);
app.route('/api/emp-cash', empCashRoutes);
app.route('/api/doctor-schedule', doctorShiftRoutes);
app.route('/api/doctor-schedule-v2', doctorScheduleRoutes2);
app.route('/api/emergency', emergencyRoutes);
app.route('/api/ip-billing', ipBillingRoutes);
app.route('/api/canonical-ipd-billing', canonicalIpdBillingRoutes);
app.route('/api/canonical-reporting', canonicalReportingRoutes);
app.route('/api/canonical-financial-smoke', canonicalFinancialSmokeRoutes);
app.route('/api/fiscal-years', fiscalYearRoutes);
app.route('/api/ot', otRoutes);
app.route('/api/push-notifications', pushNotificationRoutes);
app.route('/api/settlements', settlementRoutes);
app.route('/api/billing-credit-status', creditStatusRoutes);
app.route('/api/billing-aging', agingRoutes);
app.route('/api/vitals', vitalsRoutes);
app.route('/api/website', websiteRoutes);
app.route('/api/inventory', inventoryRoutes);
app.route('/api/billing-master', billingMasterRoutes);
app.route('/api/tenant/discounts', discountRoutes);
app.route('/api/billing-provisional', billingProvisionalRoutes);
app.route('/api/reception', receptionRoutes);
app.route('/api/price-categories', priceCategoryRoutes);
app.route('/api/lab-settings', labSettingsRoutes);
app.route('/api/lab-monitoring', labMonitoringRoutes);
app.route('/api/lab-monitoring/qc', labQcRoutes);
app.route('/api/lab-monitoring/calibrations', labCalibrationsRoutes);
app.route('/api/lab-components', labComponentsRoutes);
app.route('/api/reports/lab', reportLabRoutes);
app.route('/api/reports/pharmacy', reportPharmacyRoutes);
app.route('/api/reports/appointment', reportAppointmentRoutes);
app.route('/api/nursing', nursingRoutes);
app.route('/api/e-prescribing', ePrescribingRoutes);
app.route('/api/medical-records', medicalRecordsRoutes);
app.route('/api/clinical', clinicalRoutes);
app.route('/api/radiology', radiologyRoutes);
app.route('/api/vaccinations', vaccinationRoutes);
app.route('/api', healthRecordRoutes);
app.route('/api/visit-pass', visitPassRoutes);
app.route('/api/global-health', globalHealthRoutes);
app.route('/api/reminders', reminderRoutes);
app.route('/api/procedure-orders', procedureOrderRoutes);
app.route('/api/queue', queueRoutes);
app.route('/api/kitchen', kitchenRoutes);
app.route('/api/blood-bank', bloodBankRoutes);
app.route('/api/mlc', mlcRoutes);
app.route('/api/cssd', cssdRoutes);
app.route('/api/mfa', mfaRoutes);
app.route('/api/laundry', laundryRoutes);
app.route('/api/housekeeping', housekeepingRoutes);
app.route('/api/ambulance', ambulanceRoutes);
app.route('/api/mortuary', mortuaryRoutes);
app.route('/api/death-records', deathRecordRoutes);
app.route('/api/maternity', maternityRoutes);
app.route('/api/patient-duplicates', patientDuplicatesRoutes);
app.route('/api/whatsapp', whatsappRoutes);
app.route('/api/print-templates', printTemplateRoutes);
app.route('/api/discharge-planning', dischargePlanningRoutes);
app.route('/api/biomedical-waste', biomedicalWasteRoutes);
app.route('/api/track-anything', trackAnythingRoutes);
app.route('/api/lbf', lbfFormRoutes);
app.route('/api/questionnaires', questionnaireRoutes);
app.route('/api/prior-auth', priorAuthRoutes);
app.route('/api/physical-exam', physicalExamRoutes);
app.route('/api/fee-sheet', feeSheetRoutes);
app.route('/api/dental', dentalRoutes);
app.route('/api/ward-supply', wardSupplyRoutes);
app.route('/api/helpdesk', helpdeskRoutes);
app.route('/api/psychiatry', psychiatryRoutes);
app.route('/api/dictation', dictationRoutes);
app.route('/api/predictive', predictiveRoutes);
app.route('/api/cds', cdsRoutes);
app.route('/api/requisitions', requisitionRoutes);
app.route('/api/group-attendance', groupAttendanceRoutes);
app.route('/api/camos', camosRoutes);
app.route('/api/clinical-images', clinicalImageRoutes);
app.route('/api/input-output', inputOutputRoutes);
app.route('/api/marketing-referral', marketingReferralRoutes);
app.route('/api/external-referring-doctors', externalReferringDoctorRoutes);
app.route('/api/doctor-certificates', doctorCertificateRoutes);
app.route('/api/terminology', terminologyRoutes);
app.route('/api/mpi', mpiRoutes);
app.route('/api/patient-reported', patientReportedRoutes);


// ─── Not Found handler ──────────────────────────────────────────────
// For API routes: return JSON 404
// For /admin/* routes: serve admin SPA (admin-panel/)
// For /patient/* routes: serve patient SPA (apps/ozzyl-lifestyle)
// For all other routes: fallback to hospital SPA (web/)
app.get('/tutorial-page', (c) => c.redirect('/tutorial-page/'));
app.get('/tutorial-page/', async (c) => {
  const url = new URL('/tutorial-page/index.html', c.req.url);
  const response = await c.env.ASSETS.fetch(new Request(url));
  return new Response(response.body, response);
});

app.get('/TESTING_TUTORIAL', (c) => c.redirect('/tutorial-page/'));

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Admin Panel SPA: serve admin/index.html for /admin/* routes
  if (c.req.path.startsWith('/admin')) {
    const adminRequest = new Request(new URL('/admin/index.html', c.req.url));
    const adminResponse = await c.env.ASSETS.fetch(adminRequest);
    return new Response(adminResponse.body, adminResponse);
  }

  // Patient Portal SPA: serve patient/index.html for /patient/* routes
  if (c.req.path.startsWith('/patient')) {
    const patientAssetPath = resolvePatientAssetPath(c.req.path);
    const patientRequest = new Request(new URL(patientAssetPath, c.req.url));
    const spaResponse = await c.env.ASSETS.fetch(patientRequest);
    return new Response(spaResponse.body, spaResponse);
  }

  // Hospital SPA fallback (client-side routing)
  const fallback = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(fallback.body, fallback);
});

// Global error handler — handles HTTPException & unknown errors
app.onError((err, c) => {
  const status = 'status' in err && typeof (err as { status: number }).status === 'number'
    ? (err as { status: number }).status
    : 500;

  if (err instanceof CanonicalStrictFinancialError) {
    return c.json({
      error: err.code,
      code: err.code,
      message: err.code === 'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED'
        ? 'This Demo Hospital financial operation is blocked during strict canonical verification.'
        : 'This Demo Hospital financial operation failed canonical verification.',
    }, 409);
  }

  logServerError({
    request: c.req.raw,
    status,
    environment: c.env.ENVIRONMENT,
    source: 'onError',
    error: err,
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    requestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? undefined,
    tags: ['unhandled_exception'],
  });

  if (status >= 400 && status < 500) {
    return c.json({ error: err.message, message: err.message }, status as 400);
  }

  return c.json({ error: 'Internal server error' }, 500);
});

// Export both the fetch handler (app) and the scheduled handler
// DashboardDO must be re-exported for the Cloudflare Workers runtime (matches wrangler.toml class_name)
export { DashboardDO };
export default {
  fetch: app.fetch,
  scheduled: scheduledHandler.scheduled,
};
