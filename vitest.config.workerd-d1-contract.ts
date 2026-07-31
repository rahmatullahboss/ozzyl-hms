import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        d1Databases: ['DB'],
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/workers/cdb101-d1-batch-metadata.test.ts'],
    sequence: {
      concurrent: false,
    },
  },
});
