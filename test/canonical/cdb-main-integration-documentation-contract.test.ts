import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const checkpoint = 'CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE';
const nextTask = 'OBS-001-POST-RELEASE-OBSERVATION-BASELINE';
const candidate = '4ff275b8-f17e-4956-a104-e9083a0a1d57';
const releaseSha = '3da958da07e7a20d016dbe08176a629bd6f54b65';

describe('CDB post-release documentation contract', () => {
  it('keeps active control surfaces on CDB-V1-071B and OBS-001', () => {
    const historicalBoard = read('docs/architecture/hms-canonical-parallel-execution-board.yaml');
    const currentBoard = read('docs/architecture/post-canonical-parallel-execution-board.yaml');
    const prompt = read('docs/architecture/canonical-main-continuation-prompt.md');
    const tracker = read('task-progress.yaml');
    const handoff = read('.ai-bridge/current-plan.md');
    const controlCenter = read('docs/architecture/canonical-program-control-center.md');

    for (const document of [currentBoard, prompt, tracker, handoff, controlCenter]) {
      expect(document).toContain(checkpoint);
      expect(document).toContain(nextTask);
      expect(document).toContain(candidate);
    }

    expect(currentBoard).toContain(`origin_main_sha: ${releaseSha}`);
    expect(currentBoard).toContain('active_traffic_percent: 100');
    expect(currentBoard).toContain('pending_migrations_at_release_completion: 0');

    expect(prompt).toContain('production_release_state: released_100_percent');
    expect(prompt).toContain('previous CDB-V1-071B authorization has been consumed');

    expect(tracker).toContain('production_release_complete: true');
    expect(tracker).toContain('historical_task_records_below_remain_evidence_not_current_routing: true');

    expect(handoff).toContain('Post-Release Observation and Parallel Repository Plan');
    expect(handoff).toContain('must not be executed as the current task');

    expect(controlCenter).toContain('Production release complete:** yes');
    expect(controlCenter).toContain('Broad provider-authority promotion complete:** no');

    expect(historicalBoard).toContain(
      'status: historical_pre_release_evidence_superseded_for_current_execution',
    );
    expect(historicalBoard).toContain(
      'historical_lane_details_below_are_not_current_execution_instructions: true',
    );
  });

  it('keeps post-release parallel work bounded and serializes shared governance changes', () => {
    const board = read('docs/architecture/post-canonical-parallel-execution-board.yaml');
    const policy = read('docs/architecture/hms-production-scope-policy.md');

    expect(board).toContain('max_parallel_workers: 4');
    expect(board).toContain('OBS-001:');
    expect(board).toContain('INV-INT-001:');
    expect(board).toContain('MM-RB-001:');
    expect(board).toContain('DIAG-AUD-001:');
    expect(board).toContain('merge_policy: one_reviewed_worker_at_a_time');
    expect(board).toContain('shared_file_locks:');
    expect(board).toContain('do_not_start_unrelated_production_release_during_initial_observation');

    expect(policy).toContain('The user may run multiple user-launched agents in parallel');
    expect(policy).toContain('shared integration files must remain serially controlled');
  });

  it('does not treat the Worker release as provider promotion or Legacy retirement', () => {
    const state = read('docs/architecture/canonical-inventory-mm-current-state.yaml');
    const prompt = read('docs/architecture/canonical-main-continuation-prompt.md');

    expect(state).toContain('provider_flags_changed: false');
    expect(state).toContain('canonical_authority_broadly_promoted: false');
    expect(state).toContain('local_sync_activated: false');
    expect(state).toContain('legacy_retired: false');
    expect(prompt).toContain('does not authorize a new production migration');
  });
});
