/// <reference types="node" />
/**
 * Vitest config for REAL D1 integration tests.
 *
 * These tests run against a LOCAL Wrangler dev server (http://localhost:8787)
 * with a real D1 SQLite database. No mocking.
 *
 * Prerequisites before running:
 *   1. Apply migrations:
 *      npm run test:real:setup
 *   2. Start wrangler dev in a separate terminal:
 *      npm run dev:api
 *   3. Run tests:
 *      npm run test:real
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/real-db/**/*.test.ts'],
    // Generous timeouts — wrangler dev has startup latency
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run sequentially to avoid data race conditions on shared D1
    sequence: {
      concurrent: false,
    },
    // No coverage for integration tests (they hit the worker, not raw source)
    coverage: {
      enabled: false,
    },
  },
});
