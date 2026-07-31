-- Helpdesk Ticketing Module Migration
-- Enables internal hospital helpdesk for IT, facility, equipment issues

-- ─── Categories ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_assignee_id INTEGER,
  default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low', 'medium', 'high', 'critical')),
  response_sla_minutes INTEGER NOT NULL DEFAULT 120,
  resolution_sla_minutes INTEGER NOT NULL DEFAULT 1440,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hc_tenant ON helpdesk_categories(tenant_id);

INSERT OR IGNORE INTO helpdesk_categories (tenant_id, name, description, default_priority, response_sla_minutes, resolution_sla_minutes) VALUES
('default', 'IT', 'IT infrastructure, software, network issues', 'high', 60, 480),
('default', 'Facility', 'Building maintenance, plumbing, electrical, HVAC', 'medium', 120, 1440),
('default', 'Equipment', 'Medical equipment repair and maintenance', 'high', 30, 240),
('default', 'Billing', 'Billing disputes, invoice issues', 'medium', 240, 2880),
('default', 'HR', 'Staff-related issues, payroll queries', 'low', 480, 5760),
('default', 'Security', 'Security incidents, access control', 'critical', 15, 120),
('default', 'Other', 'General inquiries not covered above', 'low', 480, 5760);

-- ─── Tickets ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ticket_no TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'escalated', 'cancelled')),
  requester_id INTEGER NOT NULL,
  requester_name TEXT NOT NULL,
  requester_role TEXT,
  assigned_to_id INTEGER,
  assigned_to_name TEXT,
  assigned_at TEXT,
  ward_id INTEGER,
  ward_name TEXT,
  patient_id INTEGER,
  patient_name TEXT,
  resolved_by_id INTEGER,
  resolved_by_name TEXT,
  resolved_at TEXT,
  resolution_notes TEXT,
  closed_by_id INTEGER,
  closed_by_name TEXT,
  closed_at TEXT,
  close_reason TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  first_response_at TEXT,
  response_time_minutes INTEGER,
  resolution_time_minutes INTEGER,
  sla_breached INTEGER DEFAULT 0,
  sla_breach_reason TEXT,
  due_at TEXT,
  source TEXT DEFAULT 'web' CHECK (source IN ('web', 'email', 'phone', 'walkin', 'mobile')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ht_tenant ON helpdesk_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ht_status ON helpdesk_tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ht_priority ON helpdesk_tickets(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_ht_category ON helpdesk_tickets(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_ht_assignee ON helpdesk_tickets(tenant_id, assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_ht_requester ON helpdesk_tickets(tenant_id, requester_id);
CREATE INDEX IF NOT EXISTS idx_ht_ward ON helpdesk_tickets(tenant_id, ward_id);

-- ─── Ticket Comments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_ticket_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ticket_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT,
  content TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  attachment_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_htc_ticket ON helpdesk_ticket_comments(tenant_id, ticket_id);

-- ─── Ticket History / Audit ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_ticket_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ticket_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by_id INTEGER,
  changed_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hth_ticket ON helpdesk_ticket_history(tenant_id, ticket_id);

-- ─── SLA Rules ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS helpdesk_sla_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  category TEXT,
  priority TEXT,
  response_sla_minutes INTEGER NOT NULL,
  resolution_sla_minutes INTEGER NOT NULL,
  escalation_email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hs_tenant ON helpdesk_sla_rules(tenant_id);
