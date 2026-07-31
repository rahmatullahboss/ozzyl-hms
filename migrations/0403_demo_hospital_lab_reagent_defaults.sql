-- Migration: 0403_demo_hospital_lab_reagent_defaults.sql
-- Purpose: Backfill the legacy demo hospital (tenant 100) with default lab/diagnostic consumable mappings.
-- This keeps billing-time reagent consumption from opening mapping-missing exceptions in the demo flow.

WITH default_consumables(code, name, category, unit, unit_price, reorder_level, reorder_qty, storage_condition, description, expiry_alert_days) AS (
  VALUES
    ('CBC-REAGENT-TEST', 'CBC reagent pack - test equivalent', 'reagent', 'test', 0, 100, 500, 'Per analyzer/kit IFU', 'Generic CBC analyzer reagent test equivalent', 30),
    ('EDTA-TUBE', 'EDTA sample tube', 'tube', 'pcs', 0, 100, 500, 'Room temperature', 'Default blood collection tube', 30),
    ('GLUCOSE-REAGENT-TEST', 'Glucose reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic glucose chemistry reagent test equivalent', 30),
    ('CRP-KIT-TEST', 'CRP kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic CRP latex/card/quantitative kit test equivalent', 30),
    ('ALT-REAGENT-TEST', 'ALT reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic ALT reagent test equivalent', 30),
    ('AST-REAGENT-TEST', 'AST reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic AST reagent test equivalent', 30),
    ('ALP-REAGENT-TEST', 'ALP reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic ALP reagent test equivalent', 30),
    ('BIL-T-REAGENT-TEST', 'Total bilirubin reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic total bilirubin reagent test equivalent', 30),
    ('BIL-D-REAGENT-TEST', 'Direct bilirubin reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic direct bilirubin reagent test equivalent', 30),
    ('TP-REAGENT-TEST', 'Total protein reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic total protein reagent test equivalent', 30),
    ('ALB-REAGENT-TEST', 'Albumin reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic albumin reagent test equivalent', 30),
    ('UREA-REAGENT-TEST', 'Urea reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic urea chemistry reagent test equivalent', 30),
    ('CREATININE-REAGENT-TEST', 'Creatinine reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic creatinine chemistry reagent test equivalent', 30),
    ('URIC-ACID-REAGENT-TEST', 'Uric acid reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic uric acid chemistry reagent test equivalent', 30),
    ('CHOL-REAGENT-TEST', 'Total cholesterol reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic total cholesterol reagent test equivalent', 30),
    ('TG-REAGENT-TEST', 'Triglycerides reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic triglycerides reagent test equivalent', 30),
    ('HDL-REAGENT-TEST', 'HDL cholesterol reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic HDL reagent test equivalent', 30),
    ('LDL-REAGENT-TEST', 'LDL reagent - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic LDL reagent test equivalent', 30),
    ('TSH-REAGENT-TEST', 'TSH reagent/cartridge - test equivalent', 'kit', 'test', 0, 20, 100, '2-8C or per kit IFU', 'Generic TSH immunoassay reagent test equivalent', 30),
    ('HBA1C-REAGENT-TEST', 'HbA1c reagent/cartridge - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic HbA1c cartridge/reagent test equivalent', 30),
    ('URINE-CONTAINER', 'Urine container', 'other', 'pcs', 0, 100, 500, 'Room temperature', 'Default urine sample container', 30),
    ('URINE-STRIP-TEST', 'Urine strip - test equivalent', 'reagent', 'test', 0, 100, 500, '2-8C or per kit IFU', 'Generic urine dipstick test equivalent', 30),
    ('STOOL-CONTAINER', 'Stool container', 'other', 'pcs', 0, 100, 500, 'Room temperature', 'Default stool sample container', 30),
    ('MICROSCOPE-SLIDE', 'Microscope slide', 'other', 'pcs', 0, 100, 500, 'Room temperature', 'Default microscopy slide', 30),
    ('CULTURE-MEDIA-TEST', 'Culture media - test equivalent', 'kit', 'test', 0, 50, 200, 'Per analyzer/kit IFU', 'Generic culture media plate/test equivalent', 30),
    ('AST-DISC-TEST', 'Antibiotic sensitivity disc set - test equivalent', 'kit', 'test', 0, 50, 200, 'Per analyzer/kit IFU', 'Generic antibiotic sensitivity disc test equivalent', 30),
    ('GIEMSA-STAIN-TEST', 'Giemsa stain - test equivalent', 'reagent', 'test', 0, 50, 200, '2-8C or per kit IFU', 'Generic microscopy stain test equivalent', 30),
    ('ECG-PAPER-TEST', 'ECG thermal paper - test equivalent', 'other', 'test', 0, 50, 200, 'Room temperature', 'Default ECG paper test equivalent', 30),
    ('XRAY-FILM-TEST', 'X-Ray film/digital media - test equivalent', 'film', 'test', 0, 50, 200, 'Room temperature', 'Default X-Ray film or digital media test equivalent', 30),
    ('ULTRASOUND-GEL-TEST', 'Ultrasound gel - test equivalent', 'other', 'test', 0, 50, 200, 'Room temperature', 'Default ultrasound/echo gel test equivalent', 30),
    ('WIDAL-KIT-TEST', 'Widal kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic Widal slide/tube kit test equivalent', 30),
    ('DENGUE-NS1-KIT-TEST', 'Dengue NS1 kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic dengue NS1 rapid/ELISA kit test equivalent', 30),
    ('COVID-AG-KIT-TEST', 'COVID-19 antigen kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic SARS-CoV-2 antigen kit test equivalent', 30),
    ('SWAB', 'Sterile swab', 'other', 'pcs', 0, 100, 500, 'Room temperature', 'Default swab collection consumable', 30),
    ('TROPONIN-I-KIT-TEST', 'Troponin I kit - test equivalent', 'kit', 'test', 0, 10, 50, 'Per analyzer/kit IFU', 'Generic troponin I rapid/quantitative kit test equivalent', 30),
    ('PT-REAGENT-TEST', 'PT reagent - test equivalent', 'reagent', 'test', 0, 50, 200, '2-8C or per kit IFU', 'Generic prothrombin time reagent test equivalent', 30),
    ('APTT-REAGENT-TEST', 'APTT reagent - test equivalent', 'reagent', 'test', 0, 50, 200, '2-8C or per kit IFU', 'Generic APTT reagent test equivalent', 30),
    ('HBSAG-KIT-TEST', 'HBsAg kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic HBsAg rapid/ELISA kit test equivalent', 30),
    ('HCV-KIT-TEST', 'Anti-HCV kit - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic HCV rapid/ELISA kit test equivalent', 30),
    ('PSA-REAGENT-TEST', 'PSA reagent/cartridge - test equivalent', 'kit', 'test', 0, 20, 100, 'Per analyzer/kit IFU', 'Generic PSA immunoassay test equivalent', 30)
)
INSERT INTO lab_consumables
  (code, name, category, unit, unit_price, reorder_level, reorder_qty, storage_condition, description, expiry_alert_days, tenant_id, created_by)
SELECT dc.code, dc.name, dc.category, dc.unit, dc.unit_price, dc.reorder_level, dc.reorder_qty,
       dc.storage_condition, dc.description, dc.expiry_alert_days, 100, 101
FROM default_consumables dc
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 100)
  AND NOT EXISTS (
    SELECT 1 FROM lab_consumables existing
    WHERE existing.tenant_id = 100 AND UPPER(existing.code) = UPPER(dc.code)
  );

WITH default_maps(test_code, consumable_code, qty_per_test, notes) AS (
  VALUES
    ('CBC', 'CBC-REAGENT-TEST', 1, 'Default no-LIS starter value: validate CBC analyzer reagent usage per hospital SOP.'),
    ('CBC', 'EDTA-TUBE', 1, 'Default collection tube mapping.'),
    ('BSF', 'GLUCOSE-REAGENT-TEST', 1, 'Default glucose reagent test-equivalent mapping.'),
    ('BS2H', 'GLUCOSE-REAGENT-TEST', 1, 'Default glucose reagent test-equivalent mapping.'),
    ('CRP', 'CRP-KIT-TEST', 1, 'Default CRP kit test-equivalent mapping.'),
    ('LFT', 'ALT-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'AST-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'ALP-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'BIL-T-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'BIL-D-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'TP-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('LFT', 'ALB-REAGENT-TEST', 1, 'Default LFT reagent component mapping.'),
    ('KFT', 'UREA-REAGENT-TEST', 1, 'Default KFT reagent component mapping.'),
    ('KFT', 'CREATININE-REAGENT-TEST', 1, 'Default KFT reagent component mapping.'),
    ('KFT', 'URIC-ACID-REAGENT-TEST', 1, 'Default KFT reagent component mapping.'),
    ('LIPID', 'CHOL-REAGENT-TEST', 1, 'Default lipid reagent component mapping.'),
    ('LIPID', 'TG-REAGENT-TEST', 1, 'Default lipid reagent component mapping.'),
    ('LIPID', 'HDL-REAGENT-TEST', 1, 'Default lipid reagent component mapping.'),
    ('LIPID', 'LDL-REAGENT-TEST', 1, 'Default lipid reagent component mapping.'),
    ('TSH', 'TSH-REAGENT-TEST', 1, 'Default TSH reagent/cartridge mapping.'),
    ('HBA1C', 'HBA1C-REAGENT-TEST', 1, 'Default HbA1c reagent/cartridge mapping.'),
    ('URINE', 'URINE-CONTAINER', 1, 'Default urine collection container mapping.'),
    ('URINE', 'URINE-STRIP-TEST', 1, 'Default urine strip test-equivalent mapping.'),
    ('UCR', 'URINE-CONTAINER', 1, 'Default urine culture container mapping.'),
    ('UCR', 'CULTURE-MEDIA-TEST', 1, 'Default culture media mapping.'),
    ('UCR', 'AST-DISC-TEST', 1, 'Default antibiotic sensitivity disc mapping.'),
    ('STOOL', 'STOOL-CONTAINER', 1, 'Default stool collection container mapping.'),
    ('STOOL', 'MICROSCOPE-SLIDE', 1, 'Default stool microscopy slide mapping.'),
    ('ECG', 'ECG-PAPER-TEST', 1, 'Default ECG paper/digital-media mapping.'),
    ('ECHO', 'ULTRASOUND-GEL-TEST', 1, 'Default echo gel mapping.'),
    ('CXR', 'XRAY-FILM-TEST', 1, 'Default X-Ray film/digital-media mapping.'),
    ('ABDXR', 'XRAY-FILM-TEST', 1, 'Default X-Ray film/digital-media mapping.'),
    ('USG', 'ULTRASOUND-GEL-TEST', 1, 'Default ultrasound gel mapping.'),
    ('USGLV', 'ULTRASOUND-GEL-TEST', 1, 'Default ultrasound gel mapping.'),
    ('USGNCK', 'ULTRASOUND-GEL-TEST', 1, 'Default ultrasound gel mapping.'),
    ('WIDAL', 'WIDAL-KIT-TEST', 1, 'Default Widal kit mapping.'),
    ('MPS', 'MICROSCOPE-SLIDE', 1, 'Default malaria microscopy slide mapping.'),
    ('MPS', 'GIEMSA-STAIN-TEST', 1, 'Default malaria stain mapping.'),
    ('DENGUE', 'DENGUE-NS1-KIT-TEST', 1, 'Default Dengue NS1 kit mapping.'),
    ('COVID', 'COVID-AG-KIT-TEST', 1, 'Default COVID antigen kit mapping.'),
    ('COVID', 'SWAB', 1, 'Default COVID swab mapping.'),
    ('TROPON', 'TROPONIN-I-KIT-TEST', 1, 'Default Troponin I kit mapping.'),
    ('PT', 'PT-REAGENT-TEST', 1, 'Default PT reagent mapping.'),
    ('APTT', 'APTT-REAGENT-TEST', 1, 'Default APTT reagent mapping.'),
    ('BILT', 'BIL-T-REAGENT-TEST', 1, 'Default bilirubin total reagent mapping.'),
    ('BILT', 'BIL-D-REAGENT-TEST', 1, 'Default bilirubin direct reagent mapping.'),
    ('HBsAg', 'HBSAG-KIT-TEST', 1, 'Default HBsAg kit mapping.'),
    ('ANTIHCV', 'HCV-KIT-TEST', 1, 'Default Anti-HCV kit mapping.'),
    ('PSA', 'PSA-REAGENT-TEST', 1, 'Default PSA reagent/cartridge mapping.')
), resolved AS (
  SELECT t.id AS lab_test_id, c.id AS consumable_id, dm.qty_per_test, dm.notes
  FROM default_maps dm
  JOIN lab_test_catalog t ON t.tenant_id = 100 AND COALESCE(t.is_active, 1) = 1 AND UPPER(t.code) = UPPER(dm.test_code)
  JOIN lab_consumables c ON c.tenant_id = 100 AND COALESCE(c.is_active, 1) = 1 AND UPPER(c.code) = UPPER(dm.consumable_code)
)
INSERT INTO lab_test_consumable_map (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id)
SELECT r.lab_test_id, r.consumable_id, r.qty_per_test, 1, r.notes, 100
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1 FROM lab_test_consumable_map existing
  WHERE existing.tenant_id = 100
    AND existing.lab_test_id = r.lab_test_id
    AND existing.consumable_id = r.consumable_id
);

WITH default_maps(test_code, consumable_code) AS (
  VALUES
    ('CBC', 'CBC-REAGENT-TEST'), ('CBC', 'EDTA-TUBE'),
    ('BSF', 'GLUCOSE-REAGENT-TEST'), ('BS2H', 'GLUCOSE-REAGENT-TEST'),
    ('CRP', 'CRP-KIT-TEST'),
    ('LFT', 'ALT-REAGENT-TEST'), ('LFT', 'AST-REAGENT-TEST'), ('LFT', 'ALP-REAGENT-TEST'), ('LFT', 'BIL-T-REAGENT-TEST'), ('LFT', 'BIL-D-REAGENT-TEST'), ('LFT', 'TP-REAGENT-TEST'), ('LFT', 'ALB-REAGENT-TEST'),
    ('KFT', 'UREA-REAGENT-TEST'), ('KFT', 'CREATININE-REAGENT-TEST'), ('KFT', 'URIC-ACID-REAGENT-TEST'),
    ('LIPID', 'CHOL-REAGENT-TEST'), ('LIPID', 'TG-REAGENT-TEST'), ('LIPID', 'HDL-REAGENT-TEST'), ('LIPID', 'LDL-REAGENT-TEST'),
    ('TSH', 'TSH-REAGENT-TEST'), ('HBA1C', 'HBA1C-REAGENT-TEST'),
    ('URINE', 'URINE-CONTAINER'), ('URINE', 'URINE-STRIP-TEST'),
    ('UCR', 'URINE-CONTAINER'), ('UCR', 'CULTURE-MEDIA-TEST'), ('UCR', 'AST-DISC-TEST'),
    ('STOOL', 'STOOL-CONTAINER'), ('STOOL', 'MICROSCOPE-SLIDE'),
    ('ECG', 'ECG-PAPER-TEST'), ('ECHO', 'ULTRASOUND-GEL-TEST'),
    ('CXR', 'XRAY-FILM-TEST'), ('ABDXR', 'XRAY-FILM-TEST'),
    ('USG', 'ULTRASOUND-GEL-TEST'), ('USGLV', 'ULTRASOUND-GEL-TEST'), ('USGNCK', 'ULTRASOUND-GEL-TEST'),
    ('WIDAL', 'WIDAL-KIT-TEST'), ('MPS', 'MICROSCOPE-SLIDE'), ('MPS', 'GIEMSA-STAIN-TEST'),
    ('DENGUE', 'DENGUE-NS1-KIT-TEST'), ('COVID', 'COVID-AG-KIT-TEST'), ('COVID', 'SWAB'),
    ('TROPON', 'TROPONIN-I-KIT-TEST'), ('PT', 'PT-REAGENT-TEST'), ('APTT', 'APTT-REAGENT-TEST'),
    ('BILT', 'BIL-T-REAGENT-TEST'), ('BILT', 'BIL-D-REAGENT-TEST'),
    ('HBsAg', 'HBSAG-KIT-TEST'), ('ANTIHCV', 'HCV-KIT-TEST'), ('PSA', 'PSA-REAGENT-TEST')
), resolved AS (
  SELECT m.id AS map_id
  FROM default_maps dm
  JOIN lab_test_catalog t ON t.tenant_id = 100 AND UPPER(t.code) = UPPER(dm.test_code)
  JOIN lab_consumables c ON c.tenant_id = 100 AND UPPER(c.code) = UPPER(dm.consumable_code)
  JOIN lab_test_consumable_map m ON m.tenant_id = 100 AND m.lab_test_id = t.id AND m.consumable_id = c.id
)
UPDATE lab_test_consumable_map
SET is_active = 1,
    deleted_at = NULL,
    effective_to = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT map_id FROM resolved);
