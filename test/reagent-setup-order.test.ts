import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyMigration } from '../scripts/build-migration-manifest';

const REAGENT_MIGRATIONS = [
  '0170_lab_consumables_monitoring.sql',
  '0372_lab_consumable_consumption_claims.sql',
  '0373_lab_consumable_stock_qc.sql',
  '0374_lab_consumable_stock_onboard_expiry.sql',
  '0375_lab_consumable_stock_locations.sql',
  '0376_lab_consumable_waste_requests.sql',
  '0377_lab_operation_logs_stock_lifecycle_types.sql',
  '0378_lab_inventory_bridge_links.sql',
  '0392_lab_reagent_analyzer_assignments.sql',
  '0393_lab_inventory_policy.sql',
  '0394_lab_inventory_exception_and_claim_lifecycle.sql',
  '0395_lab_inventory_policy_modes.sql',
  '0396_lab_test_consumable_map_lifecycle.sql',
  '0398_inventory_consumption_automation.sql',
] as const;

const LOCAL_REAGENT_BOOTSTRAP_SEQUENCE = [
  '0001_fix_schema_add_missing_tables.sql',
  '0033_operation_theatre.sql',
  '0037_inventory.sql',
  '0053_radiology.sql',
  '0143_lis_full_upgrade.sql',
  ...REAGENT_MIGRATIONS,
] as const;

function expectInOrder(source: string, filenames: readonly string[]) {
  let previousIndex = -1;

  for (const filename of filenames) {
    const path = `migrations/${filename}`;
    const currentIndex = source.indexOf(path);

    expect(currentIndex, `${path} should be present`).toBeGreaterThanOrEqual(0);
    expect(currentIndex, `${path} should appear after the previous bootstrap file`).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
}

describe('reagent setup migration order', () => {
  it('keeps every required reagent migration file in the repository with safe migration naming', () => {
    for (const filename of REAGENT_MIGRATIONS) {
      expect(existsSync(`migrations/${filename}`), `${filename} should exist`).toBe(true);
      expect(classifyMigration(filename), `${filename} should be a safe migration`).toBe('safe');
    }
  });

  it('keeps every required reagent migration in the generated schema migration manifest', () => {
    const generatedManifest = readFileSync('src/data/schema-migrations.generated.ts', 'utf8');

    for (const filename of REAGENT_MIGRATIONS) {
      expect(generatedManifest, `${filename} should be bundled into migration metadata`).toContain(`filename: "${filename}"`);
    }
  });

  it('keeps the local-server reagent bootstrap in dependency order and behind its explicit skip flag', () => {
    const migrateScript = readFileSync('scripts/local-server/migrate.sh', 'utf8');
    const applyReagentBootstrap = migrateScript.match(/apply_reagent_bootstrap\(\) \{[\s\S]*?\n\}\n\n/)?.[0] ?? '';

    expect(applyReagentBootstrap).toContain('HMS_LOCAL_SKIP_REAGENT_BOOTSTRAP');
    expect(applyReagentBootstrap).toContain('run_file_once "$file"');
    expectInOrder(applyReagentBootstrap, LOCAL_REAGENT_BOOTSTRAP_SEQUENCE);
  });

  it('runs the default local-server setup as baseline, tenant baseline, reagent bootstrap, then optional versioned migrations', () => {
    const migrateScript = readFileSync('scripts/local-server/migrate.sh', 'utf8');
    const mainFlow = migrateScript.slice(migrateScript.indexOf('echo "Preparing the hospital local-server database."'));

    const baseSchemaIndex = mainFlow.indexOf('ensure_base_schema');
    const tenantBaselineIndex = mainFlow.indexOf('ensure_tenant_baseline');
    const reagentBootstrapIndex = mainFlow.indexOf('apply_reagent_bootstrap');
    const optionalVersionedIndex = mainFlow.indexOf('if [[ "$APPLY_VERSIONED" == "1" ]]');

    expect(baseSchemaIndex).toBeGreaterThanOrEqual(0);
    expect(tenantBaselineIndex).toBeGreaterThan(baseSchemaIndex);
    expect(reagentBootstrapIndex).toBeGreaterThan(tenantBaselineIndex);
    expect(optionalVersionedIndex).toBeGreaterThan(reagentBootstrapIndex);
  });
});
