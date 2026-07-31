/**
 * k6 API Load Test — Core HMS Endpoints
 *
 * Tests critical API endpoints under ramping load (10 → 50 → 100 VUs).
 * Validates response times, error rates, and throughput thresholds.
 *
 * Usage:
 *   k6 run test/load/api-load.js
 *   k6 run test/load/api-load.js --env BASE_URL=https://your-worker.workers.dev
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ─────────────────────────────────────────────────────────

const errorRate = new Rate('hms_errors');
const patientListDuration = new Trend('hms_patient_list_duration', true);
const dashboardDuration = new Trend('hms_dashboard_duration', true);

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

export const options = {
  thresholds: {
    http_req_failed:    [{ threshold: 'rate<0.05', abortOnFail: true }], // <5% errors
    http_req_duration:  ['p(95)<500', 'p(99)<1000'],                     // p95 <500ms, p99 <1s
    hms_errors:         ['rate<0.05'],
  },
  scenarios: {
    // Smoke → Average → Peak load progression
    api_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },   // warm up
        { duration: '30s', target: 10 },   // smoke
        { duration: '15s', target: 50 },   // ramp to average
        { duration: '60s', target: 50 },   // sustained average
        { duration: '15s', target: 100 },  // ramp to peak
        { duration: '30s', target: 100 },  // sustained peak
        { duration: '15s', target: 0 },    // ramp down
      ],
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

function checkResponse(res, label) {
  const ok = check(res, {
    [`${label} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label} body is JSON`]:  (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });
  errorRate.add(!ok);
  return ok;
}

// ─── Default function (runs per VU iteration) ───────────────────────────────

export default function () {
  // 1. Dashboard KPIs — most frequently hit endpoint
  {
    const res = http.get(`${BASE_URL}/api/dashboard`, { headers: headers() });
    dashboardDuration.add(res.timings.duration);
    checkResponse(res, 'Dashboard');
  }
  sleep(0.5);

  // 2. Patient list — paginated, high-traffic
  {
    const res = http.get(`${BASE_URL}/api/patients?page=1&limit=20`, { headers: headers() });
    patientListDuration.add(res.timings.duration);
    checkResponse(res, 'Patient List');
  }
  sleep(0.3);

  // 3. Appointments list
  {
    const res = http.get(`${BASE_URL}/api/appointments`, { headers: headers() });
    checkResponse(res, 'Appointments');
  }
  sleep(0.3);

  // 4. Pharmacy stock
  {
    const res = http.get(`${BASE_URL}/api/pharmacy/medicines`, { headers: headers() });
    checkResponse(res, 'Pharmacy');
  }
  sleep(0.3);

  // 5. Lab orders
  {
    const res = http.get(`${BASE_URL}/api/lab`, { headers: headers() });
    checkResponse(res, 'Lab');
  }
  sleep(0.5);
}
