import path from 'node:path';
import { defineConfig } from 'vitest/config';
import {
  cloudflarePool,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      globals: true,
      include: ['test/workers/**/*.test.ts'],
      pool: cloudflarePool({
        wrangler: {
          configPath: './wrangler.toml',
        },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['src/types.ts'],
      },
    },
  };
});
