/**
 * Granular permissions for LIS (Lab), RIS (Radiology) and ProcedureOrders.
 *
 * SCOPE NOTE (fix/clinical-lis-ris):
 *   The project-wide `requirePermission(...)` middleware lives in
 *   `src/middleware/rbac.ts` (owned by `fix/auth-rbac`). This module
 *   defines the *permission names* + role-based shortcuts that the
 *   clinical/LIS/RIS routes consume today, using the existing
 *   `requireRole(...)` middleware. Once `fix/auth-rbac` ships the
 *   real `requirePermission` hoisted into `src/lib/authz.ts`, this
 *   file should be re-expressed in terms of those constants.
 *
 *   Per `docs/FIX_COORDINATION_PLAN.md`, this file MUST NOT edit
 *   `src/middleware/rbac.ts`. Documented for the coordinator.
 */

import { requireRole } from '../../../middleware/rbac';

// ─── Permission name constants ───────────────────────────────────────────────

export const LAB_PERMISSIONS = {
  ORDER_CREATE: 'lab.order.create',
  RESULT_ENTER: 'lab.result.enter',
  REPORT_VERIFY: 'lab.report.verify',
  REPORT_VALIDATE: 'lab.report.validate',
  REPORT_PUBLISH: 'lab.report.publish',
  REPORT_CORRECT: 'lab.report.correct',
  CATALOG_MANAGE: 'lab.catalog.manage',
  QC_RELEASE: 'lab.qc.release',
  SAMPLE_COLLECT: 'lab.sample.collect',
} as const;

export const RIS_PERMISSIONS = {
  CATALOG_MANAGE: 'ris.catalog.manage',
  ORDER_CREATE: 'ris.order.create',
  SCAN_PERFORM: 'ris.scan.perform',
  REPORT_DRAFT: 'ris.report.draft',
  REPORT_FINALIZE: 'ris.report.finalize',
  PACS_MANAGE: 'ris.pacs.manage',
} as const;

export const PROCEDURE_PERMISSIONS = {
  CREATE: 'procedureOrders.create',
  RESULT: 'procedureOrders.result',
  PUBLISH: 'procedureOrders.publish',
} as const;

// ─── Role groupings (used as fall-back until fix/auth-rbac lands) ────────────

// Broad legacy lab access roles — kept only for read-only GET endpoints and
// to keep the existing dashboard/lab pages alive. Mutating endpoints below
// use the tighter sets.
export const LAB_READ_ROLES = [
  'laboratory',
  'lab',
  'lab_tech',
  'doctor',
  'md',
  'nurse',
  'reception',
  'receptionist',
  'hospital_admin',
  'director',
  'accountant',
] as const;

// Pathologist / supervisor / admin only — required for verify / validate /
// publish / correct of lab reports. Per P0-14.
export const LAB_REPORT_GOVERNANCE_ROLES = [
  'pathologist',
  'lab_supervisor',
  'hospital_admin',
  'md',
] as const;

// Roles that may create / manage the lab catalog (price, code, panels). Per
// P0-12 — the previous broad `LAB_ACCESS_ROLES` allowed reception to mutate
// the catalog.
export const LAB_CATALOG_MANAGE_ROLES = [
  'laboratory',
  'lab',
  'lab_tech',
  'hospital_admin',
  'director',
  'md',
] as const;

export const LAB_RESULT_ENTRY_ROLES = [
  'laboratory',
  'lab',
  'lab_tech',
  'hospital_admin',
  'director',
  'md',
] as const;

export const LAB_ORDER_CREATE_ROLES = [
  'doctor',
  'md',
  'hospital_admin',
  'nurse',
  'reception',
  'receptionist',
  'laboratory',
  'lab',
  'lab_tech',
  'director',
] as const;

export const LAB_QC_RELEASE_ROLES = [
  'pathologist',
  'lab_supervisor',
  'hospital_admin',
  'director',
] as const;

export const LAB_SAMPLE_COLLECT_ROLES = [
  'phlebotomist',
  'nurse',
  'laboratory',
  'lab',
  'lab_tech',
  'doctor',
  'md',
  'hospital_admin',
  'director',
] as const;

// ─── RIS role groupings ─────────────────────────────────────────────────────

// RIS read — broad set (clinical staff can see radiology orders and reports).
export const RIS_READ_ROLES = [
  'hospital_admin',
  'doctor',
  'md',
  'nurse',
  'reception',
] as const;

// RIS catalog managers — per P0-15, doctors must NOT be allowed here.
export const RIS_CATALOG_MANAGE_ROLES = [
  'hospital_admin',
  'md',
  'radiologist',
  'ris_admin',
] as const;

// Roles that may create radiology orders.
export const RIS_ORDER_CREATE_ROLES = [
  'doctor',
  'md',
  'hospital_admin',
] as const;

// Roles that may operate the modality / perform the scan.
export const RIS_SCAN_PERFORM_ROLES = [
  'hospital_admin',
  'doctor',
  'md',
  'nurse',
  'radiographer',
  'ris_admin',
] as const;

// Radiologists (and admins) that may DRAFT a radiology report.
export const RIS_REPORT_DRAFT_ROLES = [
  'radiologist',
  'ris_admin',
  'hospital_admin',
  'md',
] as const;

// Only radiologists (and admins / MDs) may FINALIZE a radiology report — per
// P0-15: doctors may draft, but only radiologists publish.
export const RIS_REPORT_FINALIZE_ROLES = [
  'radiologist',
  'ris_admin',
  'hospital_admin',
  'md',
] as const;

// PACS management — must be a small administrative group.
export const RIS_PACS_MANAGE_ROLES = [
  'hospital_admin',
  'director',
  'ris_admin',
  'radiologist',
] as const;

// ─── Procedure orders RBAC ───────────────────────────────────────────────────

export const PROCEDURE_ORDER_CREATE_ROLES = [
  'doctor',
  'md',
  'nurse',
  'hospital_admin',
  'director',
] as const;

export const PROCEDURE_RESULT_ROLES = [
  'doctor',
  'md',
  'nurse',
  'hospital_admin',
  'laboratory',
  'lab',
  'lab_tech',
  'radiologist',
  'ris_admin',
  'director',
] as const;

export const PROCEDURE_PUBLISH_ROLES = [
  'doctor',
  'md',
  'hospital_admin',
  'radiologist',
  'laboratory',
  'lab_supervisor',
  'director',
] as const;

// ─── Middleware factories ────────────────────────────────────────────────────

/**
 * Coarse-grained middleware factory. Maps permission -> role list.
 *
 * This intentionally does NOT call `requirePermission(...)` because that
 * middleware resolves fine-grained user overrides from a table the
 * `fix/auth-rbac` branch owns. Until the centralized RBAC matrix is merged
 * we gate on role names, but the permission constant is preserved above
 * so a one-line swap is possible after `fix/auth-rbac` lands.
 */
export function requireLabPermission(permission: keyof typeof LAB_PERMISSIONS) {
  switch (permission) {
    case 'ORDER_CREATE':
      return requireRole(...LAB_ORDER_CREATE_ROLES);
    case 'RESULT_ENTER':
      return requireRole(...LAB_RESULT_ENTRY_ROLES);
    case 'REPORT_VERIFY':
    case 'REPORT_VALIDATE':
    case 'REPORT_PUBLISH':
    case 'REPORT_CORRECT':
      return requireRole(...LAB_REPORT_GOVERNANCE_ROLES);
    case 'CATALOG_MANAGE':
      return requireRole(...LAB_CATALOG_MANAGE_ROLES);
    case 'QC_RELEASE':
      return requireRole(...LAB_QC_RELEASE_ROLES);
    case 'SAMPLE_COLLECT':
      return requireRole(...LAB_SAMPLE_COLLECT_ROLES);
    default: {
      const exhaustive: never = permission;
      throw new Error(`Unhandled lab permission: ${String(exhaustive)}`);
    }
  }
}

export function requireRisPermission(permission: keyof typeof RIS_PERMISSIONS) {
  switch (permission) {
    case 'CATALOG_MANAGE':
      return requireRole(...RIS_CATALOG_MANAGE_ROLES);
    case 'ORDER_CREATE':
      return requireRole(...RIS_ORDER_CREATE_ROLES);
    case 'SCAN_PERFORM':
      return requireRole(...RIS_SCAN_PERFORM_ROLES);
    case 'REPORT_DRAFT':
      return requireRole(...RIS_REPORT_DRAFT_ROLES);
    case 'REPORT_FINALIZE':
      return requireRole(...RIS_REPORT_FINALIZE_ROLES);
    case 'PACS_MANAGE':
      return requireRole(...RIS_PACS_MANAGE_ROLES);
    default: {
      const exhaustive: never = permission;
      throw new Error(`Unhandled ris permission: ${String(exhaustive)}`);
    }
  }
}

export function requireProcedurePermission(permission: keyof typeof PROCEDURE_PERMISSIONS) {
  switch (permission) {
    case 'CREATE':
      return requireRole(...PROCEDURE_ORDER_CREATE_ROLES);
    case 'RESULT':
      return requireRole(...PROCEDURE_RESULT_ROLES);
    case 'PUBLISH':
      return requireRole(...PROCEDURE_PUBLISH_ROLES);
    default: {
      const exhaustive: never = permission;
      throw new Error(`Unhandled procedure permission: ${String(exhaustive)}`);
    }
  }
}
