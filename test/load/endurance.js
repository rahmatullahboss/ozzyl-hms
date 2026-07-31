/**
 * k6 Endurance Test -- Long-Running Soak Test
 *
 * Sustained load at 20 VUs for 30 minutes to detect memory leaks,
 * connection pool exhaustion, and gradual performance degradation.
 * Hits random HMS endpoints to simulate realistic mixed traffic.
 *
 * Usage:
 *   k6 run test/load/endurance.js
 *   k6 run test/load/endurance.js --env BASE_URL=https://your-worker.workers.dev
 *
 * Note: This test runs for ~31 minutes. Use --duration to override for quick checks:
 *   k6 run test/load/endurance.js --duration 2m
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom metrics ─────────────────────────────────────────────────────────

const errorRate = new Rate('endurance_errors');
const responseDuration = new Trend('endurance_response_duration', true);
const totalRequests = new Counter('endurance_total_requests');

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

export const options = {
  thresholds: {
    http_req_duration:            ['p(95)<500', 'p(99)<1000'],   // p95 < 500ms, p99 < 1s
    endurance_errors:             ['rate<0.05'],                  // <5% error rate
    endurance_response_duration:  ['p(95)<500', 'p(99)<1000'],
  },
  scenarios: {
    endurance: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s',  target: 20 },      // ramp up
        { duration: '30m',  target: 20 },      // sustained load for 30 minutes
        { duration: '30s',  target: 0 },       // ramp down
      ],
    },
  },
};

// ─── Endpoint pool ──────────────────────────────────────────────────────────

const ENDPOINTS = [
  { url: '/api/dashboard',                  label: 'Dashboard' },
  { url: '/api/patients?page=1&limit=20',   label: 'Patients' },
  { url: '/api/appointments',               label: 'Appointments' },
  { url: '/api/billing?page=1',             label: 'Billing' },
  { url: '/api/pharmacy/medicines',          label: 'Pharmacy' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

function randomEndpoint() {
  return ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
}

// ─── Default function (runs per VU iteration) ───────────────────────────────

export default function () {
  const endpoint = randomEndpoint();
  const url = `${BASE_URL}${endpoint.url}`;

  const res = http.get(url, { headers: headers() });

  responseDuration.add(res.timings.duration);
  totalRequests.add(1);

  const ok = check(res, {
    [`${endpoint.label} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${endpoint.label} body is JSON`]: (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
    [`${endpoint.label} response < 1s`]: (r) => r.timings.duration < 1000,
  });

  errorRate.add(!ok);

  // Realistic think-time between requests (0.5-1.5s)
  sleep(Math.random() * 1.0 + 0.5);
}
