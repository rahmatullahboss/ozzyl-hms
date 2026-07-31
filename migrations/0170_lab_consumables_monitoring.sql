-- =============================================================================
-- HMS Migration: Lab Consumables, Monitoring & Visual Templates
-- Date: 2026-04-26
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. LAB CONSUMABLES MASTER (reagents, tubes, strips, films, chemicals, etc.)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_consumables (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL,            -- e.g. EDTA-TUBE-2ML
  name              TEXT    NOT NULL,            -- e.g. EDTA Vacutainer 2mL
  category          TEXT    NOT NULL DEFAULT 'reagent'
    CHECK(category IN ('reagent','tube','strip','film','chemical','kit','slide','syringe','other')),
  unit              TEXT    NOT NULL DEFAULT 'pcs', -- pcs, mL, mg, box, roll
  unit_price        INTEGER NOT NULL DEFAULT 0,  -- paisa (purchase price)
  reorder_level     INTEGER NOT NULL DEFAULT 10, -- alert when stock <= this
  reorder_qty       INTEGER NOT NULL DEFAULT 50, -- how much to reorder
  supplier_id       INTEGER,                     -- FK to suppliers
  description       TEXT,
  storage_condition TEXT,                        -- e.g. '2-8°C', 'room temp'
  expiry_alert_days INTEGER DEFAULT 30,          -- alert before expiry
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_by        INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_consumables_tenant    ON lab_consumables(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_consumables_category  ON lab_consumables(category);
CREATE INDEX IF NOT EXISTS idx_lab_consumables_code      ON lab_consumables(code);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. LAB CONSUMABLE STOCK (current balance per batch/lot)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_consumable_stock (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id     INTEGER NOT NULL REFERENCES lab_consumables(id),
  lot_number        TEXT,                        -- batch/lot number
  expiry_date       DATE,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_used     INTEGER NOT NULL DEFAULT 0,
  quantity_wasted   INTEGER NOT NULL DEFAULT 0,  -- expired/broken
  quantity_returned INTEGER NOT NULL DEFAULT 0,
  quantity_available INTEGER GENERATED ALWAYS AS
    (quantity_received - quantity_used - quantity_wasted - quantity_returned) STORED,
  purchase_price    INTEGER NOT NULL DEFAULT 0,  -- paisa per unit
  received_date     DATE,
  remarks           TEXT,
  tenant_id         INTEGER NOT NULL,
  created_by        INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_consumable ON lab_consumable_stock(consumable_id);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_expiry     ON lab_consumable_stock(expiry_date);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_stock_tenant     ON lab_consumable_stock(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. LAB CONSUMABLE MOVEMENTS (detailed stock ledger)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_consumable_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id     INTEGER NOT NULL REFERENCES lab_consumables(id),
  stock_id          INTEGER REFERENCES lab_consumable_stock(id),
  movement_type     TEXT NOT NULL
    CHECK(movement_type IN ('purchase_in','usage_out','waste','return','adjustment','transfer_in','transfer_out')),
  quantity          INTEGER NOT NULL,
  unit_cost         INTEGER,                     -- paisa per unit at time of movement
  reference_type    TEXT,                        -- 'lab_order','radiology_order','purchase','manual','waste'
  reference_id      INTEGER,
  performed_by      INTEGER,                     -- user_id
  remarks           TEXT,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_mov_consumable ON lab_consumable_movements(consumable_id);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_mov_type       ON lab_consumable_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_mov_ref        ON lab_consumable_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_mov_date       ON lab_consumable_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_mov_tenant     ON lab_consumable_movements(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. LAB TEST → CONSUMABLE MAPPING (which consumables each test uses)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_test_consumable_map (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_test_id       INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  consumable_id     INTEGER NOT NULL REFERENCES lab_consumables(id),
  qty_per_test      REAL    NOT NULL DEFAULT 1,  -- e.g. 1 tube, 0.5 mL reagent
  is_mandatory      INTEGER NOT NULL DEFAULT 1,  -- 1=must have, 0=optional
  notes             TEXT,
  tenant_id         INTEGER NOT NULL,
  UNIQUE(lab_test_id, consumable_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_test_cons_map_test       ON lab_test_consumable_map(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_cons_map_consumable ON lab_test_consumable_map(consumable_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. LAB OPERATION LOGS (daily tracking of what happened in the lab)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_operation_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date          DATE    NOT NULL DEFAULT CURRENT_DATE,
  log_type          TEXT    NOT NULL
    CHECK(log_type IN ('test_performed','reagent_used','film_used','print_made','machine_run','qc_performed','calibration','maintenance','waste_disposed')),
  lab_test_id       INTEGER REFERENCES lab_test_catalog(id),
  consumable_id     INTEGER REFERENCES lab_consumables(id),
  lab_order_id      INTEGER REFERENCES lab_orders(id),
  radiology_req_id  INTEGER REFERENCES radiology_requisitions(id),
  quantity          INTEGER NOT NULL DEFAULT 1,
  machine_id        INTEGER REFERENCES lab_machines(id),
  description       TEXT,
  performed_by      INTEGER,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_op_logs_date     ON lab_operation_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_type     ON lab_operation_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_test     ON lab_operation_logs(lab_test_id);
CREATE INDEX IF NOT EXISTS idx_lab_op_logs_tenant   ON lab_operation_logs(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. LAB DAILY SUMMARY (aggregated snapshot, computed nightly or on-demand)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_daily_summaries (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_date          DATE    NOT NULL,
  total_orders          INTEGER NOT NULL DEFAULT 0,
  total_tests_done      INTEGER NOT NULL DEFAULT 0,
  total_tests_pending   INTEGER NOT NULL DEFAULT 0,
  total_reports_printed INTEGER NOT NULL DEFAULT 0,
  total_reagents_used   INTEGER NOT NULL DEFAULT 0,
  total_films_used      INTEGER NOT NULL DEFAULT 0,
  total_waste_items     INTEGER NOT NULL DEFAULT 0,
  revenue_from_lab      INTEGER NOT NULL DEFAULT 0,  -- paisa
  abnormal_results      INTEGER NOT NULL DEFAULT 0,
  machine_downtime_mins INTEGER NOT NULL DEFAULT 0,
  tenant_id             INTEGER NOT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(summary_date, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_daily_sum_date   ON lab_daily_summaries(summary_date);
CREATE INDEX IF NOT EXISTS idx_lab_daily_sum_tenant ON lab_daily_summaries(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RADIOLOGY FILM USAGE LOG (specific tracking for X-ray/CT/MRI films)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS radiology_film_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id    INTEGER NOT NULL REFERENCES radiology_requisitions(id),
  film_type_id      INTEGER NOT NULL REFERENCES film_types(id),
  film_size         TEXT,                        -- e.g. '8x10', '14x17'
  quantity_used     INTEGER NOT NULL DEFAULT 1,
  quantity_wasted   INTEGER NOT NULL DEFAULT 0,  -- bad exposure, torn, etc.
  print_count       INTEGER NOT NULL DEFAULT 1,
  processed_by      INTEGER,
  remarks           TEXT,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_radio_film_req      ON radiology_film_usage(requisition_id);
CREATE INDEX IF NOT EXISTS idx_radio_film_type     ON radiology_film_usage(film_type_id);
CREATE INDEX IF NOT EXISTS idx_radio_film_date     ON radiology_film_usage(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. VISUAL REPORT TEMPLATE PRESETS (pre-made WYSIWYG templates)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_report_template_presets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_code       TEXT    NOT NULL,            -- e.g. 'cbc_standard', 'lft_standard'
  preset_name       TEXT    NOT NULL,            -- e.g. 'CBC Standard Format'
  preset_name_bn    TEXT,                        -- Bengali name
  category          TEXT    NOT NULL DEFAULT 'hematology',
  layout_type       TEXT    NOT NULL DEFAULT 'table'
    CHECK(layout_type IN ('table','grid','list','freeform')),
  structure_json    TEXT    NOT NULL,            -- JSON: sections, rows, columns
  sample_html       TEXT,                        -- preview HTML
  is_active         INTEGER NOT NULL DEFAULT 1,
  is_system         INTEGER NOT NULL DEFAULT 1,  -- 1=system preset, 0=user custom
  tenant_id         INTEGER NOT NULL DEFAULT 0,  -- 0=global, else tenant-specific
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_tpl_preset_code ON lab_report_template_presets(preset_code, tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_tpl_preset_cat         ON lab_report_template_presets(category);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. SEED PRE-MADE VISUAL TEMPLATES
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO lab_report_template_presets
  (preset_code, preset_name, preset_name_bn, category, layout_type, structure_json, sample_html, is_system, tenant_id)
VALUES
('cbc_standard', 'Complete Blood Count (CBC)', 'সম্পূর্ণ রক্ত পরীক্ষা (সিবিসি)', 'hematology', 'table',
  '{"header":{"title":"Complete Blood Count","subtitle":"Hematology Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Hematology","rows":[{"param":"Hemoglobin","unit":"g/dL","range":"Male: 13.5-17.5 | Female: 12.0-15.5"},{"param":"Total WBC Count","unit":"/cmm","range":"4,000-11,000"},{"param":"RBC Count","unit":"million/cmm","range":"Male: 4.5-5.5 | Female: 4.0-5.0"},{"param":"Platelet Count","unit":"/cmm","range":"150,000-450,000"},{"param":"PCV / Hematocrit","unit":"%","range":"Male: 40-50 | Female: 36-46"},{"param":"MCV","unit":"fL","range":"80-100"},{"param":"MCH","unit":"pg","range":"27-33"},{"param":"MCHC","unit":"g/dL","range":"32-36"}]},{"title":"Differential Count","rows":[{"param":"Neutrophils","unit":"%","range":"40-75"},{"param":"Lymphocytes","unit":"%","range":"20-45"},{"param":"Monocytes","unit":"%","range":"2-10"},{"param":"Eosinophils","unit":"%","range":"1-6"},{"param":"Basophils","unit":"%","range":"0-1"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"],"note":"This report is electronically generated and valid without signature."}}',
  '<div class="lab-report"><h2>Complete Blood Count</h2><table>...</table></div>', 1, 0),

('lft_standard', 'Liver Function Test (LFT)', 'লিভার ফাংশন টেস্ট', 'biochemistry', 'table',
  '{"header":{"title":"Liver Function Test","subtitle":"Biochemistry Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Liver Enzymes","rows":[{"param":"SGPT / ALT","unit":"U/L","range":"< 41"},{"param":"SGOT / AST","unit":"U/L","range":"< 40"},{"param":"ALP","unit":"U/L","range":"44-147"},{"param":"GGT","unit":"U/L","range":"10-71"}]},{"title":"Liver Proteins & Bilirubin","rows":[{"param":"Total Bilirubin","unit":"mg/dL","range":"0.2-1.2"},{"param":"Direct Bilirubin","unit":"mg/dL","range":"< 0.3"},{"param":"Indirect Bilirubin","unit":"mg/dL","range":"0.1-0.9"},{"param":"Total Protein","unit":"g/dL","range":"6.0-8.3"},{"param":"Albumin","unit":"g/dL","range":"3.5-5.0"},{"param":"Globulin","unit":"g/dL","range":"2.0-3.5"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"]}}',
  '<div class="lab-report"><h2>Liver Function Test</h2><table>...</table></div>', 1, 0),

('rft_standard', 'Renal Function Test (RFT)', 'কিডনি ফাংশন টেস্ট', 'biochemistry', 'table',
  '{"header":{"title":"Renal Function Test","subtitle":"Biochemistry Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Renal Profile","rows":[{"param":"Blood Urea","unit":"mg/dL","range":"15-45"},{"param":"Serum Creatinine","unit":"mg/dL","range":"Male: 0.7-1.3 | Female: 0.6-1.1"},{"param":"Uric Acid","unit":"mg/dL","range":"Male: 3.5-7.2 | Female: 2.6-6.0"},{"param":"eGFR","unit":"mL/min/1.73m²","range":"> 90"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"]}}',
  '<div class="lab-report"><h2>Renal Function Test</h2><table>...</table></div>', 1, 0),

('lipid_standard', 'Lipid Profile', 'লিপিড প্রোফাইল', 'biochemistry', 'table',
  '{"header":{"title":"Lipid Profile","subtitle":"Biochemistry Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Lipid Panel","rows":[{"param":"Total Cholesterol","unit":"mg/dL","range":"< 200"},{"param":"Triglycerides","unit":"mg/dL","range":"< 150"},{"param":"HDL Cholesterol","unit":"mg/dL","range":"> 40 (Male), > 50 (Female)"},{"param":"LDL Cholesterol","unit":"mg/dL","range":"< 100"},{"param":"VLDL Cholesterol","unit":"mg/dL","range":"< 30"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"]}}',
  '<div class="lab-report"><h2>Lipid Profile</h2><table>...</table></div>', 1, 0),

('bs_standard', 'Blood Sugar (RBS/FBS/PPBS)', 'রক্তের সুগার', 'biochemistry', 'table',
  '{"header":{"title":"Blood Sugar Report","subtitle":"Biochemistry Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Glucose","rows":[{"param":"Fasting Blood Sugar","unit":"mg/dL","range":"70-100"},{"param":"Random Blood Sugar","unit":"mg/dL","range":"< 140"},{"param":"2-Hour PP Blood Sugar","unit":"mg/dL","range":"< 140"},{"param":"HbA1c","unit":"%","range":"< 5.7"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"]}}',
  '<div class="lab-report"><h2>Blood Sugar Report</h2><table>...</table></div>', 1, 0),

('urine_standard', 'Urine R/E', 'ইউরিন পরীক্ষা', 'urine', 'table',
  '{"header":{"title":"Urine Routine Examination","subtitle":"Clinical Pathology","logo":true},"patientFields":["name","age","sex","patient_id","order_date"],"sections":[{"title":"Physical Examination","rows":[{"param":"Color","unit":"","range":"Pale Yellow / Yellow"},{"param":"Appearance","unit":"","range":"Clear / Slightly Turbid"},{"param":"Specific Gravity","unit":"","range":"1.003 - 1.030"},{"param":"pH","unit":"","range":"4.5 - 8.0"}]},{"title":"Chemical Examination","rows":[{"param":"Protein","unit":"","range":"Negative"},{"param":"Glucose","unit":"","range":"Negative"},{"param":"Ketone","unit":"","range":"Negative"},{"param":"Bilirubin","unit":"","range":"Negative"},{"param":"Blood","unit":"","range":"Negative"},{"param":"Nitrite","unit":"","range":"Negative"}]},{"title":"Microscopic Examination","rows":[{"param":"Pus Cells","unit":"/HPF","range":"0-5"},{"param":"RBC","unit":"/HPF","range":"0-3"},{"param":"Epithelial Cells","unit":"/HPF","range":"Few"},{"param":"Casts","unit":"/LPF","range":"Nil"},{"param":"Crystals","unit":"","range":"Nil"},{"param":"Bacteria","unit":"","range":"Nil"}]}],"footer":{"signatoryLines":["Medical Technologist","Pathologist"]}}',
  '<div class="lab-report"><h2>Urine R/E</h2><table>...</table></div>', 1, 0),

('xray_standard', 'X-Ray Report', 'এক্সরে রিপোর্ট', 'radiology', 'freeform',
  '{"header":{"title":"X-Ray Report","subtitle":"Radiology & Imaging Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date","exam_type"],"sections":[{"title":"Clinical Information","rows":[{"param":"Referring Doctor","unit":"","range":""},{"param":"Clinical History","unit":"","range":""}]},{"title":"Findings","rows":[{"param":"Findings","unit":"","range":""},{"param":"Impression","unit":"","range":""}]}],"footer":{"signatoryLines":["Radiologist"],"note":"Report checked and verified by consultant radiologist."}}',
  '<div class="lab-report"><h2>X-Ray Report</h2><div class="findings">...</div></div>', 1, 0),

('usg_standard', 'Ultrasound Report', 'আলট্রাসাউন্ড রিপোর্ট', 'radiology', 'freeform',
  '{"header":{"title":"Ultrasound Report","subtitle":"Radiology & Imaging Department","logo":true},"patientFields":["name","age","sex","patient_id","order_date","exam_type"],"sections":[{"title":"Procedure","rows":[{"param":"Organ/Region","unit":"","range":""},{"param":"Findings","unit":"","range":""},{"param":"Impression","unit":"","range":""}]}],"footer":{"signatoryLines":["Radiologist"]}}',
  '<div class="lab-report"><h2>Ultrasound Report</h2><div class="findings">...</div></div>', 1, 0);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. HELP/INFO CONTENT TABLE (contextual tutorials stored in DB)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS help_contents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  page_key      TEXT    NOT NULL,            -- e.g. 'lab_settings', 'radiology_catalog', 'lab_monitoring'
  section_key   TEXT    NOT NULL DEFAULT 'general', -- e.g. 'categories', 'templates', 'consumables'
  title         TEXT    NOT NULL,
  title_bn      TEXT,                        -- Bengali title
  content       TEXT    NOT NULL,            -- HTML or markdown content
  content_bn    TEXT,                        -- Bengali content
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  tenant_id     INTEGER NOT NULL DEFAULT 0,  -- 0=global
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_help_page_section ON help_contents(page_key, section_key, tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. SEED HELP CONTENT FOR LAB MODULES
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO help_contents (page_key, section_key, title, title_bn, content, content_bn, sort_order, tenant_id)
VALUES
-- Lab Settings help
('lab_settings', 'general',
 'Lab Settings Overview',
 'ল্যাব সেটিংস — সাধারণ তথ্য',
 '<p><strong>Lab Settings</strong> is where you configure the foundation of your laboratory module. Think of it as setting up your lab''s menu card, report formats, and supply tracking before daily operations begin.</p><h4>What you can do here:</h4><ul><li><strong>Categories</strong>: Group tests (e.g., Hematology, Biochemistry, Radiology)</li><li><strong>Report Templates</strong>: Design how printed reports look</li><li><strong>Vendors</strong>: Add external labs you outsource tests to</li><li><strong>Run Numbers</strong>: Configure daily sample numbering (OPD-001, IPD-001)</li></ul><p><em>Tip: Categories are like folders. Tests with prices go in the <strong>Test Catalog</strong> under Lab/Radiology dashboards.</em></p>',
 '<p><strong>ল্যাব সেটিংস</strong> হলো আপনার ল্যাব মডিউলের ভিত্তি তৈরির জায়গা। এটাকে রেস্তোরাঁর মেনু কার্ড, রিপোর্ট ফরম্যাট এবং সাপ্লাই ট্র্যাকিং সেটআপ করার জায়গা হিসেবে ভাবুন।</p><h4>এখানে যা করতে পারবেন:</h4><ul><li><strong>ক্যাটাগরি</strong>: টেস্ট গ্রুপ করুন (যেমন: Hematology, Biochemistry)</li><li><strong>রিপোর্ট টেমপ্লেট</strong>: প্রিন্টেড রিপোর্টের ডিজাইন করুন</li><li><strong>ভেন্ডর</strong>: বাইরের ল্যাব যোগ করুন</li><li><strong>রান নম্বর</strong>: প্রতিদিনের স্যাম্পল নম্বরিং সেট করুন</li></ul><p><em>টিপ: ক্যাটাগরি হলো ফোল্ডারের মতো। দামসহ টেস্ট <strong>টেস্ট ক্যাটালগে</strong> যোগ করুন।</em></p>',
 1, 0),

('lab_settings', 'categories',
 'What are Test Categories?',
 'টেস্ট ক্যাটাগরি কী?',
 '<p><strong>Categories</strong> are folders that group your lab tests. They do NOT contain prices — they are purely for organization.</p><h4>Examples:</h4><ul><li>Hematology (Blood tests: CBC, Hb, etc.)</li><li>Biochemistry (Chemical tests: LFT, RFT, Lipid)</li><li>Microbiology (Culture, Sensitivity)</li><li>Radiology (X-Ray, CT, MRI, USG)</li></ul><p><strong>Where to add tests with prices?</strong> Go to <strong>Lab Dashboard → Test Catalog</strong> or <strong>Radiology Dashboard → Catalog</strong>. There you can set the price (e.g., CBC = ৳500).</p><p><em>A category just has: Name, Code (optional), Description (optional).</em></p>',
 '<p><strong>ক্যাটাগরি</strong> হলো ফোল্ডার যা আপনার ল্যাব টেস্টগুলোকে গ্রুপ করে। এখানে দাম থাকে না — শুধু সংগঠনের জন্য।</p><h4>উদাহরণ:</h4><ul><li>Hematology (রক্ত পরীক্ষা: CBC, Hb)</li><li>Biochemistry (রাসায়নিক: LFT, RFT)</li><li>Microbiology (কালচার, সেনসিটিভিটি)</li><li>Radiology (X-Ray, CT, MRI)</li></ul><p><strong>দামসহ টেস্ট কোথায় যোগ করবেন?</strong> <strong>ল্যাব ড্যাশবোর্ড → টেস্ট ক্যাটালগে</strong> যান। সেখানে দাম সেট করতে পারবেন (যেমন: CBC = ৳৫০০)।</p><p><em>ক্যাটাগরিতে শুধু থাকে: নাম, কোড (ঐচ্ছিক), বিবরণ (ঐচ্ছিক)।</em></p>',
 2, 0),

('lab_settings', 'templates',
 'Report Templates Explained',
 'রিপোর্ট টেমপ্লেট ব্যাখ্যা',
 '<p><strong>Report Templates</strong> define how your lab reports look when printed or shared.</p><h4>We now offer Visual Templates!</h4><p>Instead of writing HTML code, you can now:</p><ol><li>Pick a <strong>pre-made template</strong> (CBC, LFT, RFT, etc.)</li><li>Preview how it looks</li><li>Customize sections, headers, footers</li><li>Save and use for your reports</li></ol><p><strong>Available pre-made templates:</strong></p><ul><li>Complete Blood Count (CBC)</li><li>Liver Function Test (LFT)</li><li>Renal Function Test (RFT)</li><li>Lipid Profile</li><li>Blood Sugar</li><li>Urine R/E</li><li>X-Ray Report</li><li>Ultrasound Report</li></ul><p><em>These templates auto-fill patient info, test results, reference ranges, and signatory lines.</em></p>',
 '<p><strong>রিপোর্ট টেমপ্লেট</strong> আপনার ল্যাব রিপোর্ট প্রিন্ট বা শেয়ার করার সময় কেমন দেখাবে তা নির্ধারণ করে।</p><h4>এখন ভিজুয়াল টেমপ্লেট পাওয়া যাচ্ছে!</h4><p>HTML কোড লেখার পরিবর্তে এখন আপনি:</p><ol><li><strong>রেডিমেড টেমপ্লেট</strong> বেছে নিতে পারেন (CBC, LFT, RFT)</li><li>প্রিভিউ দেখতে পারেন</li><li>সেকশন, হেডার, ফুটার কাস্টমাইজ করতে পারেন</li><li>সেভ করে ব্যবহার করতে পারেন</li></ol><p><strong>পাওয়া যাচ্ছে:</strong> CBC, LFT, RFT, Lipid Profile, Blood Sugar, Urine R/E, X-Ray, Ultrasound</p>',
 3, 0),

('lab_settings', 'vendors',
 'External Lab Vendors',
 'বাইরের ল্যাব ভেন্ডর',
 '<p><strong>Vendors</strong> are external laboratories you send samples to when your hospital cannot perform certain tests.</p><h4>Examples:</h4><ul><li>Genetic testing labs</li><li>Specialized pathology centers</li><li>Referral hospitals with advanced equipment</li></ul><p>When creating a test in the catalog, mark it as <strong>"Outsourced"</strong> and link it to a vendor. The system will track sample status from "Sent" to "Received" to "Result Imported".</p>',
 '<p><strong>ভেন্ডর</strong> হলো বাইরের ল্যাব যেখানে আপনার হাসপাতালে না করলে স্যাম্পল পাঠানো হয়।</p><h4>উদাহরণ:</h4><ul><li>জেনেটিক টেস্টিং ল্যাব</li><li>বিশেষায়িত প্যাথলজি সেন্টার</li></ul><p>টেস্ট ক্যাটালগে তৈরি করার সময় <strong>"আউটসোর্সড"</strong> চিহ্নিত করে ভেন্ডার লিংক করুন।</p>',
 4, 0),

('lab_settings', 'run_numbers',
 'Run Number Settings',
 'রান নম্বর সেটিংস',
 '<p><strong>Run Numbers</strong> are daily sample identifiers used to track specimens in the lab.</p><h4>Common formats:</h4><ul><li><strong>OPD</strong>: OPD-001, OPD-002 (resets daily)</li><li><strong>IPD</strong>: IPD-001, IPD-002</li><li><strong>Emergency</strong>: ER-001, ER-002</li></ul><p>You can configure: prefix, separator, reset frequency (daily/monthly/yearly), and starting number.</p><p><em>This helps lab staff quickly identify which samples belong to which department.</em></p>',
 '<p><strong>রান নম্বর</strong> হলো প্রতিদিনের স্যাম্পল আইডেন্টিফায়ার যা ল্যাবে নমুনা ট্র্যাক করতে ব্যবহৃত হয়।</p><h4>সাধারণ ফরম্যাট:</h4><ul><li><strong>OPD</strong>: OPD-001, OPD-002 (প্রতিদিন রিসেট)</li><li><strong>IPD</strong>: IPD-001, IPD-002</li><li><strong>ইমার্জেন্সি</strong>: ER-001, ER-002</li></ul>',
 5, 0),

-- Lab Monitoring help
('lab_monitoring', 'general',
 'Lab Monitoring Dashboard',
 'ল্যাব মনিটরিং ড্যাশবোর্ড',
 '<p>The <strong>Lab Monitoring Dashboard</strong> tracks everything happening in your lab: reagents, consumables, machine usage, prints, and more.</p><h4>What you can track:</h4><ul><li><strong>Reagent Stock</strong>: How much reagent is left, expiry alerts</li><li><strong>Consumables</strong>: Tubes, strips, slides, syringes</li><li><strong>Film Usage</strong>: X-ray/CT films used and wasted</li><li><strong>Print Counts</strong>: How many reports printed per day</li><li><strong>Machine Runs</strong>: LIS machine activity logs</li><li><strong>Daily Summary</strong>: Orders, tests, revenue at a glance</li></ul><p><em>This helps you never run out of supplies and detect wastage early.</em></p>',
 '<p><strong>ল্যাব মনিটরিং ড্যাশবোর্ড</strong> আপনার ল্যাবে ঘটে যাওয়া সবকিছু ট্র্যাক করে: রিএজেন্ট, কনজিউমেবল, মেশিন ব্যবহার, প্রিন্ট, ইত্যাদি।</p><h4>যা ট্র্যাক করা যায়:</h4><ul><li><strong>রিএজেন্ট স্টক</strong>: কতটা আছে, মেয়াদোত্তীর্ণ অ্যালার্ট</li><li><strong>কনজিউমেবল</strong>: টিউব, স্ট্রিপ, স্লাইড, সিরিঞ্জ</li><li><strong>ফিল্ম ব্যবহার</strong>: X-ray/CT ফিল্ম কত ব্যবহার ও নষ্ট হয়েছে</li><li><strong>প্রিন্ট কাউন্ট</strong>: প্রতিদিন কত রিপোর্ট প্রিন্ট হয়েছে</li><li><strong>মেশিন রান</strong>: LIS মেশিন অ্যাক্টিভিটি লগ</li><li><strong>ডেইলি সামারি</strong>: অর্ডার, টেস্ট, রাজস্ব এক নজরে</li></ul>',
 1, 0),

('lab_monitoring', 'consumables',
 'How to Add & Track Consumables',
 'কনজিউমেবল যোগ এবং ট্র্যাকিং',
 '<p><strong>Consumables</strong> are items used up during testing: reagents, tubes, test strips, films, chemicals, etc.</p><h4>Steps:</h4><ol><li>Go to <strong>Lab Monitoring → Consumables</strong></li><li>Add a new consumable: Name, Category, Unit, Reorder Level</li><li>When stock arrives: <strong>Add Stock</strong> (quantity, lot number, expiry)</li><li>Link to tests: Go to <strong>Test Catalog</strong> and map consumables to each test (e.g., CBC uses 1 EDTA tube)</li><li>System auto-deducts stock when tests are performed</li></ol><p><strong>Categories:</strong> Reagent, Tube, Strip, Film, Chemical, Kit, Slide, Syringe, Other</p><p><em>You will get alerts when stock falls below reorder level or nears expiry.</em></p>',
 '<p><strong>কনজিউমেবল</strong> হলো পরীক্ষার সময় ব্যবহৃত হয়ে যাওয়া জিনিস: রিএজেন্ট, টিউব, টেস্ট স্ট্রিপ, ফিল্ম, রাসায়নিক, ইত্যাদি।</p><h4>ধাপ:</h4><ol><li><strong>ল্যাব মনিটরিং → কনজিউমেবলে</strong> যান</li><li>নতুন কনজিউমেবল যোগ করুন: নাম, ক্যাটাগরি, একক, রিঅর্ডার লেভেল</li><li>স্টক আসলে: <strong>স্টক যোগ করুন</strong> (পরিমাণ, লট নম্বর, মেয়াদ)</li><li>টেস্টের সাথে লিংক করুন: <strong>টেস্ট ক্যাটালগে</strong> যান এবং প্রতিটি টেস্টের জন্য কনজিউমেবল ম্যাপ করুন</li><li>টেস্ট করার সময় সিস্টেম অটোমেটিক স্টক কাটবে</li></ol>',
 2, 0),

-- Radiology Catalog help
('radiology_catalog', 'general',
 'Radiology Catalog Guide',
 'রেডিওলজি ক্যাটালগ গাইড',
 '<p>The <strong>Radiology Catalog</strong> has two levels:</p><h4>1. Imaging Types (Categories)</h4><p>These are folders: X-Ray, CT Scan, MRI, Ultrasound, Fluoroscopy, etc.</p><p>They only have: Name, Code, Description. No prices here.</p><h4>2. Imaging Tests (Actual services)</h4><p>These are the actual tests patients pay for:</p><ul><li>Name: Abdomen X-Ray</li><li>Code: XR-ABD</li><li>Type: X-Ray (linked to the folder)</li><li>Price: ৳1,000</li></ul><p><strong>To set a price:</strong> Click "Add Test" in the Imaging Tests panel and enter the price in the <strong>Price (BDT)</strong> field.</p>',
 '<p><strong>রেডিওলজি ক্যাটালগে</strong> দুটি লেভেল আছে:</p><h4>১. ইমেজিং প্রকার (ক্যাটাগরি)</h4><p>এগুলো ফোল্ডার: X-Ray, CT Scan, MRI, Ultrasound</p><p>এখানে শুধু: নাম, কোড, বিবরণ। দাম নেই।</p><h4>২. ইমেজিং টেস্ট (আসল সার্ভিস)</h4><p>এগুলো রোগী যার জন্য টাকা দেয়:</p><ul><li>নাম: Abdomen X-Ray</li><li>কোড: XR-ABD</li><li>টাইপ: X-Ray</li><li>দাম: ৳১,০০০</li></ul><p><strong>দাম সেট করতে:</strong> "টেস্ট যোগ করুন" বাটনে ক্লিক করে <strong>মূল্য (টাকা)</strong> ফিল্ডে দাম লিখুন।</p>',
 1, 0);

-- =============================================================================
-- Add missing columns to existing tables for better tracking
-- =============================================================================

-- Link lab_test_catalog to a report template preset
ALTER TABLE lab_test_catalog ADD COLUMN report_template_preset_id INTEGER REFERENCES lab_report_template_presets(id);

-- Add consumable tracking triggers via application layer (no SQLite triggers for complex logic)
-- The app will auto-log consumable usage when lab_order_items are completed

-- Add print tracking to radiology reports
ALTER TABLE radiology_reports ADD COLUMN print_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE radiology_reports ADD COLUMN printed_at DATETIME;
ALTER TABLE radiology_reports ADD COLUMN printed_by INTEGER;

-- Add film usage tracking link to radiology requisitions
ALTER TABLE radiology_requisitions ADD COLUMN film_usage_logged INTEGER NOT NULL DEFAULT 0;
