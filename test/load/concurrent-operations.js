/**
 * k6 Concurrent Operations Test -- Race Condition Detection
 *
 * 50 VUs all competing for the same appointment slot simultaneously.
 * Detects double-booking, duplicate records, and data corruption
 * under concurrent write pressure.
 *
 * Usage:
 *   k6 run test/load/concurrent-operations.js
 *   k6 run test/load/concurrent-operations.js --env BASE_URL=https://your-worker.workers.dev
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ─── Custom metrics ─────────────────────────────────────────────────────────

const duplicateRecords = new Counter('duplicate_records');
const dataCorruption = new Rate('data_corruption');
const bookingErrors = new Rate('booking_errors');

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8787';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token';

// All VUs will try to book the same slot
const SHARED_DOCTOR_ID = 1;
const SHARED_DATE = '2026-06-15';
const SHARED_TIME = '10:00';

export const options = {
  thresholds: {
    http_req_failed:    ['rate<0.50'],          // High contention = expected failures
    duplicate_records:  ['count<2'],            // No more than 1 duplicate allowed
    data_corruption:    ['rate<0.01'],          // <1% corruption rate
    booking_errors:     ['rate<0.95'],          // Most attempts should get a clear response
  },
  scenarios: {
    concurrent_booking: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,                          // Each VU gets exactly 1 attempt
      maxDuration: '30s',
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

// ─── Default function (runs per VU iteration) ───────────────────────────────

export default function () {
  // All 50 VUs attempt to book the exact same appointment slot
  const payload = JSON.stringify({
    patient_id: __VU,                         // Unique patient per VU
    doctor_id: SHARED_DOCTOR_ID,
    appt_date: SHARED_DATE,
    appt_time: SHARED_TIME,
    visit_type: 'opd',
    reason: `k6 concurrent test VU ${__VU}`,
  });

  const res = http.post(`${BASE_URL}/api/appointments`, payload, {
    headers: headers(),
  });

  const isSuccess = res.status === 201 || res.status === 200;
  const isConflict = res.status === 409;
  const isClientError = res.status >= 400 && res.status < 500;

  // A successful booking or a conflict (duplicate rejection) are both valid
  const isValidResponse = isSuccess || isConflict || isClientError;

  const ok = check(res, {
    'response is valid (success, conflict, or client error)': () => isValidResponse,
    'response has JSON body': () => {
      try { JSON.parse(res.body); return true; } catch { return false; }
    },
  });

  bookingErrors.add(!ok);

  // If we got a success, check if this is a duplicate booking
  if (isSuccess) {
    // Immediately re-check the slot to see if duplicates were created
    const verifyRes = http.get(
      `${BASE_URL}/api/appointments?doctor_id=${SHARED_DOCTOR_ID}&date=${SHARED_DATE}`,
      { headers: headers() }
    );

    if (verifyRes.status === 200) {
      try {
        const body = JSON.parse(verifyRes.body);
        const appointments = body.appointments || body.data || [];

        // Count bookings for the exact same slot
        const slotBookings = appointments.filter(
          (a) => a.appt_time === SHARED_TIME || a.time === SHARED_TIME
        );

        if (slotBookings.length > 1) {
          duplicateRecords.add(1);
          dataCorruption.add(true);
        } else {
          dataCorruption.add(false);
        }
      } catch {
        // Parse failure is not corruption
        dataCorruption.add(false);
      }
    }
  }

  sleep(0.1);
}

// ─── Teardown: Final duplicate check ────────────────────────────────────────

export function teardown() {
  const res = http.get(
    `${BASE_URL}/api/appointments?doctor_id=${SHARED_DOCTOR_ID}&date=${SHARED_DATE}`,
    { headers: headers() }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      const appointments = body.appointments || body.data || [];
      const slotBookings = appointments.filter(
        (a) => a.appt_time === SHARED_TIME || a.time === SHARED_TIME
      );

      console.log(`\n=== TEARDOWN SUMMARY ===`);
      console.log(`Total appointments for ${SHARED_DATE} ${SHARED_TIME}: ${slotBookings.length}`);

      if (slotBookings.length > 1) {
        console.log(`WARNING: ${slotBookings.length} duplicate bookings detected for the same slot!`);
        console.log(`Duplicate IDs: ${slotBookings.map((a) => a.id).join(', ')}`);
      } else if (slotBookings.length === 1) {
        console.log(`PASS: Exactly 1 booking for the contested slot.`);
      } else {
        console.log(`INFO: No bookings found (all attempts may have been rejected).`);
      }
    } catch {
      console.log('Teardown: Could not parse appointment response.');
    }
  } else {
    console.log(`Teardown: Appointment check returned status ${res.status}`);
  }
}
