#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const modeArg = rawArgs.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.slice('--mode='.length) ?? 'task';
const allowDirty = rawArgs.includes('--allow-dirty');
const requireLatestOriginMain = rawArgs.includes('--require-latest-origin-main');
const validModes = new Set(['task', 'root', 'integration']);

const failUsage = (message) => {
  console.error(`WORKTREE_POLICY_ERROR ${message}`);
  console.error(
    'Usage: pnpm worktree:check -- --mode=task|root|integration [--allow-dirty] [--require-latest-origin-main]',
  );
  process.exit(2);
};

if (!validModes.has(mode)) {
  failUsage(`unsupported mode=${mode}`);
}

if (allowDirty && mode !== 'task') {
  failUsage('--allow-dirty is permitted only with --mode=task');
}

if (requireLatestOriginMain && mode === 'root') {
  failUsage('--require-latest-origin-main is permitted only with --mode=task or --mode=integration');
}

const git = (args) =>
  execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

let topLevel;
let gitDir;
let commonDir;
let branch;
let status;
let head;
let originMain = '';

try {
  topLevel = git(['rev-parse', '--show-toplevel']);
  gitDir = resolve(topLevel, git(['rev-parse', '--git-dir']));
  commonDir = resolve(topLevel, git(['rev-parse', '--git-common-dir']));
  branch = git(['branch', '--show-current']);
  status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
  head = git(['rev-parse', 'HEAD']);
} catch (error) {
  console.error('WORKTREE_POLICY_ERROR unable to inspect Git state');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}


if (requireLatestOriginMain) {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    originMain = git(['rev-parse', 'refs/remotes/origin/main']);
  } catch (error) {
    console.error('WORKTREE_POLICY_ERROR unable to fetch or resolve origin/main');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const linked = gitDir !== commonDir;
const dirty = status.length > 0;
const errors = [];

if (!branch) {
  errors.push('detached HEAD is not allowed for governed implementation work');
}

if (mode === 'root') {
  if (linked) {
    errors.push('root mode requires the primary checkout, not a linked worktree');
  }
  if (branch !== 'main') {
    errors.push(`root mode requires branch=main, found branch=${branch || 'DETACHED'}`);
  }
  if (dirty) {
    errors.push('root mode requires a clean checkout');
  }
}

if (requireLatestOriginMain && head !== originMain) {
  errors.push(
    `HEAD must equal latest origin/main before governed startup/integration; head=${head} origin/main=${originMain}`,
  );
}

if (mode === 'task') {
  if (!linked) {
    errors.push('task mode requires a linked worktree');
  }
  if (branch === 'main' || branch === 'master') {
    errors.push('task mode requires a dedicated non-main branch');
  }
  if (dirty && !allowDirty) {
    errors.push(
      'task worktree is dirty; inspect ownership and use --allow-dirty only when continuing the same task',
    );
  }
}

if (mode === 'integration') {
  if (branch !== 'main') {
    errors.push(
      `integration mode requires branch=main, found branch=${branch || 'DETACHED'}`,
    );
  }
  if (dirty) {
    errors.push('integration mode requires a clean main worktree');
  }
}

if (errors.length > 0) {
  console.error(
    `WORKTREE_POLICY_BLOCKED mode=${mode} linked=${linked} branch=${branch || 'DETACHED'} dirty=${dirty}`,
  );
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `WORKTREE_POLICY_OK mode=${mode} linked=${linked} branch=${branch} dirty=${dirty} root=${topLevel}${originMain ? ` originMain=${originMain}` : ''}`,
);
