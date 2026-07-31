# HMS Database Migrations - Complete Timeline

## Migration Architecture

**Total Migrations:** 153  
**Format:** Numbered SQL files  
**Database:** SQLite (Cloudflare D1)  
**ORM:** Drizzle ORM  

---

## MIGRATION PHASES

### PHASE 1: FOUNDATION (0001-0020)
**Purpose:** Core schema and initial features  
**Migration Files:**

```
0001_fix_schema_add_missing_tables.sql
└─ Initial comprehensive schema
   ├─ Core tables: patients, users, visits, appointments
   ├─ Clinical tables: consultations, diagnoses
   ├─ Operational tables: departments, staff, beds
   └─ System tables: roles, permissions

0002_add_invitations.sql
└─ User invitation system for multi-tenant onboarding

0003_add_icd10_to_visits.sql
└─ ICD-10 diagnosis coding

0004_payment_gateway.sql
└─ Payment gateway integration (bKash, Nagad)

0005_multi_branch.sql
└─ Multi-branch/multi-location support

0006_telemedicine.sql
└─ Video consultation infrastructure

0007_appointments.sql
└─ Appointment scheduling enhancements

0008_prescriptions.sql
└─ Prescription management system

0009_prescriptions_unique_rxno.sql
└─ Unique prescription number constraint

0010_lab_order_clinical_fields.sql
└─ Lab order clinical metadata

0011_prescriptions_dispense_status.sql
└─ Pharmacy dispensing status tracking

0012_admissions_beds.sql
└─ IPD admission and bed management

0013_notifications.sql
└─ System notification infrastructure

0014_patient_vitals.sql
└─ Vital signs tracking

0015_discharge_summaries.sql
└─ Discharge documentation

0016_ipd_charges.sql
└─ Inpatient bed/room charges

0017_insurance.sql
└─ Insurance management and claims

0018_vitals_alerts.sql
└─ Critical value alerts for vitals

0019_prescription_sharing.sql
└─ Patient prescription sharing

0020_ai_memory.sql
└─ AI system memory/learning
```

### PHASE 2: SPECIALIZED MODULES (0020-0050)
**Purpose:** Pharmacy, Lab, Operations  
**Key Additions:**

```
0020_pharmacy_sales.sql          → Pharmacy sales tracking
0021_push_subscriptions.sql      → Push notification subscriptions
0022_lab_enhancements.sql        → Lab workflow improvements
0023_onboarding_queue.sql        → Hospital onboarding queue
0024_patient_portal.sql          → Patient portal infrastructure
0025_patient_portal_v2.sql       → Portal v2 enhancements
0026_lab_critical_thresholds.sql → Lab alert thresholds
0027_fix_insurance_claims_fk.sql → Constraint fixes
0028_subscriptions.sql           → Feature subscriptions
0029_hospital_website.sql        → Hospital website builder
0030_website_analytics.sql       → Web analytics
0031_website_analytics_subdomain.sql → Custom domain analytics
0032_emergency.sql              → Emergency department
0033_operation_theatre.sql      → Operation theatre management
0034_clinical_enhancements.sql  → Enhanced clinical documentation
0035_advanced_billing.sql       → Advanced billing features
0035b_billing_alter_columns.sql → Billing schema adjustments
0036_enhance_shareholders.sql   → Shareholder management
0037_inventory.sql              → MAJOR: Inventory system (30KB)
0038_patient_missing_columns.sql → Patient schema fixes
```

### PHASE 3: TIER-BASED PORTS (0040-0077)
**Purpose:** Legacy system conversion from DanpheEMR  
**Pattern:** Multi-step porting to modern schema

```
0040-0051: Core domain conversions
├─ Visits, appointments, consultations
├─ Lab orders and results  
├─ Nursing documentation

0052-0072: Clinical specializations
├─ Nursing MAR (Medication Admin Record)
├─ Clinical assessments
├─ Radiology with DICOM
├─ Medical records
├─ Pharmacy v2 overhaul

0073_uhid_system.sql            → Patient UHID/MRN system
0073_clinical_forms.sql         → Dynamic clinical forms

0074-0077: FINAL PORTS
├─ Tier 1: Foundation tables
├─ Tier 2: Operational tables
├─ Tier 3: Clinical tables
└─ Tier 4: Reporting tables
```

### PHASE 4: OPERATIONS & HR (0078-0095)
**Purpose:** Staff management, facilities  

```
0078_duty_roster_biometric.sql    → Biometric-integrated roster
0079_opd_queue_tokens.sql         → Queue management tokens
0080_asset_management_amc.sql     → Asset tracking + AMC
0081_kitchen_management.sql       → Kitchen/dietary management
0082_blood_bank.sql               → Blood bank operations
0083_medico_legal_cases.sql       → MLC tracking
0084_cssd.sql                     → Central Sterile Supply
0085_mfa_totp.sql                 → MFA with TOTP
0086_laundry.sql                  → Laundry management
0087_housekeeping.sql             → Housekeeping operations
0088_ambulance.sql                → Ambulance service
0089_mortuary.sql                 → Mortuary management
0090_patient_duplicate_merge.sql  → Duplicate detection/merge
0091_whatsapp_messaging.sql       → WhatsApp integration
0092_global_patient_auth.sql      → Global patient authentication
0092_print_templates.sql          → Print template system
```

### PHASE 5: QUALITY & COMPLIANCE (0093-0117)
**Purpose:** Healthcare standards, data governance  

```
0093_discharge_planning.sql       → Structured discharge planning
0093_patient_auth_hardening.sql   → Auth security improvements
0094_biomedical_waste.sql         → Biomedical waste tracking
0095_b2c_patient_vault.sql        → Secure patient vault
0096_consent_model_v2.sql         → Comprehensive consent management
0097_central_terminology.sql      → Centralized medical codes
0098_terminology_seed_data.sql    → Seed ICD-10, SNOMED, etc.
0099_mpi_hardening.sql            → Master Patient Index security
0100_unmerge_columns.sql          → Reverse patient merge
0101_health_cards.sql             → National health ID cards
0102_lab_loinc.sql                → LOINC code integration
0103_merge_map.sql                → Patient merge mapping
0104_consent_clinical_areas.sql   → Granular consent by area
0105_global_identity_claims.sql   → Global patient identity claims
0106_global_identity_nullable.sql → Identity field nullability
0107_patient_claim_codes.sql      → Patient ID claim codes
0108_clinical_review_status.sql   → Clinical review status
0108_consent_purpose_defaults.sql → Consent purpose defaults
0109_patient_reported_experience.sql → Patient feedback
```

### PHASE 6: GLOBAL HEALTH ECOSYSTEM (0110-0142)
**Purpose:** Cross-hospital, wellness, AI  

```
0110_patient_visit_passes.sql     → Visit pass system
0111_global_family_links.sql      → Family relationships (global)
0112_global_family_proxy_invites.sql → Family proxy access
0113_patient_vault_r2_uploads.sql → Cloud storage integration
0114_wallet_export_snapshots.sql  → Patient wallet export
0115_clinical_provenance_sources.sql → Data source tracking
0116_global_patient_vitals.sql    → Global vital signs

0117_global_identity_nullable_prod_hotfix.sql
└─ Production hotfix

MARKETPLACE PHASE:
0118_marketplace_tenant_columns.sql
0118_patient_ai_plans.sql        → AI-generated care plans
0119_marketplace_doctor_columns.sql
0119_patient_ai_plan_progress.sql → Plan progress tracking
0120_marketplace_bookings.sql    → Appointment bookings
0121_provider_reviews.sql         → Doctor/provider ratings
0122_doctor_auth.ts              → Doctor authentication
0123_marketplace_indexes.sql     → Performance optimization

WELLNESS PHASE:
0124_lifestyle_water_and_medicine.sql → Lifestyle tracking
0125_master_drugs_nocase_indexes.sql → Drug search optimization
0126_patient_medicine_reminder_strength_and_amount.sql
└─ Medicine reminder system
0127_health_tips_feedback_analytics.sql → Health tips system
0128_global_patient_reported_data_bootstrap.sql → Data migration
0129_wellness_profile.sql        → Wellness tracking profile
0130_wellness_logs.sql           → Wellness activity logs
0131_food_system.sql             → Nutrition/food tracking
0132_ai_insights.sql             → AI-powered health insights
0133_hospital_linking.sql        → Inter-hospital linking
0134_user_devices.sql            → Device management
0135_barcode_foods.sql           → Barcode scanning for food
0136_wearable_samples.sql        → Wearable device data
0137_mental_health_screenings.sql → Mental health assessments
0138_cycle_meditation.sql        → Meditation tracking
0139_walking_challenges.sql      → Physical activity challenges
0140_onboarding_progress.sql     → Onboarding workflow
0141_patient_amendments.sql      → Patient record amendments
0142_patient_devices.sql         → Patient device tracking
```

### SEED DATA
```
seed_demo.sql                   → Basic demo dataset
seed_demo_extended.sql          → Extended demo data
seed_pharmacy_demo.sql          → Pharmacy demo data
seed_pharmacy_stock_fill.sql    → Initial stock levels
```

---

## FEATURE COVERAGE BY MIGRATION PHASE

### Phase 1: Foundation (0001-0020)
✅ Core EHR/EMR  
✅ Basic billing  
✅ Appointments  
✅ Vital tracking  
✅ Lab orders  

### Phase 2: Specialized (0020-0050)
✅ Pharmacy  
✅ Emergency dept  
✅ Operation theatre  
✅ Advanced billing  
✅ Inventory basics  
✅ Hospital website  

### Phase 3: Ports (0040-0077)
✅ Complete legacy conversion  
✅ Radiology with DICOM  
✅ Nursing MAR  
✅ Medical records  
✅ UHID/MRN system  

### Phase 4: Operations (0078-0095)
✅ HR/Payroll  
✅ Facilities (11 departments)  
✅ Quality & MFA  
✅ Patient duplicate handling  

### Phase 5: Compliance (0093-0117)
✅ FHIR/terminology  
✅ Consent management v2  
✅ Privacy controls  
✅ Audit systems  
✅ Global MPI  

### Phase 6: Ecosystem (0118-0142)
✅ Marketplace  
✅ Wellness tracking  
✅ AI insights  
✅ Global patient identity  
✅ Wearable integration  
✅ Multi-tenant enhancements  

---

## DATABASE STATISTICS

| Category | Count | Status |
|----------|-------|--------|
| Foundation tables | 25+ | ✅ |
| Clinical tables | 40+ | ✅ |
| Operational tables | 35+ | ✅ |
| Financial tables | 20+ | ✅ |
| System tables | 15+ | ✅ |
| **TOTAL TABLES** | **100+** | ✅ |

---

## SCHEMA EVOLUTION PATTERNS

### Design Principles
1. **Additive**: New migrations add features, rarely remove
2. **Versioned**: Schema versions tracked implicitly
3. **Constrained**: Check constraints for data integrity
4. **Indexed**: Performance indexes for common queries
5. **Normalized**: 3NF for most tables, denormalized for performance

### Common Migration Types

**Data Model Additions**
```sql
0007_appointments.sql       -- New entity with full schema
0012_admissions_beds.sql    -- Domain-specific model
```

**Schema Enhancements**
```sql
0010_lab_order_clinical_fields.sql  -- Add fields to existing table
0026_lab_critical_thresholds.sql    -- Extend functionality
```

**Integration Points**
```sql
0029_hospital_website.sql   -- New subsystem
0091_whatsapp_messaging.sql -- External integration
```

**Security & Compliance**
```sql
0085_mfa_totp.sql          -- Security feature
0096_consent_model_v2.sql  -- Privacy compliance
0097_central_terminology.sql -- Data standardization
```

**Performance**
```sql
0049_performance_indexes.sql -- Query optimization
0125_master_drugs_nocase_indexes.sql -- Search optimization
0123_marketplace_indexes.sql -- Marketplace scaling
```

---

## MIGRATION BEST PRACTICES EVIDENT

1. ✅ **Granular Changes**: One feature per migration (mostly)
2. ✅ **Clear Naming**: Purpose evident from filename
3. ✅ **Progressive Building**: Features layer logically
4. ✅ **Backwards Compatible**: Older code still works
5. ✅ **Fixup Migrations**: Bug fixes and constraint corrections
6. ✅ **Seed Data**: Demo and reference data included
7. ✅ **Large Features**: Major features (inventory) in single file
8. ✅ **Hotfixes**: Production issues addressed quickly

---

## DEPLOYMENT NOTES

**Migration Order:**
- Always run sequentially (0001, 0002, ... 0142)
- Seed data optional but recommended
- No parallel migration execution
- Rollback capability limited (mostly additive)

**Large Migrations:**
- 0001_fix_schema (23KB) - Initial schema
- 0037_inventory (30KB) - Inventory system
- 0052_clinical_mar (various) - Nursing module

**Data Sensitive:**
- 0090_patient_duplicate_merge - Requires data handling
- 0100_unmerge_columns - Reverse merge operations
- 0128_global_patient_reported_data_bootstrap - Data migration

