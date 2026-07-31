/**
 * k6 Stress Test — HMS SaaS
 * Goal: Find the breaking point — push beyond normal load to identify limits
 *
 * ⚠️ Run against staging only, NEVER production!
 *
 * Run: k6 run load-tests/k6-stress.js \
 *        -e BASE_URL=https://api.staging.hmssaas.workers.dev \
 *        -e AUTH_TOKEN=<jwt>
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time_ms');

export const options = {
  stages: [
    { duration: '2m',  target: 50  },  // Ramp to normal load
    { duration: '5m',  target: 100 },  // Ramp to 2x load
    { duration: '5m',  target: 200 },  // Ramp to 4x load (stress)
    { duration: '5m',  target: 300 },  // Push to edge
    { duration: '2m',  target: 0   },  // Recovery
  ],
  thresholds: {
    http_req_duration: ['p(95)<10000'],  // Accept up to 10s under stress
    http_req_failed: ['rate<0.10'],      // Alert if error rate > 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const TENANT = __ENV.TENANT_SUBDOMAIN || 'staging';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  'X-Tenant-Subdomain': TENANT,
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

export default function () {
  // Health check (always measure)
  const healthRes = http.get(`${BASE_URL}/health`);
  const healthOk = check(healthRes, {
    'health: 200': (r) => r.status === 200,
    'health: response < 5s': (r) => r.timings.duration < 5000,
  });
  errorRate.add(!healthOk);
  responseTime.add(healthRes.timings.duration);
  sleep(0.3);

  // Patient list (read-heavy)
  const patientsRes = http.get(`${BASE_URL}/api/patients?limit=20`, { headers });
  const patientsOk = check(patientsRes, {
    'patients: 200': (r) => r.status === 200 || r.status === 429, // 429 = rate limited (acceptable)
  });
  errorRate.add(!patientsOk);
  responseTime.add(patientsRes.timings.duration);
  sleep(0.5);

  // Billing ledger (write-adjacent read)
  const billingRes = http.get(`${BASE_URL}/api/billing?status=open`, { headers });
  check(billingRes, {
    'billing: not 5xx': (r) => r.status < 500,
  });
  responseTime.add(billingRes.timings.duration);
  sleep(0.5);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  const errRate = data.metrics.http_req_failed.values.rate;
  console.log(`\n=== Stress Test Summary ===`);
  console.log(`p95 response time: ${Math.round(p95)}ms`);
  console.log(`Error rate: ${(errRate * 100).toFixed(2)}%`);
  console.log(`Peak VUs: ${data.metrics.vus.values.max}`);
  if (errRate > 0.05) {
    console.log('⚠️  ERROR RATE EXCEEDED 5% — review system capacity');
  }
  if (p95 > 5000) {
    console.log('⚠️  p95 LATENCY EXCEEDED 5s — consider scaling worker instances');
  }
  return {};
}
