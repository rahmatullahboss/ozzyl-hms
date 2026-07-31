import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('local-server CI bootstrap', () => {
  it('uses the safe baseline path instead of forcing versioned migrations onto an empty database', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const migrateScript = readFileSync('scripts/local-server/migrate.sh', 'utf8');
    const tenantBaseline = readFileSync('tenant-baseline.sql', 'utf8');

    const baselineStep = workflow.match(
      /- name: Apply local-server baseline schema[\s\S]*?- name: Start local server for smoke tests/,
    )?.[0] ?? '';

    expect(baselineStep).toContain('bash scripts/local-server/migrate.sh');
    expect(baselineStep).toContain('HMS_LOCAL_CI_BOOTSTRAP=1');
    expect(baselineStep).not.toContain('HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1');
    expect(migrateScript).toContain('APPLY_VERSIONED="${HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS:-0}"');

    const mainFlow = migrateScript.slice(migrateScript.indexOf('echo "Preparing the hospital local-server database."'));
    const baseSchemaIndex = mainFlow.indexOf('ensure_base_schema');
    const tenantBaselineIndex = mainFlow.indexOf('ensure_tenant_baseline');
    const ciBlockIndex = mainFlow.indexOf('if [[ "$CI_BOOTSTRAP" == "1" ]]');
    const reagentBootstrapIndex = mainFlow.indexOf('apply_reagent_bootstrap');

    expect(baseSchemaIndex).toBeGreaterThanOrEqual(0);
    expect(tenantBaselineIndex).toBeGreaterThan(baseSchemaIndex);
    expect(ciBlockIndex).toBeGreaterThan(tenantBaselineIndex);
    expect(reagentBootstrapIndex).toBeGreaterThan(ciBlockIndex);

    const ciBlock = migrateScript.match(/if \[\[ "\$CI_BOOTSTRAP" == "1" \]\]; then[\s\S]*?\nfi/)?.[0] ?? '';
    expect(ciBlock).toContain('exit 0');
    expect(ciBlock).not.toContain('d1 migrations apply');
    expect(ciBlock).not.toContain('apply_reagent_bootstrap');
    expect(tenantBaseline).toContain('CREATE TABLE IF NOT EXISTS patients');
    expect(tenantBaseline).not.toContain('ALTER TABLE ot_bookings');
  });
});
