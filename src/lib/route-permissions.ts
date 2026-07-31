/**
 * Central RBAC route-permission matrix — P0-02
 *
 * This module is the **single source of truth** for which permission string
 * is required to access a given tenant route. It is intentionally:
 *
 *   • **Deny-by-default** — every entry has an explicit allow. Routes that
 *     do not appear in the matrix are treated as having no rule and are
 *     rejected by `enforceCentralRoutePermission`.
 *   • **Data-only** — it does NOT touch route handlers. Other agents
 *     (`fix/clinical-lis-ris`, `fix/billing-cash`, etc.) are responsible
 *     for importing from here and applying the matrix via the new helper
 *     `enforceCentralRoutePermission` exported alongside it.
 *   • **Read-mostly** — the matrix is a `const` exported array. To extend
 *     it, add an entry; do not mutate at runtime.
 *
 * ## Why a new file (and not just `mvp-route-permissions.ts`)?
 *
 * The pre-existing `MVP_ROUTE_PERMISSION_RULES` in `mvp-route-permissions.ts`
 * only covers 6 module prefixes and is MVP-era code. The matrix below covers
 * every mounted tenant route visible in `src/index.ts` and adds the
 * fine-grained permissions the code review asked for.
 *
 * ## Conventions
 *
 *   • Permission keys are `module:action` (e.g. `lab:verify`, `pharmacy:dispense`).
 *   • `path` is matched via `path === prefix || path.startsWith(prefix + '/')`.
 *   • HTTP verbs follow `readWrite('mod:read', 'mod:write', 'mod:delete')`.
 *   • The `requireRole(...)` short-circuit handles role-only routes (e.g.
 *     `billing.counter` requiring a counter-acting role).
 *
 * @see docs/CODE_REVIEW_PHASED_REPORT.md (P0-02)
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

export type HttpVerb = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export type RouteRule = {
  /** Mount prefix; matched with `path === prefix || path.startsWith(prefix + '/')` */
  prefix: string;
  /** Permission strings; `*` matches any HTTP verb */
  permissions: Partial<Record<HttpVerb, string | string[]>>;
  /** Optional explicit role allow-list (overrides permission check when present) */
  rolesAllowed?: readonly string[];
  /** Human-readable note for future maintainers */
  note?: string;
};

// ─── Module permission catalog ─────────────────────────────────────────────
//
// All permission strings in the matrix MUST be registered here. This is the
// code-side analogue of the (currently absent) `permissions` table in
// `src/db/schema/meta/*`. Other agents are expected to add new permissions
// here when introducing new route prefixes.
//
// Grouped by domain for grep-ability. DO NOT delete entries — they may be
// referenced by future migrations or by other agents that import from this
// module.

export const ROUTE_PERMISSIONS = {
  // ── Laboratory ──
  'lab:read': 'Read lab orders, results, catalog',
  'lab:write': 'Create / update lab orders and results',
  'lab:cancel': 'Cancel lab order',
  'lab:verify': 'Verify lab results (pathologist/supervisor only)',
  'lab:catalog:read': 'Read lab test catalog',
  'lab:catalog:write': 'Add / edit lab test catalog',
  'lab:machine:read': 'Read lab machine status',
  'lab:machine:write': 'Configure lab machines',
  'lab:report:publish': 'Publish final lab report to patient',
  'lab:qc:read': 'Read QC data',
  'lab:qc:write': 'Submit QC results',
  'lab:barcode:read': 'Read barcode metadata',
  'lab:barcode:write': 'Generate / print barcodes',
  'lab:validation:read': 'Read validation rules',
  'lab:validation:write': 'Create / edit validation rules',
  'lab:settings:write': 'Edit lab settings',

  // ── Radiology / RIS ──
  'ris:read': 'Read requisitions, reports, MWL',
  'ris:write': 'Create / update requisitions',
  'ris:report:write': 'Create / update radiology report',
  'ris:report:finalize': 'Finalize radiology report',
  'ris:catalog:read': 'Read imaging catalog',
  'ris:catalog:write': 'Edit imaging catalog and prices',
  'ris:report:publish': 'Publish finalized report',
  'ris:safety:read': 'Read patient safety checks',
  'ris:safety:write': 'Submit safety checklist',
  'ris:settings:write': 'Edit RIS settings',

  // ── Pharmacy / Inventory ──
  'pharmacy:read': 'Read pharmacy items, batches, stock',
  'pharmacy:write': 'Create / update pharmacy items',
  'pharmacy:cancel': 'Cancel pharmacy transaction',
  'pharmacy:dispense': 'Dispense medication (POS-style)',
  'pharmacy:return': 'Process returns',
  'pharmacy:narcotics': 'Handle narcotic register',
  'pharmacy:purchase:write': 'Create GRN / purchase orders',
  'pharmacy:purchase:approve': 'Approve GRN / purchase',
  'pharmacy:adjust:write': 'Submit stock adjustment',
  'pharmacy:adjust:approve': 'Approve stock adjustment',
  'pharmacy:invoice:write': 'Create pharmacy invoice',
  'pharmacy:invoice:finalize': 'Finalize pharmacy invoice',
  'pharmacy:settings:write': 'Edit pharmacy settings',

  // ── Billing / Cash drawer ──
  'billing:read': 'Read bills, payments, invoices',
  'billing:write': 'Create / edit bills',
  'billing:pay': 'Collect payment',
  'billing:cancel': 'Cancel bill (with audit)',
  'billing:refund': 'Issue refund (with audit)',
  'billing:counter:open': 'Open billing counter session',
  'billing:counter:close': 'Close billing counter session',
  'billing:counter:handover': 'Counter handover',
  'billing:cash:read': 'Read cash drawer / cash book',
  'billing:cash:write': 'Write cash drawer / cash book',
  'billing:creditnote:read': 'Read credit notes',
  'billing:creditnote:write': 'Create / approve credit notes',
  'billing:deposit:read': 'Read patient deposits',
  'billing:deposit:write': 'Create / adjust deposits',
  'billing:insurance:read': 'Read insurance claims',
  'billing:insurance:write': 'Submit / settle insurance claims',
  'billing:handover:write': 'Submit / approve handover',
  'billing:report:read': 'Read billing reports',
  'reporting:canonical:read': 'Read tenant-flagged canonical reports',
  'billing:provisional:write': 'Create provisional bills',
  'billing:aging:read': 'Read aging report',
  'billing:cancellation:write': 'Cancel posted transactions',

  // ── IPD / Admissions / Beds ──
  'ipd:read': 'Read admissions, beds, ward supply',
  'ipd:admit': 'Admit a patient',
  'ipd:discharge': 'Discharge a patient',
  'ipd:transfer': 'Transfer bed / ward',
  'ipd:bed:write': 'Reserve / allocate bed',
  'ipd:charge:write': 'Create IPD charge',
  'ipd:charge:read': 'Read IPD charges',
  'ipd:report:read': 'Read IPD reports',

  // ── Operation Theatre (OT) ──
  'ot:read': 'Read OT schedule, vitals, notes',
  'ot:book': 'Book OT slot',
  'ot:consent:write': 'Record OT consent',
  'ot:vitals:write': 'Record OT vitals',
  'ot:notes:write': 'Write OT intra-op notes',
  'ot:anesthesia:write': 'Record anesthesia notes',
  'ot:inventory:write': 'Consume OT inventory',
  'ot:billing:write': 'Generate OT charge',
  'ot:summary:write': 'Write OT summary',

  // ── Nursing / I&O / MAR ──
  'nursing:read': 'Read nursing notes, care plans',
  'nursing:write': 'Create / update nursing notes',
  'nursing:mar:write': 'Medication administration record',
  'nursing:io:write': 'Intake / output charting',
  'nursing:handover:write': 'Nurse handover notes',
  'nursing:careplan:write': 'Care plan entries',
  'nursing:station:read': 'Read nurse station dashboard',
  'nursing:station:write': 'Update nurse station',

  // ── CSSD / Sterilization ──
  'cssd:read': 'Read CSSD sets, cycles, inventory',
  'cssd:cycle:write': 'Start / complete sterilization cycle',
  'cssd:cycle:approve': 'Approve cycle release',
  'cssd:item:write': 'Issue / receive CSSD items',
  'cssd:inventory:read': 'Read CSSD sterile inventory',

  // ── Prescriptions ──
  'prescription:read': 'Read prescriptions',
  'prescription:write': 'Create / update prescription',
  'prescription:finalize': 'Finalize prescription',
  'prescription:lock': 'Lock prescription (post-dispense)',
  'prescription:safety:override': 'Override safety alert (audited)',
  'prescription:fulfilment:read': 'Read prescription fulfilment',
  'prescription:fulfilment:write': 'Mark prescription fulfilled',

  // ── Allergies / Vitals / Diagnosis / Notes ──
  'allergy:read': 'Read patient allergies',
  'allergy:write': 'Add / update allergy',
  'vitals:read': 'Read vitals',
  'vitals:write': 'Record vitals',
  'diagnosis:read': 'Read diagnoses',
  'diagnosis:write': 'Add / update diagnosis',
  'note:read': 'Read clinical notes',
  'note:write': 'Create / update clinical notes',
  'problem:read': 'Read problem list',
  'problem:write': 'Add / update problem list',
  'history:read': 'Read patient history',
  'history:write': 'Add / update history',
  'assessment:read': 'Read assessments',
  'assessment:write': 'Add / update assessment',
  'ros:read': 'Read review of systems',
  'ros:write': 'Add / update ROS',
  'medication:read': 'Read medication list',
  'medication:write': 'Add / update medication',
  'encounter:read': 'Read clinical encounters',
  'encounter:write': 'Create / update encounter',
  'careplan:read': 'Read care plans',
  'careplan:write': 'Add / update care plan',
  'glucose:read': 'Read glucose log',
  'glucose:write': 'Add glucose reading',
  'eye_exam:read': 'Read eye exam',
  'eye_exam:write': 'Add / update eye exam',
  'sdoh:read': 'Read SDOH',
  'sdoh:write': 'Add / update SDOH',
  'clinical_form:read': 'Read clinical forms',
  'clinical_form:write': 'Submit clinical form',
  'clinical_image:read': 'Read clinical images',
  'clinical_image:write': 'Upload clinical image',

  // ── Procedure orders (generic) ──
  'procedure_order:read': 'Read procedure orders',
  'procedure_order:write': 'Create / update procedure order',
  'procedure_order:result:write': 'Record procedure result',
  'procedure_order:cancel': 'Cancel procedure order',

  // ── Master Patient Index (MPI) ──
  'mpi:read': 'Search / read MPI',
  'mpi:write': 'Create / update MPI',
  'mpi:merge:write': 'Merge duplicate MPI records',
  'mpi:guardian:write': 'Add / update guardian',
  'mpi:alias:write': 'Add / update alias',
  'mpi:verify:write': 'Upgrade verification level',

  // ── Personal Health Record (PHR) ──
  'phr:read': 'Read patient health record',
  'phr:write': 'Add to patient health record',
  'phr:vault:read': 'Read PHR vault file',
  'phr:vault:write': 'Upload PHR vault file',
  'phr:share:write': 'Generate / revoke share link',
  'phr:amendment:write': 'Submit amendment request',
  'phr:amendment:approve': 'Approve amendment',

  // ── Hospital links ──
  'hospital_link:read': 'Read hospital links',
  'hospital_link:write': 'Create / update hospital link',
  'hospital_link:approve': 'Approve hospital link (hospital side)',
  'hospital_link:consent:write': 'Set consent for link',
  'hospital_link:portal:read': 'Tenant patient portal bridge',

  // ── Consents ──
  'consent:read': 'Read consents',
  'consent:write': 'Create / update consent',
  'consent:revoke': 'Revoke consent',

  // ── Workforce / Staff / Roster ──
  'staff:read': 'Read legacy staff salary and account-linked details',
  'staff:write': 'Manage legacy staff salary and invitation flows',
  'workforce:read': 'Read staff operational profiles',
  'workforce:write': 'Create and update staff operational profiles',
  'workforce:deactivate': 'Deactivate staff operational profiles',
  'roster:read': 'Read duty roster and rotations',
  'roster:write': 'Assign duty roster and rotations',
  'roster:swap': 'Swap roster assignments',
  'roster:cancel': 'Cancel roster assignments',
  'roster:generate': 'Generate roster from rotations',
  'calendar:read': 'Read workforce weekends and holidays',
  'calendar:write': 'Manage workforce weekends and holidays',
  'attendance:read': 'Read workforce attendance',
  'attendance:write': 'Record workforce attendance',
  'attendance:correct': 'Correct or manually record attendance',
  'leave:read': 'Read leave balances and requests',
  'leave:request': 'Submit a leave request',
  'leave:approve': 'Approve, reject, configure, or reconcile leave',
  'biometric:read': 'Read biometric devices, enrollment, and punches',
  'biometric:manage': 'Manage biometric devices and enrollment',
  'overtime:read': 'Read operational overtime rules and logs',
  'overtime:write': 'Create operational overtime rules',
  'overtime:approve': 'Approve or reject operational overtime',

  // ── Schema sync (local-server) ──
  'schema_sync:read': 'Read schema sync status / diff',
  'schema_sync:approve': 'Approve schema sync change',
  'schema_sync:apply': 'Apply schema sync change',
} as const;

export type RoutePermission = keyof typeof ROUTE_PERMISSIONS;

// ─── Matrix ────────────────────────────────────────────────────────────────

export const ROUTE_PERMISSION_MATRIX: readonly RouteRule[] = [
  // ── Laboratory (all mounted under /api/lab/*) ──
  {
    prefix: '/api/lab/machines',
    permissions: { GET: 'lab:machine:read', POST: 'lab:machine:write', PUT: 'lab:machine:write', DELETE: 'lab:machine:write' },
    note: 'Lab machine + downtime config',
  },
  {
    prefix: '/api/lab/catalog',
    permissions: { GET: 'lab:catalog:read', POST: 'lab:catalog:write', PUT: 'lab:catalog:write', DELETE: 'lab:catalog:write' },
    note: 'Lab catalog (panels, components)',
  },
  {
    prefix: '/api/lab/qc',
    permissions: { GET: 'lab:qc:read', POST: 'lab:qc:write', PUT: 'lab:qc:write' },
    note: 'QC submission / review',
  },
  {
    prefix: '/api/lab/barcode',
    permissions: { GET: 'lab:barcode:read', POST: 'lab:barcode:write' },
    note: 'Barcode generation and lookup',
  },
  {
    prefix: '/api/lab/validation',
    permissions: { GET: 'lab:validation:read', POST: 'lab:validation:write', PUT: 'lab:validation:write' },
    note: 'Validation rules CRUD',
  },
  {
    prefix: '/api/lab/settings',
    permissions: { GET: 'lab:read', POST: 'lab:settings:write', PUT: 'lab:settings:write' },
    note: 'Lab tenant settings',
  },
  {
    prefix: '/api/lab/items', // covers result / sample-status / verify / reject / recollect
    permissions: {
      GET: 'lab:read',
      POST: 'lab:write',
      PUT: 'lab:write',
      PATCH: 'lab:write',
      DELETE: 'lab:cancel',
    },
    note: 'Lab order items and result workflow. verify sub-path is auto-elevated to lab:verify in helper.',
  },
  {
    prefix: '/api/lab',
    permissions: { GET: 'lab:read', POST: 'lab:write', PUT: 'lab:write', PATCH: 'lab:write', DELETE: 'lab:cancel' },
    note: 'Catch-all for /api/lab/* (orders, results, reports, monitoring)',
  },

  // ── Radiology (RIS) ──
  {
    prefix: '/api/radiology',
    permissions: {
      GET: 'ris:read',
      POST: 'ris:write',
      PUT: 'ris:report:write',
      PATCH: 'ris:write',
      DELETE: 'ris:catalog:write',
    },
    note: 'RIS routes; report finalize is auto-elevated to ris:report:finalize',
  },

  // ── Pharmacy ──
  {
    prefix: '/api/pharmacy/returns',
    permissions: { GET: 'pharmacy:read', POST: 'pharmacy:return', PUT: 'pharmacy:return' },
    note: 'Pharmacy returns',
  },
  {
    prefix: '/api/pharmacy/purchase',
    permissions: { GET: 'pharmacy:read', POST: 'pharmacy:purchase:write', PUT: 'pharmacy:purchase:write' },
    note: 'GRN / purchase orders',
  },
  {
    prefix: '/api/pharmacy/stock',
    permissions: {
      GET: 'pharmacy:read',
      POST: 'pharmacy:adjust:write',
      PUT: 'pharmacy:adjust:approve',
    },
    note: 'Stock adjustments',
  },
  {
    prefix: '/api/pharmacy/invoice',
    permissions: {
      GET: 'pharmacy:read',
      POST: 'pharmacy:invoice:write',
      PUT: 'pharmacy:invoice:finalize',
    },
    note: 'Pharmacy invoice / sale',
  },
  {
    prefix: '/api/pharmacy/settings',
    permissions: { GET: 'pharmacy:read', POST: 'pharmacy:settings:write', PUT: 'pharmacy:settings:write' },
    note: 'Pharmacy tenant settings',
  },
  {
    prefix: '/api/pharmacy',
    permissions: {
      GET: 'pharmacy:read',
      POST: 'pharmacy:write',
      PUT: 'pharmacy:write',
      PATCH: 'pharmacy:write',
      DELETE: 'pharmacy:cancel',
    },
    note: 'Catch-all for /api/pharmacy/*',
  },

  // ── Billing / Cash drawer ──
  {
    prefix: '/api/billing-counter',
    permissions: {
      GET: 'billing:read',
      POST: 'billing:counter:open',
      PUT: 'billing:counter:close',
    },
    note: 'Counter open / close / handover',
  },
  {
    prefix: '/api/billing-handover',
    permissions: { GET: 'billing:read', POST: 'billing:handover:write', PUT: 'billing:handover:write' },
    note: 'Counter handover',
  },
  {
    prefix: '/api/credit-notes',
    permissions: { GET: 'billing:creditnote:read', POST: 'billing:creditnote:write', PUT: 'billing:creditnote:write' },
    note: 'Credit notes',
  },
  {
    prefix: '/api/billing-cancellation',
    permissions: { GET: 'billing:read', POST: 'billing:cancellation:write' },
    note: 'Bill cancellation',
  },
  {
    prefix: '/api/billing-credit-status',
    permissions: { GET: 'billing:read' },
    note: 'Read credit status',
  },
  {
    prefix: '/api/billing-insurance',
    permissions: { GET: 'billing:insurance:read', POST: 'billing:insurance:write', PUT: 'billing:insurance:write' },
    note: 'Insurance claims',
  },
  {
    prefix: '/api/billing-provisional',
    permissions: { GET: 'billing:read', POST: 'billing:provisional:write', PUT: 'billing:provisional:write' },
    note: 'Provisional bills',
  },
  {
    prefix: '/api/billing-reports',
    permissions: { GET: 'billing:report:read' },
    note: 'Billing reports',
  },
  {
    prefix: '/api/billing-aging',
    permissions: { GET: 'billing:aging:read' },
    note: 'Aging report',
  },
  {
    prefix: '/api/cash-book',
    permissions: { GET: 'billing:cash:read', POST: 'billing:cash:write', PUT: 'billing:cash:write' },
    note: 'Cash book',
  },
  {
    prefix: '/api/deposits',
    permissions: { GET: 'billing:deposit:read', POST: 'billing:deposit:write', PUT: 'billing:deposit:write' },
    note: 'Patient deposits',
  },
  {
    prefix: '/api/billing',
    permissions: {
      GET: 'billing:read',
      POST: 'billing:write',
      PUT: 'billing:write',
      PATCH: 'billing:write',
      DELETE: 'billing:cancel',
    },
    note: 'Catch-all /api/billing/*; pay sub-path elevates to billing:pay',
  },

  // ── IPD / Admissions / Beds ──
  {
    prefix: '/api/admissions',
    permissions: { GET: 'ipd:read', POST: 'ipd:admit', PUT: 'ipd:discharge', DELETE: 'ipd:discharge' },
    note: 'Admissions (admit / discharge / transfer)',
  },
  {
    prefix: '/api/ip-billing',
    permissions: { GET: 'ipd:charge:read', POST: 'ipd:charge:write', PUT: 'ipd:charge:write' },
    note: 'IPD charge posting',
  },
  {
    prefix: '/api/canonical-ipd-billing',
    permissions: { GET: 'ipd:report:read' },
    note: 'Tenant-flagged read-only canonical IPD shadow projection',
  },
  {
    prefix: '/api/canonical-financial-smoke',
    permissions: { POST: 'billing:write' },
    rolesAllowed: ['hospital_admin'],
    note: 'Protected candidate-only Tenant 100 reversible financial smoke fixture',
  },
  {
    prefix: '/api/canonical-reporting',
    permissions: { GET: 'reporting:canonical:read' },
    rolesAllowed: ['hospital_admin', 'md', 'director', 'manager', 'accountant'],
    note: 'Tenant-flagged read-only canonical reporting canary endpoints',
  },
  {
    prefix: '/api/ipd-reports',
    permissions: { GET: 'ipd:report:read' },
    note: 'IPD reports',
  },
  {
    prefix: '/api/beds',
    permissions: { GET: 'ipd:read', POST: 'ipd:bed:write', PUT: 'ipd:bed:write' },
    note: 'Bed allocation',
  },
  {
    prefix: '/api/ward-supply',
    permissions: { GET: 'ipd:read', POST: 'ipd:read', PUT: 'ipd:read' },
    note: 'Ward supply consumption',
  },

  // ── Operation Theatre (OT) ──
  {
    prefix: '/api/ot',
    permissions: { GET: 'ot:read', POST: 'ot:book', PUT: 'ot:book' },
    note: 'OT catch-all; sub-paths elevate to ot:* actions',
  },

  // ── Nursing / I&O / MAR / Care plans ──
  {
    prefix: '/api/nursing',
    permissions: { GET: 'nursing:read', POST: 'nursing:write', PUT: 'nursing:write', PATCH: 'nursing:write' },
    note: 'Nursing catch-all',
  },
  {
    prefix: '/api/nurse-station',
    permissions: { GET: 'nursing:station:read', POST: 'nursing:station:write', PUT: 'nursing:station:write' },
    note: 'Nurse station dashboard',
  },
  {
    prefix: '/api/input-output',
    permissions: { GET: 'nursing:read', POST: 'nursing:io:write', PUT: 'nursing:io:write' },
    note: 'Intake / output charting',
  },
  {
    prefix: '/api/e-prescribing',
    permissions: { GET: 'nursing:read', POST: 'prescription:write' },
    note: 'e-Prescribing',
  },
  {
    prefix: '/api/medication-admin',
    permissions: { GET: 'nursing:read', POST: 'nursing:mar:write', PUT: 'nursing:mar:write' },
    note: 'MAR',
  },

  // ── CSSD ──
  {
    prefix: '/api/cssd',
    permissions: { GET: 'cssd:read', POST: 'cssd:cycle:write', PUT: 'cssd:cycle:write' },
    note: 'CSSD catch-all',
  },

  // ── Prescriptions ──
  {
    prefix: '/api/prescription-fulfilment',
    permissions: { GET: 'prescription:fulfilment:read', POST: 'prescription:fulfilment:write', PUT: 'prescription:fulfilment:write' },
    note: 'Prescription fulfilment',
  },
  {
    prefix: '/api/prescriptions',
    permissions: {
      GET: 'prescription:read',
      POST: 'prescription:write',
      PUT: 'prescription:write',
      PATCH: 'prescription:write',
      DELETE: 'prescription:lock',
    },
    note: 'Prescriptions; safety override sub-path elevates to prescription:safety:override',
  },

  // ── Allergies / Vitals / Diagnosis / Notes (clinical module) ──
  {
    prefix: '/api/allergies',
    permissions: { GET: 'allergy:read', POST: 'allergy:write', PUT: 'allergy:write', DELETE: 'allergy:write' },
    note: 'Allergies',
  },
  {
    prefix: '/api/vitals',
    permissions: { GET: 'vitals:read', POST: 'vitals:write', PUT: 'vitals:write' },
    note: 'Vitals',
  },
  {
    prefix: '/api/clinical',
    permissions: { GET: 'note:read', POST: 'note:write', PUT: 'note:write' },
    note: 'Catch-all /api/clinical/* (notes, diagnosis, problems, history, sdoh, ros, eye_exam, glucose, care_plans, forms, encounters, images, medications, assessments, vitals, allergies)',
  },

  // ── Procedure orders (generic) ──
  {
    prefix: '/api/procedure-orders',
    permissions: {
      GET: 'procedure_order:read',
      POST: 'procedure_order:write',
      PUT: 'procedure_order:result:write',
      PATCH: 'procedure_order:write',
      DELETE: 'procedure_order:cancel',
    },
    note: 'Generic procedure orders',
  },

  // ── MPI ──
  {
    prefix: '/api/mpi',
    permissions: { GET: 'mpi:read', POST: 'mpi:write', PUT: 'mpi:write', DELETE: 'mpi:merge:write' },
    note: 'Master Patient Index',
  },
  {
    prefix: '/api/patient-duplicates',
    permissions: { GET: 'mpi:read', POST: 'mpi:merge:write' },
    note: 'Duplicate detection / merge',
  },

  // ── PHR (Personal Health Record) ──
  {
    prefix: '/api/patient-phr',
    permissions: { GET: 'phr:read', POST: 'phr:write', PUT: 'phr:write' },
    note: 'Patient health record (global patient JWT)',
  },
  {
    prefix: '/api/patient-amendments',
    permissions: { GET: 'phr:amendment:write', POST: 'phr:amendment:write', PUT: 'phr:amendment:approve' },
    note: 'Patient amendment requests',
  },
  {
    prefix: '/api/medical-records',
    permissions: { GET: 'phr:read', POST: 'phr:write', PUT: 'phr:write' },
    note: 'Medical records (patient chart aggregate)',
  },
  {
    prefix: '/api/health-record',
    permissions: { GET: 'phr:read', POST: 'phr:write' },
    note: 'Health record summary',
  },
  {
    prefix: '/api/global-health',
    permissions: { GET: 'phr:read', POST: 'phr:write' },
    note: 'Global aggregated health record',
  },
  {
    prefix: '/api/wellness',
    permissions: { GET: 'phr:read', POST: 'phr:write' },
    note: 'Wellness data',
  },

  // ── Hospital links ──
  {
    prefix: '/api/hospital-links',
    permissions: { GET: 'hospital_link:read', POST: 'hospital_link:write', PUT: 'hospital_link:approve' },
    note: 'Global hospital-link API (cross-tenant)',
  },
  {
    prefix: '/api/patient-hospital-links',
    permissions: { GET: 'hospital_link:read', POST: 'hospital_link:write', PUT: 'hospital_link:approve' },
    note: 'Tenant patient-hospital-link API',
  },
  {
    prefix: '/api/v1/patients/link-hospital',
    permissions: { GET: 'hospital_link:read', POST: 'hospital_link:write', PUT: 'hospital_link:approve' },
    note: 'v1 patient link hospital',
  },
  {
    prefix: '/api/patient-portal',
    permissions: { GET: 'hospital_link:portal:read', POST: 'hospital_link:portal:read' },
    note: 'Tenant patient portal bridge (uses global patient JWT)',
  },

  // ── Consents ──
  {
    prefix: '/api/consents',
    permissions: { GET: 'consent:read', POST: 'consent:write', PUT: 'consent:write', DELETE: 'consent:revoke' },
    note: 'Consents CRUD',
  },

  // ── Workforce / Staff / Roster ──
  {
    prefix: '/api/staff',
    permissions: { GET: 'workforce:read', POST: 'workforce:write', PUT: 'workforce:write', PATCH: 'workforce:write', DELETE: 'workforce:deactivate' },
    note: 'Staff operational directory; identity invitations remain a separate account operation',
  },
  {
    prefix: '/api/hr/roster/holidays',
    permissions: { GET: 'calendar:read', POST: 'calendar:write', PUT: 'calendar:write', DELETE: 'calendar:write' },
    note: 'Workforce holiday calendar',
  },
  {
    prefix: '/api/hr/roster',
    permissions: { GET: 'roster:read', POST: 'roster:write', PUT: 'roster:write', PATCH: 'roster:write', DELETE: 'roster:cancel' },
    note: 'Roster assignment, rotation, swap, cancellation, and generation',
  },
  {
    prefix: '/api/hr/attendance/weekend-policies',
    permissions: { GET: 'calendar:read', POST: 'calendar:write', PUT: 'calendar:write', DELETE: 'calendar:write' },
    note: 'Tenant workforce weekend policy',
  },
  {
    prefix: '/api/hr/attendance',
    permissions: { GET: 'attendance:read', POST: 'attendance:write', PUT: 'attendance:write', PATCH: 'attendance:correct', DELETE: 'attendance:correct' },
    note: 'Attendance shifts, punches, reports, and projection actions',
  },
  {
    prefix: '/api/hr/leave/request',
    permissions: { POST: 'leave:request' },
    note: 'Submit employee leave request',
  },
  {
    prefix: '/api/hr/leave/requests',
    permissions: { GET: 'leave:read', PATCH: 'leave:approve', PUT: 'leave:approve', DELETE: 'leave:approve' },
    note: 'Leave request review lifecycle',
  },
  {
    prefix: '/api/hr/leave',
    permissions: { GET: 'leave:read', POST: 'leave:approve', PUT: 'leave:approve', PATCH: 'leave:approve', DELETE: 'leave:approve' },
    note: 'Leave categories, rules, balances, and carry forward',
  },
  {
    prefix: '/api/hr/biometric/punch/manual',
    permissions: { POST: 'attendance:correct' },
    note: 'Manual attendance correction',
  },
  {
    prefix: '/api/hr/biometric/punch',
    permissions: { POST: 'attendance:write' },
    note: 'Authenticated device or card attendance punch',
  },
  {
    prefix: '/api/hr/biometric/punches',
    permissions: { GET: 'attendance:read' },
    note: 'Attendance punch event queries',
  },
  {
    prefix: '/api/hr/biometric/overtime',
    permissions: { GET: 'overtime:read', POST: 'overtime:write', PUT: 'overtime:approve', PATCH: 'overtime:approve' },
    note: 'Operational overtime rules, logs, and review',
  },
  {
    prefix: '/api/hr/biometric',
    permissions: { GET: 'biometric:read', POST: 'biometric:manage', PUT: 'biometric:manage', PATCH: 'biometric:manage', DELETE: 'biometric:manage' },
    note: 'Biometric devices, enrollment, and device-origin punches',
  },

  // ── Schema sync (local-server) ──
  {
    prefix: '/api/local-server/schema-sync',
    permissions: {
      GET: 'schema_sync:read',
      POST: 'schema_sync:apply',
      PUT: 'schema_sync:approve',
      PATCH: 'schema_sync:apply',
      DELETE: 'schema_sync:apply',
    },
    note: 'Schema sync — apply endpoints are admin-only and additionally gated by header in src/routes/local-server/schema-sync.ts',
  },
] as const;

// ─── Lookup helpers ────────────────────────────────────────────────────────

function isPathUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Sub-path action elevation. Some routes use the same prefix but a different
 * required permission based on the URL segment after the prefix.
 *
 * Returning `null` means "fall back to the prefix's default permissions".
 */
export function getRouteActionPermission(prefix: string, path: string): string | null {
  const tail = path.slice(prefix.length).replace(/^\/+/, '');
  if (!tail) return null;

  // /api/lab/items/:id/verify  →  lab:verify
  if (prefix === '/api/lab/items' && /\/verify\/?$/.test(tail)) return 'lab:verify';
  // /api/lab/items/:id/publish  →  lab:report:publish
  if (prefix === '/api/lab' && /\/report\/[^/]+\/publish\/?$/.test(tail)) return 'lab:report:publish';
  // /api/radiology/:id/finalize  →  ris:report:finalize
  if (prefix === '/api/radiology' && /^\/?[^/]+\/finalize\/?$/.test(tail)) return 'ris:report:finalize';
  // /api/radiology/:id/publish  →  ris:report:publish
  if (prefix === '/api/radiology' && /^\/?[^/]+\/publish\/?$/.test(tail)) return 'ris:report:publish';
  // /api/radiology/safety/*  →  ris:safety:*
  if (prefix === '/api/radiology' && /^\/?safety(\/|$)/.test(tail)) {
    if (/write|submit|check/.test(tail)) return 'ris:safety:write';
    return 'ris:safety:read';
  }
  // /api/prescriptions/:id/safety-override  →  prescription:safety:override
  if (prefix === '/api/prescriptions' && /\/safety-override\/?$/.test(tail)) {
    return 'prescription:safety:override';
  }
  // /api/prescriptions/:id/lock  →  prescription:lock
  if (prefix === '/api/prescriptions' && /\/lock\/?$/.test(tail)) {
    return 'prescription:lock';
  }
  // /api/pharmacy/narcotics  →  pharmacy:narcotics
  if (prefix === '/api/pharmacy' && /^\/?narcotics(\/|$)/.test(tail)) {
    return 'pharmacy:narcotics';
  }
  // /api/hospital-links/:id/approve  →  hospital_link:approve
  if (prefix.startsWith('/api/hospital-links') || prefix.startsWith('/api/patient-hospital-links') || prefix.startsWith('/api/v1/patients/link-hospital')) {
    if (/^\/?[^/]+\/approve\/?$/.test(tail)) return 'hospital_link:approve';
    if (/^\/?[^/]+\/consent\/?$/.test(tail)) return 'hospital_link:consent:write';
  }
  // /api/billing/refund  →  billing:refund
  if (prefix === '/api/billing' && /^\/?refund\/?$/.test(tail)) {
    return 'billing:refund';
  }
  // /api/billing/pay  →  billing:pay
  if (prefix === '/api/billing' && /^\/?pay\/?$/.test(tail)) {
    return 'billing:pay';
  }
  // /api/hr/roster/:id/swap  →  roster:swap
  if (prefix === '/api/hr/roster' && /(?:^|\/)swap\/?$/.test(tail)) {
    return 'roster:swap';
  }
  // /api/hr/roster/generate  →  roster:generate
  if (prefix === '/api/hr/roster' && /^generate\/?$/.test(tail)) {
    return 'roster:generate';
  }

  return null;
}

export type RoutePermissionLookup = {
  prefix: string;
  permission: string | string[];
  rolesAllowed?: readonly string[];
};

/**
 * Resolve the required permission for a (path, method) pair.
 * Returns `null` if the path is not in the matrix (deny-by-default).
 */
export function getRequiredRoutePermission(path: string, method: string): RoutePermissionLookup | null {
  const normalized = method.toUpperCase() as HttpVerb;

  // Staff salary and invitation remain legacy identity/finance operations rather
  // than workforce-profile mutations. Resolve them before the broad /api/staff rule.
  if (normalized === 'GET' && /^\/api\/staff\/salary-report\/?$/.test(path)) {
    return { prefix: '/api/staff', permission: ['staff:read'] };
  }
  if (/^\/api\/staff\/[^/]+\/salary\/?$/.test(path)) {
    if (normalized === 'GET') return { prefix: '/api/staff', permission: ['staff:read'] };
    if (normalized === 'POST') return { prefix: '/api/staff', permission: ['staff:write'] };
  }
  if (normalized === 'POST' && /^\/api\/staff\/[^/]+\/invite\/?$/.test(path)) {
    return { prefix: '/api/staff', permission: ['staff:write'] };
  }

  // First match wins — order matters. The matrix is ordered most-specific → least-specific.
  for (const rule of ROUTE_PERMISSION_MATRIX) {
    if (!isPathUnder(path, rule.prefix)) continue;

    // Sub-path elevation
    const elevated = getRouteActionPermission(rule.prefix, path);
    if (elevated) {
      return {
        prefix: rule.prefix,
        permission: [elevated],
        rolesAllowed: rule.rolesAllowed,
      };
    }

    const verbPerm = rule.permissions[normalized] ?? rule.permissions.OPTIONS;
    if (!verbPerm) {
      return {
        prefix: rule.prefix,
        permission: [],
        rolesAllowed: rule.rolesAllowed,
      };
    }
    const permList = Array.isArray(verbPerm) ? verbPerm : [verbPerm];
    if (permList.length === 0) {
      return {
        prefix: rule.prefix,
        permission: [],
        rolesAllowed: rule.rolesAllowed,
      };
    }
    return {
      prefix: rule.prefix,
      permission: permList,
      rolesAllowed: rule.rolesAllowed,
    };
  }

  return null;
}

// ─── Enforcement helper ────────────────────────────────────────────────────

import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { resolveUserPermissions, resolveUserPermissionsCached } from '../middleware/rbac';
import type { Env, Variables } from '../types';

type CentralRbacEnv = { Bindings: Env; Variables: Variables };

export interface CentralRoutePermissionContext {
  env: Env;
  kv?: KVNamespace;
  tenantId?: string;
  userId?: string;
  role?: string;
  path: string;
  method: string;
}

/**
 * Resolve effective user permissions with KV cache.
 * Duplicated from `mvp-route-permissions.ts` to avoid creating a circular
 * import between the matrix and the existing MVP matrix helper.
 */
async function resolveEffective(ctx: CentralRoutePermissionContext): Promise<string[]> {
  if (!ctx.role) return [];
  if (ctx.role === 'hospital_admin' || ctx.role === 'super_admin') return ['*'];
  if (ctx.tenantId && ctx.userId && ctx.kv) {
    return resolveUserPermissionsCached(ctx.env.DB, ctx.kv, ctx.tenantId, ctx.role, ctx.userId);
  }
  if (ctx.tenantId && ctx.userId) {
    return resolveUserPermissions(ctx.env.DB, ctx.tenantId, ctx.role, ctx.userId);
  }
  return [];
}

/**
 * Hono middleware factory that enforces the central route-permission matrix.
 *
 * Other fix branches are expected to import this and register it after
 * their own RBAC helpers in `src/index.ts`:
 *
 * ```ts
 * import { centralRoutePermission } from './lib/route-permissions';
 * app.use('/api/*', centralRoutePermission());
 * ```
 *
 * Deny-by-default: if a (path, method) pair has no matrix entry, the
 * middleware throws 403.
 */
export type CentralRoutePermissionMode = 'enforce' | 'shadow';

export type CentralRoutePermissionViolation = {
  type: 'missing_rule' | 'method_not_allowed' | 'missing_role' | 'missing_permission' | 'permission_resolution_error';
  path: string;
  method: string;
  role?: string;
  userId?: string;
  tenantId?: string;
  prefix?: string;
  required?: string[];
  effectivePermissions?: string[];
  error?: string;
};

export interface CentralRoutePermissionOptions {
  mode?: CentralRoutePermissionMode;
  onViolation?: (event: CentralRoutePermissionViolation) => void | Promise<void>;
}

export function centralRoutePermission(options: CentralRoutePermissionOptions = {}): MiddlewareHandler<CentralRbacEnv> {
  const mode = options.mode ?? 'enforce';
  const report = async (event: CentralRoutePermissionViolation): Promise<void> => {
    if (options.onViolation) await options.onViolation(event);
  };
  return async (c, next) => {
    const lookup = getRequiredRoutePermission(c.req.path, c.req.method);
    const role = c.get('role') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    const tenantId = c.get('tenantId') as string | undefined;
    const baseEvent = { path: c.req.path, method: c.req.method, role, userId, tenantId };

    if (!lookup) {
      const violation = { type: 'missing_rule' as const, ...baseEvent };
      await report(violation);
      if (mode === 'shadow') {
        await next();
        return;
      }
      throw new HTTPException(403, {
        message: 'No route-permission rule defined for this endpoint',
      });
    }

    // Empty permission list = verb not allowed for this prefix.
    if (Array.isArray(lookup.permission) && lookup.permission.length === 0) {
      const violation = { type: 'method_not_allowed' as const, ...baseEvent, prefix: lookup.prefix };
      await report(violation);
      if (mode === 'shadow') {
        await next();
        return;
      }
      throw new HTTPException(405, {
        message: `Method ${c.req.method} not allowed for ${lookup.prefix}`,
      });
    }

    const required = Array.isArray(lookup.permission) ? lookup.permission : [lookup.permission];

    if (!role) {
      const violation = { type: 'missing_role' as const, ...baseEvent, prefix: lookup.prefix, required };
      await report(violation);
      if (mode === 'shadow') {
        await next();
        return;
      }
      throw new HTTPException(403, { message: 'No role assigned' });
    }

    if (lookup.rolesAllowed && lookup.rolesAllowed.includes(role)) {
      await next();
      return;
    }

    let permissions: string[];
    try {
      permissions = await resolveEffective({
        env: c.env,
        kv: c.env.KV,
        tenantId,
        userId,
        role,
        path: c.req.path,
        method: c.req.method,
      });
    } catch (error) {
      const violation = {
        type: 'permission_resolution_error' as const,
        ...baseEvent,
        prefix: lookup.prefix,
        required,
        error: error instanceof Error ? error.message : String(error),
      };
      await report(violation);
      if (mode === 'shadow') {
        await next();
        return;
      }
      throw error;
    }

    const hasAll = required.every((p) => permissions.includes(p) || permissions.includes('*'));
    if (!hasAll) {
      const violation = { type: 'missing_permission' as const, ...baseEvent, prefix: lookup.prefix, required, effectivePermissions: permissions };
      await report(violation);
      if (mode === 'shadow') {
        await next();
        return;
      }
      throw new HTTPException(403, {
        message: `Missing permission(s): ${required.join(', ')}`,
      });
    }
    await next();
  };
}

export function centralRoutePermissionFromEnv(): MiddlewareHandler<CentralRbacEnv> {
  const shadow = centralRoutePermission({
    mode: 'shadow',
    onViolation: (event) => console.warn('RBAC central route shadow violation', event),
  });
  const enforce = centralRoutePermission({
    mode: 'enforce',
    onViolation: (event) => console.error('RBAC central route enforce violation', event),
  });
  return async (c, next) => {
    const mode = c.env.RBAC_CENTRAL_ROUTE_MODE ?? 'off';
    if (mode === 'shadow') {
      await shadow(c, next);
      return;
    }
    if (mode === 'enforce') {
      await enforce(c, next);
      return;
    }
    await next();
  };
}

export const centralRoutePermissionShadowFromEnv = centralRoutePermissionFromEnv;
