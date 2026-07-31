import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staff password reset public route mount', () => {
  it('mounts reset routes before tenant-authenticated routes', () => {
    const source = readFileSync('src/index.ts', 'utf8');
    expect(source).toContain("import staffPasswordResetRoutes from './routes/staff-password-reset';");
    expect(source).toContain("app.route('/api/auth', staffPasswordResetRoutes);");
  });
});
