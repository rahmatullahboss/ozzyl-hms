-- ════════════════════════════════════════════════════════════════
-- Sprint 6: SOAP Note Templates + Vaccination Module
-- Created: 2026-04-06
-- ════════════════════════════════════════════════════════════════

-- ── 1. SOAP Note Templates ────────────────────────────────────

CREATE TABLE IF NOT EXISTS soap_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_bn TEXT,
  chief_complaint TEXT NOT NULL,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  specialty TEXT,
  is_global INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_soap_templates_tenant ON soap_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_soap_templates_specialty ON soap_templates(tenant_id, specialty);

-- ── 2. Vaccine Master Catalog ─────────────────────────────────

CREATE TABLE IF NOT EXISTS vaccine_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_bn TEXT,
  description TEXT,
  number_of_doses INTEGER DEFAULT 1,
  dose_interval_days INTEGER,
  target_age_group TEXT,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vaccine_master_code ON vaccine_master(tenant_id, code);

-- ── 3. Patient Vaccination Records ────────────────────────────

CREATE TABLE IF NOT EXISTS patient_vaccinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  vaccine_id INTEGER NOT NULL,
  dose_number INTEGER NOT NULL DEFAULT 1,
  administered_date TEXT NOT NULL,
  administered_by INTEGER,
  batch_number TEXT,
  manufacturer TEXT,
  route TEXT CHECK(route IN ('IM','SC','ID','PO','IN')),
  administration_site TEXT,
  adverse_effects TEXT,
  remarks TEXT,
  next_dose_date TEXT,
  status TEXT DEFAULT 'completed' CHECK(status IN ('completed','scheduled','missed','cancelled')),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (vaccine_id) REFERENCES vaccine_master(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_vacc_patient ON patient_vaccinations(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_vacc_date ON patient_vaccinations(tenant_id, administered_date);
CREATE INDEX IF NOT EXISTS idx_patient_vacc_next ON patient_vaccinations(tenant_id, next_dose_date, status);

-- Prevent duplicate dose for same patient + vaccine + dose_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_vacc_unique_dose
  ON patient_vaccinations(tenant_id, patient_id, vaccine_id, dose_number)
  WHERE status != 'cancelled';

-- ── 4. Seed: Bangladesh EPI Vaccine Schedule ─────────────────
-- tenant_id=0 means global/template — copied to tenant on first use

INSERT OR IGNORE INTO vaccine_master (tenant_id, code, name, name_bn, description, number_of_doses, dose_interval_days, target_age_group, is_active, created_by)
VALUES
  (0, 'BCG',         'BCG',                          'বিসিজি',               'Bacillus Calmette-Guérin — Tuberculosis prevention',  1, NULL, '0-14d',   1, NULL),
  (0, 'HEP-B-BD',    'Hepatitis B (Birth Dose)',     'হেপাটাইটিস বি (জন্মদোজ)', 'Hepatitis B birth dose within 24h',                 1, NULL, '0-1d',    1, NULL),
  (0, 'OPV-0',       'OPV-0 (Birth Dose)',           'ওপিভি-০ (জন্মদোজ)',      'Oral Polio Vaccine birth dose',                       1, NULL, '0-14d',   1, NULL),
  (0, 'OPV',         'OPV (1-3)',                    'ওপিভি',                 'Oral Polio Vaccine',                                   3, 28,   '6w-14w',  1, NULL),
  (0, 'PENTA',       'Pentavalent (DPT-HepB-Hib)',   'পেন্টাভ্যালেন্ট',       'DPT + Hepatitis B + Haemophilus influenzae type b',    3, 28,   '6w-14w',  1, NULL),
  (0, 'PCV',         'PCV (Pneumococcal)',            'পিসিভি',                'Pneumococcal Conjugate Vaccine',                       3, 28,   '6w-14w',  1, NULL),
  (0, 'IPV',         'IPV (Inactivated Polio)',       'আইপিভি',                'Inactivated Polio Vaccine',                            2, 28,   '6w-14w',  1, NULL),
  (0, 'MR',          'MR (Measles-Rubella)',          'এমআর (হাম-রুবেলা)',      'Measles-Rubella vaccine',                              2, 180,  '9m-15m',  1, NULL),
  (0, 'TT',          'TT (Tetanus Toxoid)',           'টিটি (ধনুষ্টংকার)',      'Tetanus Toxoid — pregnant women & WCBA',               5, 28,   'WCBA',    1, NULL),
  (0, 'COVID-19',    'COVID-19',                     'কোভিড-১৯',             'COVID-19 vaccine (various manufacturers)',               2, 28,   '12y+',    1, NULL),
  (0, 'HEP-B',       'Hepatitis B (Adult)',           'হেপাটাইটিস বি (প্রাপ্তবয়স্ক)', 'Hepatitis B adult series',                      3, 30,   'Adult',   1, NULL),
  (0, 'RABIES',      'Rabies (Post-Exposure)',        'রেবিজ',                'Post-exposure rabies prophylaxis',                      5, 7,    'All',     1, NULL),
  (0, 'TYPHOID',     'Typhoid',                      'টাইফয়েড',              'Typhoid conjugate vaccine',                             1, NULL, '2y+',     1, NULL),
  (0, 'FLU',         'Influenza (Seasonal)',          'ইনফ্লুয়েঞ্জা',          'Annual seasonal influenza vaccine',                     1, NULL, '6m+',     1, NULL),
  (0, 'HPV',         'HPV',                          'এইচপিভি',              'Human Papillomavirus vaccine',                          2, 180,  '9-14y',   1, NULL);

-- ── 5. Seed: Common SOAP Note Templates (Bangladesh) ─────────

INSERT OR IGNORE INTO soap_templates (tenant_id, name, name_bn, chief_complaint, subjective, objective, assessment, plan, specialty, is_global, created_by)
VALUES
  (0, 'Fever',           'জ্বর',
   'Fever',
   'Patient complains of fever for ___ days. Associated symptoms: headache/body ache/chills/sweating/cough/runny nose. No history of travel. Appetite reduced.',
   'Temp: ___°F, PR: ___/min, BP: ___/___ mmHg, SpO2: ___%\nGeneral: looks unwell/well. Throat: ___. Lungs: clear/crackles. Abdomen: soft, non-tender.',
   'Acute febrile illness — likely viral/bacterial. DDx: URI, UTI, Dengue, Typhoid, Malaria.',
   '1. CBC, Blood culture, Widal/Dengue NS1 if >5d\n2. Paracetamol 500mg TDS\n3. ORS / fluids\n4. Review in 3 days or sooner if worsening',
   NULL, 1, NULL),

  (0, 'Diabetes Follow-up', 'ডায়াবেটিস ফলো-আপ',
   'Diabetes mellitus follow-up',
   'Known DM Type __ for ___ years on ___. Compliance: good/poor. Symptoms: polyuria/polydipsia/weight change/numbness in feet/blurred vision. Home glucose: ___.',
   'Wt: ___kg, BP: ___/___ mmHg\nFeet: pulses present, sensation intact/reduced. Fundoscopy: ___. HbA1c: ___%, FBS: ___ mg/dL.',
   'DM Type __ — controlled/uncontrolled (HbA1c ___%).',
   '1. Continue/adjust current medications\n2. HbA1c target <7%\n3. Annual: eye exam, renal function, lipid profile\n4. Diet counseling, exercise\n5. Follow-up in ___ months',
   'Medicine', 1, NULL),

  (0, 'Hypertension',    'উচ্চ রক্তচাপ',
   'Hypertension follow-up / new HTN',
   'Known HTN for ___ years / newly detected elevated BP. Current medications: ___. Compliance: ___. Symptoms: headache/dizziness/chest pain/visual changes — none.',
   'BP: ___/___ mmHg (sitting), PR: ___/min, Wt: ___kg\nHeart: S1S2 normal, no murmur. Lungs: clear. Pedal edema: absent.',
   'Essential hypertension — Stage __ (JNC 8). Target: <140/90 (or <130/80 if DM/CKD).',
   '1. Lifestyle: low salt diet, exercise 30min/day, weight management\n2. Start/continue ___ (ACEi/ARB/CCB/diuretic)\n3. Labs: Cr, K+, lipid profile, ECG\n4. Review in 4 weeks',
   'Medicine', 1, NULL),

  (0, 'Diarrhea',        'ডায়রিয়া',
   'Diarrhea / loose stools',
   'Loose stools ___ times/day for ___ days. Watery/mucoid/bloody. Vomiting: yes/no. Fever: yes/no. Last oral intake: ___. Urine output: reduced/normal.',
   'Temp: ___°F, PR: ___/min, BP: ___/___\nDehydration: none/some/severe. Skin turgor: ___. Mucous membranes: dry/moist. Abdomen: soft, hyperactive bowel sounds.',
   'Acute gastroenteritis with ___ dehydration. DDx: viral/bacterial/parasitic.',
   '1. ORS after each loose stool\n2. Zinc 20mg x 10 days (children)\n3. Antibiotics if bloody/severe: Azithromycin/Ciprofloxacin\n4. Stool R/E, C/S if not improving\n5. IV fluid if severe dehydration\n6. Review in 24-48h',
   NULL, 1, NULL),

  (0, 'Respiratory Infection', 'শ্বাসনালীর সংক্রমণ',
   'Cough / cold / respiratory infection',
   'Cough for ___ days — dry/productive (sputum color: ___). Fever: yes/no. Sore throat/nasal congestion/ear pain. Breathing difficulty: none. Smoking: ___.',
   'Temp: ___°F, SpO2: ___%\nThroat: congested/normal. Tonsils: ___. Ears: ___. Lungs: clear/rhonchi/crackles/wheeze. No respiratory distress.',
   'Acute upper respiratory tract infection / Acute bronchitis / Pneumonia (CRB-65: ___).',
   '1. Symptomatic: warm fluids, steam inhalation\n2. Paracetamol PRN for fever\n3. Antihistamine (Fexofenadine) if allergic component\n4. Antibiotics if bacterial: Amoxicillin 500mg TDS x 5d\n5. CXR if >7 days or worsening\n6. Follow-up if not improving in 5 days',
   NULL, 1, NULL),

  (0, 'Asthma',          'হাঁপানি',
   'Asthma / breathing difficulty / wheeze',
   'Known asthma for ___ years / new wheeze. Current inhalers: ___. Compliance: ___. Triggers: dust/cold/exercise/smoke. Night symptoms: ___/week. Rescue inhaler use: ___/week.',
   'SpO2: ___%, RR: ___/min, PR: ___/min\nLungs: bilateral wheeze / reduced air entry. No accessory muscle use. PEFR: ___L/min (predicted: ___).',
   'Bronchial asthma — intermittent/mild persistent/moderate persistent/severe (GINA step __).',
   '1. SABA (Salbutamol) PRN\n2. ICS (Beclomethasone/Budesonide) ___ mcg BD — step up/maintain/step down\n3. Spacer technique education\n4. Avoid triggers\n5. Asthma action plan provided\n6. Review in ___ weeks, PEFR diary',
   'Medicine', 1, NULL),

  (0, 'UTI',             'মূত্রনালীর সংক্রমণ',
   'Urinary tract infection / dysuria',
   'Burning micturition for ___ days. Frequency/urgency/suprapubic pain. Fever: yes/no. Flank pain: yes/no. Hematuria: yes/no. Previous UTI: ___. Pregnant: ___.',
   'Temp: ___°F, BP: ___/___\nAbdomen: suprapubic tenderness: yes/no. CVA tenderness: yes/no. No pelvic exam done / pelvic exam: ___.',
   'Acute uncomplicated UTI / Complicated UTI / Pyelonephritis.',
   '1. Urine R/E + C/S before antibiotics\n2. Empiric: Nitrofurantoin 100mg BD x 5d (uncomplicated) OR Ciprofloxacin 500mg BD x 7d\n3. Fluids >2L/day\n4. Paracetamol PRN\n5. Review with C/S result\n6. If recurrent: USS KUB, consider prophylaxis',
   NULL, 1, NULL),

  (0, 'Headache',        'মাথাব্যথা',
   'Headache',
   'Headache for ___ days/months. Location: frontal/temporal/occipital/unilateral/bilateral. Character: throbbing/pressing/sharp. Severity: ___/10. Nausea/vomiting: ___. Visual aura: ___. Photophobia: ___.',
   'BP: ___/___ mmHg, Temp: ___°F\nNeurological: alert, oriented. Pupils: equal, reactive. No neck stiffness. No focal deficit. Fundoscopy: no papilledema.',
   'Tension-type headache / Migraine without aura / Migraine with aura. Red flags: absent.',
   '1. Acute: Paracetamol 1g / Ibuprofen 400mg / Sumatriptan 50mg (migraine)\n2. Prophylaxis if >4/month: Propranolol 40mg BD / Amitriptyline 10-25mg HS\n3. Headache diary\n4. CT/MRI if red flags or not responding\n5. Follow-up in 4 weeks',
   'Medicine', 1, NULL),

  (0, 'Back Pain',       'পিঠ/কোমর ব্যথা',
   'Back pain / low back pain',
   'Low back pain for ___. Onset: sudden/gradual. Radiation to legs: yes/no. Numbness/tingling: ___. Bowel/bladder changes: none. Worse with: sitting/standing/bending. Previous episodes: ___.',
   'Gait: normal/antalgic. Spine: tenderness at ___. ROM: flexion/extension limited. SLR: negative/positive at ___°. Motor: ___/5 bilat. Sensory: intact. Reflexes: ___.',
   'Mechanical low back pain / Lumbar radiculopathy / Disc prolapse suspected.',
   '1. NSAIDs: Naproxen 500mg BD x 7d (with PPI cover)\n2. Muscle relaxant: Tizanidine 2mg TDS PRN\n3. Hot compress, avoid heavy lifting\n4. Physiotherapy referral\n5. X-ray LS spine if >6 weeks / red flags\n6. MRI if radiculopathy / neurological deficit',
   NULL, 1, NULL),

  (0, 'Pregnancy Visit',  'গর্ভকালীন পরিচর্যা',
   'Antenatal check-up',
   'G___P___A___, LMP: ___, EDD: ___, GA: ___ weeks. Current complaints: nausea/edema/headache/reduced fetal movement/none. Previous pregnancies: ___. Known conditions: GDM/PIH/none.',
   'Wt: ___kg, BP: ___/___ mmHg\nUterine height: ___cm. FHR: ___/min (regular). Presentation: cephalic/breech. Edema: ___. Urine: protein ___/sugar ___.',
   'Intrauterine pregnancy, ___ weeks. Low risk / High risk (reason: ___).',
   '1. Iron + Folic acid daily\n2. Calcium 500mg BD\n3. Tetanus Toxoid (TT) as per schedule\n4. Labs: CBC, blood group, RBS, HBsAg, VDRL, urine R/E\n5. USS: dating/anomaly/growth as appropriate\n6. Next visit: ___ weeks',
   'Obstetrics', 1, NULL),

  (0, 'Child Growth Check', 'শিশু বৃদ্ধি পরীক্ষা',
   'Well-child visit / growth monitoring',
   'Age: ___. Feeding: breast/formula/complementary. Milestones: ___. Vaccination: up to date/pending ___. Concerns: ___. Appetite/sleep: ___.',
   'Wt: ___kg (___th centile), Ht: ___cm (___th centile), HC: ___cm\nGeneral: active, alert. Fontanelle: ___. Heart: normal. Lungs: clear. Abdomen: soft. Development: age-appropriate / delayed.',
   'Well child, ___ months. Growth: adequate/faltering. Development: normal/delayed in ___.',
   '1. Age-appropriate vaccinations: ___\n2. Nutrition counseling: ___\n3. Vitamin A supplementation if due\n4. Deworming (Albendazole) if >1 year\n5. Growth chart updated\n6. Next visit: ___',
   'Pediatrics', 1, NULL),

  (0, 'Skin Rash',       'চর্মরোগ',
   'Skin rash / itching / dermatitis',
   'Rash/itching for ___ days/weeks. Location: ___. Character: red/raised/vesicular/scaly. Itching: mild/severe. Spread: ___. Known allergies: ___. Contact with irritants: ___. Similar episode before: ___.',
   'Skin: ___ (describe distribution, morphology, margins). Nails: ___. Scalp: ___. No mucosal involvement. No lymphadenopathy.',
   'Allergic dermatitis / Eczema / Fungal infection / Scabies / Urticaria.',
   '1. Topical: steroid (Betamethasone) / antifungal (Clotrimazole) / emollients\n2. Oral antihistamine: Cetirizine 10mg HS\n3. Avoid triggers/irritants\n4. Skin scraping/KOH if fungal suspected\n5. Review in 2 weeks',
   'Dermatology', 1, NULL),

  (0, 'Gastritis',       'গ্যাস্ট্রাইটিস',
   'Epigastric pain / acidity / gastritis',
   'Upper abdominal pain/burning for ___. Relation to food: before/after meals. Nausea/vomiting: ___. Heartburn/acid reflux: ___. NSAIDs/smoking/alcohol use: ___. Weight loss: ___. Melena: ___.',
   'Abdomen: epigastric tenderness. No guarding/rigidity. Bowel sounds: normal. No organomegaly. PR: not done / normal / melena.',
   'Functional dyspepsia / GERD / Peptic ulcer disease. H. pylori status: unknown/positive/negative.',
   '1. PPI: Omeprazole 20mg BD x 4 weeks (before meals)\n2. Antacid PRN\n3. Avoid NSAIDs, spicy food, smoking\n4. H. pylori testing if not done\n5. Endoscopy if: >45y, alarm symptoms, not responding\n6. Follow-up in 4 weeks',
   'Medicine', 1, NULL),

  (0, 'Chest Pain',      'বুকে ব্যথা',
   'Chest pain',
   'Chest pain for ___. Character: sharp/crushing/burning/pleuritic. Radiation: arm/jaw/back. Duration: ___. Exertion-related: ___. Associated: SOB/sweating/nausea/palpitation. Risk factors: HTN/DM/smoking/family Hx.',
   'BP: ___/___ mmHg, PR: ___/min, SpO2: ___%\nCardiac: S1S2 normal, no murmur/gallop. JVP: normal. Lungs: clear. Chest wall tenderness: ___. ECG: ___.',
   'Chest pain — cardiac/non-cardiac. DDx: ACS/GERD/musculoskeletal/anxiety. HEART score: ___.',
   '1. ECG (done: ___)\n2. Troponin I/T stat\n3. If ACS suspected: Aspirin 300mg stat, Clopidogrel 300mg, refer to CCU\n4. If non-cardiac: treat underlying cause\n5. Risk factor modification\n6. Cardiology referral if indicated',
   'Medicine', 1, NULL),

  (0, 'Eye Infection',   'চোখের সংক্রমণ',
   'Eye redness / discharge / conjunctivitis',
   'Red eye for ___ days. Discharge: watery/mucopurulent. Itching: ___. Pain: ___. Vision change: ___. Contact lens use: ___. Trauma: none. Affected eye: left/right/both.',
   'Visual acuity: R: ___ L: ___. Conjunctiva: injected. Discharge: ___. Cornea: clear/hazy. Pupil: round, reactive. Fundus: not examined / normal.',
   'Allergic conjunctivitis / Bacterial conjunctivitis / Viral conjunctivitis.',
   '1. Eye drops: Moxifloxacin 0.5% QID x 7d (bacterial) / Olopatadine BD (allergic)\n2. Warm compress / lid hygiene\n3. Avoid rubbing eyes\n4. Hand hygiene — prevent spread\n5. Ophthalmology referral if: no improvement in 5d / vision affected / corneal involvement',
   'Ophthalmology', 1, NULL);
