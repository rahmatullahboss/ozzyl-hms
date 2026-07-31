import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/payments.ts', 'utf8');
const start = source.indexOf("paymentRoutes.post('/verify'");
const end = source.indexOf('// ─── GET /api/payments/logs', start);
const route = source.slice(start, end > start ? end : undefined);

describe('payment gateway canonical settlement source contract', () => {
  it('integrates the gateway boundary through the strict financial coordinator', () => {
    expect(route).toContain('prepareGatewayPaymentLegacyStatements');
    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain("boundary: 'payment-gateway.verify'");
    expect(route).toContain('legacyStatements,');
    expect(route).toContain('return settleGatewayPayment(c.env.DB');
    expect(route).not.toContain("assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'payment-gateway.verify')");
    expect(route).not.toContain('await db.$client.batch(statements)');
  });

  it('prepares invoice mapping and canonical projections only inside the callback', () => {
    const callback = route.indexOf('canonical: async (execution) => {');
    const mapping = route.indexOf('canonical_source_mappings', callback);
    const paymentProjection = route.indexOf('buildLivePaymentProjection', callback);
    const depositProjection = route.indexOf('buildLiveDepositProjection', callback);
    const command = route.indexOf('return settleGatewayPayment(c.env.DB', callback);

    expect(callback).toBeGreaterThan(-1);
    expect(mapping).toBeGreaterThan(callback);
    expect(paymentProjection).toBeGreaterThan(callback);
    expect(depositProjection).toBeGreaterThan(callback);
    expect(command).toBeGreaterThan(callback);
    expect(route.indexOf('buildLivePaymentProjection')).toBe(paymentProjection);
    expect(route.indexOf('buildLiveDepositProjection')).toBe(depositProjection);
    expect(route).toContain('authoritativeStatements: execution.authoritativeStatements');
  });

  it('keeps external verification and retry unlock outside the financial batch', () => {
    const verifyCall = route.indexOf('verifyResult = await gw.verify(paymentId)');
    const coordinator = route.indexOf('executeStrictFinancialMutation');
    const unlock = route.indexOf("WHERE id = ? AND status = 'verifying'");

    expect(verifyCall).toBeGreaterThan(-1);
    expect(coordinator).toBeGreaterThan(verifyCall);
    expect(unlock).toBeGreaterThan(coordinator);
    expect(route).toContain('Payment was verified but could not be posted. Please retry verification.');
  });
});
