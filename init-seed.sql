-- Create tables
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active',
  plan TEXT DEFAULT 'basic',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

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
);

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

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  position TEXT NOT NULL,
  salary REAL NOT NULL,
  bank_account TEXT NOT NULL,
  mobile TEXT NOT NULL,
  joining_date DATE,
  status TEXT DEFAULT 'active',
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  tenant_id INTEGER NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert super admin with hashed password (admin123)
INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('admin@hms.com', '$2a$10$UC8HWJsr4W8KBMOD7Iw7Au5fI9rvSSyPX5ugGukdt9Fqb0GTTc4OW', 'Super Admin', 'super_admin', NULL);

-- Insert sample hospital
INSERT OR IGNORE INTO tenants (id, name, subdomain, status, plan) 
VALUES (1, 'General Hospital', 'general', 'active', 'basic');

-- Insert hospital users (password: hospital123)
INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('hospital@general.com', '$2a$10$6oZgfQ3m4Ck/RYF33Fiu6.onkfoitAmtRGZ2UM3Kog6hN7HJoImw.', 'Hospital Admin', 'hospital_admin', 1);

INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('lab@general.com', '$2a$10$6oZgfQ3m4Ck/RYF33Fiu6.onkfoitAmtRGZ2UM3Kog6hN7HJoImw.', 'Lab Technician', 'laboratory', 1);

INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('reception@general.com', '$2a$10$6oZgfQ3m4Ck/RYF33Fiu6.onkfoitAmtRGZ2UM3Kog6hN7HJoImw.', 'Receptionist', 'reception', 1);

INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('md@general.com', '$2a$10$6oZgfQ3m4Ck/RYF33Fiu6.onkfoitAmtRGZ2UM3Kog6hN7HJoImw.', 'Managing Director', 'md', 1);

INSERT OR IGNORE INTO users (email, password_hash, name, role, tenant_id) 
VALUES ('director@general.com', '$2a$10$6oZgfQ3m4Ck/RYF33Fiu6.onkfoitAmtRGZ2UM3Kog6hN7HJoImw.', 'Director', 'director', 1);

-- Insert sample patients
INSERT INTO patients (name, father_husband, address, mobile, tenant_id) 
VALUES ('Rahim Khan', 'Karim Khan', 'Dhaka', '01711111111', 1);

INSERT INTO patients (name, father_husband, address, mobile, tenant_id) 
VALUES ('Karim Khan', 'Rahim Khan', 'Chittagong', '01722222222', 1);

INSERT INTO patients (name, father_husband, address, mobile, tenant_id) 
VALUES ('Fatema Begum', 'Ahmed Khan', 'Sylhet', '01733333333', 1);

-- Insert sample medicines
INSERT INTO medicines (name, company, unit_price, quantity, tenant_id) 
VALUES ('Paracetamol 500mg', 'Square Pharma', 2, 1000, 1);

INSERT INTO medicines (name, company, unit_price, quantity, tenant_id) 
VALUES ('Amoxicillin 250mg', 'Beximco', 5, 500, 1);

INSERT INTO medicines (name, company, unit_price, quantity, tenant_id) 
VALUES ('Metronidazole 400mg', 'Incepta', 3, 800, 1);

-- Insert sample staff
INSERT INTO staff (name, position, salary, address, bank_account, mobile, tenant_id) 
VALUES ('Nurse Joya', 'Nurse', 15000, 'Dhaka', '1234567890', '01744444444', 1);

INSERT INTO staff (name, position, salary, address, bank_account, mobile, tenant_id) 
VALUES ('Nurse Rina', 'Nurse', 15000, 'Dhaka', '1234567891', '01755555555', 1);

INSERT INTO staff (name, position, salary, address, bank_account, mobile, tenant_id) 
VALUES ('Guard Alam', 'Security', 10000, 'Dhaka', '1234567892', '01766666666', 1);

-- Insert sample shareholders
INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) 
VALUES ('Partner 1', 'profit', 3, 300000, '01711111111', 'Dhaka', 1);

INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) 
VALUES ('Partner 2', 'profit', 3, 300000, '01722222222', 'Chittagong', 1);

INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) 
VALUES ('Partner 3', 'profit', 3, 300000, '01733333333', 'Sylhet', 1);

INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) 
VALUES ('Owner 1', 'owner', 50, 5000000, '01777777777', 'Dhaka', 1);

INSERT INTO shareholders (name, type, share_count, investment, phone, address, tenant_id) 
VALUES ('Owner 2', 'owner', 100, 10000000, '01788888888', 'Dhaka', 1);

-- Insert settings
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('share_price', '100000', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('total_shares', '300', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('profit_percentage', '30', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('profit_partner_count', '100', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('owner_partner_count', '200', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('shares_per_profit_partner', '3', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('fire_service_charge', '50', 1);
INSERT OR IGNORE INTO settings (key, value, tenant_id) VALUES ('ambulance_charge', '500', 1);
