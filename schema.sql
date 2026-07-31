-- Super Admin Database Schema
-- Run: wrangler d1 execute hms-super-admin --local --file=./schema.sql

-- Tenants table (hospitals)
CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    plan TEXT DEFAULT 'basic',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table (both super admin and hospital users)
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

-- System settings (global)
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES 
    ('share_price', '100000'),
    ('total_shares', '300'),
    ('profit_percentage', '30'),
    ('profit_partner_count', '100'),
    ('owner_partner_count', '200'),
    ('shares_per_profit_partner', '3'),
    ('fire_service_charge', '50'),
    ('ambulance_charge', '500');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
