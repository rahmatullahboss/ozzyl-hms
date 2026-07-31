-- Migration: 0091_whatsapp_messaging.sql
-- WhatsApp Business API integration for appointment reminders & notifications

CREATE TABLE IF NOT EXISTS whatsapp_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    phone_number_id TEXT,                -- WhatsApp Business phone number ID
    business_account_id TEXT,
    access_token_encrypted TEXT,          -- encrypted Meta access token
    webhook_verify_token TEXT,
    default_template_name TEXT DEFAULT 'appointment_reminder',
    default_language TEXT DEFAULT 'en',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    template_name TEXT NOT NULL,          -- "appointment_reminder", "lab_result_ready", "discharge_summary"
    template_type TEXT DEFAULT 'appointment' CHECK(template_type IN ('appointment','lab_result','prescription','discharge','billing','general','follow_up')),
    language TEXT DEFAULT 'en',
    header_text TEXT,
    body_text TEXT NOT NULL,             -- with {{1}}, {{2}} placeholders
    footer_text TEXT,
    button_text TEXT,
    meta_template_id TEXT,               -- WhatsApp-approved template ID from Meta
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','rejected')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_template_tenant ON whatsapp_templates(tenant_id, template_type);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,        -- with country code: +880...
    recipient_name TEXT,
    patient_id INTEGER,
    appointment_id INTEGER,
    template_name TEXT,
    message_type TEXT DEFAULT 'template' CHECK(message_type IN ('template','text','media')),
    message_body TEXT,
    wa_message_id TEXT,                   -- returned by WhatsApp API
    status TEXT DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','read','failed')),
    error_message TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_msg_tenant ON whatsapp_messages(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_msg_status ON whatsapp_messages(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_msg_patient ON whatsapp_messages(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_waid ON whatsapp_messages(wa_message_id);
