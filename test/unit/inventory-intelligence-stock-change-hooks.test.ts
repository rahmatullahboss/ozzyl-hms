import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('inventory intelligence stock-change hooks', () => {
  it('schedules intelligence recompute after goods receipt changes stock', () => {
    const text = source('src/routes/tenant/inventory/gr.ts');

    expect(text).toContain('scheduleInventoryIntelligenceRecompute');
    expect(text).toContain("from '../../../lib/inventory-intelligence/triggers'");
    expect(text).toContain('dbClient: c.env.DB');
    expect(text).toContain('waitUntil');
    expect(text.indexOf('mirrorInventoryLabReagentReceipt')).toBeGreaterThan(-1);
    expect(text.lastIndexOf('scheduleInventoryIntelligenceRecompute')).toBeGreaterThan(text.indexOf('mirrorInventoryLabReagentReceipt'));
  });

  it('schedules intelligence recompute after inventory issue changes stock', () => {
    const text = source('src/lib/inventory-issue-service.ts');

    expect(text).toContain('scheduleInventoryIntelligenceRecompute');
    expect(text).toContain("from './inventory-intelligence/triggers'");
    expect(text).toContain('dbClient: db.$client');
    expect(text.indexOf('postPendingAccountingEvents')).toBeGreaterThan(-1);
    expect(text.lastIndexOf('scheduleInventoryIntelligenceRecompute')).toBeGreaterThan(text.indexOf('postPendingAccountingEvents'));
  });
});
