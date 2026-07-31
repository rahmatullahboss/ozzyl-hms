import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const files = {
  prompt: path.join(root, 'docs/architecture/canonical-main-continuation-prompt.md'),
  roadmap: path.join(root, 'docs/architecture/2026-07-31-post-canonical-production-roadmap.md'),
  board: path.join(root, 'docs/architecture/post-canonical-parallel-execution-board.yaml'),
  currentState: path.join(root, 'docs/architecture/canonical-inventory-mm-current-state.yaml'),
  currentTask: path.join(root, 'docs/production-readiness/CURRENT_NEXT_TASK.md'),
  taskStatus: path.join(root, 'docs/production-readiness/TASK_STATUS.md'),
  startHere: path.join(root, 'docs/production-readiness/START_HERE.md'),
  historicalControlCenter: path.join(
    root,
    'docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md',
  ),
  historicalPrompts: path.join(
    root,
    'docs/architecture/2026-07-29-canonical-inventory-mm-continuation-prompt.md',
  ),
  migrationRunbook: path.join(
    root,
    'docs/database/2026-07-29-inventory-main-migration-reconciliation.md',
  ),
};

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('post-Canonical release continuation contract', () => {
  it('keeps every current continuation artifact present and substantial', () => {
    for (const [name, file] of Object.entries(files)) {
      expect(fs.existsSync(file), name).toBe(true);
      expect(read(file).length, name).toBeGreaterThan(1_000);
    }
  });

  it('routes immediate work to post-release observation instead of obsolete Gate A work', () => {
    const prompt = read(files.prompt);
    const task = read(files.currentTask);

    for (const document of [prompt, task]) {
      expect(document).toContain('CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE');
      expect(document).toContain('OBS-001');
      expect(document).toContain('4ff275b8-f17e-4956-a104-e9083a0a1d57');
      expect(document).toContain('3da958da07e7a20d016dbe08176a629bd6f54b65');
    }

    expect(prompt).toContain('active_worker_traffic_percent: 100');
    expect(prompt).toContain('pending_migrations_at_release_completion: 0');
    expect(prompt).toContain('previous CDB-V1-071B authorization has been consumed');
    expect(task).not.toContain('CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION');
  });

  it('records the exact controlled production release without claiming broad retirement', () => {
    const combined = [files.roadmap, files.board, files.currentState, files.taskStatus]
      .map(read)
      .join('\n');

    expect(combined).toContain('4ff275b8-f17e-4956-a104-e9083a0a1d57');
    expect(combined).toContain('4f5d8f93-92d4-4fda-8fba-c0a2863f1b71');
    expect(combined).toContain('e7de7b306b7e75685b86b1b1efebc653e2b2dab4ec8b5ceeb0acca4b52230144');
    expect(combined).toMatch(/54.*resolved|dependency_issues_resolved:\s*54/is);
    expect(combined).toMatch(/4.*waived|cache_variance_issues_waived:\s*4/is);
    expect(combined).toMatch(/remaining.*0|remaining_open_target_issues:\s*0/is);
    expect(combined).toContain('legacy_retired: false');
    expect(combined).toContain('canonical_authority_broadly_promoted: false');
  });

  it('distinguishes deployed code, operational commissioning and Canonical authority', () => {
    const roadmap = read(files.roadmap);
    const board = read(files.board);
    const startHere = read(files.startHere);

    expect(roadmap).toContain('Code deployed');
    expect(roadmap).toContain('Operationally commissioned');
    expect(roadmap).toContain('Canonical authority complete');
    expect(board).toContain('code_deployed: route_or_ui_is_present_in_active_worker_bundle');
    expect(board).toContain('operationally_commissioned: hospital_configured_trained_and_using_module');
    expect(startHere).toContain('Many optional HMS routes are deployed in the Worker');
  });

  it('keeps Inventory development complete while current-main integration and production remain pending', () => {
    const state = read(files.currentState);
    const roadmap = read(files.roadmap);

    expect(state).toContain('program_status: closed_27_of_27');
    expect(state).toContain('latest_integrated_task: INV-MM-121');
    expect(state).toContain('main_integration_status: pending_latest_main_reconciliation');
    expect(state).toContain('production_activation_status: not_authorized_not_performed');
    expect(state).toContain('direct_inventory_to_main_merge_allowed: false');
    expect(state).toContain('production_data_migration_required: false');
    expect(roadmap).toContain('Inventory is **not a new implementation project**');
    expect(roadmap).toContain('INV-INT-001');
  });

  it('requires post-0571 migration reservation and keeps destructive retirement separate', () => {
    const state = read(files.currentState);
    const board = read(files.board);
    const runbook = read(files.migrationRunbook);

    expect(state).toContain('current_main_latest_migration: 0571_canonical_admission_encounter_type_alignment.sql');
    expect(state).toContain('inventory_new_range_must_be_reserved_after_0571: true');
    for (const prefix of [
      '0537',
      '0538',
      '0539',
      '0540',
      '0541',
      '0542',
      '0543',
      '0550',
      '0551',
      '0552',
      '0553',
    ]) {
      expect(state).toContain(`- '${prefix}'`);
      expect(runbook).toContain(`| \`${prefix}\``);
    }

    expect(state).toContain(
      'destructive_retirement_migration: migrations/0558d_retire_legacy_inventory_tables.sql',
    );
    expect(state).toContain('legacy_inventory_tables_may_be_dropped_now: false');
    expect(board).toContain('direct_drop_allowed: false');
    expect(runbook).toContain('BLOCKED — DO NOT DROP');
  });

  it('requires Full MM rebaseline onto current main and final Inventory without duplicate authority', () => {
    const state = read(files.currentState);
    const prompt = read(files.prompt);

    expect(state).toContain('completed_tasks: 34');
    expect(state).toContain('total_tasks: 45');
    expect(state).toContain('task_progress_percent: 75.6');
    expect(state).toContain('recorded_latest_inventory_task: INV-MM-089');
    expect(state).toContain('required_latest_inventory_task: INV-MM-121');
    expect(state).toContain(
      'role: consume_reviewed_inventory_public_contracts_without_duplicate_inventory_authority',
    );
    expect(prompt).toContain('MM-RB-001');
    expect(prompt).toContain('duplicate Inventory authority');
  });

  it('defines bounded parallel lanes with one serial integration owner', () => {
    const board = read(files.board);
    const roadmap = read(files.roadmap);

    expect(board).toContain('max_parallel_workers: 4');
    expect(board).toContain('OBS-001:');
    expect(board).toContain('INV-INT-001:');
    expect(board).toContain('MM-RB-001:');
    expect(board).toContain('DIAG-AUD-001:');
    expect(board).toContain('merge_policy: one_reviewed_worker_at_a_time');
    expect(roadmap).toContain('maximum four worker sessions plus one integration/review owner');
    expect(roadmap).toContain('Workers can develop in parallel; integration remains serial.');
  });

  it('keeps future production and destructive actions behind fresh exact authorization', () => {
    const combined = [files.prompt, files.roadmap, files.currentState, files.currentTask]
      .map(read)
      .join('\n');

    expect(combined).toMatch(/fresh exact target|fresh exact.*authorization|separate.*authorization/is);
    expect(combined).toContain('inventory_production_migration_or_activation: false');
    expect(combined).toContain('destructive_legacy_retirement: false');
    expect(combined).toContain('local_sync_activation: false');
    expect(combined).toMatch(/do not.*wait idle|Do not wait idle/is);
  });

  it('marks the 2026-07-29 controls as historical instead of current execution prompts', () => {
    expect(read(files.historicalControlCenter)).toContain('Historical pre-release control center');
    expect(read(files.historicalPrompts)).toContain('Historical pre-release prompts');
  });
});
