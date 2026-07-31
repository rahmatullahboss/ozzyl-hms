import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_ROUTES,
  TENANT_ROLE_LABELS,
  VALID_TENANT_ROLES,
  getPermissionsForRole,
  normalizeRole,
} from '../src/lib/authz';

describe('authz', () => {
  it('supports all inviteable tenant roles including doctor and nurse', () => {
    expect(VALID_TENANT_ROLES).toEqual([
      'hospital_admin',
      'doctor',
      'nurse',
      'laboratory',
      'reception',
      'manager',
      'md',
      'director',
      'pharmacist',
      'accountant',
      'shareholder_viewer',
    ]);
  });

  it('normalizes legacy aliases to canonical roles', () => {
    expect(normalizeRole('receptionist')).toBe('reception');
    expect(normalizeRole('lab')).toBe('laboratory');
    expect(normalizeRole('lab_tech')).toBe('laboratory');
    expect(normalizeRole('doctor')).toBe('doctor');
    expect(normalizeRole('manager')).toBe('manager');
  });

  it('keeps role labels and default routes aligned with canonical roles', () => {
    expect(TENANT_ROLE_LABELS.doctor).toBe('Doctor');
    expect(TENANT_ROLE_LABELS.nurse).toBe('Nurse');
    expect(TENANT_ROLE_LABELS.manager).toBe('Manager');
    expect(TENANT_ROLE_LABELS.md).toBe('CEO / Managing Director');
    expect(TENANT_ROLE_LABELS.director).toBe('Administration');
    expect(DEFAULT_ROLE_ROUTES.doctor).toBe('doctor/dashboard');
    expect(DEFAULT_ROLE_ROUTES.nurse).toBe('nurse-station');
    expect(DEFAULT_ROLE_ROUTES.manager).toBe('manager/dashboard');
    expect(DEFAULT_ROLE_ROUTES.accountant).toBe('accountant/dashboard');
    expect(TENANT_ROLE_LABELS.shareholder_viewer).toBe('Shareholder Viewer');
    expect(DEFAULT_ROLE_ROUTES.shareholder_viewer).toBe('shareholder/dashboard');
  });

  it('returns consistent least-privilege permissions for clinical and finance roles', () => {
    expect(getPermissionsForRole('doctor')).toContain('patients:read');
    expect(getPermissionsForRole('doctor')).toContain('prescriptions:write');
    expect(getPermissionsForRole('doctor')).not.toContain('staff:delete');

    expect(getPermissionsForRole('nurse')).toContain('nursing:read');
    expect(getPermissionsForRole('nurse')).toContain('vitals:write');
    expect(getPermissionsForRole('nurse')).not.toContain('billing:write');

    expect(getPermissionsForRole('accountant')).toContain('accounting:read');
    expect(getPermissionsForRole('accountant')).toContain('reports:read');
    expect(getPermissionsForRole('accountant')).toContain('audit:read');
    expect(getPermissionsForRole('accountant')).not.toContain('settings:write');

    expect(getPermissionsForRole('shareholder_viewer')).toEqual([
      'shareholder_portal:read',
      'shareholder_portal:export',
    ]);
    expect(getPermissionsForRole('shareholder_viewer')).not.toContain('accounting:read');
    expect(getPermissionsForRole('shareholder_viewer')).not.toContain('reports:read');
    expect(getPermissionsForRole('shareholder_viewer')).not.toContain('shareholders:read');
  });

  it('separates receivable work, write-off request, and write-off approval permissions', () => {
    expect(getPermissionsForRole('manager')).toEqual(expect.arrayContaining([
      'receivables.view',
      'receivables.followup.manage',
      'receivables.write_off.request',
    ]));
    expect(getPermissionsForRole('manager')).not.toContain('receivables.write_off.approve');

    expect(getPermissionsForRole('accountant')).toEqual(expect.arrayContaining([
      'receivables.view',
      'receivables.followup.manage',
      'receivables.write_off.request',
    ]));
    expect(getPermissionsForRole('accountant')).not.toContain('receivables.write_off.approve');

    expect(getPermissionsForRole('md')).toContain('receivables.write_off.approve');
    expect(getPermissionsForRole('director')).toContain('receivables.write_off.approve');
    expect(getPermissionsForRole('reception')).not.toContain('receivables.write_off.request');
  });

  it('keeps counter takeover out of the receptionist default role while allowing management cash owners', () => {
    expect(getPermissionsForRole('reception')).not.toContain('billing.counter.takeover');
    expect(getPermissionsForRole('manager')).toContain('billing.counter.takeover');
    expect(getPermissionsForRole('md')).toContain('billing.counter.takeover');
    expect(getPermissionsForRole('director')).toContain('billing.counter.takeover');
    expect(getPermissionsForRole('accountant')).toContain('billing.counter.takeover');
  });

  it('keeps manager default permissions focused on reception and lab operations without executive reports', () => {
    const managerPerms = getPermissionsForRole('manager');

    expect(managerPerms).toEqual(expect.arrayContaining([
      'dashboard:read',
      'manager.dashboard.read',
      'operations.overview.read',
      'operations.alerts.read',
      'operations.tasks.read',
      'operations.department_status.read',
      'billing:write',
      'billing.counter.invoice.create',
      'billing.counter.handover.create',
      'billing.counter.takeover',
      'admissions:write',
      'tests:read',
      'tests:write',
    ]));
    expect(managerPerms).not.toContain('reports:read');
    expect(managerPerms).not.toContain('accounting:read');
    expect(managerPerms).not.toContain('operations.tasks.write');
    expect(managerPerms).not.toContain('profit:calculate');
    expect(managerPerms).not.toContain('roles:manage');
    expect(managerPerms).not.toContain('settings:write');
    expect(managerPerms).not.toContain('users:delete');
  });

  it('grants director reception desk permissions for workspace switching', () => {
    const directorPerms = getPermissionsForRole('director');

    expect(directorPerms).toEqual(expect.arrayContaining([
      'patients:read',
      'appointments:read',
      'billing:read',
      'billing.counter.read',
      'billing.counter.invoice.create',
      'admissions:read',
      'beds:read',
    ]));
  });

  it('grants inventory workflow permissions to operational roles without over-granting approvals', () => {
    expect(getPermissionsForRole('pharmacist')).toEqual(expect.arrayContaining([
      'inventory:read',
      'inventory:consume',
      'inventory:transfer',
    ]));
    expect(getPermissionsForRole('pharmacist')).not.toContain('inventory:approve');

    expect(getPermissionsForRole('laboratory')).toEqual(expect.arrayContaining([
      'inventory:read',
      'inventory:consume',
    ]));
    expect(getPermissionsForRole('laboratory')).not.toContain('inventory:approve');

    expect(getPermissionsForRole('nurse')).toEqual(expect.arrayContaining([
      'inventory:read',
      'inventory:consume',
    ]));
    expect(getPermissionsForRole('nurse')).not.toContain('inventory:approve');

    expect(getPermissionsForRole('accountant')).toEqual(expect.arrayContaining([
      'inventory:read',
      'inventory:reports',
      'inventory:audit',
    ]));
    expect(getPermissionsForRole('accountant')).not.toContain('inventory:adjust');
  });
});
