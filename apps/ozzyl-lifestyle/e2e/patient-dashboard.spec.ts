import { test, expect, type Page, type Route } from '@playwright/test';

async function mockJson(page: Page, urlPattern: string | RegExp, body: unknown, method = 'GET', status = 200) {
  await page.route(urlPattern, async (route: Route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function setupPatientDashboardMocks(page: Page) {
  await mockJson(page, '**/api/patient-auth/me', {
    user: {
      id: 1,
      name: 'Rahim Uddin',
      email: 'rahim@example.com',
      phone: '01711000000',
      national_id: '1234567890',
      uhid: 'OZ-000123',
    },
  });

  await mockJson(page, '**/api/global-portal/dashboard', {
    hospitalsCount: 2,
    appointments: [
      {
        id: 1,
        hospital_name: 'City Hospital',
        doctor_name: 'Dr Ahmed',
        appointment_date: '2026-04-15',
        appointment_time: '10:00',
        status: 'booked',
      },
    ],
    prescriptions: [
      {
        id: 1,
        hospital_name: 'City Hospital',
        doctor_name: 'Dr Ahmed',
        date: '2026-04-10',
      },
    ],
    bills: [
      {
        id: 1,
        hospital_name: 'City Hospital',
        bill_date: '2026-04-10',
        grand_total: 2500,
        payment_status: 'paid',
      },
    ],
    patient_guidance: {
      headline: 'Follow-up needed',
      status: 'watch',
      summary: 'You have one hospital follow-up coming up.',
      what_changed: ['New prescription added'],
      next_steps: ['Carry your latest prescription'],
      trust_notes: ['1 item still pending doctor review'],
      care_reminders: ['Create a visit pass before your next visit'],
      counts: {
        pending_review_items: 1,
        verified_items: 4,
        vault_documents: 2,
        active_visit_pass: 1,
      },
    },
  });

  await mockJson(page, '**/api/global-portal/hospitals', {
    hospitals: [
      { tenantId: 'tenant-1', patientId: 10, hospitalName: 'City Hospital' },
      { tenantId: 'tenant-2', patientId: 11, hospitalName: 'Metro Clinic' },
    ],
  });

  await mockJson(page, '**/api/global-portal/family', {
    managed_profiles: [
      { identity_id: 77, name: 'Child One', relationship: 'child', hospitals_count: 1 },
    ],
    risk_overview: {
      status: 'watch',
      headline: 'Family risk watch active',
      insights: [
        { label: 'Diabetes', severity: 'watch', rationale: 'Family history suggests earlier screening.' },
      ],
    },
  });

  await mockJson(page, '**/api/global-portal/visit-pass', {
    active_pass: {
      id: 1,
      pass_code: 'VP-ABCD12',
      expires_at: '2026-04-20T00:00:00.000Z',
    },
    history: [],
  });

  await mockJson(page, '**/api/global-health/access-log', {
    access_log: [
      {
        id: 1,
        access_type: 'portal_view',
        source_hospital: 'City Hospital',
        accessing_hospital: 'City Hospital',
        accessed_at: '2026-04-10T10:00:00.000Z',
      },
    ],
  });
  await mockJson(page, '**/api/global-health/block', {
    id: 1,
    message: 'Access blocked successfully',
  }, 'POST', 200);

  await mockJson(page, '**/api/patient-phr/vault', {
    documents: [
      {
        id: 1,
        document_url: '/api/patient-phr/vault/1/file',
        document_type: 'prescription',
        document_date: '2026-04-01',
        title: 'April Prescription',
        notes: 'Uploaded copy',
        entered_at: '2026-04-01T08:00:00.000Z',
        source_kind: 'uploaded_file',
      },
    ],
  });

  await mockJson(page, '**/api/patient-phr/reported-data', {
    reported_data: [
      {
        id: 1,
        category: 'allergy',
        name: 'Penicillin',
        severity: 'moderate',
        clinical_status: 'active',
        verification_status: 'pending_review',
        start_date: null,
        notes: 'Reported by patient',
        created_at: '2026-04-10T00:00:00.000Z',
      },
    ],
  });

  await mockJson(page, '**/api/patient-phr/adverse-reactions', {
    adverse_reactions: [
      {
        id: 1,
        medication_name: 'Ibuprofen',
        generic_name: 'Ibuprofen',
        reaction: 'Acidity',
        severity: 'mild',
        onset_date: '2026-04-08',
        outcome_status: 'recovering',
        notes: 'Improved after stopping',
        source: 'patient_reported',
        review_status: 'pending_review',
        reviewed_at: null,
        review_notes: null,
        created_at: '2026-04-08T00:00:00.000Z',
      },
    ],
  });

  await mockJson(page, '**/api/patient-phr/lifestyle-logs', {
    lifestyle_logs: [
      {
        id: 1,
        logged_on: '2026-04-09',
        sleep_hours: 6,
        exercise_minutes: 30,
        mood: 'good',
        energy_level: 'steady',
        symptom_score: 1,
        symptoms: null,
        diet_notes: 'Low sugar',
        notes: null,
        source: 'patient_reported',
        review_status: 'pending_review',
        reviewed_at: null,
        review_notes: null,
        created_at: '2026-04-09T00:00:00.000Z',
      },
    ],
  });

  await mockJson(page, '**/api/patient-phr/vitals', {
    vitals: [
      {
        id: 1,
        logged_on: '2026-04-09',
        systolic: 120,
        diastolic: 80,
        heart_rate: 76,
        blood_sugar: 6.1,
        blood_sugar_context: 'random',
      },
    ],
  });

  await mockJson(page, '**/api/patient-portal/dashboard', {
    nextAppointment: {
      id: 2,
      appt_date: '2026-04-15',
      appt_time: '10:30',
      doctor_name: 'Dr Ahmed',
    },
    latestLabResult: {
      id: 4,
      order_no: 'LAB-1004',
      created_at: '2026-04-10T00:00:00.000Z',
      status: 'completed',
      test_names: 'CBC, HbA1c',
    },
    activePrescriptions: 1,
    billing: {
      totalDue: 0,
      totalPaid: 2500,
      totalBilled: 2500,
    },
    totalVisits: 4,
  });

  await mockJson(page, '**/api/patient-portal/live-visit-status', {
    live_visit: {
      status: 'waiting',
      current_serving_token_no: 'T009',
      patients_ahead: 2,
      estimated_wait_minutes: 18,
      arrival_guidance: {
        action: 'arrive_soon',
        label: 'Please arrive soon. Your turn is getting closer.',
      },
      appointment: {
        id: 2,
        appt_date: '2026-04-15',
        appt_time: '10:30',
        doctor_name: 'Dr Ahmed',
      },
      queue: {
        id: 7,
        token_no: 'T012',
        token_number: 12,
        status: 'waiting',
        counter_no: 'Room 3',
      },
    },
  });

  await mockJson(page, '**/api/patient-portal/appointments?limit=5', {
    data: [{ id: 1, appt_date: '2026-04-15', doctor_name: 'Dr Ahmed', chief_complaint: 'Follow-up' }],
  });
  await mockJson(page, '**/api/patient-portal/prescriptions?limit=5', {
    data: [{ id: 1, rx_no: 'RX-1001', doctor_name: 'Dr Ahmed', diagnosis: 'Viral fever', created_at: '2026-04-10T00:00:00.000Z' }],
  });
  await mockJson(page, '**/api/patient-portal/lab-results?limit=5', {
    data: [{ id: 4, test_name: 'CBC', result: 'Normal' }],
  });
  await mockJson(page, '**/api/patient-portal/documents?limit=5', {
    data: [{ id: 8, title: 'Discharge Summary', document_type: 'discharge_summary' }],
  });
  await mockJson(page, '**/api/patient-portal/diagnoses?limit=5', {
    data: [{ id: 9, diagnosis_name: 'Hypertension', icd10_code: 'I10', doctor_name: 'Dr Ahmed' }],
  });
  await mockJson(page, '**/api/patient-portal/messages', {
    conversations: [{ doctor_id: 5, doctor_name: 'Dr Ahmed', last_message: 'Please continue medication.' }],
  });
  await mockJson(page, '**/api/patient-portal/reviews/mine', {
    data: [{ id: 3, rating: 5, review_text: 'Very helpful.' }],
  });
  await mockJson(page, '**/api/patient-portal/available-doctors', {
    doctors: [{ id: 5, name: 'Dr Ahmed', specialty: 'Medicine', consultation_fee: 800 }],
  });
}

test.describe('Patient Dashboard', () => {
  test('renders all major tabs without crashes', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await setupPatientDashboardMocks(page);

    await page.goto('/patient/login');
    await page.evaluate(() => {
      localStorage.setItem('global_patient_user', JSON.stringify({
        id: 1,
        name: 'Rahim Uddin',
        email: 'rahim@example.com',
        phone: '01711000000',
        uhid: 'OZ-000123',
      }));
    });

    await page.goto('/patient/dashboard');

    await expect(page.getByRole('heading', { name: 'Rahim Uddin' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /What you should do now/i })).toBeVisible();
    await expect(page.getByText('Do these next')).toBeVisible();
    await expect(page.getByText('Carry your latest prescription')).toBeVisible();

    await page.getByRole('button', { name: 'Hospital Services' }).click();
    await expect(page.getByText('Active Hospital Portal')).toBeVisible();
    await expect(page.getByText('Care Path History')).toBeVisible();

    await page.getByRole('button', { name: 'Global Records' }).click();
    await expect(page.getByText('Connected Hospitals')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'City Hospital' })).toBeVisible();

    await page.getByRole('button', { name: 'My Health Vault' }).click();
    await expect(page.getByText('April Prescription')).toBeVisible();

    await page.getByRole('button', { name: 'Self-Reported Data' }).click();
    await expect(page.getByText('Personal Health Record')).toBeVisible();
    await expect(page.getByText('Penicillin')).toBeVisible();

    await page.getByRole('button', { name: 'Privacy & Access' }).click();
    await expect(page.getByText('Data Access Control')).toBeVisible();
    await expect(page.getByText('Access Audit History')).toBeVisible();

    const fatalErrors = pageErrors.filter((message) => !message.includes('ResizeObserver'));
    expect(fatalErrors).toEqual([]);
  });

  test('redirects unauthenticated users before dashboard tabs can fetch protected data', async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        requestedUrls.push(pathname);
      }
    });

    await page.route('**/api/patient-auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Authentication required' }),
      });
    });

    await page.goto('/patient/dashboard?tab=vault');
    await page.waitForURL('**/patient/login');

    expect(requestedUrls.filter((url) => url === '/api/patient-auth/me').length).toBeGreaterThan(0);
    expect(requestedUrls).not.toContain('/api/global-portal/dashboard');
    expect(requestedUrls).not.toContain('/api/patient-phr/vault');
    expect(requestedUrls).not.toContain('/api/patient-phr/reported-data');
  });

  test('waits for profile bootstrap before loading requested protected tabs', async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        requestedUrls.push(pathname);
      }
    });
    let releaseProfile: (() => void) | null = null;
    let resolveProfileRequest: (() => void) | null = null;
    const profileGate = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const profileRequested = new Promise<void>((resolve) => {
      resolveProfileRequest = resolve;
    });

    await page.route('**/api/patient-auth/me', async (route) => {
      resolveProfileRequest?.();
      await profileGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 1,
            name: 'Rahim Uddin',
            email: 'rahim@example.com',
            phone: '01711000000',
            national_id: '1234567890',
            uhid: 'OZ-000123',
          },
        }),
      });
    });

    await mockJson(page, '**/api/global-portal/dashboard', {
      hospitalsCount: 1,
      appointments: [],
      prescriptions: [],
      bills: [],
      patient_guidance: {
        headline: 'All clear',
        status: 'stable',
        summary: 'No urgent action needed.',
        what_changed: [],
        next_steps: [],
        trust_notes: [],
        care_reminders: [],
        counts: {
          pending_review_items: 0,
          verified_items: 0,
          vault_documents: 0,
          active_visit_pass: 0,
        },
      },
    });

    await mockJson(page, '**/api/patient-phr/vault', { documents: [] });

    const gotoPromise = page.goto('/patient/dashboard?tab=vault');
    await profileRequested;

    expect(requestedUrls).toContain('/api/patient-auth/me');
    expect(requestedUrls).not.toContain('/api/global-portal/dashboard');
    expect(requestedUrls).not.toContain('/api/patient-phr/vault');

    releaseProfile?.();
    await gotoPromise;
    await expect(page.getByText(/My Health Vault|Medical Vault/i)).toBeVisible();

    expect(requestedUrls).toContain('/api/global-portal/dashboard');
    expect(requestedUrls).toContain('/api/patient-phr/vault');
  });
});
