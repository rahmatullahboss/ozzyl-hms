import { describe, expect, it } from 'vitest';
import {
  ADMIN_COMMAND_CENTER_FLAG_KEY,
  ADMIN_COMMAND_CENTER_PREVIEW_HOST,
  ADMIN_COMMAND_CENTER_PREVIEW_MODE,
  isAdminCommandCenterEnabled,
  isAdminCommandCenterPreviewHostname,
  isAdminCommandCenterPreviewMode,
  type AdminCommandCenterFlagDatabase,
} from '../../src/lib/dashboard/admin-command-center-flag';

function database(result: Record<string, unknown> | null, error?: Error): {
  db: AdminCommandCenterFlagDatabase;
  calls: Array<{ sql: string; values: unknown[] }>;
} {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async first() {
                if (error) throw error;
                return result;
              },
            };
          },
        };
      },
    },
  };
}

describe('admin command center feature flag', () => {
  it('uses stable flag and preview keys', () => {
    expect(ADMIN_COMMAND_CENTER_FLAG_KEY).toBe('admin_command_center_v2');
    expect(ADMIN_COMMAND_CENTER_PREVIEW_HOST).toBe('command-center.ozzyl.com');
    expect(ADMIN_COMMAND_CENTER_PREVIEW_MODE).toBe('dashboard-v2');
  });

  it('accepts only the exact dashboard-v2 preview mode', () => {
    expect(isAdminCommandCenterPreviewMode('dashboard-v2')).toBe(true);
    expect(isAdminCommandCenterPreviewMode('Dashboard-v2')).toBe(false);
    expect(isAdminCommandCenterPreviewMode(' dashboard-v2 ')).toBe(false);
    expect(isAdminCommandCenterPreviewMode('dashboard-v2-extra')).toBe(false);
    expect(isAdminCommandCenterPreviewMode(undefined)).toBe(false);
  });

  it('matches only the exact comparison preview hostname', () => {
    expect(isAdminCommandCenterPreviewHostname('command-center.ozzyl.com')).toBe(true);
    expect(isAdminCommandCenterPreviewHostname('COMMAND-CENTER.OZZYL.COM')).toBe(true);
    expect(isAdminCommandCenterPreviewHostname('command-center.ozzyl.com.')).toBe(true);
    expect(isAdminCommandCenterPreviewHostname(' command-center.ozzyl.com ')).toBe(true);
    expect(isAdminCommandCenterPreviewHostname('command-center.ozzyl.com.evil.example')).toBe(false);
    expect(isAdminCommandCenterPreviewHostname('tenant.ozzyl.com')).toBe(false);
  });

  it('returns disabled when canonical feature flags table is absent', async () => {
    const { db } = database(null, new Error('no such table: canonical_feature_flags'));
    await expect(isAdminCommandCenterEnabled(db, 'tenant-1')).resolves.toBe(false);
  });

  it('returns disabled when the tenant has no matching row', async () => {
    const { db } = database(null);
    await expect(isAdminCommandCenterEnabled(db, 'tenant-1')).resolves.toBe(false);
  });

  it('requires enabled state and a non-disabled mode', async () => {
    await expect(isAdminCommandCenterEnabled(database({ mode: 'disabled', is_enabled: 1 }).db, 'tenant-1')).resolves.toBe(false);
    await expect(isAdminCommandCenterEnabled(database({ mode: 'shadow', is_enabled: 0 }).db, 'tenant-1')).resolves.toBe(false);
    await expect(isAdminCommandCenterEnabled(database({ mode: 'shadow', is_enabled: 1 }).db, 'tenant-1')).resolves.toBe(true);
    await expect(isAdminCommandCenterEnabled(database({ mode: 'canonical', is_enabled: '1' }).db, 'tenant-1')).resolves.toBe(true);
  });

  it('binds the exact tenant and flag key', async () => {
    const { db, calls } = database({ mode: 'shadow', is_enabled: 1 });
    await isAdminCommandCenterEnabled(db, 'tenant-22');
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual(['tenant-22', ADMIN_COMMAND_CENTER_FLAG_KEY]);
  });

  it('rejects a non-exact tenant id', async () => {
    const { db } = database({ mode: 'shadow', is_enabled: 1 });
    await expect(isAdminCommandCenterEnabled(db, ' tenant-1 ')).rejects.toThrow('tenantId must be a non-empty exact value');
  });

  it('rethrows unexpected database failures', async () => {
    const { db } = database(null, new Error('database unavailable'));
    await expect(isAdminCommandCenterEnabled(db, 'tenant-1')).rejects.toThrow('database unavailable');
  });
});
