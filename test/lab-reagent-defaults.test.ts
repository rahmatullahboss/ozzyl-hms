import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAB_TEST_REAGENT_PROFILES, seedLabReagentDefaults } from '../src/lib/lab-reagent-defaults.ts';

type SqliteValue = string | number | bigint | null | Uint8Array;

type RunMeta = { changes: number; last_row_id: number; duration: number };

class SqliteD1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.database,
      this.sql,
      params.map((param) => (param === undefined ? null : param)) as SqliteValue[],
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    const statement = this.database.prepare(this.sql);
    return { results: statement.all(...this.params) as T[], success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    return (statement.get(...this.params) as T | undefined) ?? null;
  }

  async run(): Promise<{ success: boolean; meta: RunMeta }> {
    const statement = this.database.prepare(this.sql);
    const result = statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }
}

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE lab_test_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lab_consumables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'reagent',
      unit TEXT NOT NULL DEFAULT 'pcs',
      unit_price INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      reorder_qty INTEGER NOT NULL DEFAULT 50,
      supplier_id INTEGER,
      description TEXT,
      storage_condition TEXT,
      expiry_alert_days INTEGER DEFAULT 30,
      is_active INTEGER NOT NULL DEFAULT 1,
      tenant_id INTEGER NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lab_test_consumable_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_test_id INTEGER NOT NULL REFERENCES lab_test_catalog(id),
      consumable_id INTEGER NOT NULL REFERENCES lab_consumables(id),
      qty_per_test REAL NOT NULL DEFAULT 1,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      tenant_id INTEGER NOT NULL,
      UNIQUE(lab_test_id, consumable_id, tenant_id)
    );
  `);

  const d1 = {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(sqlite, sql);
    },
  } as unknown as D1Database;

  return { sqlite, d1 };
}

describe('lab reagent default seeding', () => {
  it('includes common Bangladesh starter tests as editable test-equivalent defaults', () => {
    const codes = DEFAULT_LAB_TEST_REAGENT_PROFILES.map((profile) => profile.testCode);
    expect(codes).toEqual(expect.arrayContaining([
      'CBC',
      'RBS',
      'PPBS',
      'LFT',
      'KFT',
      'TSH',
      'CRP',
      'URINE-RE',
      'DENGUE-NS1',
      'HBsAg',
      'HCV',
      'HIV',
      'WIDAL',
      'TYPHOID-IGM-IGG',
      'ELECTROLYTES',
      'BLOOD-GROUP',
      'PREG-TEST',
      'MP',
    ]));
    const dengue = DEFAULT_LAB_TEST_REAGENT_PROFILES.find((profile) => profile.testCode === 'DENGUE-NS1');
    expect(dengue?.consumables[0]).toMatchObject({ unit: 'test', qtyPerTest: 1 });
    expect(dengue?.consumables[0].notes).toContain('Validate/override');
  });

  it('seeds starter reagent profiles as test-equivalent mappings and stays idempotent', async () => {
    const { sqlite, d1 } = createHarness();

    const first = await seedLabReagentDefaults(d1, 91001);
    expect(first.tests).toBe(DEFAULT_LAB_TEST_REAGENT_PROFILES.length);
    expect(first.mappings).toBeGreaterThan(10);

    const summary = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM lab_test_catalog WHERE tenant_id = 91001) as tests,
        (SELECT COUNT(*) FROM lab_consumables WHERE tenant_id = 91001) as consumables,
        (SELECT COUNT(*) FROM lab_test_consumable_map WHERE tenant_id = 91001) as mappings
    `).get() as { tests: number; consumables: number; mappings: number };
    expect(summary.tests).toBe(DEFAULT_LAB_TEST_REAGENT_PROFILES.length);
    expect(summary.consumables).toBeLessThanOrEqual(first.mappings);
    expect(summary.consumables).toBeGreaterThan(10);
    expect(summary.mappings).toBe(first.mappings);

    const cbc = sqlite.prepare(`
      SELECT t.code as test_code, c.code as consumable_code, c.unit, m.qty_per_test, m.notes
      FROM lab_test_consumable_map m
      JOIN lab_test_catalog t ON t.id = m.lab_test_id
      JOIN lab_consumables c ON c.id = m.consumable_id
      WHERE t.code = 'CBC' AND c.code = 'CBC-REAGENT-TEST'
    `).get() as { test_code: string; consumable_code: string; unit: string; qty_per_test: number; notes: string };
    expect(cbc).toMatchObject({ test_code: 'CBC', consumable_code: 'CBC-REAGENT-TEST', unit: 'test', qty_per_test: 1 });
    expect(cbc.notes).toContain('Validate/override');

    const second = await seedLabReagentDefaults(d1, 91001);
    expect(second.mappings).toBe(0);

    const afterSecond = sqlite.prepare('SELECT COUNT(*) as count FROM lab_test_consumable_map WHERE tenant_id = 91001').get() as { count: number };
    expect(afterSecond.count).toBe(first.mappings);
  });

  it('covers common Bangladesh diagnostic tests beyond the starter seed', () => {
    const codes = new Set(DEFAULT_LAB_TEST_REAGENT_PROFILES.map((profile) => profile.testCode));
    const requiredCodes = [
      'HB',
      'PLT',
      'BLOOD-GROUP',
      'CRP',
      'HBsAg',
      'DENGUE-NS1',
      'DENGUE-IGM-IGG',
      'URINE-RE',
      'PREG-TEST',
      'TROPONIN-I',
      'ELECTROLYTES',
      'FERRITIN',
      'VIT-D',
      'PSA',
      'PROLACTIN',
      'LH',
      'FSH',
      'COVID-AG',
      'URINE-CS',
      'BLOOD-CS',
      'SPUTUM-AFB',
      'GRAM-STAIN',
      'SEMEN-ANALYSIS',
      'ECG',
      'ECHO',
      'CXR',
      'USG',
    ];

    for (const code of requiredCodes) {
      expect(codes.has(code), `${code} should be available as a default lab profile`).toBe(true);
    }
  });

  it('reuses an existing FBS catalog row and creates RBS as a separate editable glucose mapping', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.prepare(`
      INSERT INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
      VALUES ('FBS', 'Fasting Blood Sugar', 'Biochemistry', 200, 1, 91001)
    `).run();

    await seedLabReagentDefaults(d1, 91001);

    const sugarTests = sqlite.prepare(`
      SELECT code, COUNT(*) as count
      FROM lab_test_catalog
      WHERE tenant_id = 91001 AND UPPER(code) IN ('FBS','RBS')
      GROUP BY code
      ORDER BY code
    `).all() as Array<{ code: string; count: number }>;
    expect(sugarTests).toEqual([
      { code: 'FBS', count: 1 },
      { code: 'RBS', count: 1 },
    ]);

    const glucoseMappings = sqlite.prepare(`
      SELECT t.code as test_code, c.code as consumable_code, m.qty_per_test
      FROM lab_test_consumable_map m
      JOIN lab_test_catalog t ON t.id = m.lab_test_id
      JOIN lab_consumables c ON c.id = m.consumable_id
      WHERE t.code IN ('FBS', 'RBS') AND c.code = 'GLUCOSE-REAGENT-TEST'
      ORDER BY t.code
    `).all() as Array<{ test_code: string; consumable_code: string; qty_per_test: number }>;
    expect(glucoseMappings).toEqual([
      { test_code: 'FBS', consumable_code: 'GLUCOSE-REAGENT-TEST', qty_per_test: 1 },
      { test_code: 'RBS', consumable_code: 'GLUCOSE-REAGENT-TEST', qty_per_test: 1 },
    ]);
  });

  it('maps legacy demo hospital catalog codes without creating duplicate canonical rows', async () => {
    const { sqlite, d1 } = createHarness();
    const legacyRows = [
      ['BSF', 'Blood Sugar Fasting', 'blood', 200],
      ['BS2H', 'Blood Sugar 2hr PP', 'blood', 200],
      ['URINE', 'Urine R/E', 'urine', 150],
      ['UCR', 'Urine Culture & Sensitivity', 'urine', 600],
      ['STOOL', 'Stool R/E', 'stool', 150],
      ['DENGUE', 'Dengue NS1 Antigen', 'blood', 800],
      ['COVID', 'COVID-19 Rapid Antigen', 'blood', 300],
      ['TROPON', 'Troponin I', 'blood', 2000],
      ['PT', 'Prothrombin Time (PT)', 'blood', 600],
      ['BILT', 'Serum Bilirubin (Total)', 'blood', 400],
      ['ANTIHCV', 'Anti-HCV Antibody', 'blood', 800],
      ['MPS', 'Malarial Parasite Screen', 'blood', 300],
      ['ECHO', 'Echocardiography', 'ecg', 2500],
      ['CXR', 'Chest X-Ray', 'xray', 400],
      ['USG', 'Ultrasonogram — Whole Abdomen', 'ultrasound', 800],
    ] as const;

    const insert = sqlite.prepare(`
      INSERT INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
      VALUES (?, ?, ?, ?, 1, 91001)
    `);
    for (const row of legacyRows) insert.run(...row);

    await seedLabReagentDefaults(d1, 91001);

    const missingMappings = sqlite.prepare(`
      SELECT t.code
      FROM lab_test_catalog t
      WHERE t.tenant_id = 91001
        AND t.code IN ('BSF','BS2H','URINE','UCR','STOOL','DENGUE','COVID','TROPON','PT','BILT','ANTIHCV','MPS','ECHO','CXR','USG')
        AND NOT EXISTS (
          SELECT 1
          FROM lab_test_consumable_map m
          WHERE m.tenant_id = t.tenant_id AND m.lab_test_id = t.id
        )
      ORDER BY t.code
    `).all() as Array<{ code: string }>;
    expect(missingMappings).toEqual([]);

    const canonicalDuplicates = sqlite.prepare(`
      SELECT code
      FROM lab_test_catalog
      WHERE tenant_id = 91001
        AND code IN ('FBS','PPBS','URINE-RE','URINE-CS','DENGUE-NS1','COVID-AG','TROPONIN-I','PT-INR','BILIRUBIN','HCV','MP')
      ORDER BY code
    `).all() as Array<{ code: string }>;
    expect(canonicalDuplicates).toEqual([]);

    const demoMappings = sqlite.prepare(`
      SELECT t.code as test_code, c.code as consumable_code
      FROM lab_test_consumable_map m
      JOIN lab_test_catalog t ON t.id = m.lab_test_id
      JOIN lab_consumables c ON c.id = m.consumable_id
      WHERE t.tenant_id = 91001
        AND t.code IN ('BSF','BS2H','ECHO','CXR','USG')
      ORDER BY t.code, c.code
    `).all() as Array<{ test_code: string; consumable_code: string }>;
    expect(demoMappings).toEqual([
      { test_code: 'BS2H', consumable_code: 'GLUCOSE-REAGENT-TEST' },
      { test_code: 'BSF', consumable_code: 'GLUCOSE-REAGENT-TEST' },
      { test_code: 'CXR', consumable_code: 'XRAY-FILM-TEST' },
      { test_code: 'ECHO', consumable_code: 'ULTRASOUND-GEL-TEST' },
      { test_code: 'USG', consumable_code: 'ULTRASOUND-GEL-TEST' },
    ]);
  });
});
