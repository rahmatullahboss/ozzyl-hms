import { describe, it, expect } from 'vitest';
import { adminNavGroups } from './adminSidebarConfig';

describe('adminSidebarConfig', () => {
  it('exports the canonical Action Center and Patient Experience groups immediately after dashboard', () => {
    expect(adminNavGroups).toHaveLength(12);
    expect(adminNavGroups.map(g => g.groupKey ?? 'dashboard').slice(0, 6)).toEqual([
      'dashboard',
      'groupActionCenter',
      'groupPatientExperience',
      'groupStarterControl',
      'groupReagentStock',
      'groupPatientServices',
    ]);
  });

  it('first group contains dashboard item', () => {
    const firstGroup = adminNavGroups[0];
    expect(firstGroup.items).toHaveLength(1);
    expect(firstGroup.items[0].labelKey).toBe('dashboard');
    expect(firstGroup.items[0].path).toBe('dashboard');
  });

  it('Starter Control Center exposes the sales demo cash workflow first', () => {
    const starter = adminNavGroups.find(g => g.groupKey === 'groupStarterControl');
    expect(starter).toBeDefined();
    const labels = starter!.items.map(i => i.labelKey);
    const paths = starter!.items.map(i => i.path);
    expect(labels[0]).toBe('billingCounter');
    expect(labels).toEqual(expect.arrayContaining([
      'cashControl',
      'shiftHandover',
      'discountReview',
      'expenses',
      'doctorCommissions',
      'accountingFinance',
    ]));
    expect(paths).toEqual(expect.arrayContaining([
      'billing-counter',
      'cash/drawers',
      'cash/handover',
      'cash/discounts',
      'cash/expenses',
    ]));
    expect(labels).not.toContain('dueCollection');
    expect(labels).not.toContain('collectionFollowups');
    expect(paths).not.toContain('cash/dues');
    expect(paths).not.toContain('cash/followups');
  });

  it('Reagent & Stock group brings reagent control before inventory details', () => {
    const reagentStock = adminNavGroups.find(g => g.groupKey === 'groupReagentStock');
    expect(reagentStock).toBeDefined();
    const labels = reagentStock!.items.map(i => i.labelKey);
    expect(labels).toEqual(expect.arrayContaining([
      'inventoryDashboard',
      'reagentControl',
      'inventoryMain',
      'inventoryProcurement',
      'inventoryOperations',
      'inventoryReports',
    ]));
    const reagent = reagentStock!.items.find(i => i.labelKey === 'reagentControl');
    expect(reagent?.path).toBe('reagent-control');
    expect(reagent?.requiredPermission).toBe('lab_machines:read');
  });

  it('Patient & Services keeps setup essentials without HR noise', () => {
    const patientServices = adminNavGroups.find(g => g.groupKey === 'groupPatientServices');
    expect(patientServices).toBeDefined();
    const labels = patientServices!.items.map(i => i.labelKey);
    expect(labels).toEqual(expect.arrayContaining([
      'patients',
      'doctors',
      'servicesPricing',
      'branchesDepartments',
      'appointments',
      'medicalRecords',
    ]));
    expect(labels).not.toContain('staff');
    expect(labels).not.toContain('hrDashboard');
    expect(labels).not.toContain('payrollGeneration');
  });

  it('exposes one canonical Action Center navigation in workflow order', () => {
    const actionCenter = adminNavGroups.find(g => g.groupKey === 'groupActionCenter');
    expect(actionCenter).toBeDefined();
    expect(actionCenter!.items.map(item => item.labelKey)).toEqual([
      'actionCenterOverview',
      'approvals',
      'exceptions',
      'collections',
      'tasks',
    ]);
    expect(actionCenter!.items.map(item => item.path)).toEqual([
      'action',
      'action/approvals',
      'action/exceptions',
      'action/collections',
      'action/tasks',
    ]);
  });

  it('moves review moderation into a separate Patient Experience group', () => {
    const patientExperience = adminNavGroups.find(g => g.groupKey === 'groupPatientExperience');
    expect(patientExperience).toBeDefined();
    expect(patientExperience!.items.map(item => item.labelKey)).toEqual([
      'reviewModeration',
      'marketplaceBookings',
    ]);
    expect(patientExperience!.items.map(item => item.path)).toEqual([
      'patient-experience/reviews',
      'marketplace-bookings',
    ]);
  });

  it('Advanced Operations group keeps operational monitors available lower in the menu', () => {
    const advancedOps = adminNavGroups.find(g => g.groupKey === 'groupAdvancedOperations');
    expect(advancedOps).toBeDefined();
    expect(advancedOps!.items.length).toBeGreaterThanOrEqual(6);
    const paths = advancedOps!.items.map(item => item.path);
    expect(paths).toEqual(expect.arrayContaining([
      'monitor/opd',
      'monitor/lab',
      'monitor/pharmacy',
      'beds',
      'ot',
      'emergency',
    ]));
    for (const path of ['monitor/operations', 'monitor/opd', 'monitor/lab', 'monitor/pharmacy', 'monitor/emergency', 'emergency', 'beds', 'ot']) {
      expect(advancedOps!.items.find(item => item.path === path)?.requiredPermission).toBeDefined();
    }
  });

  it('Reports group exposes reporting, PDF, branch, and collection analysis tools', () => {
    const reports = adminNavGroups.find(g => g.groupKey === 'groupReportsAnalytics');
    expect(reports).toBeDefined();
    expect(reports!.items.map(i => i.path)).toEqual(expect.arrayContaining([
      'reports',
      'reports/pdf',
      'analytics/branches',
      'cash/collections',
    ]));
  });

  it('People & Access does not expose the unimplemented login sessions page', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    expect(people).toBeDefined();
    expect(people!.items.map(i => i.path)).not.toContain('sessions');
  });

  it('People & Access keeps staff/permission/HR concepts lower in the menu', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    expect(people).toBeDefined();
    const labelKeys = people!.items.map(i => i.labelKey);

    expect(labelKeys).toEqual(expect.arrayContaining([
      'staff',
      'accessControl',
      'hrDashboard',
      'leave',
      'attendancePunch',
      'dutyRoster',
      'payrollGeneration',
    ]));
    expect(labelKeys).not.toContain('patients');
    expect(labelKeys).not.toContain('doctors');
    expect(labelKeys).not.toContain('users');
    expect(labelKeys).not.toContain('employees');
  });

  it('People & Access shows Access Control only for roles:manage permission', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    const accessControl = people!.items.find(i => i.path === 'permissions');

    expect(accessControl?.labelKey).toBe('accessControl');
    expect(accessControl?.requiredPermission).toBe('roles:manage');
  });

  it('People & Access staff item points at the staff route', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    const staff = people!.items.find(i => i.labelKey === 'staff');
    expect(staff?.path).toBe('staff');
  });

  it('People & Access HR Dashboard item points at the hr route with hr:read permission', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    const hr = people!.items.find(i => i.labelKey === 'hrDashboard');
    expect(hr?.path).toBe('hr');
    expect(hr?.requiredPermission).toBe('hr:read');
  });

  it('People & Access leave item points at the standalone Leave page', () => {
    const people = adminNavGroups.find(g => g.groupKey === 'groupPeopleAccess');
    const leave = people!.items.find(i => i.labelKey === 'leave');
    expect(leave?.path).toBe('hr/leave');
    expect(leave?.requiredPermission).toBe('hr:read');
  });

  it('Advanced Lab / LIS keeps technical lab pages available but not primary', () => {
    const advancedLab = adminNavGroups.find(g => g.groupKey === 'groupAdvancedLabLis');
    expect(advancedLab).toBeDefined();
    expect(advancedLab!.items.map(i => i.path)).toEqual(expect.arrayContaining([
      'lab-settings',
      'lab-machines',
      'reports/lab',
      'lab/qc',
    ]));
  });

  it('Audit & Security routes to existing audit screens only', () => {
    const audit = adminNavGroups.find(g => g.groupKey === 'groupAuditSecurity');
    expect(audit).toBeDefined();
    expect(audit!.items.map(i => i.path)).toEqual(expect.arrayContaining([
      'system-audit',
      'activity-log',
      'audit/financial',
      'audit/safety-overrides',
      'audit/offline-sync',
      'sessions',
    ]));
  });

  it('Settings exposes the implemented policy and notification pages', () => {
    const settings = adminNavGroups.find(g => g.groupKey === 'groupSettings');
    expect(settings).toBeDefined();
    expect(settings!.items.map(i => i.path)).toEqual(expect.arrayContaining([
      'settings/approval-policies',
      'settings/notifications',
      'settings/security',
      'settings/payments',
    ]));
  });

  it('keeps Patient Analytics on the historical compatibility route', () => {
    const reports = adminNavGroups.find(g => g.groupKey === 'groupReportsAnalytics');
    const patientAnalytics = reports?.items.find(item => item.labelKey === 'analyticsPatients');
    expect(patientAnalytics).toMatchObject({
      path: 'analytics/patients',
      requiredPermission: 'reports:read',
    });
  });

  it('all items have labelKey and path or children', () => {
    adminNavGroups.forEach(group => {
      group.items.forEach(item => {
        expect(item.labelKey).toBeTruthy();
        expect(item.path || item.children).toBeTruthy();
      });
    });
  });

  it('all items have icon', () => {
    adminNavGroups.forEach(group => {
      group.items.forEach(item => {
        expect(item.icon).toBeTruthy();
      });
    });
  });

  it('keeps the production menu comprehensive with broad route coverage', () => {
    const totalItems = adminNavGroups.reduce((sum, group) => sum + group.items.length, 0);
    const paths = adminNavGroups.flatMap(group => group.items.map(item => item.path).filter(Boolean));
    expect(totalItems).toBeGreaterThanOrEqual(100);
    expect(new Set(paths).size).toBeGreaterThanOrEqual(130);
  });
});
