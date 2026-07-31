import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { getDb } from '../db';


const seedRoutes = new Hono<{
  Bindings: {
    DB: D1Database;
    ENVIRONMENT: string;
    SEED_ADMIN_PASSWORD?: string;
    SEED_HOSPITAL_PASSWORD?: string;
  };
}>();


// ⚠️  SAFETY: seed routes are guarded by TWO checks:
//   1. Runtime: ENVIRONMENT must equal 'development'
//   2. Compile-time: ALLOW_SEED must be true (set this only in local dev builds)
// Never set ALLOW_SEED = true in production code.
const ALLOW_SEED = true; // <── flip to `false` before ANY production build



seedRoutes.post('/dev', async (c) => {
  const db = getDb(c.env.DB);
  if (!ALLOW_SEED || c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Seed only works in development' }, 403);
  }

  try {
    // Create super admin with properly hashed password
    const superAdminPassword = c.env.SEED_ADMIN_PASSWORD || crypto.randomUUID().slice(0, 12);
    const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
    await db.$client.prepare(
      'INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) VALUES (?, ?, ?, ?, ?)'
    ).bind('admin@hms.com', superAdminHash, 'Super Admin', 'super_admin', null).run();

    // Create sample hospital
    await db.$client.prepare(
      'INSERT OR IGNORE INTO tenants (id, name, subdomain, status, plan) VALUES (?, ?, ?, ?, ?)'
    ).bind(1, 'General Hospital', 'general', 'active', 'basic').run();

    // Create hospital users
    const users = [
      { email: 'hospital@general.com', name: 'Hospital Admin', role: 'hospital_admin' },
      { email: 'lab@general.com', name: 'Lab Technician', role: 'laboratory' },
      { email: 'reception@general.com', name: 'Receptionist', role: 'reception' },
      { email: 'md@general.com', name: 'Managing Director', role: 'md' },
      { email: 'director@general.com', name: 'Director', role: 'director' },
    ];

    const hospitalPassword = c.env.SEED_HOSPITAL_PASSWORD || crypto.randomUUID().slice(0, 12);
    const hospitalHash = await bcrypt.hash(hospitalPassword, 10);

    for (const user of users) {
      await db.$client.prepare(
        'INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.email, hospitalHash, user.name, user.role, 1).run();
    }

    // Create sample patients
    const patients = [
      { name: 'Rahim Khan', father: 'Karim Khan', address: 'Dhaka', mobile: '01711111111' },
      { name: 'Karim Khan', father: 'Rahim Khan', address: 'Chittagong', mobile: '01722222222' },
      { name: 'Fatema Begum', father: 'Ahmed Khan', address: 'Sylhet', mobile: '01733333333' },
    ];

    for (const patient of patients) {
      await db.$client.prepare(
        'INSERT INTO patients (name, father_husband, address, mobile, tenant_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(patient.name, patient.father, patient.address, patient.mobile, 1).run();
    }

    // Create sample medicines
    const medicines = [
      { name: 'Paracetamol 500mg', company: 'Square Pharma', price: 2, qty: 1000 },
      { name: 'Amoxicillin 250mg', company: 'Beximco', price: 5, qty: 500 },
      { name: 'Metronidazole 400mg', company: 'Incepta', price: 3, qty: 800 },
    ];

    for (const med of medicines) {
      await db.$client.prepare(
        'INSERT INTO medicines (name, company, unit_price, quantity, tenant_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(med.name, med.company, med.price, med.qty, 1).run();
    }

    // Create sample staff
    const staff = [
      { name: 'Nurse Joya', position: 'Nurse', salary: 15000, address: 'Dhaka', bank: '1234567890', mobile: '01744444444' },
      { name: 'Nurse Rina', position: 'Nurse', salary: 15000, address: 'Dhaka', bank: '1234567891', mobile: '01755555555' },
      { name: 'Guard Alam', position: 'Security', salary: 10000, address: 'Dhaka', bank: '1234567892', mobile: '01766666666' },
    ];

    for (const s of staff) {
      await db.$client.prepare(
        'INSERT INTO staff (name, position, salary, address, bank_account, mobile, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(s.name, s.position, s.salary, s.address, s.bank, s.mobile, 1).run();
    }

    // Create sample shareholders
    const shareholders = [
      { name: 'Partner 1', type: 'profit', shares: 3, investment: 300000, phone: '01711111111', address: 'Dhaka' },
      { name: 'Partner 2', type: 'profit', shares: 3, investment: 300000, phone: '01722222222', address: 'Chittagong' },
      { name: 'Partner 3', type: 'profit', shares: 3, investment: 300000, phone: '01733333333', address: 'Sylhet' },
      { name: 'Owner 1', type: 'owner', shares: 50, investment: 5000000, phone: '01777777777', address: 'Dhaka' },
      { name: 'Owner 2', type: 'owner', shares: 100, investment: 10000000, phone: '01788888888', address: 'Dhaka' },
    ];

    for (const sh of shareholders) {
      await db.$client.prepare(
        'INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(sh.name, sh.type, sh.shares, sh.investment, sh.phone, sh.address, 1).run();
    }

    // Create settings
    const settings = [
      { key: 'share_price', value: '100000' },
      { key: 'total_shares', value: '300' },
      { key: 'profit_percentage', value: '30' },
      { key: 'profit_partner_count', value: '100' },
      { key: 'owner_partner_count', value: '200' },
      { key: 'shares_per_profit_partner', value: '3' },
      { key: 'fire_service_charge', value: '50' },
      { key: 'ambulance_charge', value: '500' },
    ];

    for (const setting of settings) {
      await db.$client.prepare(
        'INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES (?, ?, ?)'
      ).bind(setting.key, setting.value, 1).run();
    }

    return c.json({
      message: 'Seed data created successfully!',
      hospital: 'general.yourdomain.com',
      superAdminPassword,
      hospitalPassword
    });
  } catch (error) {
    console.error('Seed error:', error);
    return c.json({ error: 'Seed failed', details: String(error) }, 500);
  }
});

seedRoutes.post('/accounting', async (c) => {
  const db = getDb(c.env.DB);
  if (!ALLOW_SEED || c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Seed only works in development' }, 403);
  }

  try {
    // Create tables using prepare instead of exec to avoid issues
    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_id INTEGER,
        is_active INTEGER DEFAULT 1,
        tenant_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, code)
      )
    `).run();

    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date DATE NOT NULL,
        reference TEXT,
        description TEXT,
        debit_account_id INTEGER NOT NULL,
        credit_account_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        created_by INTEGER,
        tenant_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0
      )
    `).run();

    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER,
        action TEXT NOT NULL,
        table_name TEXT,
        record_id INTEGER,
        old_value TEXT,
        new_value TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS recurring_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        frequency TEXT NOT NULL,
        next_run_date DATE NOT NULL,
        end_date DATE,
        is_active INTEGER DEFAULT 1,
        created_by INTEGER,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Recreate income table with correct schema
    try {
      await db.$client.prepare('DROP TABLE IF EXISTS income').run();
    } catch (e) {}

    await db.$client.prepare(`
      CREATE TABLE income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other')),
        amount REAL NOT NULL,
        description TEXT,
        bill_id INTEGER,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )
    `).run();

    // Recreate expenses table
    try {
      await db.$client.prepare('DROP TABLE IF EXISTS expenses').run();
    } catch (e) {}

    await db.$client.prepare(`
      CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
        approved_by INTEGER,
        approved_at DATETIME,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )
    `).run();

    const categories = [
      { name: 'Staff Salary', code: 'SALARY' },
      { name: 'Medicine Purchase', code: 'MEDICINE' },
      { name: 'Rent', code: 'RENT' },
      { name: 'Electricity', code: 'ELECTRICITY' },
      { name: 'Water Supply', code: 'WATER' },
      { name: 'Internet & Phone', code: 'COMMUNICATION' },
      { name: 'Maintenance', code: 'MAINTENANCE' },
      { name: 'Medical Supplies', code: 'SUPPLIES' },
      { name: 'Marketing', code: 'MARKETING' },
      { name: 'Bank Charges', code: 'BANK' },
      { name: 'Miscellaneous', code: 'MISC' },
    ];

    for (const cat of categories) {
      await db.$client.prepare(
        'INSERT OR IGNORE INTO expense_categories (name, code, tenant_id) VALUES (?, ?, ?)'
      ).bind(cat.name, cat.code, 1).run();
    }

    const accounts = [
      { code: '1000', name: 'Cash', type: 'asset' },
      { code: '1100', name: 'Bank', type: 'asset' },
      { code: '1200', name: 'Receivables', type: 'asset' },
      { code: '2000', name: 'Payables', type: 'liability' },
      { code: '3000', name: 'Capital', type: 'equity' },
      { code: '4000', name: 'Pharmacy Income', type: 'income' },
      { code: '4100', name: 'Laboratory Income', type: 'income' },
      { code: '4200', name: 'Doctor Visit Income', type: 'income' },
      { code: '5000', name: 'Salary Expense', type: 'expense' },
      { code: '5100', name: 'Medicine Expense', type: 'expense' },
      { code: '5200', name: 'Rent Expense', type: 'expense' },
    ];

    for (const acc of accounts) {
      await db.$client.prepare(
        'INSERT OR IGNORE INTO chart_of_accounts (code, name, type, tenant_id) VALUES (?, ?, ?, ?)'
      ).bind(acc.code, acc.name, acc.type, 1).run();
    }

    // Add sample income data - using valid source values
    const incomes = [
      { date: '2026-03-10', source: 'pharmacy', amount: 5000, description: 'Medicine sales' },
      { date: '2026-03-10', source: 'laboratory', amount: 8000, description: 'Lab tests' },
      { date: '2026-03-09', source: 'doctor_visit', amount: 3000, description: 'Consultation fees' },
      { date: '2026-03-08', source: 'pharmacy', amount: 4500, description: 'Medicine sales' },
      { date: '2026-03-07', source: 'admission', amount: 15000, description: 'Patient admission' },
    ];

    for (const inc of incomes) {
      await db.$client.prepare(
        'INSERT INTO income (date, source, amount, description, tenant_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(inc.date, inc.source, inc.amount, inc.description, 1, 7).run();
    }

    // Add sample expense data
    const expenses = [
      { date: '2026-03-10', category: 'SALARY', amount: 25000, description: 'Staff salary', status: 'approved' },
      { date: '2026-03-10', category: 'MEDICINE', amount: 12000, description: 'Medicine purchase', status: 'approved' },
      { date: '2026-03-09', category: 'RENT', amount: 30000, description: 'Monthly rent', status: 'approved' },
      { date: '2026-03-08', category: 'ELECTRICITY', amount: 8000, description: 'Electricity bill', status: 'approved' },
      { date: '2026-03-07', category: 'MAINTENANCE', amount: 5000, description: 'Equipment maintenance', status: 'approved' },
    ];

    for (const exp of expenses) {
      await db.$client.prepare(
        'INSERT INTO expenses (date, category, amount, description, status, tenant_id, created_by, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(exp.date, exp.category, exp.amount, exp.description, exp.status, 1, 7, 7).run();
    }

    return c.json({ message: 'Accounting tables and sample data created successfully!' });
  } catch (error) {
    console.error('Seed error:', error);
    return c.json({ error: 'Seed failed', details: String(error) }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BILLING SEED - Default Service Depts & Items for new hospitals
// ═══════════════════════════════════════════════════════════

seedRoutes.post('/billing', async (c) => {
  const db = getDb(c.env.DB);
  if (!ALLOW_SEED || c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Seed only works in development' }, 403);
  }

  const tenantId = Number(c.req.query('tenant')) || 1;

  try {
    // Check if already seeded
    const existingDepts = await db.$client.prepare(
      'SELECT COUNT(*) as cnt FROM billing_service_departments WHERE tenant_id = ?'
    ).bind(tenantId).first<{cnt:number}>();

    if (existingDepts && existingDepts.cnt > 0) {
      return c.json({ message: 'Billing already seeded', departments: existingDepts.cnt });
    }

    // 1. Create Service Departments
    const departments = [
      { name: 'General OPD', code: 'OPD-GEN', order: 1 },
      { name: 'Emergency', code: 'EMERG', order: 2 },
      { name: 'Laboratory', code: 'LAB', order: 3 },
      { name: 'Radiology', code: 'RAD', order: 4 },
      { name: 'Pharmacy', code: 'PHARMA', order: 5 },
      { name: 'IPD General', code: 'IPD-GEN', order: 6 },
      { name: 'IPD Cabin', code: 'IPD-CAB', order: 7 },
      { name: 'IPD ICU', code: 'IPD-ICU', order: 8 },
      { name: 'Dental', code: 'DENTAL', order: 9 },
      { name: 'Eye', code: 'EYE', order: 10 },
      { name: 'Physiotherapy', code: 'PHY', order: 11 },
      { name: 'Cardiology', code: 'CARD', order: 12 },
    ];

    const deptIds: Record<string, number> = {};

    for (const dept of departments) {
      const result = await db.$client.prepare(
        `INSERT INTO billing_service_departments (department_name, department_code, display_order, tenant_id) VALUES (?, ?, ?, ?)`
      ).bind(dept.name, dept.code, dept.order, tenantId);

      // Get the last inserted ID
      const lastId = await db.$client.prepare('SELECT last_insert_rowid() as id').first<{id:number}>();
      deptIds[dept.code] = lastId?.id || 0;
    }

    // 2. Create Service Items linked to departments
    const items = [
      // General OPD
      { name: 'OPD Consultation - General', code: 'OPD-001', dept: 'OPD-GEN', price: 300, tax: true },
      { name: 'OPD Consultation - Specialist', code: 'OPD-002', dept: 'OPD-GEN', price: 500, tax: true },
      { name: 'OPD Consultation - Professor', code: 'OPD-003', dept: 'OPD-GEN', price: 800, tax: true },
      { name: 'Follow-up Visit', code: 'OPD-004', dept: 'OPD-GEN', price: 200, tax: true },

      // Emergency
      { name: 'Emergency Consultation', code: 'EMR-001', dept: 'EMERG', price: 500, tax: true },
      { name: 'Emergency Registration', code: 'EMR-002', dept: 'EMERG', price: 200, tax: true },

      // Laboratory
      { name: 'CBC (Complete Blood Count)', code: 'LAB-001', dept: 'LAB', price: 300, tax: true },
      { name: 'ESR', code: 'LAB-002', dept: 'LAB', price: 150, tax: true },
      { name: 'C-Reactive Protein (CRP)', code: 'LAB-003', dept: 'LAB', price: 400, tax: true },
      { name: 'Fasting Blood Sugar (FBS)', code: 'LAB-004', dept: 'LAB', price: 200, tax: true },
      { name: 'Lipid Profile', code: 'LAB-005', dept: 'LAB', price: 500, tax: true },
      { name: 'Liver Function Test (LFT)', code: 'LAB-006', dept: 'LAB', price: 600, tax: true },
      { name: 'Kidney Function Test (KFT)', code: 'LAB-007', dept: 'LAB', price: 600, tax: true },
      { name: 'Thyroid Profile (T3, T4, TSH)', code: 'LAB-008', dept: 'LAB', price: 900, tax: true },
      { name: 'HbA1c', code: 'LAB-009', dept: 'LAB', price: 600, tax: true },
      { name: 'Urine Complete Analysis', code: 'LAB-010', dept: 'LAB', price: 250, tax: true },
      { name: 'Stool Routine Examination', code: 'LAB-011', dept: 'LAB', price: 250, tax: true },
      { name: 'Hepatitis B Surface Antigen', code: 'LAB-012', dept: 'LAB', price: 400, tax: true },
      { name: 'Hepatitis C Antibody', code: 'LAB-013', dept: 'LAB', price: 500, tax: true },
      { name: 'HIV Test', code: 'LAB-014', dept: 'LAB', price: 300, tax: true },
      { name: 'VDRL (Syphilis)', code: 'LAB-015', dept: 'LAB', price: 300, tax: true },
      { name: 'Blood Group & Rh', code: 'LAB-016', dept: 'LAB', price: 150, tax: true },
      { name: 'Cross Match', code: 'LAB-017', dept: 'LAB', price: 250, tax: true },

      // Radiology
      { name: 'X-Ray Chest PA', code: 'RAD-001', dept: 'RAD', price: 350, tax: true },
      { name: 'X-Ray Chest AP', code: 'RAD-002', dept: 'RAD', price: 300, tax: true },
      { name: 'X-Ray Abdomen Erect', code: 'RAD-003', dept: 'RAD', price: 400, tax: true },
      { name: 'Ultrasound Whole Abdomen', code: 'RAD-004', dept: 'RAD', price: 800, tax: true },
      { name: 'Ultrasound Pelvic', code: 'RAD-005', dept: 'RAD', price: 600, tax: true },
      { name: 'Ultrasound Pregnancy', code: 'RAD-006', dept: 'RAD', price: 500, tax: true },
      { name: 'ECG', code: 'RAD-007', dept: 'RAD', price: 300, tax: true },
      { name: 'Echo Cardiography', code: 'RAD-008', dept: 'RAD', price: 2000, tax: true },
      { name: 'CT Scan Brain', code: 'RAD-009', dept: 'RAD', price: 2500, tax: true },
      { name: 'CT Scan Chest', code: 'RAD-010', dept: 'RAD', price: 3000, tax: true },
      { name: 'MRI Brain', code: 'RAD-011', dept: 'RAD', price: 5000, tax: true },

      // IPD General
      { name: 'IPD Bed Charge - General (per day)', code: 'IPD-001', dept: 'IPD-GEN', price: 1000, tax: false },
      { name: 'IPD Admission Fee', code: 'IPD-002', dept: 'IPD-GEN', price: 500, tax: false },
      { name: 'IPD Discharge Fee', code: 'IPD-003', dept: 'IPD-GEN', price: 300, tax: false },
      { name: 'IPD Nursing Charge (per day)', code: 'IPD-004', dept: 'IPD-GEN', price: 300, tax: false },
      { name: 'IPD Oxygen Charge (per day)', code: 'IPD-005', dept: 'IPD-GEN', price: 500, tax: false },
      { name: 'IPD Nebulization (per session)', code: 'IPD-006', dept: 'IPD-GEN', price: 200, tax: false },

      // IPD Cabin
      { name: 'IPD Cabin AC (per day)', code: 'IPC-001', dept: 'IPD-CAB', price: 2000, tax: false },
      { name: 'IPD Cabin Non-AC (per day)', code: 'IPC-002', dept: 'IPD-CAB', price: 1500, tax: false },
      { name: 'IPD Suite Room (per day)', code: 'IPC-003', dept: 'IPD-CAB', price: 3500, tax: false },

      // IPD ICU
      { name: 'ICU Bed Charge (per day)', code: 'ICU-001', dept: 'IPD-ICU', price: 5000, tax: false },
      { name: 'ICU Nursing Care (per day)', code: 'ICU-002', dept: 'IPD-ICU', price: 1500, tax: false },
      { name: 'Ventilator Charge (per day)', code: 'ICU-003', dept: 'IPD-ICU', price: 2000, tax: false },

      // Dental
      { name: 'Dental Consultation', code: 'DEN-001', dept: 'DENTAL', price: 300, tax: true },
      { name: 'Dental X-Ray', code: 'DEN-002', dept: 'DENTAL', price: 250, tax: true },
      { name: 'Tooth Extraction', code: 'DEN-003', dept: 'DENTAL', price: 500, tax: true },
      { name: 'Dental Scaling', code: 'DEN-004', dept: 'DENTAL', price: 800, tax: true },
      { name: 'Root Canal Treatment', code: 'DEN-005', dept: 'DENTAL', price: 3000, tax: true },
      { name: 'Dental Filling', code: 'DEN-006', dept: 'DENTAL', price: 1000, tax: true },

      // Eye
      { name: 'Eye Consultation', code: 'EYE-001', dept: 'EYE', price: 400, tax: true },
      { name: 'Refraction Test', code: 'EYE-002', dept: 'EYE', price: 200, tax: true },
      { name: 'Tonometry (Eye Pressure)', code: 'EYE-003', dept: 'EYE', price: 200, tax: true },
      { name: 'Fundus Examination', code: 'EYE-004', dept: 'EYE', price: 300, tax: true },
      { name: 'Cataract Surgery', code: 'EYE-005', dept: 'EYE', price: 8000, tax: true },

      // Physiotherapy
      { name: 'Physio Consultation', code: 'PHY-001', dept: 'PHY', price: 400, tax: true },
      { name: 'Ultratherapy (per session)', code: 'PHY-002', dept: 'PHY', price: 300, tax: true },
      { name: 'Shortwave Diathermy (per session)', code: 'PHY-003', dept: 'PHY', price: 250, tax: true },
      { name: 'TENS (per session)', code: 'PHY-004', dept: 'PHY', price: 200, tax: true },
      { name: 'Exercise Therapy (per session)', code: 'PHY-005', dept: 'PHY', price: 300, tax: true },
      { name: 'Massage Therapy (per session)', code: 'PHY-006', dept: 'PHY', price: 350, tax: true },

      // Cardiology
      { name: 'Cardiology Consultation', code: 'CARD-001', dept: 'CARD', price: 600, tax: true },
      { name: 'ECG', code: 'CARD-002', dept: 'CARD', price: 300, tax: true },
      { name: 'Echo Cardiography', code: 'CARD-003', dept: 'CARD', price: 2000, tax: true },
      { name: 'TMT (Treadmill Test)', code: 'CARD-004', dept: 'CARD', price: 1500, tax: true },
      { name: 'Holter Monitoring (24 hrs)', code: 'CARD-005', dept: 'CARD', price: 1200, tax: true },

      // Procedures
      { name: 'Normal Delivery', code: 'PROC-001', dept: 'IPD-GEN', price: 5000, tax: false },
      { name: 'Caesarean Section', code: 'PROC-002', dept: 'IPD-GEN', price: 15000, tax: false },
      { name: 'Appendectomy (Open)', code: 'PROC-003', dept: 'IPD-GEN', price: 12000, tax: false },
      { name: 'Laparoscopic Surgery', code: 'PROC-004', dept: 'IPD-GEN', price: 18000, tax: false },
      { name: 'Minor OT Procedure', code: 'PROC-005', dept: 'IPD-GEN', price: 2000, tax: false },
    ];

    for (const item of items) {
      const deptId = deptIds[item.dept];
      if (deptId) {
        await db.$client.prepare(
          `INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, tenant_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(item.name, item.code, deptId, item.price, item.tax ? 1 : 0, item.tax ? 15 : 0, 1, tenantId);
      }
    }

    // 3. Create default Price Category
    await db.$client.prepare(
      `INSERT INTO billing_price_categories (category_name, category_code, is_default, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind('General', 'GEN', 1, 1, tenantId);

    // 4. Create default Scheme
    await db.$client.prepare(
      `INSERT INTO billing_schemes (scheme_name, scheme_code, scheme_type, default_discount_percent, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind('General', 'GEN', 'general', 0, 1, tenantId);

    // 5. Create default Fiscal Year
    const currentYear = new Date().getFullYear();
    await db.$client.prepare(
      `INSERT INTO billing_fiscal_years (fiscal_year_name, start_date, end_date, is_current, is_active, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(`${currentYear}-${currentYear + 1}`, `${currentYear}-01-01`, `${currentYear + 1}-12-31`, 1, 1, tenantId);

    const itemCount = await db.$client.prepare(
      'SELECT COUNT(*) as cnt FROM billing_service_items WHERE tenant_id = ?'
    ).bind(tenantId).first<{cnt:number}>();

    return c.json({
      message: 'Billing data seeded successfully!',
      departments: departments.length,
      items: itemCount?.cnt || items.length,
      tenant_id: tenantId
    });
  } catch (error) {
    console.error('Billing seed error:', error);
    return c.json({ error: 'Billing seed failed', details: String(error) }, 500);
  }
});

export default seedRoutes;
