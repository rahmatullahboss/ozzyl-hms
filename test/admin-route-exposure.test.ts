import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeRegistry = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');

describe('admin API route exposure', () => {
  it('exposes admin control routes now that durable workflows exist', () => {
    expect(routeRegistry).toContain("app.route('/api/bill-versions'");
    expect(routeRegistry).toContain("app.route('/api/bank-book'");
    expect(routeRegistry).toContain("app.route('/api/shift-closing'");
  });
});
