import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('manager dashboard page wiring', () => {
  it('uses dedicated page and summary api', () => {
    const app = readFileSync('web/src/App.tsx', 'utf8');
    const page = readFileSync('web/src/pages/ManagerDashboard.tsx', 'utf8');
    expect(app).toContain("lazy(() => import('./pages/ManagerDashboard'))");
    expect(app).toContain('path="manager/dashboard"');
    expect(page).toContain('/api/manager/dashboard-summary');
    expect(page).toContain('data-testid="manager-dashboard-page"');
    expect(page).toContain('Today OPD');
    expect(page).toContain('Active counters');
    expect(page).toContain('Pending lab');
    expect(page).toContain('Operations board');
    expect(page).toContain('Alerts and follow-up');
    expect(page).toContain('Quick links');
    expect(page).toContain('Reception dashboard');
    expect(page).toContain('Cash operations');
    expect(page).toContain('Lab orders');
    expect(page).toContain('Patient search');
  });
});
