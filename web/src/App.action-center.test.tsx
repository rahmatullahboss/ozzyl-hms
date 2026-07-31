import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTenantRedirectTarget } from './lib/tenantRedirect';

const appSource = () => readFileSync(resolve(__dirname, './App.tsx'), 'utf8');

describe('Action Center routing', () => {
  it('preserves supported query intent for legacy queue redirects', () => {
    expect(buildTenantRedirectTarget(
      'city-care',
      'action/approvals',
      '?tab=Expense&status=pending',
      true,
    )).toBe('/h/city-care/action/approvals?tab=Expense&status=pending');

    expect(buildTenantRedirectTarget(
      'city-care',
      'action/exceptions',
      '?tab=Warning',
      true,
    )).toBe('/h/city-care/action/exceptions?tab=Warning');

    expect(buildTenantRedirectTarget(
      'city-care',
      'action/collections?followup=due',
      '?search=INV-101&followup=upcoming',
      true,
    )).toBe('/h/city-care/action/collections?followup=upcoming&search=INV-101');
  });

  it('does not append search parameters when a redirect opts out', () => {
    expect(buildTenantRedirectTarget('city-care', 'action', '?legacy=true', false))
      .toBe('/h/city-care/action');
  });

  it('registers canonical Action Center and Patient Experience routes', () => {
    const source = appSource();

    expect(source).toContain('const ActionCenterOverview = lazy');
    expect(source).toContain('<Route path="action" element={<ActionCenterOverview />} />');
    expect(source).toContain('function ActionCenterApprovalsRoute()');
    expect(source).toContain('<DashboardLayout role="hospital_admin"><PendingApprovals embedded /></DashboardLayout>');
    expect(source).toContain('<Route path="action/approvals" element={<ActionCenterApprovalsRoute />} />');
    expect(source).toContain('<Route path="action/exceptions" element={<AlertsExceptions />} />');
    expect(source).toContain('<Route path="action/collections" element={<DueReceivables />} />');
    expect(source).toContain('<Route path="action/tasks" element={<TasksFollowups />} />');
    expect(source).toContain('<Route path="patient-experience/reviews" element={<ReviewModerationPage role="hospital_admin" />} />');
  });

  it('keeps old bookmarks as replace redirects without duplicate visible pages', () => {
    const source = appSource();

    expect(source).toContain('<Route path="approvals" element={<TenantRedirect path="action" />} />');
    expect(source).toContain('<Route path="action/pending-approvals" element={<TenantRedirect path="action/approvals" preserveSearch />} />');
    expect(source).toContain('<Route path="alerts" element={<TenantRedirect path="action/exceptions" preserveSearch />} />');
    expect(source).toContain('<Route path="tasks" element={<TenantRedirect path="action/tasks" preserveSearch />} />');
    expect(source).toContain('<Route path="cash/dues" element={<TenantRedirect path="action/collections" preserveSearch />} />');
    expect(source).toContain('<Route path="cash/followups" element={<TenantRedirect path="action/collections?followup=due" preserveSearch />} />');
    expect(source).toContain('<Route path="review-moderation" element={<TenantRedirect path="patient-experience/reviews" preserveSearch />} />');
  });
});
