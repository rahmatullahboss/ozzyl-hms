import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function reorderSource(): string {
  return readFileSync('src/routes/tenant/inventory/reorder.ts', 'utf8');
}

describe('inventory reorder intelligence-backed PR generation', () => {
  it('has a reusable intelligence suggestion loader for auto PR generation', () => {
    const text = reorderSource();

    expect(text).toContain('async function intelligenceReorderSuggestions');
    expect(text).toContain('inventory_stock_intelligence_snapshot');
    expect(text).toContain('S.suggested_order_qty AS suggested_quantity');
    expect(text).toContain("'intelligence_snapshot' AS source");
  });

  it('generate-pr prefers intelligence suggestions and falls back to legacy only when needed', () => {
    const text = reorderSource();
    const generatePrBlock = text.slice(text.indexOf('reorder.post("/generate-pr"'));

    expect(generatePrBlock).toContain('loadReorderSuggestionsForAutomation');
    expect(generatePrBlock).toContain('source');
    expect(generatePrBlock).not.toContain('HAVING current_stock <= I.ReOrderLevel');
    expect(generatePrBlock).not.toContain('COALESCE(SUM(S.AvailableQuantity), 0) AS current_stock');
  });

  it('uses a D1-compatible purchase request number query', () => {
    const text = reorderSource();

    expect(text).not.toContain("INSTR(PRNumber, '-', 1, 2)");
    expect(text).toContain('PRNumber LIKE ?');
    expect(text).toContain('SUBSTR(PRNumber, 9)');
  });

});
