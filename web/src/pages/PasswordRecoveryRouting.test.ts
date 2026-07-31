import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staff password recovery routing', () => {
  it('registers public recovery pages and links login to them', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const loginSource = readFileSync('src/pages/Login.tsx', 'utf8');

    expect(appSource).toContain("import ForgotPassword from './pages/ForgotPassword';");
    expect(appSource).toContain("import ResetPassword from './pages/ResetPassword';");
    expect(appSource).toContain('<Route path="/forgot-password" element={<ForgotPassword />} />');
    expect(appSource).toContain('<Route path="/reset-password" element={<ResetPassword />} />');
    expect(loginSource).toContain('to="/forgot-password"');
    expect(loginSource).not.toContain('href="#"');
  });
});
