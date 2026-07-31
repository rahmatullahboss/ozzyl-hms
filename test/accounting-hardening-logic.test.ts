import { describe, it, expect } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { isPeriodClosed, calculateVoucherHash, verifyVoucherChain } from '../src/lib/accounting-hardening';
import { ACCOUNTING_EVENT_TYPES, postAccountingEventBySourceKey } from '../src/lib/accounting-posting';

describe('Accounting Hardening & Posting Logic', () => {
  const tenantId = 'test-tenant';

  describe('Period Locking', () => {
    it('should return true if a period is closed', async () => {
      const { db } = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('accounting_period_closes')) {
            return { first: { id: 1, status: 'closed' } };
          }
          return { first: null };
        }
      });
      const locked = await isPeriodClosed(db, tenantId, '2026-05-01');
      expect(locked).toBe(true);
    });

    it('should return true if a period is audited', async () => {
      const { db } = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('accounting_period_closes')) {
            return { first: { id: 1, status: 'audited' } };
          }
          return { first: null };
        }
      });
      const locked = await isPeriodClosed(db, tenantId, '2026-05-01');
      expect(locked).toBe(true);
    });

    it('should return false if a period is open', async () => {
      const { db } = createMockDB({
        queryOverride: () => ({ first: null })
      });
      const locked = await isPeriodClosed(db, tenantId, '2026-05-01');
      expect(locked).toBe(false);
    });

    it('only applies closed period rows from the active fiscal year when years overlap', async () => {
      const { db } = createMockDB({
        queryOverride: (sql, params) => {
          if (sql.includes('FROM fiscal_years')) {
            return { first: { id: 10 } };
          }
          if (sql.includes('FROM accounting_period_closes')) {
            expect(params).toEqual([tenantId, 10, '2026-05']);
            return { first: null };
          }
          return { first: null };
        }
      });

      const locked = await isPeriodClosed(db, tenantId, '2026-05-10');
      expect(locked).toBe(false);
    });
  });

  describe('Cryptographic Hashing', () => {
    it('should generate consistent hashes for voucher data', async () => {
      const data = {
        id: 1,
        tenant_id: tenantId,
        voucher_number: 'JV-2026-001',
        entry_date: '2026-05-08',
        lines: [
          { account_id: 1, debit: 1000, credit: 0 },
          { account_id: 2, debit: 0, credit: 1000 }
        ]
      };
      const hash1 = await calculateVoucherHash(data, 'GENESIS');
      const hash2 = await calculateVoucherHash(data, 'GENESIS');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it('should fail verification if a hash is tampered', async () => {
      const { db } = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('SELECT id, voucher_number')) {
            return { results: [
              { id: 1, voucher_number: 'V1', entry_date: '2026-01-01', verification_hash: 'hash1', previous_hash: 'GENESIS' }
            ]};
          }
          if (sql.includes('SELECT account_id')) {
            return { results: [{ account_id: 1, debit: 100, credit: 0 }] };
          }
          return { results: [] };
        }
      });

      const result = await verifyVoucherChain(db, tenantId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Hash mismatch');
    });
  });

  describe('Module Posting Integration', () => {
    it('should reject posting if the period is locked', async () => {
      const { db } = createMockDB({
        queryOverride: (sql, params) => {
          if (sql.includes('FROM accounting_posting_events')) {
            return {
              first: {
                id: 1,
                tenant_id: tenantId,
                source_event_key: String(params[1]),
                source_type: 'billing',
                source_id: '1',
                event_type: ACCOUNTING_EVENT_TYPES.billCreated,
                event_date: '2026-05-01',
                payload_json: JSON.stringify({ total: 100, discount: 0, testBill: 100 }),
                status: 'pending',
                attempts: 0,
                created_by: '1',
              },
            };
          }
          if (sql.includes('FROM accounting_vouchers')) return { first: null };
          if (sql.includes('accounting_period_closes')) return { first: { id: 1 } };
          return { first: null };
        }
      });

      const result = await postAccountingEventBySourceKey(db, tenantId, 'billing:1:bill_created');

      expect(result).toEqual({ posted: false, skippedReason: 'period_closed' });
    });
  });
});
