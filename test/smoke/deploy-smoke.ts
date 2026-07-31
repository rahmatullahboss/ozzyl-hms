/**
 * Post-Deploy Smoke Test — Hit Live Worker URL
 *
 * Run AFTER deploying to validate the Worker is alive and serving correctly.
 * Tests critical endpoints with real HTTP requests (no mocks).
 *
 * Usage:
 *   BASE_URL=https://ozzyl-hms.your-subdomain.workers.dev npx tsx test/smoke/deploy-smoke.ts
 *   npm run test:smoke:deploy  (uses BASE_URL env var)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
const TIMEOUT_MS = 10_000;

interface SmokeResult {
  endpoint: string;
  method: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const results: SmokeResult[] = [];
let failed = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function smoke(
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; expectedStatus?: number },
): Promise<void> {
  const url = `${BASE_URL}${path}`;
  const expectedStatus = opts?.expectedStatus ?? 200;
  const start = Date.now();

  try {
    const fetchOpts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    if (opts?.body) {
      fetchOpts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, fetchOpts);
    const latencyMs = Date.now() - start;
    const ok = res.status === expectedStatus;

    results.push({ endpoint: `${method} ${path}`, method, status: res.status, ok, latencyMs });

    if (!ok) {
      failed++;
      console.error(`  ✗ ${method} ${path} — expected ${expectedStatus}, got ${res.status} (${latencyMs}ms)`);
    } else {
      console.log(`  ✓ ${method} ${path} — ${res.status} (${latencyMs}ms)`);
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    failed++;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ endpoint: `${method} ${path}`, method, status: 0, ok: false, latencyMs, error });
    console.error(`  ✗ ${method} ${path} — NETWORK ERROR: ${error} (${latencyMs}ms)`);
  }
}

// ─── Smoke Test Suite ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n🔥 Ozzyl HMS Deploy Smoke Test`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Time:   ${new Date().toISOString()}\n`);

  // 1. Health / root — Worker is alive
  console.log('─── Worker Health ───');
  await smoke('GET', '/');

  // 2. Auth — login endpoint exists (should return 400 for missing body, not 500)
  console.log('\n─── Auth ───');
  await smoke('POST', '/api/auth/login', { body: {}, expectedStatus: 400 });

  // 3. Core read endpoints (should return 401 without auth, not 500)
  console.log('\n─── Core Endpoints (expect 401 without auth) ───');
  await smoke('GET', '/api/patients', { expectedStatus: 401 });
  await smoke('GET', '/api/dashboard', { expectedStatus: 401 });
  await smoke('GET', '/api/appointments', { expectedStatus: 401 });
  await smoke('GET', '/api/billing', { expectedStatus: 401 });
  await smoke('GET', '/api/pharmacy', { expectedStatus: 401 });
  await smoke('GET', '/api/lab', { expectedStatus: 401 });
  await smoke('GET', '/api/admissions', { expectedStatus: 401 });
  await smoke('GET', '/api/emergency', { expectedStatus: 401 });
  await smoke('GET', '/api/deposits', { expectedStatus: 401 });

  // 4. Non-existent route — should 404 or 401 (auth may run before routing), not 500
  console.log('\n─── Error Handling ───');
  await smoke('GET', '/api/this-route-does-not-exist', { expectedStatus: 401 });

  // ─── Summary ────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Total:  ${results.length} checks`);
  console.log(`  Passed: ${results.length - failed}`);
  console.log(`  Failed: ${failed}`);

  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);
  const maxLatency = Math.max(...results.map((r) => r.latencyMs));
  console.log(`  Avg latency: ${avgLatency}ms`);
  console.log(`  Max latency: ${maxLatency}ms`);
  console.log('═══════════════════════════════════════════════\n');

  if (failed > 0) {
    console.error(`❌ ${failed} smoke check(s) FAILED — deployment may be broken!\n`);
    process.exit(1);
  } else {
    console.log('✅ All smoke checks passed — deployment looks healthy!\n');
  }
}

main().catch((err) => {
  console.error('Fatal smoke test error:', err);
  process.exit(2);
});
