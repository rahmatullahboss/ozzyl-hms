import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeFiles = [
  'src/routes/tenant/labNotifications.ts',
  'src/routes/tenant/radiology/orders.ts',
  'src/routes/tenant/radiology/reports.ts',
  'src/routes/tenant/billingInsurance.ts',
  'src/routes/tenant/clinicalReminders.ts',
  'src/routes/tenant/consents.ts',
  'src/routes/tenant/ccda.ts',
  'src/routes/tenant/reminders.ts',
];

describe('Diagnostic routes patient field contract', () => {
  it('uses current patients.mobile/date_of_birth columns for diagnostic handoffs', () => {
    for (const file of routeFiles) {
      const source = readFileSync(file, 'utf8');

      expect(source, `${file} must not query removed patients.phone column`).not.toMatch(/\bp\.phone\b/);
      expect(source, `${file} must not query removed patients.dob column`).not.toMatch(/\bp\.dob\b/);
      expect(source, `${file} must not query removed patients.nid column`).not.toMatch(/\bp\.nid\b/);
      expect(source, `${file} must not select removed patient columns directly`).not.toMatch(
        /\bSELECT[^\n]*(?<!AS )\b(?:phone|dob|nid)\b[^\n]*\bFROM patients\b/i,
      );
    }
  });
});
