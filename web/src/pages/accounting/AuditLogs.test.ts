import { describe, expect, it } from 'vitest';
import AuditLogs from './AuditLogs';
import SystemAuditLog from '../SystemAuditLog';

describe('AuditLogs', () => {
  it('reuses the canonical system audit page instead of maintaining a second page', () => {
    expect(AuditLogs).toBe(SystemAuditLog);
  });
});
