# Database Schema Overview

> **Source paths:** `sql/database.sql` (15,382 lines, 280 tables),
> `version.php`
> **Documented version:** OpenEMR 8.0.1-dev (`v_database = 535`)

OpenEMR's schema is a single ~15,400-line SQL file (`sql/database.sql`)
defining 280 tables. There is **no ORM** — services query through
`QueryUtils` with raw SQL, and the schema is the source of truth for
types, defaults, and indexes.

---

## 1. Scale

| Metric | Value |
|---|---|
| Total tables | **280** (`grep -c "^CREATE TABLE" sql/database.sql`) |
| Lines in `database.sql` | 15,382 |
| Primary engine | **InnoDB** (older CREATE TABLEs are MyISAM — migration in progress) |
| Default charset | **utf8mb4** (set in `src/BC/DatabaseConnectionFactory.php`) |
| Database version constant | `$v_database = 535` in `version.php` |
| Upgrade scripts | 32 (`sql/X_Y_Z-to-A_B_C_upgrade.sql`, 2.6.0 → 8.0.1) |

---

## 2. Topical table groups

The 280 tables cluster into ~30 functional groups. This is the mental
map; for individual CREATE TABLE statements see `key-tables.md`.

### 2.1 Patient

| Table | Rows typical | Notes |
|---|---|---|
| `patient_data` | 1 per patient | 130+ columns of demographics. PK `id BIGINT`, also has `pid` and `uuid BINARY(16)`. |
| `patient_history` | 1 per patient | History of demographic changes (audit-like). |
| `patient_settings` | many per patient | Free-form key/value patient preferences. |
| `patient_birthday_alert` | — | Tracks birthday-alert state. |
| `patient_reminders` | many | Patient reminder log. |
| `patient_tracker` | many | Encounter flow board (waiting/in-visit/billed). |
| `patient_tracker_element` | many | Custom tracker columns. |
| `recent_patients` | many | Per-user "recently opened" patient list. |
| `patient_access_onsite` | 0–1 per patient | Patient portal credentials. |
| `patient_portal_menu` | many | Patient portal menu customization. |
| `patient_treatment_intervention_preferences` | many | USCDI preferences. |
| `patient_care_experience_preferences` | many | USCDI preferences. |
| `patient_issues_*` (in `lists_medication`, `lists_touch`) | many | Touched-issues log. |
| `employer_data` | many | Patient employer. |
| `insurance_data` | many per patient | Payer + policy numbers per patient. |
| `insurance_numbers` | many | Plan numbers (per-company). |
| `insurance_companies` | many | Insurance company master. |
| `insurance_type_codes` | lookup | Plan type codes. |
| `pharmacies` | lookup | Pharmacy directory. |

### 2.2 Encounter (visits)

| Table | Notes |
|---|---|
| `form_encounter` | The visit record (PK `encounter`, FK `pid`). One row per encounter. |
| `issue_encounter` | M:N between `form_encounter` and `lists` (issues linked to a visit). |

### 2.3 Clinical forms (one table per form)

The `form_*` pattern: each clinical form has its own `form_xxx` table
keyed by `id` with an `encounter` and `pid` FK.

| Form | Table |
|---|---|
| Vitals | `form_vitals`, `form_vital_details`, `form_vitals_calculation`, `form_vitals_calculation_components`, `form_vitals_calculation_form_vitals` |
| SOAP | `form_soap` |
| Review of systems | `form_ros`, `form_reviewofs` |
| Care plan | `form_care_plan` |
| Clinical instructions | `form_clinical_instructions` |
| Eye exam (ophthalmology) | `form_eye_base`, `form_eye_hpi`, `form_eye_ros`, `form_eye_vitals`, `form_eye_acuity`, `form_eye_refraction`, `form_eye_biometrics`, `form_eye_external`, `form_eye_antseg`, `form_eye_postseg`, `form_eye_neuro`, `form_eye_locking`, `form_eye_mag_dispense`, `form_eye_mag_prefs`, `form_eye_mag_orders`, `form_eye_mag_impplan`, `form_eye_mag_wearing` |
| Dictation | `form_dictation` |
| Misc billing | `form_misc_billing_options` |
| Observation | `form_observation` |
| Task management | `form_taskman` |
| Group encounter | `form_groups_encounter`, `form_group_attendance` |
| SDOH | `form_history_sdoh`, `form_history_sdoh_health_concerns` |
| Questionnaire | `form_questionnaire_assessments` |
| Functional / cognitive | `form_functional_cognitive_status` |
| Clinical notes (FHIR) | `clinical_notes_documents`, `clinical_notes_procedure_results` |
| History | `history_data` (old single-table history with name/value pairs) |

There is also a meta-table `forms` that registers each form (its table
name, ACL section, render class, etc.).

### 2.4 The universal `lists` table (issues)

The single most important clinical table:

| Table | Notes |
|---|---|
| `lists` | Universal issues: problems, allergies, medications, surgeries, dental, referrals. ~15 `type` values. |
| `lists_medication` | Medication-specific fields. FK `list_id`. |
| `lists_touch` | Logs every change to a `lists` row. |
| `list_options` | Lookup values (issues, yes/no, etc.) — drives dropdowns. |
| `issue_types` | Allowed `lists.type` values. |
| `issue_encounter` | M:N between `lists` and `form_encounter`. |

The `lists` table is intentionally wide: a single row represents one
clinical issue of any kind, and the `type` column discriminates. A
medication issue also has a 1:1 row in `lists_medication`.

### 2.5 Medications / prescriptions

| Table | Notes |
|---|---|
| `prescriptions` | One row per prescription (drug, dose, route, refills). |
| `drugs` | Drug master. |
| `drug_templates` | Reusable prescription templates (favorite sigs). |
| `drug_inventory` | Lot tracking. |
| `drug_sales` | Dispense log. |
| `product_warehouse` | Warehouse for inventory. |
| `erx_rx_log` | e-Rx log. |
| `erx_narcotics` | Narcotic-class drug flag. |

### 2.6 Lab / imaging / procedures

| Table | Notes |
|---|---|
| `procedure_order` | One row per order (lab / imaging / procedure). |
| `procedure_order_code` | One row per code on an order. |
| `procedure_questions` | The questions (questionnaire) attached to an order type. |
| `procedure_answers` | The answers to those questions. |
| `procedure_report` | The result report. |
| `procedure_result` | Individual result rows (LOINC-coded). |
| `procedure_specimen` | Specimen metadata. |
| `procedure_order_relationships` | M:N between orders (e.g. reflex orders). |
| `procedure_type` | Order-type master. |
| `procedure_providers` | Provider directory. |
| `procedure_questions` | (above) |
| `external_procedures` | Imported procedures (HL7). |
| `external_encounters` | Imported encounters. |

### 2.7 Immunizations

| Table | Notes |
|---|---|
| `immunizations` | One row per administered vaccine. |
| `immunization_observation` | VAERS-style observations. |
| `codes` (CVX subset) | Local CVX code catalogue (also `sql/cvx_codes.sql` for the full list). |

### 2.8 Documents

| Table | Notes |
|---|---|
| `documents` | One row per file (URL or blob). |
| `categories` | Hierarchical document categories. |
| `categories_seq` | Sequence for nested-set lft/rght. |
| `categories_to_documents` | M:N. |
| `onsite_documents` | Patient-portal-uploaded docs. |
| `documents_legal_master` / `_detail` / `_categories` | Legal e-signature docs. |
| `document_templates` | Reusable doc templates. |
| `document_template_profiles` | Template profiles. |
| `esign_signatures` | E-signature log. |
| `onsite_signatures` | Patient-side e-signatures. |

### 2.9 Billing / claims

| Table | Notes |
|---|---|
| `billing` | The line-item charge (CPT/HCPCS, fee, modifier, units). |
| `claims` | One row per X12 claim (HCFA-1500 / UB-04). |
| `payments` | Payment header. |
| `enc_category_map` | Maps encounters to billing categories. |
| `fee_schedule` | The fee schedule (price list). |
| `fee_sheet_options` | Per-user fee sheet preferences. |
| `ar_activity` (legacy, removed) | — (removed in 8.0; replaced by `transactions` + `payments`) |
| `transactions` | Financial transactions. |
| `voids` | Voided payment log. |
| `edi_sequences` | X12 sequence tracking. |
| `x12_partners` | X12 partner (clearinghouse) master. |
| `x12_remote_tracker` | Inbound X12 999/277 acknowledgement tracker. |
| `eligibility_verification` | X12 270/271 log. |
| `payment_gateway_details` | Stripe / Authorize.Net credentials. |
| `payment_processing_audit` | Payment processor audit log. |
| `product_registration` | Product license / registration. |
| `report_itemized` | Saved itemized reports. |
| `report_results` | Saved report outputs. |

### 2.10 Users / auth

| Table | Notes |
|---|---|
| `users` | User profile (name, role, authorized flag, info, active). |
| `users_secure` | **Separate** table for password + MFA secret + login_work_area (split for security; see `key-tables.md`). |
| `users_facility` | M:N users ↔ facilities. |
| `user_settings` | Per-user preferences. |
| `facility` | Facility master (clinic, lab, etc.). |
| `facility_user_ids` | Facility-scoped provider IDs (NPI, etc.). |
| `groups` | User groups. |

### 2.11 ACL (phpGACL fork)

30 tables. The "gacl" prefix is a fork of phpGACL 3.x. See
`auth/acl-system.md` and `key-tables.md`.

| Table | Purpose |
|---|---|
| `gacl_acl` | The actual ACL rules (ARO × ACO × AXO). |
| `gacl_acl_sections` / `gacl_acl_seq` | Section metadata. |
| `gacl_aco` | Access Control Objects (things being protected). |
| `gacl_aco_map` / `gacl_aco_sections` / `gacl_aco_sections_seq` / `gacl_aco_seq` | ACO metadata. |
| `gacl_aro` | Access Request Objects (users, groups). |
| `gacl_aro_groups` | ARO groups. |
| `gacl_aro_groups_id_seq` / `gacl_aro_groups_map` / `gacl_aro_map` | ARO group metadata. |
| `gacl_aro_sections` / `gacl_aro_sections_seq` / `gacl_aro_seq` | ARO metadata. |
| `gacl_axo` | Access eXtension Objects (sections within a request). |
| `gacl_axo_groups` / `gacl_axo_groups_map` / `gacl_axo_map` | AXO metadata. |
| `gacl_axo_sections` | AXO sections. |
| `gacl_groups_aro_map` | ARO group membership. |
| `gacl_groups_axo_map` | AXO group membership. |
| `gacl_phpgacl` | Configuration. |

Plus OpenEMR-specific tables:
| Table | Purpose |
|---|---|
| `module_acl_sections` | Module-level ACL sections. |
| `module_acl_user_settings` | Per-user module ACL. |
| `module_acl_group_settings` | Per-group module ACL. |
| `module_configuration` | Module config storage. |
| `modules` | Module registry. |
| `modules_hooks_settings` | Module hook config. |
| `modules_settings` | Module settings. |

### 2.12 Scheduling / appointments

| Table | Notes |
|---|---|
| `openemr_postcalendar_events` | The appointment / calendar event. |
| `openemr_postcalendar_categories` | Event categories (color-coded). |
| `openemr_postcalendar_topics` | Topic categories. |
| `openemr_module_vars` | Calendar module settings. |
| `openemr_modules` | PostNuke PostCalendar module registry. |
| `calendar_external` | External calendar feeds (iCal). |

### 2.13 Audit / logging

| Table | Notes |
|---|---|
| `log` | Every event (login, record view, SQL, etc.). |
| `log_comment_encrypt` | Encrypted long-form log comments. |
| `extended_log` | Cross-patient audit log. |
| `audit_master` | One row per audited action (with date, user, group, patient, success, comment). |
| `audit_details` | N rows per `audit_master` (before/after diff). |
| `audit_scan_*` | Tamper-detection scans. |
| `onetime_auth` | One-time email tokens (patient portal). |
| `verify_email` | Email verification tokens. |
| `ip_tracking` | IP address audit. |
| `notification_log` | Patient notification log (SMS, email). |
| `notification_settings` | Per-patient notification preferences. |
| `api_log` | API request log. |
| `api_token` / `api_refresh_token` | OAuth2 token store. |
| `jwt_grant_history` | Replay-prevention log for JWT client assertions. |
| `oauth_clients` | OAuth2 client registrations. |
| `oauth_trusted_user` | Trusted user (refresh token) records. |
| `session_tracker` | Active sessions (for idle timeout). |
| `login_mfa_registrations` | TOTP / U2F registrations. |
| `track_events` | Custom event tracking (analytics). |
| `automatic_notification` | Per-patient auto-notification rules. |
| `dated_reminders` | Date-triggered reminders. |
| `dated_reminders_link` | Link to patient / encounter. |
| `pnotes` | Internal messages (provider notes). |
| `onotes` | Other notes. |
| `onsite_mail` / `onsite_messages` / `onsite_online` / `onsite_portal_activity` | Patient portal activity. |
| `direct_message_log` | Direct (HISP) message log. |
| `medex_icons` / `medex_outgoing` / `medex_prefs` / `medex_recalls` | MedEx integration. |
| `email_queue` | Outbound email queue. |
| `email_log` | Sent email log. |

### 2.14 Clinical decision support

| Table | Notes |
|---|---|
| `clinical_plans` | CDR plans (custom rules). |
| `clinical_plans_rules` | Rules within a plan. |
| `clinical_rules` | The rule engine rules. |
| `clinical_rules_log` | Rule execution log. |
| `amc_misc_data` | AMC (Appalachian Medical Center) reporting data. |
| `amendments` / `amendments_history` | Record amendments. |
| `benefit_eligibility` | Real-time eligibility benefits. |
| `dsi_source_attributes` | Decision Support Intervention (CDS Hooks) attributes. |
| `value_sets` / `valueset` / `valueset_oid` | VSAC value sets. |
| `rule_action` / `rule_action_item` / `rule_filter` / `rule_patient_data` / `rule_reminder` / `rule_target` | CDR engine internals. |
| `registry` | Patient registry definitions. |
| `syndromic_surveillance` | Public health surveillance events. |
| `report_itemized` / `report_results` | Saved reports. |

### 2.15 Codes / standards

| Table | Notes |
|---|---|
| `codes` | The unified code table (ICD9, ICD10, SNOMED, CPT, HCPCS, NDC, …). |
| `code_types` | The list of code types. |
| `codes_history` | Code import history. |
| `icd9_dx_code` / `icd9_dx_long_code` | ICD-9 diagnosis codes. |
| `icd9_sg_code` / `icd9_sg_long_code` | ICD-9 SG codes. |
| `icd10_dx_order_code` / `icd10_pcs_order_code` | ICD-10 codes (order-specific). |
| `icd10_gem_dx_10_9` / `icd10_gem_dx_9_10` | GEM (General Equivalence Mapping). |
| `icd10_gem_pcs_10_9` / `icd10_gem_pcs_9_10` | PCS GEM. |
| `icd10_reimbr_dx_9_10` / `icd10_reimbr_pcs_9_10` | Reimbursement mappings. |
| `standardized_tables_track` | Tracks which standardized tables have been imported. |
| `supported_external_dataloads` | Supported external code imports. |

### 2.16 Layout / options

| Table | Notes |
|---|---|
| `layout_options` | Per-form field layout (which fields to show, order, ACL). |
| `layout_group_properties` | Per-group layout overrides. |
| `list_options` | Lookup values (see `lists` table). |
| `globals` | The giant `key/value/index → value` settings table. |
| `version` | Database version (mirrors `version.php` `$v_database`). |
| `keys` | Site-level encrypted keys (OAuth2, etc.). |
| `background_services` | Background workers (last-run time, interval). |
| `lang_languages` / `lang_constants` / `lang_definitions` / `lang_custom` | i18n. |
| `customlists` | Custom list options. |
| `template_users` | Template per user (UI templates). |
| `misc_address_book` | Personal address book. |
| `shared_attributes` | Cross-table metadata. |
| `product_registration` | Site registration. |
| `sequences` | Sequence emulation (e.g. `categories_seq`). |
| `ext_*` | (rare) External data imports. |

### 2.17 FHIR / CCDA

| Table | Notes |
|---|---|
| `ccda` | Generated CCDA documents. |
| `ccda_components` / `ccda_sections` / `ccda_field_mapping` / `ccda_table_mapping` | CCDA template mapping. |
| `questionnaire_repository` | FHIR Questionnaire definitions. |
| `questionnaire_response` | FHIR QuestionnaireResponse. |
| `care_teams` / `care_team_member` | Care team composition. |
| `export_job` | `$export` (bulk data) job state. |
| `uuid_registry` | UUIDs that have been assigned. |
| `uuid_mapping` | UUID ↔ table-id mapping (when an entity is referenced across tables). |

### 2.18 Misc

| Table | Notes |
|---|---|
| `addresses` | Generic addresses (used by FHIR/ContactAddress). |
| `phone_numbers` | Generic phone numbers. |
| `contact` | Generic contacts. |
| `contact_telecom` | Telecom (phone, email) for a contact. |
| `contact_relation` | M:N between contacts. |
| `person` | Person (base for Patient + User). |
| `person_patient_link` | Patient ↔ person link. |
| `therapy_groups` / `therapy_groups_participants` / `therapy_groups_counselors` / `therapy_groups_participant_attendance` | Group therapy. |
| `patient_birthday_alert` | Birthday alert state. |
| `notes` | Generic notes. |
| `feesheet_categories` (legacy) | (Removed; categories handled in `fee_sheet_options`.) |

---

## 3. Conventions

### 3.1 Primary key

Most tables use one of:

| Pattern | Example | Use |
|---|---|---|
| `id BIGINT(20) NOT NULL auto_increment` | `patient_data.id`, `form_encounter.encounter` | Single-column auto-increment |
| `id INT(11) NOT NULL auto_increment` | `drugs.drug_id` (rare) | Smaller tables |
| `id INT(11) NOT NULL default '0'` | `categories.id`, `documents.id` (legacy) | Pre-InnoDB |
| No auto-inc | `lists.id` (a `pid`-scoped id assigned by the app) | Composite identity |

### 3.2 UUIDs (`BINARY(16)`)

Most modern tables have:

```sql
`uuid` binary(16) DEFAULT NULL,
```

…plus a unique index on `uuid`. UUIDs are **COMB UUIDs** (time-prefixed
to be index-friendly) generated by `OpenEMR\Common\Uuid\UuidRegistry`.
They are stored as 16 bytes and returned to clients as 36-char strings
via `UuidRegistry::uuidToString()`.

The `uuid_registry` table tracks every UUID that has been issued; the
`uuid_mapping` table maps cross-table references (e.g. a `Person.uuid`
that is also a `Patient.uuid`).

### 3.3 Audit columns

Many tables include:

```sql
`created_by`   INT(11) DEFAULT NULL,
`date_created` DATETIME DEFAULT NULL,
`updated_by`   INT(11) DEFAULT NULL,
`last_updated` DATETIME DEFAULT NULL,
```

(Some tables use `date` instead of `date_created`.)

### 3.4 `pid` (patient id)

Tables that scope rows to a patient typically have:

```sql
`pid` BIGINT(20) NOT NULL DEFAULT '0',
```

…and an index on `pid`. (Note: `pid` and `id` are often both present and
distinct — `id` is the auto-increment PK, `pid` is the patient FK.)

### 3.5 Charset / collation

- `utf8mb4` everywhere
- Collation is `utf8mb4_general_ci` for older tables and
  `utf8mb4_0900_ai_ci` for newer ones (in 8.0+).

### 3.6 Engine

InnoDB is the target. The migration is in progress:

> `#IfInnoDBMigrationNeeded` directive in upgrade scripts finds all
> `ENGINE=MyISAM` tables and converts them to InnoDB.

---

## 4. Indexes

Common index patterns:

| Pattern | Use |
|---|---|
| `PRIMARY KEY (id)` | Standard PK. |
| `UNIQUE KEY uuid (uuid)` | UUID lookup. |
| `KEY pid (pid)` | Patient lookup. |
| `KEY encounter (encounter)` | Encounter lookup. |
| `KEY date (date)` / `KEY dt (dt)` | Date-range scans. |
| `KEY foreign_id (foreign_id)` | Generic FK lookups. |
| Composite `(pid, date)` | Patient + date. |
| Composite `(pid, type)` | Lists / issues. |

---

## 5. `form_*` pattern

Each clinical form has its own table with this column shape:

```sql
CREATE TABLE `form_<name>` (
  `id` bigint(20) NOT NULL auto_increment,
  `date` datetime DEFAULT NULL,
  `pid` bigint(20) NOT NULL DEFAULT '0',
  `user` varchar(255) NOT NULL DEFAULT '',
  `groupname` varchar(255) NOT NULL DEFAULT '',
  `authorized` tinyint(4) NOT NULL DEFAULT '0',
  `activity` tinyint(4) NOT NULL DEFAULT '1',
  `encounter` bigint(20) NOT NULL DEFAULT '0',
  /* form-specific fields below */
  PRIMARY KEY (`id`),
  KEY `pid` (`pid`),
  KEY `encounter` (`encounter`),
  KEY `date` (`date`)
) ENGINE=InnoDB;
```

`pid` and `encounter` are the standard join keys. The form is rendered
by `OpenEMR\Services\FormService` and saved via
`OpenEMR\Services\FormService::save()` which dispatches
`form.saved` events.

The `forms` meta-table registers each form (its table name, ACL
section, render class, etc.).

---

## 6. The `lists` table (universal issues)

The single most important clinical table. Represents **any** kind of
clinical issue:

| Column | Type | Notes |
|---|---|---|
| `id` | INT | PK |
| `pid` | BIGINT | Patient |
| `type` | VARCHAR(255) | `medical_problem`, `allergy`, `medication`, `surgery`, `dental`, `referral`, etc. |
| `title` | VARCHAR(255) | Title (often a code) |
| `diagnosis` | VARCHAR(255) | Code (e.g. `I10`) |
| `begdate` | DATE | Onset |
| `enddate` | DATE | Resolution |
| `outcome` | INT | 0 = active, 1 = resolved |
| `comments` | TEXT | Free text |
| `list_option_id` | (legacy) | FK to `list_options` for custom dropdowns |
| `created_by` / `date_created` | — | Audit |
| `updated_by` / `last_updated` | — | Audit |

Indexed on `(pid, type)`, `(pid, begdate)`.

The `lists_medication` table holds medication-specific fields (dose,
route, frequency, etc.) with `list_id` as the FK.

The `lists_touch` table is a write-ahead log of every change to a
`lists` row (used for "touched" reports in the UI).

---

## 7. See also

- [`connection-layer.md`](./connection-layer.md) — how the schema is queried
- [`migrations.md`](./migrations.md) — schema evolution
- [`key-tables.md`](./key-tables.md) — per-table deep dive
- `sql/database.sql` — the schema itself
