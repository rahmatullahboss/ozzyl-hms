/**
 * Local RBAC permission catalog for IPD / OT / Nursing / CSSD / Ward Supply.
 *
 * Owned by `fix/ipd-ot-nursing`. These permission identifiers are referenced in
 * the route handlers and correspond to the canonical names from the
 * `fix/auth-rbac` plan:
 *
 *   OT:
 *     ot.booking.create
 *     ot.booking.cancel
 *     ot.consent.record
 *     ot.vitals.record
 *     ot.inventory.use
 *     ot.notes.write
 *     ot.anesthesia.record
 *     ot.summary.finalize
 *     ot.billing.post
 *
 *   Nursing:
 *     nursing.intake.record
 *     nursing.output.record
 *     nursing.vitals.record
 *     nursing.notes.write
 *
 *   CSSD:
 *     cssd.cycle.start
 *     cssd.cycle.complete
 *     cssd.cycle.release
 *     cssd.sterile.issue
 *     cssd.used.receive
 *
 * Implementation note: until the central permission matrix is updated by
 * `fix/auth-rbac`, these permissions are enforced by role checks in this
 * module. Each role-gate mirrors the permission name so the eventual migration
 * to the dynamic permission system is a one-line change per route.
 */

export type RbacPermission =
  | 'ot.booking.create'
  | 'ot.booking.cancel'
  | 'ot.consent.record'
  | 'ot.vitals.record'
  | 'ot.inventory.use'
  | 'ot.notes.write'
  | 'ot.anesthesia.record'
  | 'ot.summary.finalize'
  | 'ot.billing.post'
  | 'nursing.intake.record'
  | 'nursing.output.record'
  | 'nursing.vitals.record'
  | 'nursing.notes.write'
  | 'cssd.cycle.start'
  | 'cssd.cycle.complete'
  | 'cssd.cycle.release'
  | 'cssd.sterile.issue'
  | 'cssd.used.receive'
  | 'ward.supply.dispatch';

const PERMISSION_ROLE_MAP: Record<RbacPermission, readonly string[]> = {
  'ot.booking.create': ['doctor', 'nurse', 'hospital_admin', 'md', 'reception'],
  'ot.booking.cancel': ['doctor', 'nurse', 'hospital_admin', 'md'],
  'ot.consent.record': ['doctor', 'nurse', 'hospital_admin', 'md'],
  'ot.vitals.record': ['doctor', 'nurse', 'anesthetist', 'hospital_admin', 'md'],
  'ot.inventory.use': ['nurse', 'hospital_admin', 'md'],
  'ot.notes.write': ['doctor', 'hospital_admin', 'md'],
  'ot.anesthesia.record': ['doctor', 'anesthetist', 'hospital_admin', 'md'],
  'ot.summary.finalize': ['doctor', 'hospital_admin', 'md'],
  'ot.billing.post': ['accountant', 'hospital_admin', 'md', 'director'],
  'nursing.intake.record': ['nurse', 'doctor', 'hospital_admin', 'md'],
  'nursing.output.record': ['nurse', 'doctor', 'hospital_admin', 'md'],
  'nursing.vitals.record': ['nurse', 'doctor', 'hospital_admin', 'md'],
  'nursing.notes.write': ['nurse', 'doctor', 'hospital_admin', 'md'],
  'cssd.cycle.start': ['nurse', 'hospital_admin', 'md'],
  'cssd.cycle.complete': ['nurse', 'hospital_admin', 'md'],
  'cssd.cycle.release': ['nurse', 'doctor', 'hospital_admin', 'md'],
  'cssd.sterile.issue': ['nurse', 'hospital_admin', 'md'],
  'cssd.used.receive': ['nurse', 'hospital_admin', 'md'],
  'ward.supply.dispatch': ['nurse', 'hospital_admin', 'md', 'inventory'],
};

export const IPD_OT_NURSING_PERMISSIONS = Object.keys(PERMISSION_ROLE_MAP) as RbacPermission[];

/**
 * Get the list of role names allowed to use a given permission.
 *
 * `hospital_admin` and `super_admin` always have access; this list is for the
 * non-admin roles that should be granted the permission by default.
 */
export function rolesForPermission(permission: RbacPermission): readonly string[] {
  return PERMISSION_ROLE_MAP[permission];
}

/**
 * Check whether the supplied role is allowed to use a given permission.
 * Admin roles always have access.
 */
export function hasPermission(role: string | null | undefined, permission: RbacPermission): boolean {
  if (!role) return false;
  if (role === 'hospital_admin' || role === 'super_admin') return true;
  const allowed = PERMISSION_ROLE_MAP[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}
