import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) => readFileSync(path, 'utf8');
const runGit = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

describe('repository worktree governance', () => {
  it('keeps the mandatory workflow discoverable from root instructions', () => {
    const agents = readText('agents.md');

    expect(agents).toContain('.agent-rules/git-workflow.md');
    expect(agents).toContain('pnpm worktree:check -- --mode=task');
    expect(agents).toContain('exact latest fetched `origin/main`');
    expect(agents).not.toContain('main-canonical-merge-20260720');
  });

  it('ships the detailed policy and executable package command', () => {
    const packageJson = JSON.parse(readText('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(existsSync('.agent-rules/git-workflow.md')).toBe(true);
    expect(existsSync('scripts/check-worktree-policy.mjs')).toBe(true);
    expect(packageJson.scripts?.['worktree:check']).toBe(
      'node scripts/check-worktree-policy.mjs',
    );

    const policy = readText('.agent-rules/git-workflow.md');
    expect(policy).toContain('Root checkout contract');
    expect(policy).toContain('Task worktree contract');
    expect(policy).toContain('Integration contract');
    expect(policy).toContain('--require-latest-origin-main');
    expect(policy).toContain('Delete the remote task branch if it exists.');
    expect(policy).toContain('Never use an unrelated dirty branch as a task base');
  });

  it('accepts a clean isolated feature worktree in task mode', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hms-worktree-policy-'));
    const repository = join(sandbox, 'repository');
    const taskWorktree = join(sandbox, 'task-worktree');
    const checker = resolve('scripts/check-worktree-policy.mjs');

    try {
      mkdirSync(repository);
      runGit(repository, ['init', '-b', 'main']);
      runGit(repository, ['config', 'user.email', 'policy-test@example.com']);
      runGit(repository, ['config', 'user.name', 'Policy Test']);
      writeFileSync(join(repository, 'README.md'), '# temporary repository\n');
      runGit(repository, ['add', 'README.md']);
      runGit(repository, ['commit', '-m', 'initial']);
      runGit(repository, [
        'worktree',
        'add',
        taskWorktree,
        '-b',
        'feature/test-policy',
      ]);

      const output = execFileSync(
        process.execPath,
        [checker, '--mode=task'],
        { cwd: taskWorktree, encoding: 'utf8' },
      );

      expect(output).toContain('WORKTREE_POLICY_OK');
      expect(output).toContain('mode=task');
      expect(output).toContain('linked=true');
      expect(output).toContain('branch=feature/test-policy');
      expect(output).toContain('dirty=false');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
