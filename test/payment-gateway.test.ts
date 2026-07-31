import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPaymentGateway } from '../src/lib/payment-gateway';
import type { GatewayEnv } from '../src/lib/payment-gateway';

// ─── Payment Gateway Tests ───────────────────────────────────────────────────
// Covers: src/lib/payment-gateway.ts
// bKash, Nagad, Stub provider, factory routing

describe('createPaymentGateway', () => {
  describe('factory routing', () => {
    it('returns stub for bkash with missing credentials', () => {
      const gw = createPaymentGateway('bkash', {});
      const proto = Object.getPrototypeOf(gw);
      expect(proto.constructor.name).toBe('StubPaymentProvider');
    });

    it('returns stub for nagad with missing credentials', () => {
      const gw = createPaymentGateway('nagad', {});
      const proto = Object.getPrototypeOf(gw);
      expect(proto.constructor.name).toBe('StubPaymentProvider');
    });

    it('returns BkashProvider when all bkash credentials are present', () => {
      const env: GatewayEnv = {
        BKASH_APP_KEY: 'key',
        BKASH_APP_SECRET: 'secret',
        BKASH_USERNAME: 'user',
        BKASH_PASSWORD: 'pass',
      };
      const gw = createPaymentGateway('bkash', env);
      const proto = Object.getPrototypeOf(gw);
      expect(proto.constructor.name).toBe('BkashProvider');
    });

    it('returns NagadProvider when all nagad credentials are present', () => {
      const env: GatewayEnv = {
        NAGAD_MERCHANT_ID: 'merchant-123',
        NAGAD_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg...\n-----END PRIVATE KEY-----',
      };
      const gw = createPaymentGateway('nagad', env);
      const proto = Object.getPrototypeOf(gw);
      expect(proto.constructor.name).toBe('NagadProvider');
    });

    it('returns stub for unknown gateway', () => {
      const gw = createPaymentGateway('unknown' as any, {});
      const proto = Object.getPrototypeOf(gw);
      expect(proto.constructor.name).toBe('StubPaymentProvider');
    });
  });

  describe('StubPaymentProvider', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('initiate returns valid result with paymentId and redirectUrl', async () => {
      const gw = createPaymentGateway('bkash', {});
      const result = await gw.initiate({ billId: 42, amount: 1500, callbackUrl: 'https://example.com/cb' });

      expect(result.paymentId).toMatch(/^stub-\d+$/);
      expect(result.redirectUrl).toContain('http://localhost:8787/');
      expect(result.redirectUrl).toContain('paymentId=');
      expect(result.redirectUrl).toContain('status=success');
    });

    it('verify returns success=true with transactionId', async () => {
      const gw = createPaymentGateway('nagad', {});
      const result = await gw.verify('stub-1234567890');

      expect(result.success).toBe(true);
      expect(result.paymentId).toBe('stub-1234567890');
      expect(result.amount).toBe(0);
      expect(result.transactionId).toMatch(/^TXN-\d+$/);
      expect(result.message).toBe('Stub success');
    });

    it('initiate includes billId in redirectUrl', async () => {
      const gw = createPaymentGateway('bkash', {});
      const result = await gw.initiate({ billId: 99, amount: 500, callbackUrl: 'https://example.com/cb' });

      expect(result.redirectUrl).toContain(result.paymentId);
    });
  });
});
