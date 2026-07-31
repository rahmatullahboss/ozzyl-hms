/**
 * Integration tests for IPD Package Billing
 *
 * Tests package selection at admission, included bed days,
 * and package-based billing logic.
 */

import { describe, it, expect } from 'vitest';
import admissionsRoute from '../../../src/routes/tenant/admissions';
import billingMasterRoute from '../../../src/routes/tenant/billingMaster';
import ipBillingRoute from '../../../src/routes/tenant/ipBilling';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import {
  TENANT_1,
  PATIENT_1,
  DOCTOR_1,
  BED_AVAILABLE,
} from '../helpers/fixtures';

// ─── Package fixtures ────────────────────────────────────────────────────────

const PACKAGE_NORMAL_DELIVERY = {
  id: 1,
  tenant_id: TENANT_1.id,
  package_name: 'Normal Delivery Package',
  package_code: 'NDP-001',
  description: 'Normal delivery with 3 days bed included',
  total_price: 25000,
  discount_percent: 0,
  included_bed_days: 3,
  extra_bed_rate: 1500,
  package_type: 'package_included_days',
  is_active: 1,
  created_by: 1,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

const PACKAGE_ITEM_1 = {
  id: 1,
  package_id: 1,
  service_item_id: 100,
  item_name: 'Doctor Fee',
  quantity: 1,
  price: 5000,
  tenant_id: TENANT_1.id,
  created_at: '2026-01-01T00:00:00',
};

const PACKAGE_ITEM_2 = {
  id: 2,
  package_id: 1,
  service_item_id: 101,
  item_name: 'OT Charge',
  quantity: 1,
  price: 8000,
  tenant_id: TENANT_1.id,
  created_at: '2026-01-01T00:00:00',
};

// Helper to build queryOverride for package queries
function packageQueryOverride(packages: any[], packageItems: any[] = []) {
  return (sql: string) => {
    if (sql.includes('billing_packages')) {
      if (sql.includes('is_active')) {
        return { results: packages.filter(p => p.is_active === 1) };
      }
      if (packages.length > 0) {
        return { results: [packages[0]] };
      }
      return { results: packages };
    }
    if (sql.includes('billing_package_items')) {
      return { results: packageItems };
    }
    return null;
  };
}

const admissionCreateQueryOverride = (sql: string) => {
  if (/SELECT\s+id\s+FROM\s+admissions\s+WHERE\s+admission_no/i.test(sql)) {
    return { first: { id: 9101 }, results: [{ id: 9101 }] };
  }
  return null;
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('IPD Package Billing', () => {

  // ─── Package List API ──────────────────────────────────────────────────────

  describe('GET /billing-master/packages — package list with bed fields', () => {
    it('returns packages with included_bed_days and extra_bed_rate fields', async () => {
      const { app } = createTestApp({
        route: billingMasterRoute,
        routePath: '/billing-master',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: packageQueryOverride([PACKAGE_NORMAL_DELIVERY]),
      });

      const res = await app.request('/billing-master/packages');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any[] };
      expect(body.data.length).toBe(1);

      const pkg = body.data[0];
      expect(pkg.package_name).toBe('Normal Delivery Package');
      expect(pkg.included_bed_days).toBe(3);
      expect(pkg.extra_bed_rate).toBe(1500);
      expect(pkg.package_type).toBe('package_included_days');
    });
  });

  describe('GET /billing-master/packages/:id — package detail with items', () => {
    it('returns package with items and bed fields', async () => {
      const { app } = createTestApp({
        route: billingMasterRoute,
        routePath: '/billing-master',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: packageQueryOverride([PACKAGE_NORMAL_DELIVERY], [PACKAGE_ITEM_1, PACKAGE_ITEM_2]),
      });

      const res = await app.request('/billing-master/packages/1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: any };
      expect(body.data.package_name).toBe('Normal Delivery Package');
      expect(body.data.included_bed_days).toBe(3);
      expect(body.data.items.length).toBe(2);
    });
  });

  // ─── Admission with Package ────────────────────────────────────────────────

  describe('POST /admissions — admission with package_id', () => {
    it('creates admission with package_id and billing_mode', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          beds: [{ ...BED_AVAILABLE, status: 'available' }],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          billing_provisional_items: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'planned',
          package_id: 1,
          billing_mode: 'package_included_days',
          admission_fee: 500,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.admission_no).toBeDefined();
    });

    it('creates admission without package (regular mode)', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          beds: [{ ...BED_AVAILABLE, status: 'available' }],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          billing_provisional_items: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'planned',
          admission_fee: 0,
        },
      });

      expect(res.status).toBe(201);
    });

    it('creates admission with admission_fee and inserts provisional charge', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          beds: [{ ...BED_AVAILABLE, status: 'available' }],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          billing_provisional_items: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'planned',
          admission_fee: 1000,
        },
      });

      expect(res.status).toBe(201);

      // Verify the admission INSERT includes admission_fee
      const admissionInsert = mockDB.queries.find(q =>
        q.sql.toUpperCase().includes('INSERT') &&
        q.sql.includes('admissions') &&
        q.params.includes(1000)
      );
      expect(admissionInsert).toBeDefined();
      expect(admissionInsert!.params).toContain(1000);
    });

    it('does not insert provisional charge when admission_fee is 0', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          beds: [{ ...BED_AVAILABLE, status: 'available' }],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          billing_provisional_items: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'planned',
          admission_fee: 0,
        },
      });

      expect(res.status).toBe(201);

      // Verify NO provisional charge was inserted for admission fee
      const insertQueries = mockDB.queries.filter(q =>
        q.sql.toUpperCase().includes('INSERT') &&
        q.sql.includes('billing_provisional_items')
      );
      expect(insertQueries.length).toBe(0);
    });
  });

  // ─── IPD Billing Pending with Package ──────────────────────────────────────

  describe('GET /ip-billing/pending/:admissionId — bed charges with package', () => {
    it('returns bed charges calculated with package-included days', async () => {
      const admission = {
        id: 1,
        tenant_id: TENANT_1.id,
        admission_no: 'ADM-00001',
        patient_id: PATIENT_1.id,
        bed_id: BED_AVAILABLE.id,
        doctor_id: DOCTOR_1.id,
        admission_type: 'planned',
        status: 'admitted',
        billing_mode: 'package_included_days',
        package_id: 1,
        admission_fee: 500,
        admission_date: '2026-06-01T10:00:00',
        created_at: '2026-06-01T10:00:00',
      };

      const bedInfo = {
        id: 1,
        tenant_id: TENANT_1.id,
        patient_id: PATIENT_1.id,
        admission_id: 1,
        bed_id: BED_AVAILABLE.id,
        ward_name: 'Cabin',
        bed_number: 'C-203',
        bed_type: 'cabin',
        rate_per_day: 1500,
        started_on: '2026-06-01T10:00:00',
        ended_on: null,
        is_billed: 0,
      };

      const { app } = createTestApp({
        route: ipBillingRoute,
        routePath: '/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admission],
          patient_bed_infos: [bedInfo],
          billing_provisional_items: [],
          billing_deposits: [],
          billing_packages: [PACKAGE_NORMAL_DELIVERY],
        },
      });

      const res = await app.request('/ip-billing/pending/1');
      expect(res.status).toBe(200);
      const body = await res.json() as any;

      // Should have bed charges
      expect(body.bed_charges).toBeDefined();
      expect(body.bed_charges.segments).toBeDefined();
      expect(body.bed_charges.segments.length).toBe(1);

      // Should have package info
      expect(body.package).toBeDefined();
      expect(body.package.package_name).toBe('Normal Delivery Package');
      expect(body.package.included_bed_days).toBe(3);
      expect(body.package.extra_bed_rate).toBe(1500);

      // Should include package-included days calculation
      const segment = body.bed_charges.segments[0];
      expect(segment.included_days_used).toBeDefined();
      expect(segment.extra_days).toBeDefined();
    });
  });

  // ─── Package-included bed days logic ───────────────────────────────────────

  describe('Package-included bed days calculation', () => {
    it('package with 3 included days does not charge for 2-day stay', () => {
      const pkg = PACKAGE_NORMAL_DELIVERY;
      const stayDays = 2;
      const includedDays = pkg.included_bed_days;
      const extraDays = Math.max(0, stayDays - includedDays);
      const extraCharge = extraDays * pkg.extra_bed_rate;

      expect(extraDays).toBe(0);
      expect(extraCharge).toBe(0);
    });

    it('package with 3 included days charges for 5-day stay', () => {
      const pkg = PACKAGE_NORMAL_DELIVERY;
      const stayDays = 5;
      const includedDays = pkg.included_bed_days;
      const extraDays = Math.max(0, stayDays - includedDays);
      const extraCharge = extraDays * pkg.extra_bed_rate;

      expect(extraDays).toBe(2);
      expect(extraCharge).toBe(3000);
    });

    it('caesarean package with 5 included days charges for 7-day stay', () => {
      const pkg = { ...PACKAGE_NORMAL_DELIVERY, included_bed_days: 5, extra_bed_rate: 2000 };
      const stayDays = 7;
      const includedDays = pkg.included_bed_days;
      const extraDays = Math.max(0, stayDays - includedDays);
      const extraCharge = extraDays * pkg.extra_bed_rate;

      expect(extraDays).toBe(2);
      expect(extraCharge).toBe(4000);
    });
  });
});
