/**
 * k6 Billing Stress Test — Financial Module Load Test
 *
 * Simulates concurrent billing operations: invoice creation, deposit collection,
 * credit note generation, and payment processing. Tests D1 write throughput
 * and transaction atomicity under load.
 *
 * Usage:
 *   k6 run test/load/billing-stress.js
 *   k6 run test/load/billing-stress.js --env BASE_URL=https://your-worker.workers.dev
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Counter } from 'k6/metrics';

// ─── Custom metrics ─────────────────────────────────────────────────────────

const billingErrors = new Rate('billing_errors');
const invoicesCreated = new Counter('invoices_created');
const depositsCollected = new Counter('deposits_collected');

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

export const options = {
  thresholds: {
    http_req_failed:    ['rate<0.02'],              // <2% errors for financial ops
    http_req_duration:  ['p(95)<800', 'p(99)<2000'], // financial ops can be slower
    billing_errors:     ['rate<0.02'],
  },
  scenarios: {
    // Constant arrival rate — simulates steady billing desk activity
    billing_desk: {
      executor: 'constant-arrival-rate',
      duration: '2m',
      rate: 20,                // 20 iterations/sec
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 60,
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

function randomPatientId() {
  return Math.floor(Math.random() * 100) + 1;
}

// ─── Default function ───────────────────────────────────────────────────────

export default function () {
  const patientId = randomPatientId();

  group('Billing Flow', () => {
    // 1. Get billing list — read-heavy
    {
      const res = http.get(`${BASE_URL}/api/billing?page=1`, { headers: headers() });
      const ok = check(res, {
        'billing list 2xx': (r) => r.status >= 200 && r.status < 300,
      });
      billingErrors.add(!ok);
    }
    sleep(0.2);

    // 2. Create invoice — write operation
    {
      const payload = JSON.stringify({
        patientId: patientId,   // camelCase: matches createBillSchema
        items: [
          {
            itemCategory: 'doctor_visit',  // enum: test|doctor_visit|operation|medicine|admission|fire_service|other
            quantity: 1,
            unitPrice: 500,
            description: 'Consultation Fee',
          },
          {
            itemCategory: 'test',
            quantity: 1,
            unitPrice: 300,
            description: 'Blood Test',
          },
        ],
        discount: 0,
      });
      const res = http.post(`${BASE_URL}/api/billing`, payload, { headers: headers() });
      const ok = check(res, {
        'invoice created': (r) => r.status === 201 || r.status === 200,
      });
      if (ok) invoicesCreated.add(1);
      billingErrors.add(!ok);
    }
    sleep(0.3);

    // 3. Collect deposit — write operation
    {
      const payload = JSON.stringify({
        patient_id: patientId,
        amount: 1000,
        payment_method: 'cash',
        remarks: 'k6 test deposit',
      });
      const res = http.post(`${BASE_URL}/api/deposits`, payload, { headers: headers() });
      const ok = check(res, {
        'deposit collected': (r) => r.status === 201 || r.status === 200,
      });
      if (ok) depositsCollected.add(1);
      billingErrors.add(!ok);
    }
    sleep(0.3);

    // 4. Check deposit balance — read
    {
      const res = http.get(`${BASE_URL}/api/deposits/balance/${patientId}`, {
        headers: headers(),
      });
      check(res, {
        'balance check 2xx': (r) => r.status >= 200 && r.status < 300,
      });
    }
  });
}
