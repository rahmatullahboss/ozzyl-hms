-- Doctor auth: authentication for independent doctors who register their own chamber
CREATE TABLE doctor_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  is_verified INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doctor_auth_email ON doctor_auth(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_doctor_auth_phone ON doctor_auth(phone) WHERE phone IS NOT NULL;
