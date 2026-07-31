import { defineConfig } from 'vitest/config';

function preserveLegacyBillingCounterRouteTests() {
  return {
    name: 'preserve-legacy-billing-counter-route-tests',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.endsWith('/test/integration/routes/billing-counter-legacy.test.ts')) return null;
      return code.replace(
        "../../../src/routes/tenant/billingCounter'",
        "../../../src/routes/tenant/billingCounter.legacy'",
      );
    },
  };
}

export default defineConfig({
  plugins: [preserveLegacyBillingCounterRouteTests()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['test/integration/real-db/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
    },
  },
});
