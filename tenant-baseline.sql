-- Tenant Database Schema (per hospital)
-- This schema is created for each new hospital

-- Patients
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    father_husband TEXT NOT NULL,
    address TEXT NOT NULL,
    mobile TEXT,
    mobile_missing_reason TEXT
        CHECK (mobile_missing_reason IS NULL OR mobile_missing_reason IN (
            'no_personal_mobile',
            'no_family_mobile',
            'emergency_arrival',
            'patient_refused',
            'will_update_later',
            'other'
        )),
    guardian_mobile TEXT,
    village TEXT,
    union_name TEXT,
    upazila TEXT,
    district TEXT,
    division TEXT,
    age INTEGER,
    gender TEXT CHECK(gender IN ('male', 'female', 'other')),
    blood_group TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Serial/Token management
CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    serial_number TEXT NOT NULL,
    date DATE NOT NULL,
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting', 'in-progress', 'completed')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Tests
CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    test_name TEXT NOT NULL,
    result TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Bills
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
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
    referred_by_type TEXT,
    referred_by_hospital_id INTEGER REFERENCES referral_hospitals(id),
    referred_by_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Referral hospitals
CREATE TABLE IF NOT EXISTS referral_hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    short_code TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_hospitals_tenant_active
    ON referral_hospitals(tenant_id, is_active);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_type TEXT CHECK(payment_type IN ('current', 'due')),
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id)
);

-- Income
CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other')),
    amount REAL NOT NULL,
    description TEXT,
    bill_id INTEGER,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (bill_id) REFERENCES bills(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    receipt_key TEXT,
    receipt_status TEXT DEFAULT 'not_uploaded'
      CHECK(receipt_status IN ('not_uploaded', 'uploaded', 'verified', 'rejected')),
    receipt_uploaded_by INTEGER,
    receipt_uploaded_at TEXT,
    receipt_verified_by INTEGER,
    receipt_verified_at TEXT,
    receipt_rejected_by INTEGER,
    receipt_rejected_at TEXT,
    receipt_rejection_reason TEXT,
    payee_name TEXT,
    approval_status TEXT NOT NULL DEFAULT 'approved'
      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    payment_status TEXT NOT NULL DEFAULT 'paid'
      CHECK (payment_status IN ('unpaid', 'paid', 'void')),
    approval_required INTEGER NOT NULL DEFAULT 0,
    approval_threshold REAL NOT NULL DEFAULT 1000,
    counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
    cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
    execution_idempotency_key TEXT,
    executed_by INTEGER REFERENCES users(id),
    executed_at TEXT,
    status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by INTEGER,
    approved_at DATETIME,
    tenant_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Investments
CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Medicines
CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    unit_price REAL NOT NULL,
    quantity INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Staff
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    position TEXT NOT NULL,
    salary REAL NOT NULL,
    bank_account TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    date_of_birth DATE,
    gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
    salutation TEXT CHECK(salutation IN ('Mr', 'Mrs', 'Ms', 'Dr')),
    joining_date DATE,
    department TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Salary payments
CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date DATE NOT NULL,
    month TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- Shareholders
CREATE TABLE IF NOT EXISTS shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    share_count INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('profit', 'owner')),
    investment REAL NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tenant settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profit distributions
CREATE TABLE IF NOT EXISTS profit_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    total_profit REAL NOT NULL,
    distributable_profit REAL NOT NULL,
    profit_percentage REAL NOT NULL,
    approved_by INTEGER,
    approved_at DATETIME,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity')),
    parent_id INTEGER,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id)
);

-- Journal Entries (Double-Entry)
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date DATE NOT NULL,
    reference TEXT,
    description TEXT,
    debit_account_id INTEGER NOT NULL,
    credit_account_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (debit_account_id) REFERENCES chart_of_accounts(id),
    FOREIGN KEY (credit_account_id) REFERENCES chart_of_accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    requires_approval INTEGER DEFAULT 0,
    is_recurring_eligible INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Expenses
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly')),
    next_run_date DATE NOT NULL,
    end_date DATE,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES expense_categories(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Income Detail (links income to chart of accounts)
CREATE TABLE IF NOT EXISTS income_detail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    income_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (income_id) REFERENCES income(id),
    FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')),
    table_name TEXT NOT NULL,
    record_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Daily Income Summary (for fast dashboard queries)
CREATE TABLE IF NOT EXISTS daily_income_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    source TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_count INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Monthly Expense Summary (for fast dashboard queries)
CREATE TABLE IF NOT EXISTS monthly_expense_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year_month TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_count INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);
CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tests_patient ON tests(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_source ON income(source);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_shareholders_type ON shareholders(type);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code ON chart_of_accounts(code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type ON chart_of_accounts(type);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_income_summary_date ON daily_income_summary(date);
CREATE INDEX IF NOT EXISTS idx_monthly_expense_summary_month ON monthly_expense_summary(year_month);
