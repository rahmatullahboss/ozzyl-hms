import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const approvalsSource = readFileSync(
  join(process.cwd(), 'src/routes/tenant/approvals.ts'),
  'utf8',
);

describe('approval query production schema contract', () => {
  it('does not reference the non-existent expenses.updated_at column', () => {
    expect(approvalsSource).not.toContain('e.updated_at');
  });

  it('does not reference the non-existent approval_requests.updated_at column', () => {
    expect(approvalsSource).not.toContain('COALESCE(reviewed_at, updated_at)');
  });
});
