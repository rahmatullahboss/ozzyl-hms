import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  'src/lib/prescription-lab-orders.ts',
  'src/routes/tenant/orderSets.ts',
  'src/routes/tenant/lab.ts',
  'src/routes/tenant/reception.ts',
  'src/routes/tenant/prescriptions.ts',
] as const;

describe('lab order clinical attribution write paths', () => {
  for (const path of sources) {
    it(`${path} writes explicit ordering clinician attribution`, () => {
      const source = readFileSync(path, 'utf8');
      const inserts = [...source.matchAll(/INSERT\s+INTO\s+lab_orders\s*\(([^)]+)\)/gi)];

      expect(inserts.length).toBeGreaterThan(0);
      for (const insert of inserts) {
        expect(insert[1]).toMatch(/ordering_clinician_doctor_id/i);
      }
    });
  }
});
