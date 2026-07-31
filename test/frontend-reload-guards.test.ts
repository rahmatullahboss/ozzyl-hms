import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('frontend reload guards', () => {
  it('does not use a hard browser reload for staff login redirects', () => {
    const loginSource = readFileSync('web/src/pages/Login.tsx', 'utf8');

    expect(loginSource).not.toContain('window.location.replace(target)');
  });

  it('does not silently auto-update the PWA service worker', () => {
    const viteConfig = readFileSync('web/vite.config.ts', 'utf8');

    expect(viteConfig).toContain("registerType: 'prompt'");
    expect(viteConfig).toContain('skipWaiting: false');
    expect(viteConfig).toContain('clientsClaim: false');
    expect(viteConfig).toContain('enabled: false');
  });

  it('keeps the service-worker API matcher self-contained', () => {
    const viteConfig = readFileSync('web/vite.config.ts', 'utf8');

    expect(viteConfig).not.toMatch(/import\s+\{\s*PUBLIC_API_PATH_PATTERNS\s*\}/);
    expect(viteConfig).not.toMatch(/return\s+PUBLIC_API_PATH_PATTERNS\.some/);
  });
});
