import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/dashboard.ts', 'utf8');

describe('dashboard KPI D1 batching', () => {
  it('uses a single D1 batch for the cash movement KPI breakdown queries', () => {
    expect(source).toContain('async function getCashMovementKpiBreakdown');
    expect(source).toContain('const batchResults = await db.$client.batch([');
    expect(source).toContain('const billRow = batchResults[0]?.results?.[0]');
    expect(source).toContain('const billSplitResult = { results: batchResults[1]?.results');
    expect(source).toContain('const refundRow = batchResults[3]?.results?.[0]');
    expect(source).toContain('const expenseRow = batchResults[4]?.results?.[0]');
    expect(source).toContain('const payoutRow = batchResults[5]?.results?.[0]');
  });

  it('does not fan out KPI breakdown reads through Promise.all', () => {
    const breakdownBlock = source.slice(
      source.indexOf('async function getCashMovementKpiBreakdown'),
      source.indexOf('const billAmount = roundMoney'),
    );

    expect(breakdownBlock).not.toContain('Promise.all([');
  });
});
