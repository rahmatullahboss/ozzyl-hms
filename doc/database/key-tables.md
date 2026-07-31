# Key Tables

> **Source path:** `sql/database.sql`
> **Documented version:** OpenEMR 8.0.1-dev (`v_database = 535`)

This file is the per-table deep dive. For the high-level overview see
[`schema-overview.md`](./schema-overview.md).

Each section below shows:
- **PK** — primary key
- **FKs** — foreign keys (logical; many are not declared as SQL FKs in
  OpenEMR — referential integrity is enforced in PHP)
- **Important columns** — the ones you need to know
- **Indexes** — what the table is fast at
- **What it stores** — the conceptual purpose

---

## 1. `patient_data` — the patient master record

> Source: `sql/database.sql` line 8333
> One of the largest tables; ~130+ columns.

```sql
CREATE TABLE `patient_data` (
  `id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `title` varchar(255) NOT NULL default '',
  `language` varchar(255) NOT NULL default '',
  `financial` varchar(255) NOT NULL default '',
  `fname` varchar(255) NOT NULL default '',
  `lname` varchar(255) NOT NULL default '',
  `mname` varchar(255) NOT NULL default '',
  `DOB` date default NULL,
  `street` varchar(255) NOT NULL default '',
  `postal_code` varchar(255) NOT NULL default '',
  `city` varchar(255) NOT NULL default '',
  `state` varchar(255) NOT NULL default '',
  `country_code` varchar(255) NOT NULL default '',
  `drivers_license` varchar(255) NOT NULL default '',
  `ss` varchar(255) NOT NULL default '',
  `occupation` longtext,
  `phone_home` varchar(255) NOT NULL default '',
  `phone_biz` varchar(255) NOT NULL default '',
  `phone_contact` varchar(255) NOT NULL default '',
  `phone_cell` varchar(255) NOT NULL default '',
  `pharmacy_id` int(11) NOT NULL default '0',
  `status` varchar(255) NOT NULL default '',
  `contact_relationship` varchar(255) NOT NULL default '',
  `date` datetime default NULL,
  `sex` varchar(255) NOT NULL default '' COMMENT 'Sex at birth',
  `referrer` varchar(255) NOT NULL default '',
  `referrerID` varchar(255) NOT NULL default '',
  `providerID` int(11) default NULL,
  `ref_providerID` int(11) default NULL,
  `email` varchar(255) NOT NULL default '',
  `email_direct` varchar(255) NOT NULL default '',
  `ethnoracial` varchar(255) NOT NULL default '',
  `race` varchar(255) NOT NULL default '',
  `ethnicity` varchar(255) NOT NULL default '',
  `religion` varchar(40) NOT NULL default '',
  `interpreter` varchar(255) NOT NULL default '',
  `interpreter_needed` TEXT,
  `migrantseasonal` varchar(255) NOT NULL default '',
  `family_size` varchar(255) NOT NULL default '',
  `monthly_income` varchar(255) NOT NULL default '',
  `billing_note` text,
  `homeless` varchar(255) NOT NULL default '',
  `financial_review` datetime default NULL,
  `pubpid` varchar(255) NOT NULL default '',
  `pid` bigint(20) NOT NULL default '0',
  `genericname1` varchar(255) NOT NULL default '',
  `genericval1` varchar(255) NOT NULL default '',
  `genericname2` varchar(255) NOT NULL default '',
  `genericval2` varchar(255) NOT NULL default '',
  `hipaa_mail` varchar(3) NOT NULL default '',
  `hipaa_voice` varchar(3) NOT NULL default '',
  `hipaa_notice` varchar(3) NOT NULL default '',
  `hipaa_message` varchar(20) NOT NULL default '',
  `hipaa_allowsms` VARCHAR(3) NOT NULL DEFAULT 'NO',
  `hipaa_allowemail` VARCHAR(3) NOT NULL DEFAULT 'NO',
  `squad` varchar(32) NOT NULL default '',
  `fitness` int(11) NOT NULL default '0',
  `referral_source` varchar(30) NOT NULL default '',
  -- … ~80 more columns: deceased, death_date, mothers_name, guardians,
  -- allow_patient_portal, prevent_patient_portal_audit, … (see source)
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `pid` (`pid`),
  KEY `pubpid` (`pubpid`),
  KEY `fname_lname` (`fname`, `lname`, `DOB`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `id` | Auto-increment PK |
| `uuid` | `BINARY(16)`, the FHIR-compatible identifier |
| `pid` | Patient ID (almost always == `id`, kept distinct for historical reasons) |
| `pubpid` | Public / external patient ID (MRN) |
| `fname`, `mname`, `lname` | Name parts |
| `DOB` | Date of birth |
| `sex` | Sex at birth (free text; commonly `M`/`F`/`other`) |
| `providerID` | FK to `users.id` (primary provider) |
| `ref_providerID` | FK to `users.id` (referring provider) |
| `pharmacy_id` | FK to `pharmacies.id` (preferred pharmacy) |
| `hipaa_*` | HIPAA consent flags |
| `allow_patient_portal` | YES/NO portal eligibility |

**Stores:** the entire patient demographics record. Every clinical,
billing, and FHIR operation goes through this table.

---

## 2. `form_encounter` — the visit record

> The encounter (visit) is the unit of clinical work.

```sql
CREATE TABLE `form_encounter` (
  `id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `date` datetime default NULL,
  `reason` longtext,
  `facility` longtext,
  `facility_id` int(11) NOT NULL default '0',
  `pid` bigint(20) NOT NULL default '0',
  `encounter` bigint(20) NOT NULL default '0',
  `encounter_ip_title` longtext,
  `onset_date` datetime default NULL,
  `priority_id` INT(11) DEFAULT NULL,
  `provider_id` INT(11) DEFAULT '0',
  `billing_facility` INT(11) NOT NULL DEFAULT '0',
  `billing_provider_id` INT(11) NOT NULL DEFAULT '0',
  `visit_type` VARCHAR(255) DEFAULT NULL,
  `review_of_systems` INT(11) DEFAULT NULL,
  `provider_mfa` VARCHAR(100) DEFAULT NULL,
  `eSign_why` TEXT,
  `parent_encounter_id` BIGINT(20) DEFAULT NULL,
  `pc_catid` INT(11) DEFAULT NULL,
  `last_update` DATETIME DEFAULT NULL,
  `last_update_by` INT(11) DEFAULT NULL,
  `sensitivity` VARCHAR(64) DEFAULT 'normal',
  `referral_source_id` INT(11) DEFAULT NULL,
  `sensitivity_concept_id` INT(11) DEFAULT NULL,
  `group_id` INT(11) DEFAULT NULL,
  `created_by` INT(11) DEFAULT NULL,
  `updated_by` INT(11) DEFAULT NULL,
  `date_created` DATETIME DEFAULT NULL,
  `last_updated` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `pid_encounter` (`pid`, `encounter`),
  KEY `date` (`date`),
  KEY `pid_date` (`pid`, `date`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `pid` | Patient (FK `patient_data.pid`) |
| `encounter` | Encounter number (the public-facing ID for the visit) |
| `date` | Visit date |
| `facility_id` | FK `facility.id` |
| `provider_id` | FK `users.id` (rendering provider) |
| `visit_type` | e.g. `office_visit`, `telephone_encounter`, `home_visit` |
| `pc_catid` | FK to `openemr_postcalendar_categories` (color-coded) |
| `sensitivity` | FK to `sensitivities` ACO; e.g. `normal`/`high` |
| `parent_encounter_id` | Link to a parent encounter (rarely used) |
| `group_id` | FK `therapy_groups.id` (group therapy encounters) |

**Stores:** one row per visit. Every `form_*` clinical record hangs off
this row via its `encounter` and `pid` columns.

---

## 3. `openemr_postcalendar_events` — appointments

> The scheduler. Backed by the legacy PostNuke PostCalendar module.

```sql
CREATE TABLE `openemr_postcalendar_events` (
  `pc_eid` int(11) unsigned NOT NULL auto_increment,
  `pc_aid` varchar(30) NOT NULL default '',
  `pc_pid` bigint(20) NOT NULL default '0',
  `pc_gid` int(11) NOT NULL default '0',
  `pc_nm` varchar(60) NOT NULL default '',
  `pc_attendant` varchar(20) NOT NULL default '0',
  `pc_institution` varchar(20) NOT NULL default '0',
  `pc_room` varchar(20) NOT NULL default '',
  `pc_title` varchar(80) NOT NULL default '',
  `pc_hometext` longtext,
  `pc_category` varchar(40) NOT NULL default '',
  `pc_status` varchar(20) NOT NULL default '-',
  `pc_eventDate` date NOT NULL default '0000-00-00',
  `pc_endDate` date NOT NULL default '0000-00-00',
  `pc_duration` bigint(20) NOT NULL default '0',
  `pc_recurrtype` int(11) NOT NULL default '0',
  `pc_recurrspec` longtext,
  `pc_recurrfreq` int(11) NOT NULL default '0',
  `pc_startTime` time default NULL,
  `pc_endTime` time default NULL,
  `pc_alldayevent` int(11) NOT NULL default '0',
  `pc_priority` int(11) NOT NULL default '5',
  `pc_calendarmethod` varchar(40) NOT NULL default 'PUBLISH',
  `pc_eventstatus` int(11) NOT NULL default '0',
  `pc_sharing` int(11) NOT NULL default '0',
  `pc_encounter` bigint(20) NOT NULL default '0',
  `pc_apptstatus` varchar(11) NOT NULL default '-',
  `pc_apptstat_last_update` DATETIME DEFAULT NULL,
  `pc_apptstat_last_update_by` INT(11) DEFAULT NULL,
  `pc_completed_by` INT(11) DEFAULT NULL,
  `pc_completed_date` DATETIME DEFAULT NULL,
  `pc_cancelled_reason` TEXT,
  `pc_room_id` INT(11) DEFAULT NULL,
  `pc_facility` INT(11) NOT NULL DEFAULT '0',
  `pc_billing_location` varchar(60) NOT NULL default '',
  `pc_specialty` INT(11) DEFAULT NULL,
  `pc_visit_type` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`pc_eid`),
  KEY `pc_eventDate` (`pc_eventDate`),
  KEY `pc_pid_pc_eventDate` (`pc_pid`, `pc_eventDate`),
  KEY `pc_aid_pc_eventDate` (`pc_aid`, `pc_eventDate`),
  KEY `pc_status_pc_eventDate` (`pc_status`, `pc_eventDate`),
  KEY `pc_encounter` (`pc_encounter`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `pc_eid` | Appointment ID |
| `pc_pid` | Patient (FK `patient_data.pid`) |
| `pc_aid` | Provider (FK `users.username` — yes, username, not id) |
| `pc_gid` | Group (FK `groups.id`) |
| `pc_eventDate` | Appointment date |
| `pc_startTime` / `pc_endTime` | Start / end time |
| `pc_duration` | Duration in minutes |
| `pc_recurrtype` / `pc_recurrspec` / `pc_recurrfreq` | Recurrence (PostCalendar format) |
| `pc_status` | `-` (active) / `>^` (checked out) / `C` (cancelled) / … |
| `pc_apptstatus` | More granular status (`-`, `*`, `?`, etc.) |
| `pc_encounter` | If converted to an encounter, the `form_encounter.encounter` |
| `pc_room_id` | FK `rooms.id` (rooming) |
| `pc_facility` | FK `facility.id` |

**Stores:** every appointment / calendar event. A subset of these are
**linked** to encounters (`pc_encounter` is non-zero).

---

## 4. `form_vitals` and the vitals family

> A clinical form for vital signs.

```sql
CREATE TABLE `form_vitals` (
  `id` bigint(20) NOT NULL auto_increment,
  `date` datetime DEFAULT NULL,
  `pid` bigint(20) NOT NULL DEFAULT '0',
  `user` varchar(255) NOT NULL DEFAULT '',
  `groupname` varchar(255) NOT NULL DEFAULT '',
  `authorized` tinyint(4) NOT NULL DEFAULT '0',
  `activity` tinyint(4) NOT NULL DEFAULT '1',
  `encounter` bigint(20) NOT NULL DEFAULT '0',
  `bps`  varchar(40) NOT NULL DEFAULT '',   /* systolic BP */
  `bpd`  varchar(40) NOT NULL DEFAULT '',   /* diastolic BP */
  `weight` float NOT NULL DEFAULT '0',     /* in lbs or kg per globals */
  `height` float NOT NULL DEFAULT '0',     /* in inches or cm per globals */
  `temperature` float NOT NULL DEFAULT '0',/* in F or C per globals */
  `temp_method` varchar(255) DEFAULT NULL, /* oral / tympanic / … */
  `pulse` float NOT NULL DEFAULT '0',      /* beats per minute */
  `respiration` float NOT NULL DEFAULT '0',
  `oxygen_saturation` float NOT NULL DEFAULT '0',
  `oxygen_flow_rate` float NOT NULL DEFAULT '0',
  `oxygen_method` varchar(255) DEFAULT NULL,
  `head_circ` float DEFAULT NULL,
  `waist_circ` float DEFAULT NULL,
  `bmi` float DEFAULT NULL,
  `bmi_status` varchar(255) DEFAULT NULL,
  `note` text,
  `created_by` int(11) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `pid` (`pid`),
  KEY `encounter` (`encounter`),
  KEY `date` (`date`)
) ENGINE=InnoDB;
```

**Related vitals tables:**

| Table | Notes |
|---|---|
| `form_vital_details` | Vitals with extra clinical detail (position, cuff size, etc.). |
| `form_vitals_calculation` | A calculated vitals set (BMI, BSA, MAP). |
| `form_vitals_calculation_components` | Per-component formula inputs. |
| `form_vitals_calculation_form_vitals` | Links the calculation to the source `form_vitals` row. |

---

## 5. `prescriptions` — medications

```sql
CREATE TABLE `prescriptions` (
  `id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `date_added` datetime default NULL,
  `date_modified` datetime default NULL,
  `provider_id` int(11) NOT NULL default '0',
  `patient_id` bigint(20) NOT NULL default '0',
  `drug` varchar(150) NOT NULL default '',
  `drug_id` int(11) NOT NULL default '0',
  `dosage` varchar(10) DEFAULT NULL,
  `route` int DEFAULT NULL,
  `unit` int DEFAULT NULL,
  `form` int DEFAULT NULL,
  `interval` int DEFAULT NULL,
  `refills` int DEFAULT NULL,
  `refill_quantity` int DEFAULT NULL,
  `quantity` varchar(31) DEFAULT NULL,
  `note` text,
  `prn` varchar(30) DEFAULT NULL,
  `active` int(11) NOT NULL default '1',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `datetime` datetime DEFAULT NULL,
  `referred_by` int(11) NOT NULL default '0',
  `erx_source` varchar(5) NOT NULL default '0',
  `erx_uploaded` varchar(3) NOT NULL default '0',
  `rxnorm_drugcode` varchar(25) DEFAULT NULL,
  `ndc` varchar(20) DEFAULT NULL,
  `drug_info_erx` text,
  `prescriptionguid` varchar(50) DEFAULT NULL,
  `encounter` int(11) NOT NULL default '0',
  `free_drug_name` varchar(150) DEFAULT NULL,
  `send_to_pharmacy` tinyint(1) NOT NULL DEFAULT '0',
  `dispense_as_written` tinyint(1) NOT NULL DEFAULT '0',
  `daw_dispense_as_written` tinyint(1) NOT NULL DEFAULT '0',
  `days_to_take` int(11) DEFAULT NULL,
  `substitute` int(11) DEFAULT NULL,
  `comments` text,
  `generic_substitute` int(11) DEFAULT NULL,
  `erx_uuid` varchar(100) DEFAULT NULL,
  `pharmacy_id` int(11) NOT NULL default '0',
  `created_by` int(11) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `patient_id` (`patient_id`),
  KEY `encounter` (`encounter`),
  KEY `provider_id` (`provider_id`),
  KEY `date_added` (`date_added`),
  KEY `active` (`active`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `patient_id` | FK `patient_data.pid` |
| `drug_id` | FK `drugs.drug_id` (drug master) |
| `provider_id` | FK `users.id` |
| `encounter` | FK `form_encounter.encounter` |
| `active` | 1 = active, 0 = discontinued |
| `rxnorm_drugcode` | RxNorm code (for e-prescribe) |
| `ndc` | NDC code |
| `pharmacy_id` | FK `pharmacies.id` (dispensing pharmacy) |
| `erx_source` | e-prescribing source (`0` = native, `1` = NewCrop, etc.) |
| `dispense_as_written` | DAW flag |

**Stores:** every prescription written. Drugs are referenced by
`drugs.drug_id` (the local drug master) with optional RxNorm/NDC for
interop. The `lists_medication` table holds a parallel entry when the
medication is also represented in the universal `lists` table.

---

## 6. `lists` — the universal issues table

> See `schema-overview.md §6` for full discussion.

```sql
CREATE TABLE `lists` (
  `id` int(11) NOT NULL auto_increment,
  `pid` bigint(20) NOT NULL default '0',
  `type` varchar(255) NOT NULL default '',
  `title` varchar(255) NOT NULL default '',
  `diagnosis` varchar(255) NOT NULL default '',
  `begdate` date default NULL,
  `enddate` date default NULL,
  `occurrence` int(11) NOT NULL default '0',
  `classification` int(11) NOT NULL default '0',
  `referredby` varchar(255) NOT NULL default '',
  `extrainfo` varchar(255) NOT NULL default '',
  `status` varchar(255) NOT NULL default '',
  `outcome` int(11) NOT NULL default '0',
  `followup` varchar(255) NOT NULL default '',
  `user` varchar(255) NOT NULL default '',
  `groupname` varchar(255) NOT NULL default '',
  `reconciled` int(11) NOT NULL default '0',
  `activity` tinyint(4) NOT NULL default '1',
  `comments` text,
  `issue` int(11) NOT NULL default '0',
  `list_option_id` int(11) NOT NULL default '0',
  `created_by` int(11) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `pid_type` (`pid`, `type`),
  KEY `pid_begdate` (`pid`, `begdate`),
  KEY `pid_enddate` (`pid`, `enddate`),
  KEY `pid_diagnosis` (`pid`, `diagnosis`),
  KEY `issue` (`issue`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `type` | `medical_problem`, `allergy`, `medication`, `surgery`, `dental`, `referral`, `risk_factor`, `patient_instruction`, `differential_dx`, `nnd`, `health_maintenance`, etc. |
| `outcome` | 0 = active, 1 = resolved, 2 = inactive |
| `classification` | For allergies: 0 = allergy, 1 = adverse reaction, 2 = intolerance |
| `list_option_id` | For custom dropdowns (`list_options.option_id`) |
| `reconciled` | C-CDA reconciliation flag |
| `issue` | Sub-issue (e.g. for a parent problem) |

The `lists_medication` table holds 1:1 medication-specific fields (dose,
frequency, route as code, etc.) keyed by `list_id`.

---

## 7. `billing`, `claims`, `payments` — the financial triple

### 7.1 `billing` — line-item charges

```sql
CREATE TABLE `billing` (
  `id` int(11) NOT NULL auto_increment,
  `date` datetime default NULL,
  `code_type` varchar(15) default NULL,
  `code` varchar(20) default NULL,
  `pid` bigint(20) NOT NULL default '0',
  `provider_id` int(11) default NULL,
  `user` int(11) default NULL,
  `groupname` varchar(255) NOT NULL default '',
  `authorized` tinyint(4) NOT NULL default '0',
  `encounter` bigint(20) NOT NULL default '0',
  `code_text` longtext,
  `modifier` varchar(12) default NULL,
  `units` int(11) default NULL,
  `fee` decimal(12,2) default NULL,
  `justify` varchar(255) default NULL,
  `target` varchar(30) default NULL,
  `xcpt_home` tinyint(4) default NULL,
  `hcfa_qualifier` varchar(2) default NULL,
  `hcfa_type` varchar(2) default NULL,
  `hcfa_code_value` varchar(20) default NULL,
  `place_of_service` tinyint(4) NOT NULL default '0',
  `ndc_info` varchar(255) default NULL,
  `note` text,
  `billed` tinyint(4) default NULL,
  `bill_date` datetime default NULL,
  `process_date` datetime default NULL,
  `process_file` varchar(255) default NULL,
  `pay_amount` decimal(12,2) default NULL,
  `adj_amount` decimal(12,2) default NULL,
  `payment_date` datetime default NULL,
  `payment_ins` decimal(12,2) default NULL,
  `payment_pat` decimal(12,2) default NULL,
  `mark_as_paid` tinyint(4) default NULL,
  `paid_at` datetime default NULL,
  `post_user` int(11) default NULL,
  PRIMARY KEY (`id`),
  KEY `pid_encounter` (`pid`, `encounter`),
  KEY `date` (`date`),
  KEY `code` (`code`),
  KEY `encounter` (`encounter`)
) ENGINE=InnoDB;
```

### 7.2 `claims` — claim headers

```sql
CREATE TABLE `claims` (
  `patient_id` bigint(20) NOT NULL default '0',
  `encounter_id` bigint(20) NOT NULL default '0',
  `version` int(10) unsigned NOT NULL auto_increment,
  `payer_id` int(11) NOT NULL default '0',
  `status` tinyint(2) NOT NULL default '0',
  `payer_type` tinyint(4) NOT NULL default '0',
  `bill_process` tinyint(2) NOT NULL default '0',
  `bill_date` datetime default NULL,
  `process_date` datetime default NULL,
  `process_file` varchar(255) default NULL,
  `primary_ins_id` bigint(20) default NULL,
  `suppervising_provider_id` int(11) default NULL,
  `total_charge` decimal(12,2) default NULL,
  `total_payment` decimal(12,2) default NULL,
  `total_adjustment` decimal(12,2) default NULL,
  `total_visit` decimal(12,2) default NULL,
  `total_interest` decimal(12,2) default NULL,
  PRIMARY KEY (`version`),
  KEY `encounter_id` (`encounter_id`),
  KEY `patient_id` (`patient_id`)
) ENGINE=InnoDB;
```

### 7.3 `payments` — payment header (legacy + modern)

```sql
CREATE TABLE `payments` (
  `id` bigint(20) NOT NULL auto_increment,
  `pid` bigint(20) NOT NULL default '0',
  `dtime` datetime NOT NULL,
  `encounter` bigint(20) NOT NULL default '0',
  `user` int(11) default NULL,
  `method` varchar(20) default NULL,
  `source` varchar(50) default NULL,
  `amount1` decimal(12,2) default NULL,
  `amount2` decimal(12,2) default NULL,
  `amount3` decimal(12,2) default NULL,
  `check_date` date default NULL,
  `check_number` varchar(20) default NULL,
  `check_amount` decimal(12,2) default NULL,
  `deposit_date` date default NULL,
  `deposit_amount` decimal(12,2) default NULL,
  `global_amount` decimal(12,2) default NULL,
  `post_to_date` datetime default NULL,
  `payment_type` varchar(20) NOT NULL default '',
  `adjustment_code` varchar(20) default NULL,
  `payer_id` int(11) NOT NULL default '0',
  `notes` text,
  PRIMARY KEY (`id`),
  KEY `pid` (`pid`),
  KEY `encounter` (`encounter`),
  KEY `dtime` (`dtime`)
) ENGINE=InnoDB;
```

**Flow:** `billing` is the line item (CPT/HCPCS + fee + units). One
encounter has N billing rows. `claims` is the claim header
(generated from billing rows). `payments` is the payment posting
(distribution to one or more billing lines). See
`library/payment.inc.php::DistributionInsert()` for the payment
distribution algorithm.

---

## 8. `users`, `users_secure` — the split user model

> OpenEMR splits user information into two tables for **defense in
> depth**: one table is read by the UI, the other holds the password
> hash and MFA secrets.

### 8.1 `users` (UI-readable profile)

```sql
CREATE TABLE `users` (
  `id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `username` varchar(255) NOT NULL default '',
  `password` varchar(255) DEFAULT NULL,           -- legacy plaintext (no longer used for auth)
  `authorized` tinyint(4) NOT NULL default '0',
  `info` longtext,
  `fname` varchar(255) NOT NULL default '',
  `mname` varchar(255) NOT NULL default '',
  `lname` varchar(255) NOT NULL default '',
  `suffix` varchar(255) NOT NULL default '',
  `federaltaxid` varchar(255) NOT NULL default '',
  `federaldrugid` varchar(255) NOT NULL default '',
  `upin` varchar(255) NOT NULL default '',
  `npi` varchar(255) NOT NULL default '',
  `job` varchar(255) NOT NULL default '',
  `role` varchar(255) NOT NULL default '',
  `taxonomy` varchar(255) NOT NULL default '207Q00000X',
  `facility_id` int(11) NOT NULL default '0',
  `billing_facility_id` int(11) NOT NULL default '0',
  `specialty` varchar(255) NOT NULL default '',
  `billable` tinyint(1) NOT NULL default '0',
  `active` tinyint(1) NOT NULL default '1',
  `direct_address` varchar(255) DEFAULT NULL,
  `encryption_postal` tinyint(1) NOT NULL default '0',
  `created_by` int(11) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT NULL,
  `password_reset_token` varchar(64) DEFAULT NULL,
  `password_reset_expires` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB;
```

### 8.2 `users_secure` (the secret half)

```sql
CREATE TABLE `users_secure` (
  `id` bigint(20) NOT NULL auto_increment,
  `username` varchar(255) NOT NULL default '',
  `password` varchar(255) NOT NULL default '',  -- bcrypt / argon2 hash
  `last_login` datetime default NULL,
  `login_work_area` longtext,                    -- U2F challenge scratch
  `login_auth_token` longtext,                   -- legacy 2FA
  `email_token_1` varchar(255) default NULL,
  `email_token_2` varchar(255) default NULL,
  `email_expire_1` datetime default NULL,
  `email_expire_2` datetime default NULL,
  `active` tinyint(1) NOT NULL default '1',
  `password_history1` varchar(255) NOT NULL default '',
  `password_history2` varchar(255) NOT NULL default '',
  `password_history3` varchar(255) NOT NULL default '',
  `password_change_time` datetime default NULL,
  `current_login_lock_until` datetime default NULL,
  `previous_login_lock_until` datetime default NULL,
  `current_lev_login_failures` int(11) NOT NULL default '0',
  `previous_lev_login_failures` int(11) NOT NULL default '0',
  `current_hipaa_login_failures` int(11) NOT NULL default '0',
  `previous_hipaa_login_failures` int(11) NOT NULL default '0',
  `pwd_expiration_date` date default NULL,
  `pwd_history1` varchar(255) NOT NULL default '',
  `pwd_history2` varchar(255) NOT NULL default '',
  `pwd_history3` varchar(255) NOT NULL default '',
  `mfa_totp_secret` longtext,                    -- encrypted TOTP secret (legacy)
  `mfa_attempts` int(11) NOT NULL default '0',
  `mfa_expiration` datetime default NULL,
  `mfa_lock_until` datetime default NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `password` | **Hashed** with bcrypt / argon2 / SHA512 per `gbl_auth_hash_algo` global. |
| `password_history1..3` | Last 3 hashes (re-use prevention). |
| `current_lev_login_failures` | Lev (level) failures since last successful login. |
| `previous_lev_login_failures` | Carried over. |
| `current_login_lock_until` | Account locked until this datetime. |
| `login_work_area` | U2F challenge JSON (during MFA flow). |
| `mfa_totp_secret` | (Legacy) encrypted TOTP secret. Modern TOTP secrets are in `login_mfa_registrations.var1`. |

**Why split?** If the `users` table is exposed (e.g. via a backup
leak), the password hash is **not** in it. The `users_secure` table
is treated as a secrets store.

---

## 9. `facility` — the clinic / lab

```sql
CREATE TABLE `facility` (
  `id` int(11) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `name` varchar(255) NOT NULL default '',
  `phone` varchar(30) NOT NULL default '',
  `fax` varchar(30) NOT NULL default '',
  `street` varchar(255) NOT NULL default '',
  `city` varchar(255) NOT NULL default '',
  `state` varchar(50) NOT NULL default '',
  `postal_code` varchar(11) NOT NULL default '',
  `country_code` varchar(30) NOT NULL default '',
  `federal_ein` varchar(15) NOT NULL default '',
  `domain_identifier` varchar(60) default NULL,
  `facility_npi` varchar(15) default NULL,
  `facility_taxonomy` varchar(15) default NULL,
  `email` varchar(255) NOT NULL default '',
  `billing_location` tinyint(1) NOT NULL default '0',
  `service_location` tinyint(1) NOT NULL default '0',
  `color` varchar(20) NOT NULL default '#999999',
  `primary_business_entity` tinyint(1) NOT NULL default '0',
  `attn` varchar(255) NOT NULL default '',
  `clia_code` varchar(255) DEFAULT NULL,
  `pos_code` int(11) DEFAULT NULL,
  `send_via` varchar(20) DEFAULT NULL,
  `hipaa_15` text,
  `status` tinyint(4) NOT NULL DEFAULT '1',
  `created_by` int(11) DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `name` (`name`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `billing_location` | 1 = can be selected as a billing location. |
| `service_location` | 1 = can be selected as a service location. |
| `primary_business_entity` | The "main" facility (used as the default). |
| `pos_code` | Place of service (CMS POS code). |
| `clia_code` | CLIA certification number (lab). |

**Stores:** every clinic, lab, hospital, or place of service.

---

## 10. `gacl_*` — the ACL store (30 tables)

> The phpGACL fork. Full discussion in `auth/acl-system.md`.

Key tables:

| Table | Purpose |
|---|---|
| `gacl_aco` | Access Control Objects — the "things being protected" (e.g. `patients.demo`). |
| `gacl_aro` | Access Request Objects — the requesters (e.g. `users.alice`). |
| `gacl_axo` | Access eXtension Objects — sectioned objects (rarely used). |
| `gacl_aro_groups` | ARO groups (e.g. `Doctors`, `Front Desk`). |
| `gacl_aco_sections` | ACO sections (e.g. `patients`, `encounters`). |
| `gacl_acl` | The actual rules: `aro_id × aco_id × axo_id → allow/deny + return_value`. |
| `gacl_aro_map` / `gacl_aro_groups_map` / `gacl_groups_aro_map` | Memberships. |
| `gacl_phpgacl` | Single-row config. |

The `acl` row is the actual rule. `OpenEMR\Gacl\Gacl::acl_query($section, $value, $aro_section, $aro_value, …)`
returns the list of matching rules. `AclMain::aclCheckCore()` interprets
the result, with **deny-takes-precedence** semantics.

---

## 11. `log`, `audit_master`, `audit_details` — the audit triple

### 11.1 `log` (one row per event)

```sql
CREATE TABLE `log` (
  `id` bigint(20) NOT NULL auto_increment,
  `date` datetime default NULL,
  `event` varchar(255) default NULL,
  `category` varchar(255) default NULL,
  `user` varchar(255) default NULL,
  `groupname` varchar(255) default NULL,
  `comments` longtext,
  `user_notes` longtext,
  `crt_user` varchar(255) default NULL,
  `pid` bigint(20) default NULL,
  `success` tinyint(1) default '1',
  `checksum` longtext,
  `crt_event` varchar(255) default NULL,
  `certificate_id` varchar(255) default NULL,
  `method` varchar(255) default NULL,
  `request` longtext,
  `request_id` bigint(20) default NULL,
  PRIMARY KEY (`id`),
  KEY `date` (`date`),
  KEY `event` (`event`),
  KEY `pid` (`pid`),
  KEY `user` (`user`),
  KEY `category` (`category`)
) ENGINE=InnoDB;
```

### 11.2 `audit_master` (per-action)

```sql
CREATE TABLE `audit_master` (
  `id` varchar(40) NOT NULL default '',
  `pid` bigint(20) default NULL,
  `user_id` int(11) default NULL,
  `groupname` varchar(255) default NULL,
  `activity` varchar(255) default NULL,
  `comment` varchar(255) default NULL,
  `date` datetime default NULL,
  `patient_affected` tinyint(1) default '0',
  `approval_user_id` int(11) default NULL,
  `approval_status` varchar(50) default NULL,
  `approval_date` datetime default NULL,
  `approval_facility` varchar(255) default NULL,
  `fiscal_year` int(11) default NULL,
  PRIMARY KEY (`id`),
  KEY `pid` (`pid`),
  KEY `user_id` (`user_id`),
  KEY `date` (`date`)
) ENGINE=InnoDB;
```

### 11.3 `audit_details` (N rows per `audit_master`)

```sql
CREATE TABLE `audit_details` (
  `id` bigint(20) NOT NULL auto_increment,
  `audit_master_id` varchar(40) NOT NULL default '',
  `table_name` varchar(255) NOT NULL default '',
  `field_name` varchar(255) NOT NULL default '',
  `field_value` longtext,
  `entry_identification` varchar(255) default NULL,
  PRIMARY KEY (`id`),
  KEY `audit_master_id` (`audit_master_id`)
) ENGINE=InnoDB;
```

**`audit_details` stores the before/after diff** for each audited write.
The `audit_master` row is the "envelope" with who, when, what action;
the `audit_details` rows are the field-level changes.

The `log_comment_encrypt` table stores long-form comments encrypted at
rest (used by SQL audit events whose comments may be sensitive).

### 11.4 `extended_log`

Cross-patient audit (queries that span patients, e.g. searches).

```sql
CREATE TABLE `extended_log` (
  `id` bigint(20) NOT NULL auto_increment,
  `date` datetime default NULL,
  `event` varchar(255) NOT NULL default '',
  `user` varchar(255) NOT NULL default '',
  `groupname` varchar(255) NOT NULL default '',
  `comment` longtext,
  `patient_id` bigint(20) NOT NULL default '0',
  `success` tinyint(1) NOT NULL default '1',
  `checksum` longtext,
  PRIMARY KEY (`id`),
  KEY `date` (`date`),
  KEY `event` (`event`),
  KEY `user` (`user`)
) ENGINE=InnoDB;
```

---

## 12. `documents`, `categories` — file storage

### 12.1 `documents` (one row per file)

```sql
CREATE TABLE `documents` (
  `id` int(11) NOT NULL default '0',           -- (legacy — non-auto-inc)
  `type` enum('file_url','blob','web_url') default NULL,
  `size` int(11) default NULL,
  `date` datetime default NULL,
  `url` varchar(255) default NULL,             -- path under sites/<id>/documents/
  `mimetype` varchar(255) default NULL,
  `pages` int(11) default NULL,
  `owner` int(11) default NULL,
  `revision` timestamp(14) NOT NULL,
  `foreign_id` bigint(20) default NULL,        -- typically patient pid
  `doc_cat_id` int(11) default NULL,
  `list_cat_id` int(11) default NULL,
  `hash` varchar(255) default NULL,
  PRIMARY KEY (`id`),
  KEY `revision` (`revision`),
  KEY `foreign_id` (`foreign_id`),
  KEY `owner` (`owner`),
  KEY `doc_cat_id` (`doc_cat_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `type` | `file_url` (file on disk), `blob` (in DB), `web_url` (external) |
| `url` | Path to the file (relative to `sites/<id>/documents/<pid>/`) |
| `foreign_id` | Patient PID (most common) |
| `doc_cat_id` | FK to `categories.id` (hierarchical category) |
| `hash` | SHA-256 of the file content (for tamper detection) |

**Storage location:** `sites/<id>/documents/<pid>/<docid>.<ext>` —
filesystem-isolated per site. The `id` is a `categories_seq`-style
integer (not auto-increment on this table).

### 12.2 `categories` (nested set)

```sql
CREATE TABLE `categories` (
  `id` int(11) NOT NULL default '0',
  `name` varchar(255) NOT NULL default '',
  `value` varchar(255) NOT NULL default '',
  `parent` int(11) NOT NULL default '0',
  `lft` int(11) NOT NULL default '0',
  `rght` int(11) NOT NULL default '0',
  `hidden` tinyint(1) NOT NULL default '0',
  `group_category` int(11) DEFAULT '0',
  `aco_spec` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `parent` (`parent`),
  KEY `lft` (`lft`, `rght`),
  KEY `name` (`name`)
) ENGINE=InnoDB;
```

A nested-set (left/right) tree. Used for **document categories** and
**encounter categories**. The `lft`/`rght` columns make subtree queries
a single range scan.

### 12.3 `categories_to_documents` (M:N)

```sql
CREATE TABLE `categories_to_documents` (
  `category_id` int(11) NOT NULL default '0',
  `document_id` int(11) NOT NULL default '0',
  PRIMARY KEY (`category_id`,`document_id`)
) ENGINE=InnoDB;
```

---

## 13. `insurance_data`, `insurance_companies` — payer info

### 13.1 `insurance_data` (per-patient coverage)

```sql
CREATE TABLE `insurance_data` (
  `id` bigint(20) NOT NULL auto_increment,
  `pid` bigint(20) NOT NULL default '0',
  `provider` int(11) NOT NULL default '0',
  `plan_name` varchar(255) default NULL,
  `policy_number` varchar(255) default NULL,
  `group_number` varchar(255) default NULL,
  `subscriber_lname` varchar(255) default NULL,
  `subscriber_mname` varchar(255) default NULL,
  `subscriber_fname` varchar(255) default NULL,
  `subscriber_relationship` varchar(255) default NULL,
  `subscriber_dob` date default NULL,
  `subscriber_ss` varchar(255) default NULL,
  `subscriber_sex` varchar(25) default NULL,
  `subscriber_street` varchar(255) default NULL,
  `subscriber_postal_code` varchar(255) default NULL,
  `subscriber_city` varchar(255) default NULL,
  `subscriber_state` varchar(255) default NULL,
  `subscriber_country` varchar(255) default NULL,
  `subscriber_phone` varchar(255) default NULL,
  `subscriber_employer` varchar(255) default NULL,
  `date` date NOT NULL,
  `type` enum('primary','secondary','tertiary') NOT NULL default 'primary',
  `copay` decimal(8,2) default NULL,
  `accept_assignment` tinyint(1) NOT NULL default '0',
  `policy_type` varchar(255) default NULL,
  `effective_date` date default NULL,
  `expiration_date` date default NULL,
  `create_date` datetime default NULL,
  `cumulative_insurance` tinyint(1) NOT NULL default '0',
  PRIMARY KEY (`id`),
  KEY `pid_type` (`pid`, `type`)
) ENGINE=InnoDB;
```

A patient can have up to 3 coverages (primary, secondary, tertiary).
The `type` enum enforces that.

### 13.2 `insurance_companies` (payer master)

```sql
CREATE TABLE `insurance_companies` (
  `id` int(11) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `name` varchar(255) NOT NULL default '',
  `attn` varchar(255) default NULL,
  `cms_id` varchar(15) default NULL,
  `freeb_type` tinyint(4) default NULL,
  `x12_receiver_id` varchar(25) default NULL,
  `x12_default_partner_id` int(11) default NULL,
  `alt_cms_id` varchar(15) default NULL,
  `address_line1` varchar(255) default NULL,
  `address_line2` varchar(255) default NULL,
  `city` varchar(255) default NULL,
  `state` varchar(255) default NULL,
  `zip` varchar(35) default NULL,
  `country` varchar(255) default NULL,
  `phone` varchar(35) default NULL,
  `fax` varchar(35) default NULL,
  `email` varchar(255) default NULL,
  `website` varchar(255) default NULL,
  `PayerID` varchar(255) default NULL,
  `Naic_Code` varchar(255) default NULL,
  `Federal_Tax_ID` varchar(255) default NULL,
  `Date_Of_Export` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `name` (`name`)
) ENGINE=InnoDB;
```

---

## 14. `procedure_order`, `procedure_report` — orders and results

```sql
CREATE TABLE `procedure_order` (
  `procedure_order_id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `provider_id` int(11) NOT NULL default '0',
  `patient_id` bigint(20) NOT NULL default '0',
  `encounter_id` bigint(20) NOT NULL default '0',
  `date_ordered` datetime default NULL,
  `date_collected` datetime default NULL,
  `date_received` datetime default NULL,
  `date_reported` datetime default NULL,
  `lab_id` int(11) default NULL,
  `specimen_type` varchar(255) default NULL,
  `specimen_location` varchar(255) default NULL,
  `specimen_volume` varchar(255) default NULL,
  `date_transmitted` datetime default NULL,
  `clinical_hx` text,
  `order_priority` varchar(255) DEFAULT 'normal',
  `order_status` varchar(255) DEFAULT 'pending',
  `patient_instructions` text,
  `activity` tinyint(4) NOT NULL default '1',
  `control_id` varchar(255) DEFAULT NULL,
  `lab_status` varchar(255) DEFAULT NULL,
  `lab_imported` tinyint(1) NOT NULL DEFAULT '0',
  `protocol_id` int(11) DEFAULT NULL,
  `questionnaire_response_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`procedure_order_id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `encounter_id` (`encounter_id`),
  KEY `patient_id` (`patient_id`),
  KEY `provider_id` (`provider_id`),
  KEY `date_ordered` (`date_ordered`)
) ENGINE=InnoDB;
```

Related:

| Table | Notes |
|---|---|
| `procedure_order_code` | One row per code (CPT/LOINC) on an order. |
| `procedure_questions` | Questions attached to an order type. |
| `procedure_answers` | The answers. |
| `procedure_report` | The result report (one per order, with N `procedure_result` rows). |
| `procedure_result` | One row per result component (LOINC-coded). |
| `procedure_specimen` | Specimen metadata. |
| `procedure_order_relationships` | M:N between orders. |
| `procedure_type` | Order-type master (templates for "CBC", "Lipid Panel", etc.). |
| `procedure_providers` | Provider directory (lab, imaging center). |

---

## 15. `immunizations` — vaccine administrations

```sql
CREATE TABLE `immunizations` (
  `id` bigint(20) NOT NULL auto_increment,
  `uuid` binary(16) DEFAULT NULL,
  `patient_id` bigint(20) NOT NULL default '0',
  `administered_date` datetime default NULL,
  `immunization_id` int(11) NOT NULL default '0',  -- FK to `codes` (CVX)
  `cvx_code` varchar(10) default NULL,
  `manufacturer` varchar(100) default NULL,
  `lot_number` varchar(50) default NULL,
  `expiration_date` date default NULL,
  `VIS_publication_date` date default NULL,
  `dose_amount` varchar(20) default NULL,
  `dose_unit` varchar(20) default NULL,
  `route` varchar(20) default NULL,
  `administration_site` varchar(50) default NULL,
  `administered_by` int(11) default NULL,
  `encounter` bigint(20) default NULL,
  `note` text,
  `created_by` int(11) default NULL,
  `updated_by` int(11) default NULL,
  `date_created` datetime default NULL,
  `last_updated` datetime default NULL,
  `completion_status` varchar(20) NOT NULL DEFAULT 'completed',
  `information_source` varchar(20) DEFAULT 'other',
  `refusal_reason` varchar(50) DEFAULT NULL,
  `ordering_provider` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `patient_id` (`patient_id`),
  KEY `administered_date` (`administered_date`),
  KEY `cvx_code` (`cvx_code`),
  KEY `immunization_id` (`immunization_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `cvx_code` | CDC CVX code |
| `immunization_id` | FK to `codes` (the local CVX row) |
| `administration_site` | e.g. `left arm`, `right thigh` |
| `route` | e.g. `IM`, `SC`, `oral` |
| `completion_status` | `completed`, `refused`, `partial`, `notadministered` |
| `information_source` | `historical`, `other`, `fromotherprovider`, `fromparent` |

**Related:** `immunization_observation` (VAERS-style adverse event
observations), `codes` (CVX rows), `sql/cvx_codes.sql` (the full CVX
catalogue that is imported on install).

---

## 16. `session_tracker` — active sessions

> Source: tracks every active session for idle-timeout enforcement.

```sql
CREATE TABLE `session_tracker` (
  `id` bigint(20) NOT NULL auto_increment,
  `created` datetime default NULL,
  `last_updated` datetime default NULL,
  `pid` bigint(20) default NULL,
  `user` varchar(255) default NULL,
  `groupname` varchar(255) default NULL,
  `sid` varchar(255) default NULL,
  `ip` varchar(64) default NULL,
  `provider` varchar(255) default NULL,
  `logout_user` int(11) NOT NULL default '0',
  `logout_pid` bigint(20) default NULL,
  `logout_provider` varchar(255) default NULL,
  PRIMARY KEY (`id`),
  KEY `last_updated` (`last_updated`),
  KEY `pid` (`pid`),
  KEY `user` (`user`),
  KEY `sid` (`sid`)
) ENGINE=InnoDB;
```

A row is inserted on each successful login. `last_updated` is bumped on
every request. A background cron deletes rows where `last_updated <
NOW() - INTERVAL <timeout> SECOND` and triggers a logout event.

See `OpenEMR\Common\Session\SessionTracker`.

---

## 17. `login_mfa_registrations` — TOTP / U2F registrations

```sql
CREATE TABLE `login_mfa_registrations` (
  `id` bigint(20) NOT NULL auto_increment,
  `user_id` bigint(20) NOT NULL default '0',
  `name` varchar(255) NOT NULL default '',
  `method` enum('TOTP','U2F') NOT NULL default 'TOTP',
  `var1` longtext,                              -- TOTP secret (encrypted) or U2F registration JSON
  `var2` varchar(255) default NULL,
  `date_created` datetime default NULL,
  `date_modified` datetime default NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `method` | `TOTP` (RFC 6238) or `U2F` (FIDO U2F). |
| `var1` | For TOTP: the encrypted secret. For U2F: JSON of the registration (key handle, public key, attestation). |
| `date_modified` | Last used (U2F uses this to track counter increment). |

A user can have **multiple** registrations (e.g. TOTP on phone + U2F key).
See `src/Common/Auth/MfaUtils.php` and `auth/mfa.md`.

---

## 18. `oauth_clients`, `oauth_trusted_user` — OAuth2 store

```sql
CREATE TABLE `oauth_clients` (
  `client_id` varchar(80) NOT NULL default '',
  `client_role` varchar(255) NOT NULL default 'user',
  `client_name` varchar(255) default NULL,
  `client_secret` varchar(255) default NULL,    -- hashed
  `client_uri` varchar(255) default NULL,
  `redirect_uri` longtext,
  `enc_client_key` longtext,                     -- encrypted JWK for asymmetric auth
  `login_uri` longtext,
  `logo_uri` varchar(255) default NULL,
  `contacts` longtext,
  `grant_types` longtext,
  `scope` longtext,
  `policy_uri` longtext,
  `tos_uri` longtext,
  `jwks_uri` longtext,
  `jwks` longtext,
  `token_endpoint_auth_method` varchar(255) NOT NULL default 'client_secret_basic',
  `registration_token` varchar(255) default NULL,
  `registration_token_expiration` datetime default NULL,
  `is_confidential` tinyint(1) NOT NULL default '1',
  `is_disabled` tinyint(1) NOT NULL default '0',
  `user_id` int(11) default NULL,
  `client_type` varchar(20) NOT NULL default 'smart-app',
  `site_id` varchar(64) NOT NULL default 'default',
  `pkce_code_challenge_method` varchar(20) default NULL,
  PRIMARY KEY (`client_id`)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE `oauth_trusted_user` (
  `id` bigint(20) NOT NULL auto_increment,
  `user_id` int(11) NOT NULL default '0',
  `client_id` varchar(80) NOT NULL default '',
  `scope` longtext,
  `persist_login` tinyint(1) NOT NULL default '0',
  `time` datetime NOT NULL,
  `code` varchar(255) default NULL,
  `session_cache` longtext,
  `grant_type` varchar(50) default 'authorization_code',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `client_id` (`client_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `client_role` | `user` (normal app) or `system` (admin / internal) |
| `client_type` | `smart-app` or `system-app` |
| `is_confidential` | 1 = confidential client (has secret); 0 = public (PKCE only) |
| `token_endpoint_auth_method` | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none` |
| `jwks_uri` / `jwks` | For asymmetric auth: public key location or inline |
| `oauth_trusted_user.code` | One-time code (when refresh-token flow) |
| `oauth_trusted_user.session_cache` | The active session id (revoked on logout) |

See `auth/oauth2-server.md` for full flow.

---

## 19. `keys` — site-level secrets

```sql
CREATE TABLE `keys` (
  `name` varchar(255) NOT NULL default '',
  `value` longtext NOT NULL,        -- encrypted
  `date_created` datetime default NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB;
```

Stores:

| `name` | Purpose |
|---|---|
| `oauth2key` | The symmetric encryption key for OAuth2 tokens (encrypted with `CryptoGen`). |
| `oauth2passphrase` | The passphrase for the OAuth2 RSA private key. |
| `api` (or various) | Reserved for future use. |

The OAuth2 RSA key pair is stored on disk in
`sites/<id>/documents/certificates/{oaprivate.key,oapublic.key}`.

See `src/Common/Auth/OAuth2KeyConfig.php`.

---

## 20. See also

- [`schema-overview.md`](./schema-overview.md) — table groups
- [`migrations.md`](./migrations.md) — schema evolution
- [`connection-layer.md`](./connection-layer.md) — querying
- `sql/database.sql` — the canonical schema
