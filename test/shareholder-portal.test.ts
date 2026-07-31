import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from '../src/lib/csv-export';
import shareholderPortalRoutes, {
  inclusiveMonthCount,
  isStrictDate,
  normalizePercentage,
} from '../src/routes/tenant/shareholderPortal';
import shareholderRoutes from '../src/routes/tenant/shareholders';
import { createInvitationSchema } from '../src/schemas/invitation';
import { isPrivilegedStaffInviteRole } from '../src/lib/staff-invite-policy';

describe('shareholder portal security helpers', () => {
  it('validates calendar dates strictly', () => {
    expect(isStrictDate('2026-07-16')).toBe(true);
    expect(isStrictDate('2026-02-29')).toBe(false);
    expect(isStrictDate('2024-02-29')).toBe(true);
    expect(isStrictDate('2026-13-01')).toBe(false);
    expect(isStrictDate('not-a-date')).toBe(false);
  });

  it('counts inclusive calendar months for the 36-month range limit', () => {
    expect(inclusiveMonthCount('2026-01-01', '2026-01-31')).toBe(1);
    expect(inclusiveMonthCount('2024-01-01', '2026-12-31')).toBe(36);
    expect(inclusiveMonthCount('2024-01-01', '2027-01-01')).toBe(37);
  });

  it('falls back for malformed or out-of-range percentage settings', () => {
    expect(normalizePercentage('30', 0)).toBe(30);
    expect(normalizePercentage('not-a-number', 30)).toBe(30);
    expect(normalizePercentage(-1, 30)).toBe(30);
    expect(normalizePercentage(101, 30)).toBe(30);
  });

  it('allows only role managers to invite shareholder viewers', () => {
    expect(createInvitationSchema.safeParse({
      email: 'viewer@example.com',
      role: 'shareholder_viewer',
    }).success).toBe(true);
    expect(isPrivilegedStaffInviteRole('shareholder_viewer')).toBe(true);
  });

  it('quotes fields and escapes embedded double quotes', () => {
    expect(csvCell('A "quoted" value')).toBe('"A ""quoted"" value"');
  });

  it('neutralizes spreadsheet formula prefixes, including full-width variants', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe('"\'=SUM(A1:A2)"');
    expect(csvCell('+123')).toBe('"\'+123"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('＝1+1')).toBe('"\'＝1+1"');
    expect(csvCell('\tformula')).toBe('"\'\tformula"');
  });

  it('creates UTF-8 BOM CSV with CRLF rows', () => {
    const csv = buildCsv([
      ['Header', 'Value'],
      ['Income', 100],
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Header","Value"\r\n"Income","100"\r\n');
  });

  it('fails closed when the portal request has no authenticated role', async () => {
    const env = { DB: {} } as never;
    const summary = await shareholderPortalRoutes.request(
      'http://localhost/summary?from=2026-01-01&to=2026-07-16',
      undefined,
      env,
    );
    const exported = await shareholderPortalRoutes.request(
      'http://localhost/export.csv?from=2026-01-01&to=2026-07-16',
      undefined,
      env,
    );

    expect(summary.status).toBe(403);
    expect(exported.status).toBe(403);
  });

  it('blocks aggregate viewers from legacy shareholder self-service PII routes', async () => {
    const app = new Hono<any>();
    app.use('*', async (c, next) => {
      c.set('role', 'shareholder_viewer');
      c.set('tenantId', '1');
      c.set('userId', '1');
      await next();
    });
    app.route('/api/shareholders', shareholderRoutes);

    const env = { DB: {} } as never;
    const profile = await app.request('http://localhost/api/shareholders/my-profile', undefined, env);
    const dividends = await app.request('http://localhost/api/shareholders/my-dividends', undefined, env);

    expect(profile.status).toBe(403);
    expect(dividends.status).toBe(403);
  });
});
