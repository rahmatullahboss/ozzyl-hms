import { describe, expect, it } from 'vitest';
import {
  createActionCenterWebServerConfig,
  shouldStartActionCenterWebServer,
} from '../playwright.config';

describe('Action Center Playwright server config', () => {
  it('starts the local preview server on the host and port from the configured base URL', () => {
    expect(createActionCenterWebServerConfig('http://localhost:4188')).toEqual({
      command: 'pnpm --filter web build && pnpm --filter web preview --host localhost --port 4188 --strictPort',
      url: 'http://localhost:4188',
      reuseExistingServer: false,
      timeout: 180_000,
    });
  });

  it('rejects non-local Action Center E2E base URLs', () => {
    expect(() => createActionCenterWebServerConfig('https://example.com')).toThrow(
      'Action Center E2E web server must use a local URL',
    );
  });

  it('starts for either the spec path or the dedicated project and stays off for list-only discovery', () => {
    expect(shouldStartActionCenterWebServer([
      'node',
      'playwright',
      'test',
      'test/e2e/action-center-workflows.spec.ts',
    ])).toBe(true);
    expect(shouldStartActionCenterWebServer([
      'node',
      'playwright',
      'test',
      '--project=action-center-workflows',
    ])).toBe(true);
    expect(shouldStartActionCenterWebServer([
      'node',
      'playwright',
      'test',
      'test/e2e/action-center-workflows.spec.ts',
      '--list',
    ])).toBe(false);
  });
});
