/**
 * k6 Spike Test -- Sudden Traffic Surge Simulation
 *
 * Simulates a sudden 10x traffic spike (10 -> 100 VUs) and verifies
 * the system recovers gracefully. Hits random HMS endpoints to simulate
 * realistic mixed traffic patterns.
 *
 * Usage:
 *   k6 run test/load/spike.js
 *   k6 run test/load/spike.js --env BASE_URL=https://your-worker.workers.dev
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ─────────────────────────────────────────────────────────

const errorRate = new Rate('spike_errors');
const spikeDuration = new Trend('spike_response_duration', true);

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

export const options = {
  thresholds: {
    http_req_duration:  ['p(95)<2000'],         // p95 < 2 seconds
    spike_errors:       ['rate<0.10'],           // <10% error rate
  },
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },        // warm-up to baseline
        { duration: '5s',  target: 100 },        // SPIKE: 10x traffic surge
        { duration: '30s', target: 100 },        // hold at peak
        { duration: '10s', target: 10 },         // recovery ramp-down
        { duration: '10s', target: 0 },          // cool-down to zero
      ],
    },
  },
};

// ─── Endpoint pool ──────────────────────────────────────────────────────────

const ENDPOINTS = [
  '/api/dashboard',
  '/api/patients?page=1&limit=20',
  '/api/appointments',
  '/api/billing?page=1',
  '/api/pharmacy/medicines',
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
  const url = `${BASE_URL}${endpoint}`;

  const res = http.get(url, { headers: headers() });

  spikeDuration.add(res.timings.duration);

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response body is not empty': (r) => r.body && r.body.length > 0,
    'response is JSON': (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  errorRate.add(!ok);

  // Short think-time to simulate realistic browsing
  sleep(Math.random() * 0.5 + 0.1);
}
