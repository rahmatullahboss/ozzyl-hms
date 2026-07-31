/**
 * k6 Smoke Test — HMS SaaS
 * Goal: Verify the system works under a minimal load (5 VUs, 1 minute)
 * Run: k6 run load-tests/k6-smoke.js -e BASE_URL=https://api.hmssaas.workers.dev
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time_ms');

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests < 2s
    http_req_failed: ['rate<0.01'],     // Error rate < 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const TENANT = __ENV.TENANT_SUBDOMAIN || 'demo';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  'X-Tenant-Subdomain': TENANT,
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

export default function () {
  // 1. Health check
  {
    const res = http.get(`${BASE_URL}/health`);
    const ok = check(res, {
      'health: status 200': (r) => r.status === 200,
      'health: has db_status': (r) => JSON.parse(r.body).db_status !== undefined,
    });
    errorRate.add(!ok);
    responseTime.add(res.timings.duration);
  }

  sleep(0.5);

  // 2. Patient list
  {
    const res = http.get(`${BASE_URL}/api/patients`, { headers });
    const ok = check(res, {
      'patients: status 200': (r) => r.status === 200,
      'patients: has array': (r) => Array.isArray(JSON.parse(r.body).patients),
    });
    errorRate.add(!ok);
    responseTime.add(res.timings.duration);
  }

  sleep(0.5);

  // 3. Billing list
  {
    const res = http.get(`${BASE_URL}/api/billing`, { headers });
    const ok = check(res, { 'billing: status 200': (r) => r.status === 200 });
    errorRate.add(!ok);
    responseTime.add(res.timings.duration);
  }

  sleep(1);
}
