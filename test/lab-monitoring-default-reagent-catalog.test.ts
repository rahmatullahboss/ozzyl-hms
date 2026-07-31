import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_LAB_TEST_REAGENT_PROFILES } from '../src/lib/lab-reagent-defaults';

describe('lab monitoring default reagent catalog seeding', () => {
  it('exposes a manager-only endpoint to load editable reagent defaults for existing tenants', () => {
    const source = readFileSync('src/routes/tenant/labMonitoring.ts', 'utf8');
    expect(source).toContain("/default-reagent-catalog/seed");
    expect(source).toContain('seedLabReagentDefaults');
    expect(source).toContain('Default reagent catalog loaded');
  });

  it('covers the phase-1 starter tests with editable test-equivalent mappings', () => {
    const profilesByCode = new Map(DEFAULT_LAB_TEST_REAGENT_PROFILES.map((profile) => [profile.testCode, profile]));

    expect(profilesByCode.get('CBC')?.consumables.map((item) => item.code)).toEqual([
      'CBC-REAGENT-TEST',
      'EDTA-TUBE',
    ]);
    expect(profilesByCode.get('RBS')?.consumables.map((item) => item.code)).toEqual(['GLUCOSE-REAGENT-TEST']);
    expect(profilesByCode.get('FBS')?.consumables.map((item) => item.code)).toEqual(['GLUCOSE-REAGENT-TEST']);
    expect(profilesByCode.get('LIPID')?.consumables.map((item) => item.code)).toEqual([
      'CHOL-REAGENT-TEST',
      'TG-REAGENT-TEST',
      'HDL-REAGENT-TEST',
      'LDL-REAGENT-TEST',
    ]);
    expect(profilesByCode.get('LFT')?.consumables.map((item) => item.code)).toEqual([
      'ALT-REAGENT-TEST',
      'AST-REAGENT-TEST',
      'ALP-REAGENT-TEST',
      'BIL-T-REAGENT-TEST',
      'BIL-D-REAGENT-TEST',
      'TP-REAGENT-TEST',
      'ALB-REAGENT-TEST',
    ]);
    expect(profilesByCode.get('KFT')?.aliases).toEqual(expect.arrayContaining(['RFT', 'Renal Function Test']));
    expect(profilesByCode.get('KFT')?.consumables.map((item) => item.code)).toEqual([
      'UREA-REAGENT-TEST',
      'CREATININE-REAGENT-TEST',
      'URIC-ACID-REAGENT-TEST',
    ]);

    for (const code of ['CBC', 'RBS', 'FBS', 'LIPID', 'LFT', 'KFT']) {
      for (const item of profilesByCode.get(code)?.consumables ?? []) {
        expect(item.qtyPerTest).toBe(1);
        if (item.unit === 'test') {
          expect(item.notes).toContain('1 test-equivalent');
        }
      }
    }
  });
});
