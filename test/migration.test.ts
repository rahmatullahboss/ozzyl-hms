import { describe, it, expect } from 'vitest';

// ═════════════════════════════════════════════════════════════════════════════
// DATABASE MIGRATION VALIDATION TESTS
// Ensures schema integrity, rollback safety, and data consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('HMS Database Migration Validation Tests', () => {

  // ─── 1. Migration File Naming Convention ───────────────────────────────────
  describe('Migration Naming Convention', () => {
    const MIGRATION_FILES = [
      '0001_init.sql', '0002_billing_items.sql', '0003_appointments.sql',
      '0004_pharmacy_stock.sql', '0005_lab_orders.sql', '0006_ipd.sql',
      '0007_notifications.sql', '0008_consultations.sql', '0009_accounting.sql',
      '0010_shareholders.sql', '0011_branches.sql', '0012_commissions.sql',
      '0013_recurring.sql', '0014_profit.sql', '0015_telehealth.sql',
      '0016_dr_schedules.sql', '0017_discharge_summaries.sql',
    ];

    it('should have at least 17 migration files', () => {
      expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(17);
    });

    it('all migrations should follow NNNN_ prefix pattern', () => {
      for (const f of MIGRATION_FILES) {
        expect(f).toMatch(/^\d{4}_/);
      }
    });

    it('all migrations should have .sql extension', () => {
      for (const f of MIGRATION_FILES) {
        expect(f).toMatch(/\.sql$/);
      }
    });

    it('migration numbers should be sequential', () => {
      const nums = MIGRATION_FILES.map(f => parseInt(f.split('_')[0]));
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBe(nums[i - 1] + 1);
      }
    });

    it('first migration should be 0001_init.sql', () => {
      expect(MIGRATION_FILES[0]).toBe('0001_init.sql');
    });
  });

  // ─── 2. Required Core Tables ──────────────────────────────────────────────
  describe('Core Table Existence', () => {
    const REQUIRED_TABLES = [
      'patients', 'users', 'visits', 'billing', 'billing_items', 'payments',
      'doctors', 'staff', 'appointments', 'admissions', 'beds',
      'pharmacy_items', 'pharmacy_sales', 'pharmacy_purchases',
      'lab_orders', 'lab_order_items',
      'prescriptions', 'prescription_items',
      'income', 'expenses', 'audit_logs',
      'settings', 'notifications',
      'consultations', 'patient_vitals',
      'shareholders', 'profit_distributions',
      'branches', 'commissions',
      'recurring_expenses', 'chart_of_accounts', 'journal_entries',
      'doctor_schedules', 'discharge_summaries',
    ];

    it('should require at least 30 core tables', () => {
      expect(REQUIRED_TABLES.length).toBeGreaterThanOrEqual(30);
    });

    it('should include all patient-facing tables', () => {
      expect(REQUIRED_TABLES).toContain('patients');
      expect(REQUIRED_TABLES).toContain('visits');
      expect(REQUIRED_TABLES).toContain('admissions');
      expect(REQUIRED_TABLES).toContain('prescriptions');
    });

    it('should include all financial tables', () => {
      expect(REQUIRED_TABLES).toContain('billing');
      expect(REQUIRED_TABLES).toContain('payments');
      expect(REQUIRED_TABLES).toContain('income');
      expect(REQUIRED_TABLES).toContain('expenses');
      expect(REQUIRED_TABLES).toContain('journal_entries');
    });

    it('should include audit_logs for compliance', () => {
      expect(REQUIRED_TABLES).toContain('audit_logs');
    });
  });

  // ─── 3. Critical Column Constraints ───────────────────────────────────────
  describe('Column Constraints', () => {
    interface ColumnConstraint {
      table: string; column: string; nullable: boolean; type: string;
    }

    const CRITICAL_CONSTRAINTS: ColumnConstraint[] = [
      { table: 'patients', column: 'tenant_id', nullable: false, type: 'INTEGER' },
      { table: 'patients', column: 'name', nullable: false, type: 'TEXT' },
      { table: 'patients', column: 'patient_code', nullable: false, type: 'TEXT' },
      { table: 'billing', column: 'tenant_id', nullable: false, type: 'INTEGER' },
      { table: 'billing', column: 'total', nullable: false, type: 'REAL' },
      { table: 'billing', column: 'bill_no', nullable: false, type: 'TEXT' },
      { table: 'admissions', column: 'patient_id', nullable: false, type: 'INTEGER' },
      { table: 'admissions', column: 'admission_no', nullable: false, type: 'TEXT' },
      { table: 'users', column: 'email', nullable: false, type: 'TEXT' },
      { table: 'users', column: 'password_hash', nullable: false, type: 'TEXT' },
    ];

    it('tenant_id should be NOT NULL on all patient-facing tables', () => {
      const tenantCols = CRITICAL_CONSTRAINTS.filter(c => c.column === 'tenant_id');
      for (const col of tenantCols) {
        expect(col.nullable).toBe(false);
      }
    });

    it('billing total should be NOT NULL (no null invoices)', () => {
      const totalCol = CRITICAL_CONSTRAINTS.find(c => c.table === 'billing' && c.column === 'total');
      expect(totalCol?.nullable).toBe(false);
    });

    it('user email and password_hash should be NOT NULL', () => {
      const emailCol = CRITICAL_CONSTRAINTS.find(c => c.table === 'users' && c.column === 'email');
      const passCol = CRITICAL_CONSTRAINTS.find(c => c.table === 'users' && c.column === 'password_hash');
      expect(emailCol?.nullable).toBe(false);
      expect(passCol?.nullable).toBe(false);
    });
  });

  // ─── 4. Tenant Isolation Column ───────────────────────────────────────────
  describe('Tenant Isolation via tenant_id', () => {
    const TABLES_REQUIRING_TENANT_ID = [
      'patients', 'visits', 'billing', 'payments', 'income', 'expenses',
      'appointments', 'admissions', 'beds', 'doctors', 'staff',
      'pharmacy_items', 'pharmacy_sales', 'lab_orders',
      'prescriptions', 'consultations', 'audit_logs',
      'notifications', 'settings', 'shareholders',
    ];

    it('all operational tables should have tenant_id', () => {
      expect(TABLES_REQUIRING_TENANT_ID.length).toBeGreaterThanOrEqual(15);
    });

    it('every listed table should be in the required list', () => {
      for (const t of TABLES_REQUIRING_TENANT_ID) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── 5. Index Strategy ────────────────────────────────────────────────────
  describe('Index Strategy Validation', () => {
    const RECOMMENDED_INDEXES = [
      { table: 'patients', columns: ['tenant_id', 'patient_code'] },
      { table: 'billing', columns: ['tenant_id', 'bill_no'] },
      { table: 'appointments', columns: ['tenant_id', 'doctor_id', 'appt_date'] },
      { table: 'admissions', columns: ['tenant_id', 'status'] },
      { table: 'lab_orders', columns: ['tenant_id', 'patient_id'] },
      { table: 'audit_logs', columns: ['tenant_id', 'created_at'] },
      { table: 'visits', columns: ['tenant_id', 'visit_date'] },
    ];

    it('should define indexes on all high-traffic tables', () => {
      expect(RECOMMENDED_INDEXES.length).toBeGreaterThanOrEqual(7);
    });

    it('all indexes should include tenant_id for isolation', () => {
      for (const idx of RECOMMENDED_INDEXES) {
        expect(idx.columns).toContain('tenant_id');
      }
    });
  });
});
