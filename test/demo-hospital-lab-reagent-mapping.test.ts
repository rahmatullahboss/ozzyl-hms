import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DEMO_TEST_CODES = [
  'CBC',
  'BSF',
  'BS2H',
  'CRP',
  'LFT',
  'KFT',
  'LIPID',
  'TSH',
  'HBA1C',
  'URINE',
  'UCR',
  'STOOL',
  'ECG',
  'ECHO',
  'CXR',
  'ABDXR',
  'USG',
  'USGLV',
  'USGNCK',
  'WIDAL',
  'MPS',
  'DENGUE',
  'COVID',
  'TROPON',
  'PT',
  'APTT',
  'BILT',
  'HBsAg',
  'ANTIHCV',
  'PSA',
] as const;

const EXPECTED_SAMPLE_MAPPINGS = [
  ['CBC', 'CBC-REAGENT-TEST'],
  ['BSF', 'GLUCOSE-REAGENT-TEST'],
  ['BS2H', 'GLUCOSE-REAGENT-TEST'],
  ['LFT', 'ALT-REAGENT-TEST'],
  ['KFT', 'CREATININE-REAGENT-TEST'],
  ['LIPID', 'LDL-REAGENT-TEST'],
  ['URINE', 'URINE-STRIP-TEST'],
  ['UCR', 'CULTURE-MEDIA-TEST'],
  ['ECG', 'ECG-PAPER-TEST'],
  ['ECHO', 'ULTRASOUND-GEL-TEST'],
  ['CXR', 'XRAY-FILM-TEST'],
  ['USG', 'ULTRASOUND-GEL-TEST'],
  ['DENGUE', 'DENGUE-NS1-KIT-TEST'],
  ['COVID', 'COVID-AG-KIT-TEST'],
  ['TROPON', 'TROPONIN-I-KIT-TEST'],
  ['BILT', 'BIL-T-REAGENT-TEST'],
  ['ANTIHCV', 'HCV-KIT-TEST'],
] as const;

function readSql(path: string): string {
  return readFileSync(path, 'utf8');
}

function mappingTuplePattern(testCode: string, consumableCode: string): RegExp {
  return new RegExp(`\\('${testCode}',\\s*'${consumableCode}'`, 'i');
}

describe('demo hospital lab reagent default mappings', () => {
  it('keeps the fresh demo seed ready with reagent/diagnostic consumable mappings', () => {
    const seedSql = readSql('migrations/seed_demo.sql');

    expect(seedSql).toContain('5b. LAB/DIAGNOSTIC DEFAULT CONSUMABLES + TEST MAPPINGS');
    expect(seedSql).toContain('INSERT INTO lab_consumables');
    expect(seedSql).toContain('INSERT INTO lab_test_consumable_map');

    for (const [testCode, consumableCode] of EXPECTED_SAMPLE_MAPPINGS) {
      expect(seedSql, `${testCode} should map to ${consumableCode} in seed_demo.sql`).toMatch(
        mappingTuplePattern(testCode, consumableCode),
      );
    }
  });

  it('backfills the existing legacy demo tenant without creating duplicate lab catalog rows', () => {
    const migrationSql = readSql('migrations/0403_demo_hospital_lab_reagent_defaults.sql');

    expect(migrationSql).toContain('tenant 100');
    expect(migrationSql).toContain('WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 100)');
    expect(migrationSql).toContain('NOT EXISTS');
    expect(migrationSql).toContain('UPDATE lab_test_consumable_map');
    expect(migrationSql).not.toMatch(/INSERT\s+INTO\s+lab_test_catalog/i);

    for (const [testCode, consumableCode] of EXPECTED_SAMPLE_MAPPINGS) {
      expect(migrationSql, `${testCode} should map to ${consumableCode} in backfill migration`).toMatch(
        mappingTuplePattern(testCode, consumableCode),
      );
    }
  });

  it('covers every legacy demo lab/diagnostic code with at least one default mapping', () => {
    const migrationSql = readSql('migrations/0403_demo_hospital_lab_reagent_defaults.sql');

    for (const testCode of DEMO_TEST_CODES) {
      expect(migrationSql, `${testCode} should have at least one default mapping`).toMatch(
        new RegExp(`\\('${testCode}',\\s*'[^']+'`, 'i'),
      );
    }
  });
});
