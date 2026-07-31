-- Migration: Sprint 4 — Blog/CMS, Patient Reviews, Departments
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Blog / Health Education Posts
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS website_blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_bn TEXT,
    slug TEXT NOT NULL,
    content TEXT NOT NULL,
    content_bn TEXT,
    excerpt TEXT,
    excerpt_bn TEXT,
    featured_image_key TEXT,
    author_name TEXT,
    is_published INTEGER DEFAULT 0,
    published_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_slug ON website_blog_posts(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_blog_tenant_published ON website_blog_posts(tenant_id, is_published);

-- 2. Patient Reviews / Testimonials
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS website_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER,
    patient_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON website_reviews(tenant_id, is_approved);

-- 3. Website Departments
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS website_departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_bn TEXT,
    slug TEXT NOT NULL,
    description TEXT,
    description_bn TEXT,
    icon TEXT DEFAULT '🏥',
    image_key TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dept_slug ON website_departments(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_dept_tenant ON website_departments(tenant_id, is_active);
