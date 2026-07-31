import { describe, it, expect } from 'vitest';
import { getVisibleGroups, isGroupVisible } from './adminRoleAccess';

describe('adminRoleAccess', () => {
  it('hospital_admin sees all starter and advanced groups', () => {
    const groups = getVisibleGroups('hospital_admin');
    expect(groups).toHaveLength(10);
    expect(groups).toContain('groupStarterControl');
    expect(groups).toContain('groupReagentStock');
    expect(groups).toContain('groupAdvancedLabLis');
    expect(groups).toContain('groupSettings');
  });

  it('branch_manager sees starter operations without audit/settings', () => {
    const groups = getVisibleGroups('branch_manager');
    expect(groups).toHaveLength(7);
    expect(groups).toContain('groupStarterControl');
    expect(groups).toContain('groupReagentStock');
    expect(groups).toContain('groupPatientServices');
    expect(groups).toContain('groupActionCenter');
    expect(groups).toContain('groupAdvancedOperations');
    expect(groups).toContain('groupPeopleAccess');
    expect(groups).not.toContain('groupAuditSecurity');
    expect(groups).not.toContain('groupSettings');
  });

  it('accounts_manager sees starter cash + reports only', () => {
    const groups = getVisibleGroups('accounts_manager');
    expect(groups).toHaveLength(2);
    expect(groups).toContain('groupStarterControl');
    expect(groups).toContain('groupReportsAnalytics');
  });

  it('auditor sees audit + reports only', () => {
    const groups = getVisibleGroups('auditor');
    expect(groups).toHaveLength(2);
    expect(groups).toContain('groupAuditSecurity');
    expect(groups).toContain('groupReportsAnalytics');
  });

  it('owner_view sees cash, reagent stock, and reports', () => {
    const groups = getVisibleGroups('owner_view');
    expect(groups).toEqual(['groupStarterControl', 'groupReagentStock', 'groupReportsAnalytics']);
  });

  it('super_admin sees platform portal groups', () => {
    const groups = getVisibleGroups('super_admin');
    expect(groups).toEqual(['groupPlatform', 'groupHospitals', 'groupSystem']);
    expect(isGroupVisible('super_admin', 'groupPlatform')).toBe(true);
    expect(isGroupVisible('super_admin', 'groupHospitals')).toBe(true);
    expect(isGroupVisible('super_admin', 'groupSystem')).toBe(true);
  });

  it('unknown role sees all groups', () => {
    const groups = getVisibleGroups('unknown_role');
    expect(groups).toHaveLength(10);
  });

  it('isGroupVisible returns true for dashboard (no groupKey)', () => {
    expect(isGroupVisible('auditor', undefined)).toBe(true);
  });

  it('isGroupVisible returns true for allowed group', () => {
    expect(isGroupVisible('auditor', 'groupAuditSecurity')).toBe(true);
  });

  it('isGroupVisible returns false for disallowed group', () => {
    expect(isGroupVisible('auditor', 'groupSettings')).toBe(false);
  });

  it('isGroupVisible handles role normalization', () => {
    expect(isGroupVisible('Accounts Manager', 'groupStarterControl')).toBe(true);
    expect(isGroupVisible('Accounts Manager', 'groupSettings')).toBe(false);
  });
});
