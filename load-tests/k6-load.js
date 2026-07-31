/**
 * k6 Load Test — HMS SaaS
 * Goal: Verify system handles realistic production load (50 concurrent users)
 *
 * Run: k6 run load-tests/k6-load.js \
 *        -e BASE_URL=https://api.hmssaas.workers.dev \
 *        -e AUTH_TOKEN=<jwt>
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time_ms');
const paymentRequests = new Counter('payment_requests');

export const options = {
  stages: [
    { duration: '2m',  target: 10 },  // Ramp up to 10 users
    { duration: '5m',  target: 50 },  // Ramp up to 50 users (peak)
    { duration: '2m',  target: 50 },  // Sustain peak
    { duration: '1m',  target: 0  },  // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],  // p95 < 3s, p99 < 5s
    http_req_failed: ['rate<0.02'],                    // Error rate < 2%
    errors: ['rate<0.02'],
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

/** Simulate a billing staff member's workflow */
function billingFlow() {
  // List outstanding dues
  const dueRes = http.get(`${BASE_URL}/api/billing/due`, { headers });
  check(dueRes, { 'billing/due: 200': (r) => r.status === 200 });
  errorRate.add(dueRes.status !== 200);
  responseTime.add(dueRes.timings.duration);
  sleep(1);
}

/** Simulate a receptionist / nurse workflow */
function receptionFlow() {
  // Search patients
  const searchRes = http.get(`${BASE_URL}/api/patients?search=Ahmed`, { headers });
  check(searchRes, { 'patient search: 200': (r) => r.status === 200 });
  errorRate.add(searchRes.status !== 200);
  responseTime.add(searchRes.timings.duration);
  sleep(0.5);

  // Lab orders
  const labRes = http.get(`${BASE_URL}/api/lab`, { headers });
  check(labRes, { 'lab: 200 or 404': (r) => [200, 404].includes(r.status) });
  responseTime.add(labRes.timings.duration);
  sleep(1);
}

/** Simulate an admin checking reports */
function adminFlow() {
  const dashRes = http.get(`${BASE_URL}/api/accounting/dashboard`, { headers });
  check(dashRes, { 'dashboard: 200': (r) => r.status === 200 });
  errorRate.add(dashRes.status !== 200);
  responseTime.add(dashRes.timings.duration);
  sleep(2);
}

export default function () {
  const scenario = Math.random();
  if (scenario < 0.4) {
    billingFlow();
  } else if (scenario < 0.75) {
    receptionFlow();
  } else {
    adminFlow();
  }
}
