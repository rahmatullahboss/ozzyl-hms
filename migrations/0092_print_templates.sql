-- Migration: 0092_print_templates.sql
-- Customizable print templates per hospital

CREATE TABLE IF NOT EXISTS print_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    template_type TEXT NOT NULL CHECK(template_type IN ('prescription','bill','lab_report','discharge','patient_card','birth_certificate','death_certificate','appointment_slip','admission_card','referral_letter')),
    template_name TEXT NOT NULL,          -- "Default Prescription", "A4 Bill"
    -- Header
    hospital_name TEXT,
    hospital_name_bn TEXT,               -- Bangla name
    hospital_address TEXT,
    hospital_phone TEXT,
    hospital_email TEXT,
    hospital_website TEXT,
    logo_url TEXT,                        -- R2 or external URL
    header_html TEXT,                     -- custom header HTML override
    -- Layout
    paper_size TEXT DEFAULT 'a4' CHECK(paper_size IN ('a4','a5','letter','legal','thermal_80mm','thermal_58mm','custom')),
    orientation TEXT DEFAULT 'portrait' CHECK(orientation IN ('portrait','landscape')),
    margin_top_mm INTEGER DEFAULT 10,
    margin_bottom_mm INTEGER DEFAULT 10,
    margin_left_mm INTEGER DEFAULT 10,
    margin_right_mm INTEGER DEFAULT 10,
    -- Content
    body_html TEXT,                       -- Handlebars-style template with {{variables}}
    footer_html TEXT,
    css_overrides TEXT,                   -- custom CSS
    -- Settings
    show_logo INTEGER DEFAULT 1,
    show_hospital_name INTEGER DEFAULT 1,
    show_watermark INTEGER DEFAULT 0,
    watermark_text TEXT,
    font_family TEXT DEFAULT 'Figtree, Noto Sans Bengali',
    font_size_px INTEGER DEFAULT 12,
    -- Status
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_print_tpl_tenant ON print_templates(tenant_id, template_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_tpl_default ON print_templates(tenant_id, template_type, is_default) WHERE is_default = 1;
