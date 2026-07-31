import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pharmacySource = readFileSync(
  join(process.cwd(), 'src/routes/tenant/pharmacy/index.ts'),
  'utf8',
);

function routeBlock(startMarker: string, endMarker: string): string {
  const start = pharmacySource.indexOf(startMarker);
  const end = pharmacySource.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return pharmacySource.slice(start, end);
}

const pendingGrnRoute = routeBlock(
  '// GET /api/pharmacy/grn/pending-approval',
  '// PUT /api/pharmacy/grn/:id/approve',
);
const pendingWriteOffRoute = routeBlock(
  '// GET /api/pharmacy/write-offs/pending-approval',
  '// PUT /api/pharmacy/write-offs/:id/approve',
);

describe('pharmacy approval query production schema contract', () => {
  it('does not join the removed employees table in pending approval queries', () => {
    expect(pendingGrnRoute).not.toContain('LEFT JOIN employees');
    expect(pendingWriteOffRoute).not.toContain('LEFT JOIN employees');
  });

  it('uses tenant-scoped users joins for approval creator names', () => {
    expect(pendingGrnRoute).toContain('LEFT JOIN users creator');
    expect(pendingGrnRoute).toContain('creator.tenant_id = g.tenant_id');
    expect(pendingWriteOffRoute).toContain('LEFT JOIN users creator');
    expect(pendingWriteOffRoute).toContain('creator.tenant_id = w.tenant_id');
  });
});
