import { Hono } from 'hono';
import { getDb } from '../db';


const initRoutes = new Hono<{
  Bindings: {
    DB: D1Database;
    ENVIRONMENT: string;
  };
}>();

// Initialize database tables - only works in development
initRoutes.post('/dev', async (c) => {
  const db = getDb(c.env.DB);
  const env = c.env.ENVIRONMENT;
  if (env !== 'development') {
    return c.json({ error: 'Init only works in development' }, 403);
  }

  try {
    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        subdomain TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        plan TEXT DEFAULT 'basic',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.$client.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        tenant_id INTEGER,
        mfa_enabled INTEGER DEFAULT 0,
        mfa_secret TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        father_husband TEXT NOT NULL,
        address TEXT NOT NULL,
        mobile TEXT NOT NULL,
        guardian_mobile TEXT,
        age INTEGER,
        gender TEXT,
        blood_group TEXT,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS serials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        serial_number TEXT NOT NULL,
        date DATE NOT NULL,
        status TEXT DEFAULT 'waiting',
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        test_name TEXT NOT NULL,
        result TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending',
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        admission_id INTEGER,
        test_bill REAL DEFAULT 0,
        admission_bill REAL DEFAULT 0,
        doctor_visit_bill REAL DEFAULT 0,
        operation_bill REAL DEFAULT 0,
        medicine_bill REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        total REAL DEFAULT 0,
        paid REAL DEFAULT 0,
        due REAL DEFAULT 0,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_type TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        tenant_id INTEGER NOT NULL
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        source TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        bill_id INTEGER,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'approved',
        approved_by INTEGER,
        approved_at DATETIME,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        company TEXT,
        unit_price REAL NOT NULL,
        quantity INTEGER DEFAULT 0,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        position TEXT NOT NULL,
        salary REAL NOT NULL,
        bank_account TEXT NOT NULL,
        mobile TEXT NOT NULL,
        joining_date DATE,
        department TEXT,
        status TEXT DEFAULT 'active',
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS salary_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date DATE NOT NULL,
        month TEXT NOT NULL,
        tenant_id INTEGER NOT NULL
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS shareholders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        share_count INTEGER NOT NULL,
        type TEXT NOT NULL,
        investment REAL NOT NULL,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS profit_distributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        total_profit REAL NOT NULL,
        distributable_profit REAL NOT NULL,
        profit_percentage REAL NOT NULL,
        approved_by INTEGER,
        approved_at DATETIME,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.$client.exec(`
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
    `);

    await db.$client.exec(`
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
    `);

    await db.$client.exec(`
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
    `);

    await db.$client.exec(`
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
    `);

    await db.$client.exec(`
      CREATE TABLE IF NOT EXISTS income_detail (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        income_id INTEGER NOT NULL,
        description TEXT,
        quantity INTEGER,
        unit_price REAL,
        total REAL NOT NULL,
        tenant_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    return c.json({ message: 'Database initialized successfully!' });
  } catch (error) {
    console.error('Init error:', error);
    return c.json({ error: 'Init failed', details: String(error) }, 500);
  }
});

export default initRoutes;
