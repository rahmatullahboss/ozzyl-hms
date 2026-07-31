import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/inventory/dashboard.ts', 'utf8');

describe('inventory dashboard D1 batching', () => {
  it('loads inventory dashboard metrics and alert lists through one D1 batch call', () => {
    expect(source).toContain('batchResults = await db.$client.batch([');
    expect(source).toContain('const totalStockValue = Number(batchResults[0]?.results?.[0]?.value ?? 0);');
    expect(source).toContain('const unusualAdjustments = Number(batchResults[11]?.results?.[0]?.count ?? 0);');
    expect(source).toContain('const recentMovements = batchResults[12]?.results || [];');
    expect(source).toContain('const lowStockAlerts = batchResults[13]?.results || [];');
    expect(source).toContain('const expiryAlerts = batchResults[14]?.results || [];');
  });

  it('does not use per-query helper functions that fan out dashboard reads', () => {
    expect(source).not.toContain('async function firstNumber');
    expect(source).not.toContain('async function allRows');
  });
});
