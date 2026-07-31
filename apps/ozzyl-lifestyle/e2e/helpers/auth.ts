import { Page, Route } from '@playwright/test';

/**
 * E2E Auth Helpers — for Ozzyl HMS web/ app
 * Routes: /h/:slug/*   Token key: hms_token   Vite port: 5174
 */

export const SLUG = 'demo-hospital';
export const BASE_SLUG_PATH = `/h/${SLUG}`;

export type HMSRole =
  | 'hospital_admin'
  | 'reception'
  | 'md'
  | 'director'
  | 'laboratory'
  | 'pharmacist'
  | 'super_admin';

const ROLE_DEST: Record<HMSRole, string> = {
  hospital_admin: 'dashboard',
  reception: 'reception/dashboard',
  md: 'md/dashboard',
  director: 'director/dashboard',
  laboratory: 'lab/dashboard',
  pharmacist: 'pharmacy/dashboard',
  super_admin: '/super-admin/dashboard',
};

export const roleUsers: Record<HMSRole, object> = {
  hospital_admin: { id: 1, name: 'Admin User', email: 'admin@demo.com', role: 'hospital_admin' },
  reception: { id: 2, name: 'Reception User', email: 'reception@demo.com', role: 'reception' },
  md: { id: 3, name: 'MD User', email: 'md@demo.com', role: 'md' },
  director: { id: 4, name: 'Director User', email: 'director@demo.com', role: 'director' },
  laboratory: { id: 5, name: 'Lab User', email: 'lab@demo.com', role: 'laboratory' },
  pharmacist: { id: 6, name: 'Pharmacist User', email: 'pharma@demo.com', role: 'pharmacist' },
  super_admin: { id: 99, name: 'Super Admin', email: 'super@hms.com', role: 'super_admin' },
};

/**
 * Log in as a given role by:
 * 1. Generating a structurally-valid JWT inside the browser (where btoa exists)
 * 2. Storing it as hms_token in localStorage
 * 3. Mocking /api/auth/me with the role user
 * 4. Navigating to the role's dashboard (or a custom path)
 */
export async function loginAs(
  page: Page,
  role: HMSRole,
  customPath?: string
) {
  const user = roleUsers[role] as { id: number; email: string; role: string };

  // Mock auth/me so any fetch to /api/auth/me returns the user
  await page.route('**/api/auth/me', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    });
  });

  // Navigate to a neutral page first so we can set localStorage
  await page.goto('/login');

  // Generate JWT and inject auth token inside the browser context
  // (btoa is natively available in the browser)
  await page.evaluate(
    ({ userId, userRole, slug }: { userId: string; userRole: string; slug: string }) => {
      const b64url = (obj: object) =>
        btoa(JSON.stringify(obj))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = {
        userId,
        role: userRole,
        tenantId: slug,
        permissions: ['*'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };
      const token = `${b64url(header)}.${b64url(payload)}.fake-sig`;
      localStorage.setItem('hms_token', token);
      localStorage.setItem('hms_slug', slug);
    },
    { userId: String(user.id), userRole: user.role, slug: SLUG }
  );

  // Determine target URL
  let targetPath: string;
  if (customPath) {
    targetPath = customPath;
  } else if (role === 'super_admin') {
    targetPath = '/super-admin/dashboard';
  } else {
    targetPath = `${BASE_SLUG_PATH}/${ROLE_DEST[role]}`;
  }

  await page.goto(targetPath);
}

/**
 * Mock a GET API endpoint with fixture data.
 */
export async function mockGet(
  page: Page,
  urlPattern: string | RegExp,
  responseData: unknown,
  status = 200
) {
  await page.route(urlPattern, (route: Route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(responseData),
      });
    } else {
      route.continue();
    }
  });
}

/**
 * Mock POST/PUT/PATCH/DELETE endpoints.
 */
export async function mockMutation(
  page: Page,
  urlPattern: string | RegExp,
  responseData: unknown,
  status = 200
) {
  await page.route(urlPattern, (route: Route) => {
    const method = route.request().method();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(responseData),
      });
    } else {
      route.continue();
    }
  });
}

// ── Fixture Data ─────────────────────────────────────────────────────────────

export const fixtures = {
  patients: {
    patients: [
      {
        id: 1, patient_code: 'P-000001', name: 'Rahim Uddin',
        father_husband: 'Karim Uddin', address: 'Dhaka', mobile: '01711000001',
        guardian_mobile: '', blood_group: 'A+', created_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 2, patient_code: 'P-000002', name: 'Farida Begum',
        father_husband: 'Jamal Hossain', address: 'Chittagong', mobile: '01711000002',
        guardian_mobile: '', blood_group: 'B+', created_at: '2025-01-02T00:00:00Z',
      },
    ],
    total: 2,
  },
  emptyPatients: { patients: [], total: 0 },
  staff: {
    staff: [
      { id: 1, name: 'Dr. Ahmed', role: 'doctor', department: 'Medicine', is_active: 1, basic_salary: 50000 },
      { id: 2, name: 'Nurse Rima', role: 'nurse', department: 'ICU', is_active: 1, basic_salary: 20000 },
    ],
  },
  billing: {
    bills: [
      {
        id: 1, invoice_number: 'INV-000001', patient_name: 'Rahim Uddin',
        total_amount: 5500, paid_amount: 5500, due_amount: 0,
        status: 'paid', created_at: '2025-01-01',
      },
    ],
    total: 1,
    summary: { total_billed: 5500, total_collected: 5500, total_due: 0 },
  },
  income: {
    income: [
      { id: 1, amount: 5000, source: 'billing', description: 'Patient bill', date: '2025-01-01', account: 'General' },
    ],
    total: 5000,
  },
  expenses: {
    expenses: [
      { id: 1, amount: 2000, category: 'salary', description: 'Staff salary', date: '2025-01-01', account: 'General' },
    ],
    total: 2000,
  },
  medicines: {
    medicines: [
      { id: 1, name: 'Paracetamol 500mg', category: 'Analgesic', unit: 'pcs', reorder_level: 100, quantity: 500, purchase_price: 2, selling_price: 3 },
      { id: 2, name: 'Amoxicillin', category: 'Antibiotic', unit: 'pcs', reorder_level: 50, quantity: 200, purchase_price: 5, selling_price: 8 },
    ],
  },
  labTests: {
    tests: [
      { id: 1, name: 'CBC', category: 'Hematology', price: 500, is_active: 1 },
      { id: 2, name: 'Blood Glucose (Fasting)', category: 'Biochemistry', price: 300, is_active: 1 },
      { id: 3, name: 'Urine R/E', category: 'Microbiology', price: 200, is_active: 1 },
    ],
  },
  shareholders: {
    shareholders: [
      { id: 1, name: 'Dr. Islam', shares: 40, email: 'islam@demo.com' },
      { id: 2, name: 'Mrs. Rahman', shares: 60, email: 'rahman@demo.com' },
    ],
  },
  accountingDashboard: {
    summary: { total_income: 100000, total_expense: 40000, net_profit: 60000 },
    recent_income: [],
    recent_expenses: [],
  },
  admissions: {
    admissions: [
      { id: 1, patient_name: 'Rahim Uddin', bed_number: 'A-101', admission_date: '2025-01-10', status: 'admitted' },
    ],
  },
  beds: {
    beds: [
      { id: 1, bed_number: 'A-101', ward: 'General', status: 'occupied' },
      { id: 2, bed_number: 'A-102', ward: 'General', status: 'available' },
    ],
  },
  appointments: {
    appointments: [
      {
        id: 1, patient_name: 'Farida Begum', doctor_name: 'Dr. Ahmed',
        date: '2025-01-15', time: '10:00', status: 'confirmed',
      },
    ],
  },
};
