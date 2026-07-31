import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('prescription print medicine instructions', () => {
  it('normalizes medicine fields and prescribed quantity for the print response', () => {
    const source = readFileSync('src/routes/tenant/prescriptions.ts', 'utf8');
    const printHandler = source
      .split("app.get('/:id/print'")[1]
      ?.split('// ─── POST /api/prescriptions')[0] ?? '';

    expect(printHandler).toContain('const normalizedItems = items.map');
    expect(printHandler).toContain('medicine_name: item.medicineName');
    expect(printHandler).toContain('items: normalizedItems');
    expect(source).toContain('quantity: item.quantity ?? 0');
  });
});
