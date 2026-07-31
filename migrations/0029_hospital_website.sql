-- 0029_hospital_website.sql
-- Auto-generated hospital website feature
-- Adds website configuration, gallery, public services, and doctor public profile columns

-- ─── Website Configuration (per-tenant) ──────────────────────────────
CREATE TABLE IF NOT EXISTS website_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL UNIQUE,
  is_enabled INTEGER DEFAULT 1,
  theme TEXT DEFAULT 'arogyaseva',
  tagline TEXT,
  about_text TEXT,
  mission_text TEXT,
  founded_year INTEGER,
  bed_count INTEGER,
  operating_hours TEXT,           -- JSON: {"mon":"9am-5pm", ...}
  google_maps_embed TEXT,         -- iframe embed URL
  whatsapp_number TEXT,
  facebook_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT,
  primary_color TEXT DEFAULT '#0891b2',
  secondary_color TEXT DEFAULT '#059669',
  hero_image_key TEXT,            -- R2 key
  logo_key TEXT,                  -- R2 key
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Website Gallery ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  image_key TEXT NOT NULL,        -- R2 key
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_website_gallery_tenant ON website_gallery(tenant_id);

-- ─── Public Service Listings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_bn TEXT,                   -- Bengali name
  description TEXT,
  icon TEXT DEFAULT '🏥',         -- emoji or icon name
  category TEXT DEFAULT 'general', -- opd, ipd, lab, pharmacy, telemedicine, emergency
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_website_services_tenant ON website_services(tenant_id);

-- ─── Doctor Public Profile Extensions ────────────────────────────────
-- Safe ALTER TABLE: each wrapped individually so partial migration doesn't block
ALTER TABLE doctors ADD COLUMN public_bio TEXT;
ALTER TABLE doctors ADD COLUMN is_public INTEGER DEFAULT 1;
ALTER TABLE doctors ADD COLUMN photo_key TEXT;
