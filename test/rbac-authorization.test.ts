import { describe, it, expect } from 'vitest';

// ═════════════════════════════════════════════════════════════════════════════
// RBAC & AUTHORIZATION MATRIX TESTS
// Role × Resource permission matrix — every big company validates this
// ═════════════════════════════════════════════════════════════════════════════

describe('HMS RBAC & Authorization Matrix Tests', () => {

  type Role = 'super_admin' | 'platform_support' | 'hospital_admin' | 'director' | 'doctor' | 'nurse' | 'receptionist' | 'lab_tech' | 'pharmacist' | 'accountant';

  const ALL_ROLES: Role[] = ['super_admin', 'platform_support', 'hospital_admin', 'director', 'doctor', 'nurse', 'receptionist', 'lab_tech', 'pharmacist', 'accountant'];

  // Permission matrix: resource → allowed roles
  const PERMISSION_MATRIX: Record<string, Role[]> = {
    'patients.read':            ['super_admin', 'hospital_admin', 'director', 'doctor', 'nurse', 'receptionist', 'lab_tech', 'pharmacist', 'accountant'],
    'patients.create':          ['super_admin', 'hospital_admin', 'receptionist', 'nurse'],
    'patients.update':          ['super_admin', 'hospital_admin', 'receptionist', 'doctor', 'nurse'],
    'patients.delete':          ['super_admin', 'hospital_admin'],
    'billing.read':             ['super_admin', 'hospital_admin', 'director', 'receptionist', 'accountant'],
    'billing.create':           ['super_admin', 'hospital_admin', 'receptionist', 'accountant'],
    'billing.refund':           ['super_admin', 'hospital_admin', 'director'],
    'pharmacy.read':            ['super_admin', 'hospital_admin', 'pharmacist', 'doctor'],
    'pharmacy.sell':            ['super_admin', 'hospital_admin', 'pharmacist'],
    'pharmacy.purchase':        ['super_admin', 'hospital_admin', 'pharmacist'],
    'lab.read':                 ['super_admin', 'hospital_admin', 'lab_tech', 'doctor'],
    'lab.create_order':         ['super_admin', 'hospital_admin', 'doctor', 'receptionist'],
    'lab.enter_results':        ['super_admin', 'hospital_admin', 'lab_tech'],
    'prescriptions.create':     ['super_admin', 'hospital_admin', 'doctor'],
    'prescriptions.read':       ['super_admin', 'hospital_admin', 'doctor', 'nurse', 'pharmacist'],
    'admissions.admit':         ['super_admin', 'hospital_admin', 'doctor', 'nurse', 'receptionist'],
    'admissions.discharge':     ['super_admin', 'hospital_admin', 'doctor'],
    'reports.financial':        ['super_admin', 'hospital_admin', 'director', 'accountant'],
    'reports.operational':      ['super_admin', 'hospital_admin', 'director', 'doctor'],
    'expenses.create':          ['super_admin', 'hospital_admin', 'accountant'],
    'expenses.approve':         ['super_admin', 'hospital_admin', 'director'],
    'settings.read':            ['super_admin', 'hospital_admin', 'director'],
    'settings.update':          ['super_admin', 'hospital_admin'],
    'staff.manage':             ['super_admin', 'hospital_admin'],
    'audit.view':               ['super_admin', 'hospital_admin', 'director'],
    'profit.distribute':        ['super_admin', 'hospital_admin', 'director'],
    'tenant.manage':            ['super_admin'],
    'tenant.suspend':           ['super_admin', 'platform_support'],
  };

  function isAllowed(role: Role, permission: string): boolean {
    const allowedRoles = PERMISSION_MATRIX[permission];
    if (!allowedRoles) return false;
    return allowedRoles.includes(role);
  }

  // ─── 1. Super Admin has all permissions ────────────────────────────────────
  describe('Super Admin Permissions', () => {
    it('should have access to ALL resources', () => {
      for (const [perm] of Object.entries(PERMISSION_MATRIX)) {
        expect(isAllowed('super_admin', perm)).toBe(true);
      }
    });

    it('should be the ONLY role with tenant.manage', () => {
      const tenantManagers = ALL_ROLES.filter(r => isAllowed(r, 'tenant.manage'));
      expect(tenantManagers).toEqual(['super_admin']);
    });
  });

  // ─── 2. Doctor Permissions ─────────────────────────────────────────────────
  describe('Doctor Permissions', () => {
    it('should be able to create prescriptions', () => {
      expect(isAllowed('doctor', 'prescriptions.create')).toBe(true);
    });

    it('should be able to read lab results', () => {
      expect(isAllowed('doctor', 'lab.read')).toBe(true);
    });

    it('should be able to discharge patients', () => {
      expect(isAllowed('doctor', 'admissions.discharge')).toBe(true);
    });

    it('should NOT be able to manage staff', () => {
      expect(isAllowed('doctor', 'staff.manage')).toBe(false);
    });

    it('should NOT be able to approve expenses', () => {
      expect(isAllowed('doctor', 'expenses.approve')).toBe(false);
    });

    it('should NOT be able to sell pharmacy items', () => {
      expect(isAllowed('doctor', 'pharmacy.sell')).toBe(false);
    });
  });

  // ─── 3. Nurse Permissions ──────────────────────────────────────────────────
  describe('Nurse Permissions', () => {
    it('should read patients and prescriptions', () => {
      expect(isAllowed('nurse', 'patients.read')).toBe(true);
      expect(isAllowed('nurse', 'prescriptions.read')).toBe(true);
    });

    it('should admit patients', () => {
      expect(isAllowed('nurse', 'admissions.admit')).toBe(true);
    });

    it('should NOT discharge patients (doctor only)', () => {
      expect(isAllowed('nurse', 'admissions.discharge')).toBe(false);
    });

    it('should NOT create prescriptions', () => {
      expect(isAllowed('nurse', 'prescriptions.create')).toBe(false);
    });

    it('should NOT access financial reports', () => {
      expect(isAllowed('nurse', 'reports.financial')).toBe(false);
    });
  });

  // ─── 4. Receptionist Permissions ───────────────────────────────────────────
  describe('Receptionist Permissions', () => {
    it('should create patients', () => {
      expect(isAllowed('receptionist', 'patients.create')).toBe(true);
    });

    it('should create billing', () => {
      expect(isAllowed('receptionist', 'billing.create')).toBe(true);
    });

    it('should NOT enter lab results', () => {
      expect(isAllowed('receptionist', 'lab.enter_results')).toBe(false);
    });

    it('should NOT modify settings', () => {
      expect(isAllowed('receptionist', 'settings.update')).toBe(false);
    });
  });

  // ─── 5. Lab Tech Permissions ───────────────────────────────────────────────
  describe('Lab Tech Permissions', () => {
    it('should read lab orders', () => {
      expect(isAllowed('lab_tech', 'lab.read')).toBe(true);
    });

    it('should enter lab results', () => {
      expect(isAllowed('lab_tech', 'lab.enter_results')).toBe(true);
    });

    it('should NOT create billing', () => {
      expect(isAllowed('lab_tech', 'billing.create')).toBe(false);
    });

    it('should NOT create prescriptions', () => {
      expect(isAllowed('lab_tech', 'prescriptions.create')).toBe(false);
    });
  });

  // ─── 6. Pharmacist Permissions ─────────────────────────────────────────────
  describe('Pharmacist Permissions', () => {
    it('should sell pharmacy items', () => {
      expect(isAllowed('pharmacist', 'pharmacy.sell')).toBe(true);
    });

    it('should purchase pharmacy stock', () => {
      expect(isAllowed('pharmacist', 'pharmacy.purchase')).toBe(true);
    });

    it('should read prescriptions (to dispense)', () => {
      expect(isAllowed('pharmacist', 'prescriptions.read')).toBe(true);
    });

    it('should NOT create prescriptions', () => {
      expect(isAllowed('pharmacist', 'prescriptions.create')).toBe(false);
    });
  });

  // ─── 7. Accountant Permissions ─────────────────────────────────────────────
  describe('Accountant Permissions', () => {
    it('should read financial reports', () => {
      expect(isAllowed('accountant', 'reports.financial')).toBe(true);
    });

    it('should create expenses', () => {
      expect(isAllowed('accountant', 'expenses.create')).toBe(true);
    });

    it('should read billing', () => {
      expect(isAllowed('accountant', 'billing.read')).toBe(true);
    });

    it('should NOT approve expenses (director only)', () => {
      expect(isAllowed('accountant', 'expenses.approve')).toBe(false);
    });

    it('should NOT manage staff', () => {
      expect(isAllowed('accountant', 'staff.manage')).toBe(false);
    });
  });

  // ─── 8. Director Permissions ───────────────────────────────────────────────
  describe('Director Permissions', () => {
    it('should approve expenses', () => {
      expect(isAllowed('director', 'expenses.approve')).toBe(true);
    });

    it('should view audit logs', () => {
      expect(isAllowed('director', 'audit.view')).toBe(true);
    });

    it('should distribute profit', () => {
      expect(isAllowed('director', 'profit.distribute')).toBe(true);
    });

    it('should view financial reports', () => {
      expect(isAllowed('director', 'reports.financial')).toBe(true);
    });

    it('should NOT manage tenant (super_admin only)', () => {
      expect(isAllowed('director', 'tenant.manage')).toBe(false);
    });
  });

  // ─── 9. Platform Support Permissions ───────────────────────────────────────
  describe('Platform Support Permissions', () => {
    it('should be able to suspend tenants', () => {
      expect(isAllowed('platform_support', 'tenant.suspend')).toBe(true);
    });

    it('should NOT manage tenants (create/delete)', () => {
      expect(isAllowed('platform_support', 'tenant.manage')).toBe(false);
    });

    it('should NOT access clinical data', () => {
      expect(isAllowed('platform_support', 'prescriptions.create')).toBe(false);
      expect(isAllowed('platform_support', 'lab.enter_results')).toBe(false);
    });
  });

  // ─── 10. Privilege Escalation Prevention ───────────────────────────────────
  describe('Privilege Escalation Prevention', () => {
    it('no low-privilege role should manage staff', () => {
      const lowRoles: Role[] = ['receptionist', 'lab_tech', 'pharmacist', 'accountant', 'nurse'];
      for (const role of lowRoles) {
        expect(isAllowed(role, 'staff.manage')).toBe(false);
      }
    });

    it('no non-admin role should update settings', () => {
      const nonAdminRoles: Role[] = ['doctor', 'nurse', 'receptionist', 'lab_tech', 'pharmacist', 'accountant', 'director'];
      for (const role of nonAdminRoles) {
        expect(isAllowed(role, 'settings.update')).toBe(false);
      }
    });

    it('no non-financial role should issue refunds', () => {
      const nonFinancial: Role[] = ['doctor', 'nurse', 'receptionist', 'lab_tech', 'pharmacist', 'accountant'];
      for (const role of nonFinancial) {
        expect(isAllowed(role, 'billing.refund')).toBe(false);
      }
    });
  });
});
