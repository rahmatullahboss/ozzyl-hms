-- ============================================================
-- 0127: Health Tips Feedback Loop & Engagement Analytics
-- ============================================================
-- Stores 👍/👎 reactions on AI-generated health tips so the
-- scoring algorithm can be refined per patient, plus a general
-- engagement log for any wellness content shown in the portal.
-- ============================================================

-- ── 1. Health Tip Definitions (catalogue) ────────────────────
-- A tip can be system-generated or AI-generated; stored normalised
-- so feedback from many patients aggregates onto the same tip.
CREATE TABLE IF NOT EXISTS health_tips (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tip_key           TEXT NOT NULL UNIQUE,           -- stable identifier, e.g. "exercise_30min_daily"
  category          TEXT NOT NULL DEFAULT 'general' -- e.g. 'nutrition','exercise','mental_health','sleep','medication'
                    CHECK(category IN ('general','nutrition','exercise','mental_health','sleep','medication','preventive','chronic_care')),
  body_text         TEXT NOT NULL,                  -- human-readable tip text (EN)
  body_text_bn      TEXT,                           -- Bengali localisation
  tags              TEXT,                           -- JSON array of tags, e.g. '["diabetes","hypertension"]'
  source            TEXT NOT NULL DEFAULT 'system'  -- 'system' | 'ai_generated'
                    CHECK(source IN ('system','ai_generated')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  base_score        REAL NOT NULL DEFAULT 50.0,     -- starting score (0–100)
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_health_tips_category ON health_tips(category);
CREATE INDEX IF NOT EXISTS idx_health_tips_active    ON health_tips(is_active);

-- ── 2. Per-Patient Tip Feedback (👍/👎) ─────────────────────
-- Each patient can leave exactly one reaction per tip.
-- An UPSERT pattern is used on (patient_id, tip_id, tenant_id).
CREATE TABLE IF NOT EXISTS patient_tip_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  tenant_id       TEXT    NOT NULL,
  tip_id          INTEGER NOT NULL REFERENCES health_tips(id) ON DELETE CASCADE,
  tip_key         TEXT    NOT NULL,   -- denormalised for easy lookup without JOIN
  reaction        TEXT    NOT NULL    -- 'up' | 'down'
                  CHECK(reaction IN ('up','down')),
  comment         TEXT,               -- optional free-text from patient
  session_context TEXT,               -- JSON: page/section where the tip was shown
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(patient_id, tip_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ptf_patient   ON patient_tip_feedback(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_ptf_tip       ON patient_tip_feedback(tip_id);
CREATE INDEX IF NOT EXISTS idx_ptf_reaction  ON patient_tip_feedback(reaction);

-- ── 3. Engagement Events ─────────────────────────────────────
-- Tracks every meaningful interaction with tips & wellness content:
-- impressions, clicks, dismissals, shares, read-more expansions.
CREATE TABLE IF NOT EXISTS patient_tip_engagement (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  tenant_id       TEXT    NOT NULL,
  tip_id          INTEGER REFERENCES health_tips(id) ON DELETE SET NULL,
  tip_key         TEXT,               -- nullable for non-tip wellness content
  content_type    TEXT NOT NULL DEFAULT 'tip'
                  CHECK(content_type IN ('tip','wellness_article','health_alert','reminder','video','checklist')),
  event_type      TEXT NOT NULL       -- 'impression'|'click'|'dismiss'|'share'|'expand'|'complete'
                  CHECK(event_type IN ('impression','click','dismiss','share','expand','complete','bookmark')),
  section         TEXT,               -- portal section, e.g. 'dashboard','tips_feed','health_checkin'
  session_id      TEXT,               -- client-generated session UUID for grouping
  device_type     TEXT,               -- 'mobile'|'web'|'tablet'
  time_spent_ms   INTEGER,            -- milliseconds patient spent reading (for clicks/expands)
  metadata        TEXT,               -- JSON blob for extra context
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pte_patient      ON patient_tip_engagement(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_pte_tip          ON patient_tip_engagement(tip_id);
CREATE INDEX IF NOT EXISTS idx_pte_event_type   ON patient_tip_engagement(event_type);
CREATE INDEX IF NOT EXISTS idx_pte_content_type ON patient_tip_engagement(content_type);
CREATE INDEX IF NOT EXISTS idx_pte_created_at   ON patient_tip_engagement(created_at DESC);

-- ── 4. Tip Score Overrides Per Patient ───────────────────────
-- The algorithm adjusts a tip's relevance per patient based on
-- diagnoses, feedback history, and engagement signals.
-- This table caches the computed per-patient personalisation score.
CREATE TABLE IF NOT EXISTS patient_tip_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL,
  tenant_id       TEXT    NOT NULL,
  tip_id          INTEGER NOT NULL REFERENCES health_tips(id) ON DELETE CASCADE,
  tip_key         TEXT    NOT NULL,
  personal_score  REAL    NOT NULL DEFAULT 50.0,  -- 0–100: higher = more relevant
  show_count      INTEGER NOT NULL DEFAULT 0,     -- how many times shown to this patient
  last_shown_at   DATETIME,
  suppressed      INTEGER NOT NULL DEFAULT 0,     -- 1 = hide after repeated 👎
  suppressed_at   DATETIME,
  computed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(patient_id, tip_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_pts_patient ON patient_tip_scores(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_pts_score   ON patient_tip_scores(personal_score DESC);

-- ── 5. Seed: Starter Health Tips ─────────────────────────────
INSERT OR IGNORE INTO health_tips (tip_key, category, body_text, body_text_bn, tags, source, base_score) VALUES
('drink_8_glasses_water',   'nutrition',     'Drink at least 8 glasses of water daily to stay hydrated.', 'প্রতিদিন অন্তত ৮ গ্লাস পানি পান করুন।', '["hydration","general"]', 'system', 60),
('walk_30min_daily',        'exercise',      'A 30-minute walk each day can lower your blood pressure and improve mood.', 'প্রতিদিন ৩০ মিনিট হাঁটুন — রক্তচাপ কমানো ও মেজাজ উন্নত করতে পারে।', '["exercise","hypertension","diabetes"]', 'system', 65),
('sleep_7_9_hours',         'sleep',         'Aim for 7–9 hours of sleep. Poor sleep raises risk of heart disease.', '৭-৯ ঘণ্টা ঘুমানোর চেষ্টা করুন। ঘুম কম হলে হৃদরোগের ঝুঁকি বাড়ে।', '["sleep","heart_health"]', 'system', 65),
('take_meds_on_time',       'medication',    'Take your prescribed medications at the same time each day for the best effect.', 'প্রতিদিন একই সময়ে ওষুধ খান — এটি সবচেয়ে কার্যকর।', '["medication","adherence"]', 'system', 80),
('reduce_salt_intake',      'nutrition',     'Reduce salt intake to help control blood pressure — avoid processed foods.', 'লবণ কম খান, বিশেষ করে প্রক্রিয়াজাত খাবার এড়িয়ে চলুন।', '["nutrition","hypertension"]', 'system', 60),
('eat_more_vegetables',     'nutrition',     'Fill half your plate with colourful vegetables to boost vitamins and fibre.', 'থালার অর্ধেক রঙিন সবজি দিয়ে পূর্ণ করুন।', '["nutrition","diabetes"]', 'system', 60),
('quit_smoking',            'preventive',    'Quitting smoking dramatically reduces your risk of heart attack and stroke.', 'ধূমপান ছাড়লে হার্ট অ্যাটাক ও স্ট্রোকের ঝুঁকি উল্লেখযোগ্যভাবে কমে।', '["smoking","heart_health","preventive"]', 'system', 75),
('stress_breathing',        'mental_health', 'Practice 4-7-8 breathing: inhale 4s, hold 7s, exhale 8s to reduce stress.', '৪-৭-৮ শ্বাস-প্রশ্বাস অভ্যাস করুন: ৪ সেকেন্ড শ্বাস নিন, ৭ সেকেন্ড ধরুন, ৮ সেকেন্ড ছাড়ুন।', '["stress","mental_health","breathing"]', 'system', 55),
('blood_sugar_check',       'chronic_care',  'Check your blood sugar regularly and log readings to spot trends early.', 'নিয়মিত রক্তের শর্করা পরীক্ষা করুন এবং ফলাফল নোট করুন।', '["diabetes","monitoring"]', 'system', 70),
('annual_health_checkup',   'preventive',    'Schedule your annual health checkup — early detection saves lives.', 'বার্ষিক স্বাস্থ্য পরীক্ষা করান — প্রাথমিক শনাক্তকরণ জীবন বাঁচায়।', '["preventive","checkup"]', 'system', 65);
