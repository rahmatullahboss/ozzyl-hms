CREATE TABLE `doctor_commission_accruals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`doctor_id` integer NOT NULL,
	`patient_id` integer,
	`visit_id` integer,
	`bill_id` integer,
	`lab_order_id` integer,
	`lab_order_item_id` integer,
	`lab_test_id` integer,
	`settlement_id` integer,
	`source_type` text NOT NULL,
	`incentive_type` text DEFAULT 'performer' NOT NULL,
	`gross_amount` integer DEFAULT 0 NOT NULL,
	`commission_rule_id` integer,
	`commission_rate_bps` integer DEFAULT 0 NOT NULL,
	`commission_flat_amount` integer DEFAULT 0 NOT NULL,
	`commission_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'accrued' NOT NULL,
	`accrued_date` text DEFAULT CURRENT_DATE,
	`paid_date` text,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "doctor_comm_accruals_source_type_check" CHECK(source_type IN ('lab_test','consultation_fee','referral')),
	CONSTRAINT "doctor_comm_accruals_status_check" CHECK(status IN ('accrued','approved','paid','cancelled')),
	CONSTRAINT "doctor_comm_accruals_incentive_type_check" CHECK(incentive_type IN ('performer','prescriber','referrer'))
);
--> statement-breakpoint
CREATE INDEX `idx_doctor_comm_accruals_tenant_status` ON `doctor_commission_accruals` (`tenant_id`,`status`,`accrued_date`);--> statement-breakpoint
CREATE INDEX `idx_doctor_comm_accruals_doctor` ON `doctor_commission_accruals` (`tenant_id`,`doctor_id`,`accrued_date`);--> statement-breakpoint
CREATE INDEX `idx_doctor_comm_accruals_bill` ON `doctor_commission_accruals` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_dr_comm_accruals_settlement` ON `doctor_commission_accruals` (`tenant_id`,`settlement_id`);--> statement-breakpoint
CREATE TABLE `doctor_commission_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`doctor_id` integer NOT NULL,
	`service_type` text NOT NULL,
	`lab_test_id` integer,
	`category` text,
	`incentive_type` text DEFAULT 'performer' NOT NULL,
	`rate_type` text DEFAULT 'percent' NOT NULL,
	`rate_value` integer DEFAULT 0 NOT NULL,
	`effective_from` text DEFAULT CURRENT_DATE,
	`effective_to` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "doctor_comm_rules_service_type_check" CHECK(service_type IN ('lab_test','consultation_fee','referral')),
	CONSTRAINT "doctor_comm_rules_rate_type_check" CHECK(rate_type IN ('percent','flat')),
	CONSTRAINT "doctor_comm_rules_incentive_type_check" CHECK(incentive_type IN ('performer','prescriber','referrer'))
);
--> statement-breakpoint
CREATE INDEX `idx_doctor_comm_rules_tenant_doctor` ON `doctor_commission_rules` (`tenant_id`,`doctor_id`,`service_type`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_doctor_comm_rules_test` ON `doctor_commission_rules` (`tenant_id`,`lab_test_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `doctor_commission_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`doctor_id` integer NOT NULL,
	`settlement_date` text DEFAULT CURRENT_DATE,
	`total_amount` real DEFAULT 0 NOT NULL,
	`payment_mode` text DEFAULT 'cash' NOT NULL,
	`reference_no` text,
	`notes` text,
	`voucher_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "doctor_comm_settlements_payment_mode_check" CHECK(payment_mode IN ('cash','bank','cheque','card','mobile_banking','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_dr_comm_settlements_tenant_doctor` ON `doctor_commission_settlements` (`tenant_id`,`doctor_id`,`settlement_date`);--> statement-breakpoint
CREATE TABLE `fraction_calculations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`bill_id` integer NOT NULL,
	`invoice_item_id` integer,
	`doctor_id` integer NOT NULL,
	`gross_amount` real NOT NULL,
	`hospital_amount` real NOT NULL,
	`doctor_amount` real NOT NULL,
	`fraction_percent_id` integer,
	`status` text DEFAULT 'calculated' NOT NULL,
	`settled_date` text,
	`settlement_id` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fraction_percent_id`) REFERENCES `fraction_percents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fraction_calc_bill` ON `fraction_calculations` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_fraction_calc_doctor` ON `fraction_calculations` (`tenant_id`,`doctor_id`);--> statement-breakpoint
CREATE INDEX `idx_fraction_calc_status` ON `fraction_calculations` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `fraction_percents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`service_item_id` integer,
	`bill_item_category` text,
	`hospital_percent` real DEFAULT 60 NOT NULL,
	`doctor_percent` real DEFAULT 40 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_fraction_percents_tenant` ON `fraction_percents` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `accounting_period_closes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`fiscal_year_id` integer NOT NULL,
	`period_name` text NOT NULL,
	`close_date` text NOT NULL,
	`closed_at` text DEFAULT (datetime('now', '+6 hours')),
	`closed_by` text NOT NULL,
	`closing_voucher_id` integer,
	`status` text DEFAULT 'closed' NOT NULL,
	FOREIGN KEY (`fiscal_year_id`) REFERENCES `fiscal_years`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounting_period_closes_status_check" CHECK(status IN ('open', 'closed', 'audited'))
);
--> statement-breakpoint
CREATE INDEX `idx_accounting_period_closes_tenant_period` ON `accounting_period_closes` (`tenant_id`,`period_name`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounting_period_closes_unique` ON `accounting_period_closes` (`tenant_id`,`fiscal_year_id`,`period_name`);--> statement-breakpoint
CREATE TABLE `billing_credit_bill_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`bill_id` integer NOT NULL,
	`fiscal_year_id` integer,
	`invoice_no` text,
	`invoice_date` text,
	`patient_id` integer NOT NULL,
	`credit_organization_id` integer,
	`liable_party` text DEFAULT 'SELF' NOT NULL,
	`sales_total_bill_amount` real DEFAULT 0 NOT NULL,
	`return_total_bill_amount` real DEFAULT 0 NOT NULL,
	`co_pay_received_amount` real DEFAULT 0 NOT NULL,
	`co_pay_return_amount` real DEFAULT 0 NOT NULL,
	`net_receivable_amount` real DEFAULT 0 NOT NULL,
	`non_claimable_amount` real DEFAULT 0 NOT NULL,
	`is_claimable` integer DEFAULT 1 NOT NULL,
	`claim_code` text,
	`settlement_id` integer,
	`settlement_status` text DEFAULT 'Pending' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_credit_bill_status_tenant` ON `billing_credit_bill_status` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_credit_bill_status_patient` ON `billing_credit_bill_status` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_credit_bill_status_settlement` ON `billing_credit_bill_status` (`tenant_id`,`settlement_status`);--> statement-breakpoint
CREATE INDEX `idx_credit_bill_status_bill` ON `billing_credit_bill_status` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE TABLE `external_referring_doctors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`chamber` text,
	`specialty` text,
	`tenant_id` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE INDEX `idx_external_referring_doctors_tenant` ON `external_referring_doctors` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_external_referring_doctors_name` ON `external_referring_doctors` (`tenant_id`,`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cln_medication_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`formulary_item_id` integer,
	`medication_name` text NOT NULL,
	`generic_name` text,
	`strength` text,
	`dosage_form` text,
	`dose` text NOT NULL,
	`route` text DEFAULT 'Oral' NOT NULL,
	`frequency` text NOT NULL,
	`duration` text,
	`instructions` text,
	`priority` text DEFAULT 'routine' NOT NULL,
	`start_datetime` text DEFAULT (datetime('now', '+6 hours')),
	`end_datetime` text,
	`status` text DEFAULT 'active' NOT NULL,
	`status_reason` text,
	`ordered_by` integer NOT NULL,
	`verified_by` integer,
	`verified_at` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	`updated_by` integer
);
--> statement-breakpoint
INSERT INTO `__new_cln_medication_orders`("id", "tenant_id", "patient_id", "visit_id", "formulary_item_id", "medication_name", "generic_name", "strength", "dosage_form", "dose", "route", "frequency", "duration", "instructions", "priority", "start_datetime", "end_datetime", "status", "status_reason", "ordered_by", "verified_by", "verified_at", "is_active", "created_by", "created_at", "updated_at", "updated_by") SELECT "id", "tenant_id", "patient_id", "visit_id", "formulary_item_id", "medication_name", "generic_name", "strength", "dosage_form", "dose", "route", "frequency", "duration", "instructions", "priority", "start_datetime", "end_datetime", "status", "status_reason", "ordered_by", "verified_by", "verified_at", "is_active", "created_by", "created_at", "updated_at", "updated_by" FROM `cln_medication_orders`;--> statement-breakpoint
DROP TABLE `cln_medication_orders`;--> statement-breakpoint
ALTER TABLE `__new_cln_medication_orders` RENAME TO `cln_medication_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_cln_med_orders_tenant` ON `cln_medication_orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_med_orders_patient` ON `cln_medication_orders` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_med_orders_visit` ON `cln_medication_orders` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_med_orders_status` ON `cln_medication_orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_cln_med_orders_formulary` ON `cln_medication_orders` (`tenant_id`,`formulary_item_id`);--> statement-breakpoint
CREATE TABLE `__new_cln_medication_reconciliation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`reconciliation_type` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`performed_by` integer NOT NULL,
	`completed_at` text,
	`notes` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	`updated_by` integer
);
--> statement-breakpoint
INSERT INTO `__new_cln_medication_reconciliation`("id", "tenant_id", "patient_id", "visit_id", "reconciliation_type", "status", "performed_by", "completed_at", "notes", "is_active", "created_by", "created_at", "updated_at", "updated_by") SELECT "id", "tenant_id", "patient_id", "visit_id", "reconciliation_type", "status", "performed_by", "completed_at", "notes", "is_active", "created_by", "created_at", "updated_at", "updated_by" FROM `cln_medication_reconciliation`;--> statement-breakpoint
DROP TABLE `cln_medication_reconciliation`;--> statement-breakpoint
ALTER TABLE `__new_cln_medication_reconciliation` RENAME TO `cln_medication_reconciliation`;--> statement-breakpoint
CREATE INDEX `idx_cln_recon_tenant` ON `cln_medication_reconciliation` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_recon_patient` ON `cln_medication_reconciliation` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_recon_visit` ON `cln_medication_reconciliation` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE TABLE `__new_cln_medication_reconciliation_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`reconciliation_id` integer NOT NULL,
	`medication_name` text NOT NULL,
	`generic_name` text,
	`dose` text,
	`route` text,
	`frequency` text,
	`source` text DEFAULT 'home',
	`action` text DEFAULT 'continue' NOT NULL,
	`action_reason` text,
	`new_dose` text,
	`new_route` text,
	`new_frequency` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer
);
--> statement-breakpoint
INSERT INTO `__new_cln_medication_reconciliation_items`("id", "tenant_id", "reconciliation_id", "medication_name", "generic_name", "dose", "route", "frequency", "source", "action", "action_reason", "new_dose", "new_route", "new_frequency", "is_active", "created_at", "updated_by") SELECT "id", "tenant_id", "reconciliation_id", "medication_name", "generic_name", "dose", "route", "frequency", "source", "action", "action_reason", "new_dose", "new_route", "new_frequency", "is_active", "created_at", "updated_by" FROM `cln_medication_reconciliation_items`;--> statement-breakpoint
DROP TABLE `cln_medication_reconciliation_items`;--> statement-breakpoint
ALTER TABLE `__new_cln_medication_reconciliation_items` RENAME TO `cln_medication_reconciliation_items`;--> statement-breakpoint
CREATE INDEX `idx_cln_recon_items_recon` ON `cln_medication_reconciliation_items` (`reconciliation_id`);--> statement-breakpoint
CREATE TABLE `__new_health_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`card_type` text DEFAULT 'hospital' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`token_id` integer,
	`issued_by` integer NOT NULL,
	`issued_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`revoked_at` text,
	`revoke_reason` text,
	`replaced_by_id` integer,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_health_cards`("id", "tenant_id", "patient_id", "card_type", "version", "status", "token_id", "issued_by", "issued_at", "revoked_at", "revoke_reason", "replaced_by_id", "metadata", "created_at") SELECT "id", "tenant_id", "patient_id", "card_type", "version", "status", "token_id", "issued_by", "issued_at", "revoked_at", "revoke_reason", "replaced_by_id", "metadata", "created_at" FROM `health_cards`;--> statement-breakpoint
DROP TABLE `health_cards`;--> statement-breakpoint
ALTER TABLE `__new_health_cards` RENAME TO `health_cards`;--> statement-breakpoint
CREATE INDEX `idx_health_cards_patient` ON `health_cards` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_health_cards_status` ON `health_cards` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_health_cards_token` ON `health_cards` (`token_id`);--> statement-breakpoint
CREATE TABLE `__new_admissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`admission_no` text NOT NULL,
	`patient_id` integer NOT NULL,
	`bed_id` integer,
	`doctor_id` integer,
	`admission_type` text DEFAULT 'planned' NOT NULL,
	`admit_source` text,
	`referral_doctor` text,
	`admission_reason` text,
	`is_emergency` integer DEFAULT 0 NOT NULL,
	`admission_date` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`discharge_date` text,
	`provisional_diagnosis` text,
	`final_diagnosis` text,
	`status` text DEFAULT 'admitted' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_admissions`("id", "tenant_id", "admission_no", "patient_id", "bed_id", "doctor_id", "admission_type", "admit_source", "referral_doctor", "admission_reason", "is_emergency", "admission_date", "discharge_date", "provisional_diagnosis", "final_diagnosis", "status", "notes", "created_at", "updated_at") SELECT "id", "tenant_id", "admission_no", "patient_id", "bed_id", "doctor_id", "admission_type", "admit_source", "referral_doctor", "admission_reason", "is_emergency", "admission_date", "discharge_date", "provisional_diagnosis", "final_diagnosis", "status", "notes", "created_at", "updated_at" FROM `admissions`;--> statement-breakpoint
DROP TABLE `admissions`;--> statement-breakpoint
ALTER TABLE `__new_admissions` RENAME TO `admissions`;--> statement-breakpoint
CREATE TABLE `__new_ai_doctor_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`preference_type` text NOT NULL,
	`preference_key` text NOT NULL,
	`preference_value` text NOT NULL,
	`frequency` integer DEFAULT 1,
	`last_used_at` text DEFAULT (datetime('now', '+6 hours')),
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ai_doctor_preferences`("id", "tenant_id", "doctor_id", "preference_type", "preference_key", "preference_value", "frequency", "last_used_at", "created_at") SELECT "id", "tenant_id", "doctor_id", "preference_type", "preference_key", "preference_value", "frequency", "last_used_at", "created_at" FROM `ai_doctor_preferences`;--> statement-breakpoint
DROP TABLE `ai_doctor_preferences`;--> statement-breakpoint
ALTER TABLE `__new_ai_doctor_preferences` RENAME TO `ai_doctor_preferences`;--> statement-breakpoint
CREATE INDEX `idx_ai_doc_pref_doctor` ON `ai_doctor_preferences` (`tenant_id`,`doctor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_doc_pref_unique` ON `ai_doctor_preferences` (`tenant_id`,`doctor_id`,`preference_type`,`preference_key`);--> statement-breakpoint
CREATE TABLE `__new_ai_interactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`feature` text NOT NULL,
	`input_summary` text NOT NULL,
	`ai_response` text NOT NULL,
	`user_action` text DEFAULT 'pending',
	`user_modification` text,
	`vector_id` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ai_interactions`("id", "tenant_id", "user_id", "feature", "input_summary", "ai_response", "user_action", "user_modification", "vector_id", "created_at", "updated_at") SELECT "id", "tenant_id", "user_id", "feature", "input_summary", "ai_response", "user_action", "user_modification", "vector_id", "created_at", "updated_at" FROM `ai_interactions`;--> statement-breakpoint
DROP TABLE `ai_interactions`;--> statement-breakpoint
ALTER TABLE `__new_ai_interactions` RENAME TO `ai_interactions`;--> statement-breakpoint
CREATE INDEX `idx_ai_interactions_feature` ON `ai_interactions` (`tenant_id`,`feature`);--> statement-breakpoint
CREATE INDEX `idx_ai_interactions_user` ON `ai_interactions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_interactions_tenant` ON `ai_interactions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_baby_birth_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`medical_record_id` integer,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`certificate_number` text,
	`baby_name` text,
	`sex` text,
	`weight_kg` real,
	`birth_date` text NOT NULL,
	`birth_time` text,
	`birth_type` text,
	`birth_condition` text,
	`delivery_type` text,
	`birth_order` text,
	`father_name` text,
	`mother_name` text,
	`issued_by` text,
	`certified_by` text,
	`printed_by` text,
	`print_count` integer DEFAULT 0,
	`printed_on` text,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_baby_birth_details`("id", "tenant_id", "medical_record_id", "patient_id", "visit_id", "certificate_number", "baby_name", "sex", "weight_kg", "birth_date", "birth_time", "birth_type", "birth_condition", "delivery_type", "birth_order", "father_name", "mother_name", "issued_by", "certified_by", "printed_by", "print_count", "printed_on", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "medical_record_id", "patient_id", "visit_id", "certificate_number", "baby_name", "sex", "weight_kg", "birth_date", "birth_time", "birth_type", "birth_condition", "delivery_type", "birth_order", "father_name", "mother_name", "issued_by", "certified_by", "printed_by", "print_count", "printed_on", "is_active", "created_by", "created_at", "updated_at" FROM `baby_birth_details`;--> statement-breakpoint
DROP TABLE `baby_birth_details`;--> statement-breakpoint
ALTER TABLE `__new_baby_birth_details` RENAME TO `baby_birth_details`;--> statement-breakpoint
CREATE INDEX `idx_birth_tenant_patient` ON `baby_birth_details` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_birth_date` ON `baby_birth_details` (`tenant_id`,`birth_date`);--> statement-breakpoint
CREATE TABLE `__new_bed_charge_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_bed_info_id` integer NOT NULL,
	`admission_id` integer NOT NULL,
	`bed_id` integer NOT NULL,
	`old_days` integer,
	`new_days` integer,
	`old_amount` real,
	`new_amount` real,
	`reason` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_bed_charge_logs`("id", "tenant_id", "patient_bed_info_id", "admission_id", "bed_id", "old_days", "new_days", "old_amount", "new_amount", "reason", "created_by", "created_at") SELECT "id", "tenant_id", "patient_bed_info_id", "admission_id", "bed_id", "old_days", "new_days", "old_amount", "new_amount", "reason", "created_by", "created_at" FROM `bed_charge_logs`;--> statement-breakpoint
DROP TABLE `bed_charge_logs`;--> statement-breakpoint
ALTER TABLE `__new_bed_charge_logs` RENAME TO `bed_charge_logs`;--> statement-breakpoint
CREATE INDEX `idx_bcl_admission` ON `bed_charge_logs` (`tenant_id`,`admission_id`);--> statement-breakpoint
CREATE TABLE `__new_beds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ward_name` text DEFAULT 'General' NOT NULL,
	`bed_number` text NOT NULL,
	`bed_type` text DEFAULT 'general' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`floor` text,
	`notes` text,
	`rate_per_day` real DEFAULT 0,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_beds`("id", "tenant_id", "ward_name", "bed_number", "bed_type", "status", "floor", "notes", "rate_per_day", "created_at") SELECT "id", "tenant_id", "ward_name", "bed_number", "bed_type", "status", "floor", "notes", "rate_per_day", "created_at" FROM `beds`;--> statement-breakpoint
DROP TABLE `beds`;--> statement-breakpoint
ALTER TABLE `__new_beds` RENAME TO `beds`;--> statement-breakpoint
CREATE TABLE `__new_billing_credit_note_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`credit_note_id` integer NOT NULL,
	`invoice_item_id` integer NOT NULL,
	`item_name` text,
	`unit_price` real,
	`return_quantity` integer DEFAULT 1 NOT NULL,
	`total_amount` real NOT NULL,
	`remarks` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_credit_note_items`("id", "tenant_id", "credit_note_id", "invoice_item_id", "item_name", "unit_price", "return_quantity", "total_amount", "remarks", "created_at") SELECT "id", "tenant_id", "credit_note_id", "invoice_item_id", "item_name", "unit_price", "return_quantity", "total_amount", "remarks", "created_at" FROM `billing_credit_note_items`;--> statement-breakpoint
DROP TABLE `billing_credit_note_items`;--> statement-breakpoint
ALTER TABLE `__new_billing_credit_note_items` RENAME TO `billing_credit_note_items`;--> statement-breakpoint
CREATE INDEX `idx_credit_note_items_cn` ON `billing_credit_note_items` (`credit_note_id`);--> statement-breakpoint
CREATE TABLE `__new_billing_credit_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`credit_note_no` text NOT NULL,
	`bill_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`reason` text NOT NULL,
	`total_amount` real NOT NULL,
	`refund_amount` real NOT NULL,
	`payment_mode` text,
	`remarks` text,
	`counter_id` integer,
	`counter_session_id` integer,
	`status` text DEFAULT 'approved',
	`approved_by` integer,
	`approved_at` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_credit_notes`("id", "tenant_id", "credit_note_no", "bill_id", "patient_id", "reason", "total_amount", "refund_amount", "payment_mode", "remarks", "counter_id", "counter_session_id", "status", "approved_by", "approved_at", "is_active", "created_by", "created_at") SELECT "id", "tenant_id", "credit_note_no", "bill_id", "patient_id", "reason", "total_amount", "refund_amount", "payment_mode", "remarks", "counter_id", "counter_session_id", "status", "approved_by", "approved_at", "is_active", "created_by", "created_at" FROM `billing_credit_notes`;--> statement-breakpoint
DROP TABLE `billing_credit_notes`;--> statement-breakpoint
ALTER TABLE `__new_billing_credit_notes` RENAME TO `billing_credit_notes`;--> statement-breakpoint
CREATE INDEX `idx_credit_notes_patient` ON `billing_credit_notes` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_credit_notes_bill` ON `billing_credit_notes` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_credit_notes_counter_session` ON `billing_credit_notes` (`tenant_id`,`counter_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_credit_notes_tenant` ON `billing_credit_notes` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_billing_deposits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`deposit_receipt_no` text NOT NULL,
	`amount` real NOT NULL,
	`transaction_type` text DEFAULT 'deposit' NOT NULL,
	`payment_method` text,
	`remarks` text,
	`reference_bill_id` integer,
	`counter_id` integer,
	`counter_session_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reference_bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_deposits`("id", "tenant_id", "patient_id", "deposit_receipt_no", "amount", "transaction_type", "payment_method", "remarks", "reference_bill_id", "counter_id", "counter_session_id", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "deposit_receipt_no", "amount", "transaction_type", "payment_method", "remarks", "reference_bill_id", "counter_id", "counter_session_id", "is_active", "created_by", "created_at", "updated_at" FROM `billing_deposits`;--> statement-breakpoint
DROP TABLE `billing_deposits`;--> statement-breakpoint
ALTER TABLE `__new_billing_deposits` RENAME TO `billing_deposits`;--> statement-breakpoint
CREATE INDEX `idx_deposits_receipt` ON `billing_deposits` (`tenant_id`,`deposit_receipt_no`);--> statement-breakpoint
CREATE INDEX `idx_deposits_type` ON `billing_deposits` (`tenant_id`,`transaction_type`);--> statement-breakpoint
CREATE INDEX `idx_deposits_patient` ON `billing_deposits` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_deposits_counter_session` ON `billing_deposits` (`tenant_id`,`counter_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deposits_tenant` ON `billing_deposits` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_billing_handovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`handover_type` text DEFAULT 'user',
	`bank_name` text,
	`voucher_number` text,
	`voucher_date` text,
	`denomination_details` text,
	`counter_session_id` integer,
	`handover_by` integer NOT NULL,
	`handover_to` integer,
	`handover_amount` real NOT NULL,
	`due_amount` real,
	`remarks` text,
	`status` text DEFAULT 'pending',
	`received_by` integer,
	`received_at` text,
	`received_remarks` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "handover_type_check" CHECK(handover_type IN ('user', 'account')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_handovers`("id", "tenant_id", "handover_type", "bank_name", "voucher_number", "voucher_date", "denomination_details", "counter_session_id", "handover_by", "handover_to", "handover_amount", "due_amount", "remarks", "status", "received_by", "received_at", "received_remarks", "is_active", "created_at") SELECT "id", "tenant_id", "handover_type", "bank_name", "voucher_number", "voucher_date", "denomination_details", "counter_session_id", "handover_by", "handover_to", "handover_amount", "due_amount", "remarks", "status", "received_by", "received_at", "received_remarks", "is_active", "created_at" FROM `billing_handovers`;--> statement-breakpoint
DROP TABLE `billing_handovers`;--> statement-breakpoint
ALTER TABLE `__new_billing_handovers` RENAME TO `billing_handovers`;--> statement-breakpoint
CREATE INDEX `idx_handovers_by` ON `billing_handovers` (`tenant_id`,`handover_by`);--> statement-breakpoint
CREATE INDEX `idx_billing_handovers_counter_session` ON `billing_handovers` (`tenant_id`,`counter_session_id`);--> statement-breakpoint
CREATE INDEX `idx_handovers_tenant` ON `billing_handovers` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_billing_item_price_category_maps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`service_item_id` integer NOT NULL,
	`price_category_id` integer NOT NULL,
	`price` real NOT NULL,
	`is_discount_applicable` integer DEFAULT 1,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_billing_item_price_category_maps`("id", "tenant_id", "service_item_id", "price_category_id", "price", "is_discount_applicable", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "service_item_id", "price_category_id", "price", "is_discount_applicable", "is_active", "created_at", "updated_at" FROM `billing_item_price_category_maps`;--> statement-breakpoint
DROP TABLE `billing_item_price_category_maps`;--> statement-breakpoint
ALTER TABLE `__new_billing_item_price_category_maps` RENAME TO `billing_item_price_category_maps`;--> statement-breakpoint
CREATE INDEX `idx_price_map_item_category` ON `billing_item_price_category_maps` (`tenant_id`,`service_item_id`,`price_category_id`);--> statement-breakpoint
CREATE INDEX `idx_price_map_tenant` ON `billing_item_price_category_maps` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_billing_provisional_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`admission_id` integer,
	`visit_id` integer,
	`item_category` text NOT NULL,
	`item_name` text NOT NULL,
	`department` text,
	`unit_price` real NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`discount_percent` real,
	`discount_amount` real,
	`total_amount` real NOT NULL,
	`doctor_id` integer,
	`doctor_name` text,
	`reference_id` integer,
	`appointment_id` integer,
	`bill_status` text DEFAULT 'provisional',
	`is_insurance` integer DEFAULT 0,
	`cancelled_by` integer,
	`cancelled_at` text,
	`cancel_reason` text,
	`billed_bill_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_provisional_items`("id", "tenant_id", "patient_id", "admission_id", "visit_id", "item_category", "item_name", "department", "unit_price", "quantity", "discount_percent", "discount_amount", "total_amount", "doctor_id", "doctor_name", "reference_id", "appointment_id", "bill_status", "is_insurance", "cancelled_by", "cancelled_at", "cancel_reason", "billed_bill_id", "is_active", "created_by", "created_at") SELECT "id", "tenant_id", "patient_id", "admission_id", "visit_id", "item_category", "item_name", "department", "unit_price", "quantity", "discount_percent", "discount_amount", "total_amount", "doctor_id", "doctor_name", "reference_id", "appointment_id", "bill_status", "is_insurance", "cancelled_by", "cancelled_at", "cancel_reason", "billed_bill_id", "is_active", "created_by", "created_at" FROM `billing_provisional_items`;--> statement-breakpoint
DROP TABLE `billing_provisional_items`;--> statement-breakpoint
ALTER TABLE `__new_billing_provisional_items` RENAME TO `billing_provisional_items`;--> statement-breakpoint
CREATE INDEX `idx_provisional_status` ON `billing_provisional_items` (`tenant_id`,`bill_status`);--> statement-breakpoint
CREATE INDEX `idx_provisional_admission` ON `billing_provisional_items` (`tenant_id`,`admission_id`);--> statement-breakpoint
CREATE INDEX `idx_provisional_patient` ON `billing_provisional_items` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_billing_provisional_appointment` ON `billing_provisional_items` (`tenant_id`,`appointment_id`,`bill_status`);--> statement-breakpoint
CREATE INDEX `idx_provisional_tenant` ON `billing_provisional_items` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_billing_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`settlement_receipt_no` text NOT NULL,
	`payable_amount` real NOT NULL,
	`paid_amount` real NOT NULL,
	`deposit_deducted` real,
	`discount_amount` real,
	`returned_amount` real,
	`payment_mode` text,
	`remarks` text,
	`counter_id` integer,
	`counter_session_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_billing_settlements`("id", "tenant_id", "patient_id", "settlement_receipt_no", "payable_amount", "paid_amount", "deposit_deducted", "discount_amount", "returned_amount", "payment_mode", "remarks", "counter_id", "counter_session_id", "is_active", "created_by", "created_at") SELECT "id", "tenant_id", "patient_id", "settlement_receipt_no", "payable_amount", "paid_amount", "deposit_deducted", "discount_amount", "returned_amount", "payment_mode", "remarks", "counter_id", "counter_session_id", "is_active", "created_by", "created_at" FROM `billing_settlements`;--> statement-breakpoint
DROP TABLE `billing_settlements`;--> statement-breakpoint
ALTER TABLE `__new_billing_settlements` RENAME TO `billing_settlements`;--> statement-breakpoint
CREATE INDEX `idx_settlements_patient` ON `billing_settlements` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_settlements_counter_session` ON `billing_settlements` (`tenant_id`,`counter_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_settlements_tenant` ON `billing_settlements` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_catalog_icd11_mms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`icd11_uri` text,
	`is_bd_subset` integer DEFAULT 1,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_catalog_icd11_mms`("id", "code", "title", "icd11_uri", "is_bd_subset", "is_active", "created_at") SELECT "id", "code", "title", "icd11_uri", "is_bd_subset", "is_active", "created_at" FROM `catalog_icd11_mms`;--> statement-breakpoint
DROP TABLE `catalog_icd11_mms`;--> statement-breakpoint
ALTER TABLE `__new_catalog_icd11_mms` RENAME TO `catalog_icd11_mms`;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_icd11_mms_code_unique` ON `catalog_icd11_mms` (`code`);--> statement-breakpoint
CREATE INDEX `idx_catalog_icd11_mms_code` ON `catalog_icd11_mms` (`code`);--> statement-breakpoint
CREATE INDEX `idx_catalog_icd11_mms_title` ON `catalog_icd11_mms` (`title`);--> statement-breakpoint
CREATE TABLE `__new_clinical_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`image_type` text DEFAULT 'other' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`file_key` text NOT NULL,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`body_part` text,
	`is_active` integer DEFAULT 1,
	`uploaded_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_clinical_images`("id", "tenant_id", "patient_id", "visit_id", "image_type", "title", "description", "file_key", "file_name", "file_size", "mime_type", "body_part", "is_active", "uploaded_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "image_type", "title", "description", "file_key", "file_name", "file_size", "mime_type", "body_part", "is_active", "uploaded_by", "created_at", "updated_at" FROM `clinical_images`;--> statement-breakpoint
DROP TABLE `clinical_images`;--> statement-breakpoint
ALTER TABLE `__new_clinical_images` RENAME TO `clinical_images`;--> statement-breakpoint
CREATE INDEX `idx_cln_images_patient` ON `clinical_images` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_images_visit` ON `clinical_images` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_images_type` ON `clinical_images` (`tenant_id`,`image_type`);--> statement-breakpoint
CREATE TABLE `__new_clinical_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`note_type` text DEFAULT 'progress' NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`chief_complaint` text,
	`subjective` text,
	`objective` text,
	`assessment` text,
	`plan` text,
	`follow_up` text,
	`follow_up_unit` text,
	`template_id` integer,
	`performer_id` integer,
	`is_signed` integer DEFAULT 0,
	`signed_by` integer,
	`signed_at` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_clinical_notes`("id", "tenant_id", "patient_id", "visit_id", "note_type", "title", "content", "chief_complaint", "subjective", "objective", "assessment", "plan", "follow_up", "follow_up_unit", "template_id", "performer_id", "is_signed", "signed_by", "signed_at", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "note_type", "title", "content", "chief_complaint", "subjective", "objective", "assessment", "plan", "follow_up", "follow_up_unit", "template_id", "performer_id", "is_signed", "signed_by", "signed_at", "is_active", "created_by", "created_at", "updated_at" FROM `clinical_notes`;--> statement-breakpoint
DROP TABLE `clinical_notes`;--> statement-breakpoint
ALTER TABLE `__new_clinical_notes` RENAME TO `clinical_notes`;--> statement-breakpoint
CREATE INDEX `idx_cln_notes_patient` ON `clinical_notes` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_notes_visit` ON `clinical_notes` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_notes_type` ON `clinical_notes` (`tenant_id`,`note_type`);--> statement-breakpoint
CREATE TABLE `__new_clinical_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`temperature` real,
	`pulse` integer,
	`blood_pressure_systolic` integer,
	`blood_pressure_diastolic` integer,
	`respiratory_rate` integer,
	`spo2` real,
	`weight` real,
	`height` real,
	`bmi` real,
	`pain_scale` integer,
	`blood_sugar` real,
	`notes` text,
	`taken_by` integer,
	`taken_at` text DEFAULT (datetime('now', '+6 hours')),
	`source` text DEFAULT 'recorded' NOT NULL,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_clinical_vitals`("id", "tenant_id", "patient_id", "visit_id", "temperature", "pulse", "blood_pressure_systolic", "blood_pressure_diastolic", "respiratory_rate", "spo2", "weight", "height", "bmi", "pain_scale", "blood_sugar", "notes", "taken_by", "taken_at", "source", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "temperature", "pulse", "blood_pressure_systolic", "blood_pressure_diastolic", "respiratory_rate", "spo2", "weight", "height", "bmi", "pain_scale", "blood_sugar", "notes", "taken_by", "taken_at", "source", "is_active", "created_at", "updated_at" FROM `clinical_vitals`;--> statement-breakpoint
DROP TABLE `clinical_vitals`;--> statement-breakpoint
ALTER TABLE `__new_clinical_vitals` RENAME TO `clinical_vitals`;--> statement-breakpoint
CREATE INDEX `idx_vitals_taken_at` ON `clinical_vitals` (`tenant_id`,`taken_at`);--> statement-breakpoint
CREATE INDEX `idx_vitals_visit` ON `clinical_vitals` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_vitals_tenant` ON `clinical_vitals` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_cln_patient_clinical_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`key_name` text,
	`value` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_cln_patient_clinical_info`("id", "tenant_id", "patient_id", "visit_id", "key_name", "value", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "key_name", "value", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `cln_patient_clinical_info`;--> statement-breakpoint
DROP TABLE `cln_patient_clinical_info`;--> statement-breakpoint
ALTER TABLE `__new_cln_patient_clinical_info` RENAME TO `cln_patient_clinical_info`;--> statement-breakpoint
CREATE INDEX `idx_cln_info_visit` ON `cln_patient_clinical_info` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_cln_info_tenant` ON `cln_patient_clinical_info` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_consent_purpose_defaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`purpose` text NOT NULL,
	`default_scope` text DEFAULT 'none' NOT NULL,
	`default_clinical_areas` text,
	`auto_grant` integer DEFAULT 0 NOT NULL,
	`requires_explicit_consent` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_consent_purpose_defaults`("id", "tenant_id", "purpose", "default_scope", "default_clinical_areas", "auto_grant", "requires_explicit_consent", "created_at", "updated_at") SELECT "id", "tenant_id", "purpose", "default_scope", "default_clinical_areas", "auto_grant", "requires_explicit_consent", "created_at", "updated_at" FROM `consent_purpose_defaults`;--> statement-breakpoint
DROP TABLE `consent_purpose_defaults`;--> statement-breakpoint
ALTER TABLE `__new_consent_purpose_defaults` RENAME TO `consent_purpose_defaults`;--> statement-breakpoint
CREATE INDEX `idx_consent_purpose_defaults_tenant` ON `consent_purpose_defaults` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_consultations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doctor_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`scheduled_at` text NOT NULL,
	`duration_min` integer DEFAULT 30 NOT NULL,
	`room_url` text,
	`room_name` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`prescription` text,
	`chief_complaint` text,
	`followup_date` text,
	`tenant_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_consultations`("id", "doctor_id", "patient_id", "scheduled_at", "duration_min", "room_url", "room_name", "status", "notes", "prescription", "chief_complaint", "followup_date", "tenant_id", "created_by", "created_at", "updated_at") SELECT "id", "doctor_id", "patient_id", "scheduled_at", "duration_min", "room_url", "room_name", "status", "notes", "prescription", "chief_complaint", "followup_date", "tenant_id", "created_by", "created_at", "updated_at" FROM `consultations`;--> statement-breakpoint
DROP TABLE `consultations`;--> statement-breakpoint
ALTER TABLE `__new_consultations` RENAME TO `consultations`;--> statement-breakpoint
CREATE INDEX `idx_consultations_schedule` ON `consultations` (`tenant_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_consultations_patient` ON `consultations` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_consultations_doctor` ON `consultations` (`tenant_id`,`doctor_id`);--> statement-breakpoint
CREATE INDEX `idx_consultations_tenant` ON `consultations` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_death_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`medical_record_id` integer,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`certificate_number` text,
	`death_date` text NOT NULL,
	`death_time` text,
	`cause_of_death` text,
	`secondary_cause` text,
	`manner_of_death` text,
	`place_of_death` text,
	`age_at_death` text,
	`father_name` text,
	`mother_name` text,
	`spouse_name` text,
	`certified_by` text,
	`printed_by` text,
	`print_count` integer DEFAULT 0,
	`printed_on` text,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_death_details`("id", "tenant_id", "medical_record_id", "patient_id", "visit_id", "certificate_number", "death_date", "death_time", "cause_of_death", "secondary_cause", "manner_of_death", "place_of_death", "age_at_death", "father_name", "mother_name", "spouse_name", "certified_by", "printed_by", "print_count", "printed_on", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "medical_record_id", "patient_id", "visit_id", "certificate_number", "death_date", "death_time", "cause_of_death", "secondary_cause", "manner_of_death", "place_of_death", "age_at_death", "father_name", "mother_name", "spouse_name", "certified_by", "printed_by", "print_count", "printed_on", "is_active", "created_by", "created_at", "updated_at" FROM `death_details`;--> statement-breakpoint
DROP TABLE `death_details`;--> statement-breakpoint
ALTER TABLE `__new_death_details` RENAME TO `death_details`;--> statement-breakpoint
CREATE INDEX `idx_death_tenant_patient` ON `death_details` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_death_date` ON `death_details` (`tenant_id`,`death_date`);--> statement-breakpoint
CREATE TABLE `__new_document_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`medical_record_id` integer,
	`document_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`file_key` text,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`uploaded_by` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_document_records`("id", "tenant_id", "patient_id", "medical_record_id", "document_type", "title", "description", "file_key", "file_name", "file_size", "mime_type", "uploaded_by", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "medical_record_id", "document_type", "title", "description", "file_key", "file_name", "file_size", "mime_type", "uploaded_by", "is_active", "created_at", "updated_at" FROM `document_records`;--> statement-breakpoint
DROP TABLE `document_records`;--> statement-breakpoint
ALTER TABLE `__new_document_records` RENAME TO `document_records`;--> statement-breakpoint
CREATE INDEX `idx_document_tenant_patient` ON `document_records` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_drug_interaction_pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`drug_a_name` text NOT NULL,
	`drug_b_name` text NOT NULL,
	`severity` text DEFAULT 'moderate' NOT NULL,
	`description` text NOT NULL,
	`recommendation` text,
	`evidence_level` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_drug_interaction_pairs`("id", "tenant_id", "drug_a_name", "drug_b_name", "severity", "description", "recommendation", "evidence_level", "is_active", "created_by", "created_at") SELECT "id", "tenant_id", "drug_a_name", "drug_b_name", "severity", "description", "recommendation", "evidence_level", "is_active", "created_by", "created_at" FROM `drug_interaction_pairs`;--> statement-breakpoint
DROP TABLE `drug_interaction_pairs`;--> statement-breakpoint
ALTER TABLE `__new_drug_interaction_pairs` RENAME TO `drug_interaction_pairs`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_interactions_pair_unique` ON `drug_interaction_pairs` (`tenant_id`,`drug_a_name`,`drug_b_name`);--> statement-breakpoint
CREATE INDEX `idx_interactions_severity` ON `drug_interaction_pairs` (`tenant_id`,`severity`);--> statement-breakpoint
CREATE INDEX `idx_interactions_drug_b` ON `drug_interaction_pairs` (`tenant_id`,`drug_b_name`);--> statement-breakpoint
CREATE INDEX `idx_interactions_drug_a` ON `drug_interaction_pairs` (`tenant_id`,`drug_a_name`);--> statement-breakpoint
CREATE INDEX `idx_interactions_tenant` ON `drug_interaction_pairs` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_eligibility_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`policy_id` integer,
	`service_type` text DEFAULT '30',
	`eligible` integer DEFAULT 0,
	`status` text,
	`response_json` text,
	`checked_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_eligibility_logs`("id", "tenant_id", "patient_id", "policy_id", "service_type", "eligible", "status", "response_json", "checked_at") SELECT "id", "tenant_id", "patient_id", "policy_id", "service_type", "eligible", "status", "response_json", "checked_at" FROM `eligibility_logs`;--> statement-breakpoint
DROP TABLE `eligibility_logs`;--> statement-breakpoint
ALTER TABLE `__new_eligibility_logs` RENAME TO `eligibility_logs`;--> statement-breakpoint
CREATE INDEX `idx_eligibility_patient` ON `eligibility_logs` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_emp_cash_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_id` integer NOT NULL,
	`counter_id` integer,
	`counter_session_id` integer,
	`transaction_type` text NOT NULL,
	`amount` real NOT NULL,
	`reference_id` integer,
	`reference_type` text,
	`payment_method` text,
	`description` text,
	`transaction_date` text DEFAULT (datetime('now', '+6 hours')),
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "emp_cash_check_1" CHECK(transaction_type IN ('CashSales','SalesReturn','DepositDeduct','ReturnDeposit','CollectionFromReceivable','CashDiscountGiven','CashDiscountReceived'))
);
--> statement-breakpoint
INSERT INTO `__new_emp_cash_transactions`("id", "tenant_id", "employee_id", "counter_id", "counter_session_id", "transaction_type", "amount", "reference_id", "reference_type", "payment_method", "description", "transaction_date", "created_at") SELECT "id", "tenant_id", "employee_id", "counter_id", "counter_session_id", "transaction_type", "amount", "reference_id", "reference_type", "payment_method", "description", "transaction_date", "created_at" FROM `emp_cash_transactions`;--> statement-breakpoint
DROP TABLE `emp_cash_transactions`;--> statement-breakpoint
ALTER TABLE `__new_emp_cash_transactions` RENAME TO `emp_cash_transactions`;--> statement-breakpoint
CREATE INDEX `idx_emp_cash_tenant_employee` ON `emp_cash_transactions` (`tenant_id`,`employee_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_emp_cash_tenant_type` ON `emp_cash_transactions` (`tenant_id`,`transaction_type`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_emp_cash_reference` ON `emp_cash_transactions` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `__new_emp_employee_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_id` integer NOT NULL,
	`preference_name` text NOT NULL,
	`preference_value` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_emp_employee_preferences`("id", "tenant_id", "employee_id", "preference_name", "preference_value", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "employee_id", "preference_name", "preference_value", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `emp_employee_preferences`;--> statement-breakpoint
DROP TABLE `emp_employee_preferences`;--> statement-breakpoint
ALTER TABLE `__new_emp_employee_preferences` RENAME TO `emp_employee_preferences`;--> statement-breakpoint
CREATE INDEX `idx_emp_pref_employee` ON `emp_employee_preferences` (`tenant_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_emp_pref_tenant` ON `emp_employee_preferences` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_encounters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`encounter_type` text DEFAULT 'outpatient' NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`start_time` text DEFAULT (datetime('now', '+6 hours')),
	`end_time` text,
	`provider_id` integer,
	`department_id` integer,
	`reason_for_visit` text,
	`chief_complaint` text,
	`disposition_code` text,
	`disposition_note` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_encounters`("id", "tenant_id", "patient_id", "visit_id", "encounter_type", "status", "start_time", "end_time", "provider_id", "department_id", "reason_for_visit", "chief_complaint", "disposition_code", "disposition_note", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "encounter_type", "status", "start_time", "end_time", "provider_id", "department_id", "reason_for_visit", "chief_complaint", "disposition_code", "disposition_note", "is_active", "created_by", "created_at", "updated_at" FROM `encounters`;--> statement-breakpoint
DROP TABLE `encounters`;--> statement-breakpoint
ALTER TABLE `__new_encounters` RENAME TO `encounters`;--> statement-breakpoint
CREATE INDEX `idx_encounters_patient` ON `encounters` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_encounters_visit` ON `encounters` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_encounters_status` ON `encounters` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_encounters_provider` ON `encounters` (`tenant_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `__new_er_discharge_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`discharge_type` text,
	`chief_complaints` text,
	`treatment_in_er` text,
	`investigations` text,
	`advice_on_discharge` text,
	`on_examination` text,
	`provisional_diagnosis` text,
	`doctor_name` text,
	`medical_officer` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_er_discharge_summaries`("id", "tenant_id", "patient_id", "visit_id", "discharge_type", "chief_complaints", "treatment_in_er", "investigations", "advice_on_discharge", "on_examination", "provisional_diagnosis", "doctor_name", "medical_officer", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "discharge_type", "chief_complaints", "treatment_in_er", "investigations", "advice_on_discharge", "on_examination", "provisional_diagnosis", "doctor_name", "medical_officer", "created_by", "created_at", "updated_at" FROM `er_discharge_summaries`;--> statement-breakpoint
DROP TABLE `er_discharge_summaries`;--> statement-breakpoint
ALTER TABLE `__new_er_discharge_summaries` RENAME TO `er_discharge_summaries`;--> statement-breakpoint
CREATE INDEX `idx_er_discharge_visit` ON `er_discharge_summaries` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_er_discharge_patient` ON `er_discharge_summaries` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_er_discharge_tenant` ON `er_discharge_summaries` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_er_file_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`er_patient_id` integer NOT NULL,
	`patient_id` integer,
	`file_type` text,
	`file_name` text,
	`display_name` text,
	`file_url` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`er_patient_id`) REFERENCES `er_patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_er_file_uploads`("id", "tenant_id", "er_patient_id", "patient_id", "file_type", "file_name", "display_name", "file_url", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "er_patient_id", "patient_id", "file_type", "file_name", "display_name", "file_url", "is_active", "created_by", "created_at", "updated_at" FROM `er_file_uploads`;--> statement-breakpoint
DROP TABLE `er_file_uploads`;--> statement-breakpoint
ALTER TABLE `__new_er_file_uploads` RENAME TO `er_file_uploads`;--> statement-breakpoint
CREATE INDEX `idx_er_files_patient` ON `er_file_uploads` (`tenant_id`,`er_patient_id`);--> statement-breakpoint
CREATE TABLE `__new_er_mode_of_arrival` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_er_mode_of_arrival`("id", "tenant_id", "name", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "is_active", "created_at", "updated_at" FROM `er_mode_of_arrival`;--> statement-breakpoint
DROP TABLE `er_mode_of_arrival`;--> statement-breakpoint
ALTER TABLE `__new_er_mode_of_arrival` RENAME TO `er_mode_of_arrival`;--> statement-breakpoint
CREATE INDEX `idx_er_arrival_tenant` ON `er_mode_of_arrival` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_er_patient_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`er_patient_id` integer NOT NULL,
	`main_case` integer,
	`sub_case` integer,
	`other_case_details` text,
	`biting_site` integer,
	`datetime_of_bite` text,
	`biting_animal` integer,
	`first_aid` integer,
	`first_aid_others` text,
	`biting_animal_others` text,
	`biting_site_others` text,
	`biting_address` text,
	`biting_animal_name` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`er_patient_id`) REFERENCES `er_patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_er_patient_cases`("id", "tenant_id", "er_patient_id", "main_case", "sub_case", "other_case_details", "biting_site", "datetime_of_bite", "biting_animal", "first_aid", "first_aid_others", "biting_animal_others", "biting_site_others", "biting_address", "biting_animal_name", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "er_patient_id", "main_case", "sub_case", "other_case_details", "biting_site", "datetime_of_bite", "biting_animal", "first_aid", "first_aid_others", "biting_animal_others", "biting_site_others", "biting_address", "biting_animal_name", "is_active", "created_by", "created_at", "updated_at" FROM `er_patient_cases`;--> statement-breakpoint
DROP TABLE `er_patient_cases`;--> statement-breakpoint
ALTER TABLE `__new_er_patient_cases` RENAME TO `er_patient_cases`;--> statement-breakpoint
CREATE INDEX `idx_er_cases_patient` ON `er_patient_cases` (`tenant_id`,`er_patient_id`);--> statement-breakpoint
CREATE TABLE `__new_er_patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`er_patient_number` text NOT NULL,
	`patient_id` integer,
	`visit_id` integer,
	`discharge_summary_id` integer,
	`visit_datetime` text,
	`first_name` text,
	`middle_name` text,
	`last_name` text,
	`gender` text,
	`age` text,
	`date_of_birth` text,
	`contact_no` text,
	`care_of_person_contact` text,
	`address` text,
	`referred_by` text,
	`referred_to` text,
	`case_type` text,
	`condition_on_arrival` text,
	`brought_by` text,
	`relation_with_patient` text,
	`mode_of_arrival_id` integer,
	`care_of_person` text,
	`er_status` text DEFAULT 'new',
	`triage_code` text,
	`triaged_by` integer,
	`triaged_on` text,
	`is_active` integer DEFAULT 1,
	`is_existing_patient` integer DEFAULT 0,
	`ward_no` integer,
	`finalized_status` text,
	`finalized_remarks` text,
	`finalized_by` integer,
	`finalized_on` text,
	`performer_id` integer,
	`performer_name` text,
	`is_police_case` integer DEFAULT 0,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mode_of_arrival_id`) REFERENCES `er_mode_of_arrival`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_er_patients`("id", "tenant_id", "er_patient_number", "patient_id", "visit_id", "discharge_summary_id", "visit_datetime", "first_name", "middle_name", "last_name", "gender", "age", "date_of_birth", "contact_no", "care_of_person_contact", "address", "referred_by", "referred_to", "case_type", "condition_on_arrival", "brought_by", "relation_with_patient", "mode_of_arrival_id", "care_of_person", "er_status", "triage_code", "triaged_by", "triaged_on", "is_active", "is_existing_patient", "ward_no", "finalized_status", "finalized_remarks", "finalized_by", "finalized_on", "performer_id", "performer_name", "is_police_case", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "er_patient_number", "patient_id", "visit_id", "discharge_summary_id", "visit_datetime", "first_name", "middle_name", "last_name", "gender", "age", "date_of_birth", "contact_no", "care_of_person_contact", "address", "referred_by", "referred_to", "case_type", "condition_on_arrival", "brought_by", "relation_with_patient", "mode_of_arrival_id", "care_of_person", "er_status", "triage_code", "triaged_by", "triaged_on", "is_active", "is_existing_patient", "ward_no", "finalized_status", "finalized_remarks", "finalized_by", "finalized_on", "performer_id", "performer_name", "is_police_case", "created_by", "created_at", "updated_at" FROM `er_patients`;--> statement-breakpoint
DROP TABLE `er_patients`;--> statement-breakpoint
ALTER TABLE `__new_er_patients` RENAME TO `er_patients`;--> statement-breakpoint
CREATE INDEX `idx_er_patients_active` ON `er_patients` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_visit_date` ON `er_patients` (`tenant_id`,`visit_datetime`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_finalized` ON `er_patients` (`tenant_id`,`finalized_status`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_triage` ON `er_patients` (`tenant_id`,`triage_code`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_status` ON `er_patients` (`tenant_id`,`er_status`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_patient` ON `er_patients` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_number` ON `er_patients` (`tenant_id`,`er_patient_number`);--> statement-breakpoint
CREATE INDEX `idx_er_patients_tenant` ON `er_patients` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_final_diagnosis` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`medical_record_id` integer,
	`icd10_id` integer,
	`icd11_code` text,
	`icd11_title` text,
	`is_primary` integer DEFAULT 0,
	`notes` text,
	`source` text DEFAULT 'clinician' NOT NULL,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`icd10_id`) REFERENCES `icd10_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_final_diagnosis`("id", "tenant_id", "patient_id", "visit_id", "medical_record_id", "icd10_id", "icd11_code", "icd11_title", "is_primary", "notes", "source", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "medical_record_id", "icd10_id", "icd11_code", "icd11_title", "is_primary", "notes", "source", "is_active", "created_by", "created_at", "updated_at" FROM `final_diagnosis`;--> statement-breakpoint
DROP TABLE `final_diagnosis`;--> statement-breakpoint
ALTER TABLE `__new_final_diagnosis` RENAME TO `final_diagnosis`;--> statement-breakpoint
CREATE INDEX `idx_diagnosis_tenant_visit` ON `final_diagnosis` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_diagnosis_icd10` ON `final_diagnosis` (`icd10_id`);--> statement-breakpoint
CREATE TABLE `__new_fiscal_years` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`fiscal_year_name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`prefix` text DEFAULT 'BL',
	`insurance_prefix` text DEFAULT 'INS',
	`pharmacy_prefix` text DEFAULT 'PHR',
	`is_active` integer DEFAULT 1,
	`is_closed` integer DEFAULT 0,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_fiscal_years`("id", "tenant_id", "fiscal_year_name", "start_date", "end_date", "prefix", "insurance_prefix", "pharmacy_prefix", "is_active", "is_closed", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "fiscal_year_name", "start_date", "end_date", "prefix", "insurance_prefix", "pharmacy_prefix", "is_active", "is_closed", "created_by", "created_at", "updated_at" FROM `fiscal_years`;--> statement-breakpoint
DROP TABLE `fiscal_years`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_years` RENAME TO `fiscal_years`;--> statement-breakpoint
CREATE INDEX `idx_fiscal_years_tenant` ON `fiscal_years` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_formulary_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` integer,
	`sort_order` integer DEFAULT 0,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_formulary_categories`("id", "tenant_id", "name", "description", "parent_id", "sort_order", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "description", "parent_id", "sort_order", "is_active", "created_at", "updated_at" FROM `formulary_categories`;--> statement-breakpoint
DROP TABLE `formulary_categories`;--> statement-breakpoint
ALTER TABLE `__new_formulary_categories` RENAME TO `formulary_categories`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_formulary_cat_unique` ON `formulary_categories` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_formulary_cat_tenant` ON `formulary_categories` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_formulary_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`generic_name` text NOT NULL,
	`category_id` integer,
	`strength` text,
	`dosage_form` text,
	`route` text,
	`manufacturer` text,
	`common_dosages` text,
	`default_frequency` text,
	`default_duration` text,
	`max_daily_dose_mg` real,
	`default_instructions` text,
	`is_antibiotic` integer DEFAULT 0,
	`is_controlled` integer DEFAULT 0,
	`requires_prior_auth` integer DEFAULT 0,
	`unit_price` real,
	`medicine_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `formulary_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_formulary_items`("id", "tenant_id", "name", "generic_name", "category_id", "strength", "dosage_form", "route", "manufacturer", "common_dosages", "default_frequency", "default_duration", "max_daily_dose_mg", "default_instructions", "is_antibiotic", "is_controlled", "requires_prior_auth", "unit_price", "medicine_id", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "generic_name", "category_id", "strength", "dosage_form", "route", "manufacturer", "common_dosages", "default_frequency", "default_duration", "max_daily_dose_mg", "default_instructions", "is_antibiotic", "is_controlled", "requires_prior_auth", "unit_price", "medicine_id", "is_active", "created_by", "created_at", "updated_at" FROM `formulary_items`;--> statement-breakpoint
DROP TABLE `formulary_items`;--> statement-breakpoint
ALTER TABLE `__new_formulary_items` RENAME TO `formulary_items`;--> statement-breakpoint
CREATE INDEX `idx_formulary_medicine` ON `formulary_items` (`tenant_id`,`medicine_id`);--> statement-breakpoint
CREATE INDEX `idx_formulary_category` ON `formulary_items` (`tenant_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_formulary_generic` ON `formulary_items` (`tenant_id`,`generic_name`);--> statement-breakpoint
CREATE INDEX `idx_formulary_name` ON `formulary_items` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_formulary_tenant` ON `formulary_items` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_health_record_block_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`national_id` text NOT NULL,
	`blocked_tenant_id` integer,
	`blocked_doctor_id` integer,
	`reason` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_health_record_block_list`("id", "national_id", "blocked_tenant_id", "blocked_doctor_id", "reason", "is_active", "created_at", "updated_at") SELECT "id", "national_id", "blocked_tenant_id", "blocked_doctor_id", "reason", "is_active", "created_at", "updated_at" FROM `health_record_block_list`;--> statement-breakpoint
DROP TABLE `health_record_block_list`;--> statement-breakpoint
ALTER TABLE `__new_health_record_block_list` RENAME TO `health_record_block_list`;--> statement-breakpoint
CREATE INDEX `idx_block_list_nid` ON `health_record_block_list` (`national_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_health_record_consent_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`national_id` text NOT NULL,
	`accessing_tenant_id` integer NOT NULL,
	`accessing_user_id` integer NOT NULL,
	`emergency_reason_code` text NOT NULL,
	`emergency_reason_details` text,
	`resource_type` text,
	`resource_id` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_health_record_consent_overrides`("id", "national_id", "accessing_tenant_id", "accessing_user_id", "emergency_reason_code", "emergency_reason_details", "resource_type", "resource_id", "created_at") SELECT "id", "national_id", "accessing_tenant_id", "accessing_user_id", "emergency_reason_code", "emergency_reason_details", "resource_type", "resource_id", "created_at" FROM `health_record_consent_overrides`;--> statement-breakpoint
DROP TABLE `health_record_consent_overrides`;--> statement-breakpoint
ALTER TABLE `__new_health_record_consent_overrides` RENAME TO `health_record_consent_overrides`;--> statement-breakpoint
CREATE INDEX `idx_consent_overrides_nid` ON `health_record_consent_overrides` (`national_id`);--> statement-breakpoint
CREATE INDEX `idx_consent_overrides_tenant` ON `health_record_consent_overrides` (`accessing_tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_health_record_consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`national_id` text NOT NULL,
	`granting_tenant_id` text NOT NULL,
	`granting_patient_id` integer NOT NULL,
	`granted_to_tenant_id` integer,
	`consent_type` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`granted_at` text DEFAULT (datetime('now', '+6 hours')),
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_reason` text,
	`emergency_justification` text,
	`emergency_declared_by` integer,
	`clinical_areas` text,
	`purpose` text DEFAULT 'TREATMENT',
	`auto_granted` integer DEFAULT 0,
	`expired_at` text
);
--> statement-breakpoint
INSERT INTO `__new_health_record_consents`("id", "national_id", "granting_tenant_id", "granting_patient_id", "granted_to_tenant_id", "consent_type", "is_active", "granted_at", "expires_at", "revoked_at", "revoked_reason", "emergency_justification", "emergency_declared_by", "clinical_areas", "purpose", "auto_granted", "expired_at") SELECT "id", "national_id", "granting_tenant_id", "granting_patient_id", "granted_to_tenant_id", "consent_type", "is_active", "granted_at", "expires_at", "revoked_at", "revoked_reason", "emergency_justification", "emergency_declared_by", "clinical_areas", "purpose", "auto_granted", "expired_at" FROM `health_record_consents`;--> statement-breakpoint
DROP TABLE `health_record_consents`;--> statement-breakpoint
ALTER TABLE `__new_health_record_consents` RENAME TO `health_record_consents`;--> statement-breakpoint
CREATE INDEX `idx_consents_nid` ON `health_record_consents` (`national_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_consents_granting` ON `health_record_consents` (`granting_tenant_id`,`granting_patient_id`);--> statement-breakpoint
CREATE INDEX `idx_consents_expiry_cleanup` ON `health_record_consents` (`is_active`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_consents_purpose` ON `health_record_consents` (`purpose`,`auto_granted`);--> statement-breakpoint
CREATE TABLE `__new_health_record_sensitivity_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` integer NOT NULL,
	`sensitivity_category` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_health_record_sensitivity_labels`("id", "tenant_id", "patient_id", "resource_type", "resource_id", "sensitivity_category", "created_by", "created_at") SELECT "id", "tenant_id", "patient_id", "resource_type", "resource_id", "sensitivity_category", "created_by", "created_at" FROM `health_record_sensitivity_labels`;--> statement-breakpoint
DROP TABLE `health_record_sensitivity_labels`;--> statement-breakpoint
ALTER TABLE `__new_health_record_sensitivity_labels` RENAME TO `health_record_sensitivity_labels`;--> statement-breakpoint
CREATE INDEX `idx_sensitivity_resource` ON `health_record_sensitivity_labels` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_sensitivity_tenant_patient` ON `health_record_sensitivity_labels` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_icd10_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`disease_group_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`disease_group_id`) REFERENCES `icd10_disease_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_icd10_codes`("id", "tenant_id", "code", "description", "disease_group_id", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "code", "description", "disease_group_id", "is_active", "created_by", "created_at", "updated_at" FROM `icd10_codes`;--> statement-breakpoint
DROP TABLE `icd10_codes`;--> statement-breakpoint
ALTER TABLE `__new_icd10_codes` RENAME TO `icd10_codes`;--> statement-breakpoint
CREATE INDEX `idx_icd10_codes_tenant` ON `icd10_codes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_icd10_codes_code` ON `icd10_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_icd10_codes_desc` ON `icd10_codes` (`description`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_icd10_codes_unique` ON `icd10_codes` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `__new_icd10_disease_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`reporting_group_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`reporting_group_id`) REFERENCES `icd10_reporting_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_icd10_disease_groups`("id", "tenant_id", "name", "reporting_group_id", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "reporting_group_id", "is_active", "created_by", "created_at", "updated_at" FROM `icd10_disease_groups`;--> statement-breakpoint
DROP TABLE `icd10_disease_groups`;--> statement-breakpoint
ALTER TABLE `__new_icd10_disease_groups` RENAME TO `icd10_disease_groups`;--> statement-breakpoint
CREATE TABLE `__new_icd10_reporting_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_icd10_reporting_groups`("id", "tenant_id", "name", "description", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "name", "description", "is_active", "created_by", "created_at", "updated_at" FROM `icd10_reporting_groups`;--> statement-breakpoint
DROP TABLE `icd10_reporting_groups`;--> statement-breakpoint
ALTER TABLE `__new_icd10_reporting_groups` RENAME TO `icd10_reporting_groups`;--> statement-breakpoint
CREATE TABLE `__new_insurance_claim_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` integer NOT NULL,
	`service_code` text,
	`description` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`total_price` real NOT NULL,
	`covered_amount` real,
	`patient_payable` real,
	`modifier1` text,
	`modifier2` text,
	`place_of_service` text DEFAULT '11',
	`service_date` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_claim_items`("id", "tenant_id", "claim_id", "service_code", "description", "quantity", "unit_price", "total_price", "covered_amount", "patient_payable", "modifier1", "modifier2", "place_of_service", "service_date", "is_active", "created_at") SELECT "id", "tenant_id", "claim_id", "service_code", "description", "quantity", "unit_price", "total_price", "covered_amount", "patient_payable", "modifier1", "modifier2", "place_of_service", "service_date", "is_active", "created_at" FROM `insurance_claim_items`;--> statement-breakpoint
DROP TABLE `insurance_claim_items`;--> statement-breakpoint
ALTER TABLE `__new_insurance_claim_items` RENAME TO `insurance_claim_items`;--> statement-breakpoint
CREATE INDEX `idx_claim_items_claim` ON `insurance_claim_items` (`tenant_id`,`claim_id`);--> statement-breakpoint
CREATE TABLE `__new_insurance_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_no` text NOT NULL,
	`patient_id` integer NOT NULL,
	`policy_id` integer,
	`bill_id` integer,
	`diagnosis` text,
	`icd10_code` text,
	`bill_amount` integer NOT NULL,
	`claimed_amount` integer NOT NULL,
	`approved_amount` integer,
	`rejection_reason` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`reviewed_at` text,
	`settled_at` text,
	`reviewer_notes` text,
	`created_by` integer,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_claims`("id", "tenant_id", "claim_no", "patient_id", "policy_id", "bill_id", "diagnosis", "icd10_code", "bill_amount", "claimed_amount", "approved_amount", "rejection_reason", "status", "submitted_at", "reviewed_at", "settled_at", "reviewer_notes", "created_by", "updated_at") SELECT "id", "tenant_id", "claim_no", "patient_id", "policy_id", "bill_id", "diagnosis", "icd10_code", "bill_amount", "claimed_amount", "approved_amount", "rejection_reason", "status", "submitted_at", "reviewed_at", "settled_at", "reviewer_notes", "created_by", "updated_at" FROM `insurance_claims`;--> statement-breakpoint
DROP TABLE `insurance_claims`;--> statement-breakpoint
ALTER TABLE `__new_insurance_claims` RENAME TO `insurance_claims`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_insurance_claims_no` ON `insurance_claims` (`tenant_id`,`claim_no`);--> statement-breakpoint
CREATE INDEX `idx_insurance_claims_bill` ON `insurance_claims` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_insurance_claims_status` ON `insurance_claims` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_insurance_claims_patient` ON `insurance_claims` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_insurance_companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`company_name` text NOT NULL,
	`insurance_type` text,
	`address` text,
	`city` text,
	`phone` text,
	`email` text,
	`payer_id` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_companies`("id", "tenant_id", "company_name", "insurance_type", "address", "city", "phone", "email", "payer_id", "is_active", "created_at") SELECT "id", "tenant_id", "company_name", "insurance_type", "address", "city", "phone", "email", "payer_id", "is_active", "created_at" FROM `insurance_companies`;--> statement-breakpoint
DROP TABLE `insurance_companies`;--> statement-breakpoint
ALTER TABLE `__new_insurance_companies` RENAME TO `insurance_companies`;--> statement-breakpoint
CREATE INDEX `idx_ins_companies_tenant` ON `insurance_companies` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_insurance_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`provider_name` text NOT NULL,
	`policy_no` text NOT NULL,
	`policy_type` text DEFAULT 'individual' NOT NULL,
	`coverage_limit` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_policies`("id", "tenant_id", "patient_id", "provider_name", "policy_no", "policy_type", "coverage_limit", "valid_from", "valid_to", "status", "notes", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "provider_name", "policy_no", "policy_type", "coverage_limit", "valid_from", "valid_to", "status", "notes", "created_by", "created_at", "updated_at" FROM `insurance_policies`;--> statement-breakpoint
DROP TABLE `insurance_policies`;--> statement-breakpoint
ALTER TABLE `__new_insurance_policies` RENAME TO `insurance_policies`;--> statement-breakpoint
CREATE INDEX `idx_insurance_policies_status` ON `insurance_policies` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_insurance_policies_patient` ON `insurance_policies` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_insurance_schemes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`scheme_name` text NOT NULL,
	`scheme_code` text,
	`scheme_type` text DEFAULT 'insurance',
	`contact` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_schemes`("id", "tenant_id", "scheme_name", "scheme_code", "scheme_type", "contact", "is_active", "created_at") SELECT "id", "tenant_id", "scheme_name", "scheme_code", "scheme_type", "contact", "is_active", "created_at" FROM `insurance_schemes`;--> statement-breakpoint
DROP TABLE `insurance_schemes`;--> statement-breakpoint
ALTER TABLE `__new_insurance_schemes` RENAME TO `insurance_schemes`;--> statement-breakpoint
CREATE INDEX `idx_ins_schemes_tenant` ON `insurance_schemes` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_insurance_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`api_url` text,
	`api_code` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_insurance_settings`("id", "tenant_id", "api_url", "api_code", "is_active", "created_at") SELECT "id", "tenant_id", "api_url", "api_code", "is_active", "created_at" FROM `insurance_settings`;--> statement-breakpoint
DROP TABLE `insurance_settings`;--> statement-breakpoint
ALTER TABLE `__new_insurance_settings` RENAME TO `insurance_settings`;--> statement-breakpoint
CREATE TABLE `__new_InventoryDispatch` (
	`DispatchId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`DispatchNo` text,
	`DispatchDate` text,
	`RequisitionId` integer,
	`SourceStoreId` integer,
	`DestinationStoreId` integer,
	`ReceivedBy` text,
	`ReceivedOn` text,
	`Remarks` text,
	`IsReceived` integer DEFAULT 0,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`RequisitionId`) REFERENCES `InventoryRequisition`(`RequisitionId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`SourceStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`DestinationStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryDispatch`("DispatchId", "tenant_id", "DispatchNo", "DispatchDate", "RequisitionId", "SourceStoreId", "DestinationStoreId", "ReceivedBy", "ReceivedOn", "Remarks", "IsReceived", "CreatedBy", "CreatedOn") SELECT "DispatchId", "tenant_id", "DispatchNo", "DispatchDate", "RequisitionId", "SourceStoreId", "DestinationStoreId", "ReceivedBy", "ReceivedOn", "Remarks", "IsReceived", "CreatedBy", "CreatedOn" FROM `InventoryDispatch`;--> statement-breakpoint
DROP TABLE `InventoryDispatch`;--> statement-breakpoint
ALTER TABLE `__new_InventoryDispatch` RENAME TO `InventoryDispatch`;--> statement-breakpoint
CREATE INDEX `idx_inv_dispatch_date` ON `InventoryDispatch` (`tenant_id`,`DispatchDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_dispatch_req` ON `InventoryDispatch` (`RequisitionId`);--> statement-breakpoint
CREATE INDEX `idx_inv_dispatch_tenant` ON `InventoryDispatch` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryDispatchItem` (
	`DispatchItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`DispatchId` integer,
	`RequisitionItemId` integer,
	`ItemId` integer,
	`StockId` integer,
	`BatchNo` text,
	`ExpiryDate` text,
	`DispatchedQuantity` integer NOT NULL,
	`CostPrice` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`DispatchId`) REFERENCES `InventoryDispatch`(`DispatchId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`RequisitionItemId`) REFERENCES `InventoryRequisitionItem`(`RequisitionItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StockId`) REFERENCES `InventoryStock`(`StockId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryDispatchItem`("DispatchItemId", "DispatchId", "RequisitionItemId", "ItemId", "StockId", "BatchNo", "ExpiryDate", "DispatchedQuantity", "CostPrice", "Remarks", "CreatedBy", "CreatedOn") SELECT "DispatchItemId", "DispatchId", "RequisitionItemId", "ItemId", "StockId", "BatchNo", "ExpiryDate", "DispatchedQuantity", "CostPrice", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryDispatchItem`;--> statement-breakpoint
DROP TABLE `InventoryDispatchItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryDispatchItem` RENAME TO `InventoryDispatchItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_dispitem_stock` ON `InventoryDispatchItem` (`StockId`);--> statement-breakpoint
CREATE INDEX `idx_inv_dispitem_dispatch` ON `InventoryDispatchItem` (`DispatchId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryFiscalYear` (
	`FiscalYearId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`FiscalYearName` text,
	`StartDate` text,
	`EndDate` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryFiscalYear`("FiscalYearId", "tenant_id", "FiscalYearName", "StartDate", "EndDate", "IsActive", "CreatedBy", "CreatedOn") SELECT "FiscalYearId", "tenant_id", "FiscalYearName", "StartDate", "EndDate", "IsActive", "CreatedBy", "CreatedOn" FROM `InventoryFiscalYear`;--> statement-breakpoint
DROP TABLE `InventoryFiscalYear`;--> statement-breakpoint
ALTER TABLE `__new_InventoryFiscalYear` RENAME TO `InventoryFiscalYear`;--> statement-breakpoint
CREATE INDEX `idx_inv_fy_tenant` ON `InventoryFiscalYear` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryFixedAssetDonation` (
	`DonationId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`DonationName` text,
	`DonorName` text,
	`DonationDate` text,
	`TotalValue` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryFixedAssetDonation`("DonationId", "tenant_id", "DonationName", "DonorName", "DonationDate", "TotalValue", "Remarks", "CreatedBy", "CreatedOn") SELECT "DonationId", "tenant_id", "DonationName", "DonorName", "DonationDate", "TotalValue", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryFixedAssetDonation`;--> statement-breakpoint
DROP TABLE `InventoryFixedAssetDonation`;--> statement-breakpoint
ALTER TABLE `__new_InventoryFixedAssetDonation` RENAME TO `InventoryFixedAssetDonation`;--> statement-breakpoint
CREATE INDEX `idx_inv_donation_tenant` ON `InventoryFixedAssetDonation` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryFixedAssetStock` (
	`FixedAssetStockId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ItemId` integer,
	`StoreId` integer,
	`BarCodeNumber` text,
	`SerialNumber` text,
	`BatchNo` text,
	`Status` text DEFAULT 'active',
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryFixedAssetStock`("FixedAssetStockId", "tenant_id", "ItemId", "StoreId", "BarCodeNumber", "SerialNumber", "BatchNo", "Status", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "FixedAssetStockId", "tenant_id", "ItemId", "StoreId", "BarCodeNumber", "SerialNumber", "BatchNo", "Status", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryFixedAssetStock`;--> statement-breakpoint
DROP TABLE `InventoryFixedAssetStock`;--> statement-breakpoint
ALTER TABLE `__new_InventoryFixedAssetStock` RENAME TO `InventoryFixedAssetStock`;--> statement-breakpoint
CREATE INDEX `idx_inv_fastock_barcode` ON `InventoryFixedAssetStock` (`BarCodeNumber`);--> statement-breakpoint
CREATE INDEX `idx_inv_fastock_item` ON `InventoryFixedAssetStock` (`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_fastock_tenant` ON `InventoryFixedAssetStock` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryGoodsReceipt` (
	`GoodsReceiptId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`GRNumber` text,
	`GRDate` text,
	`VendorId` integer,
	`PurchaseOrderId` integer,
	`StoreId` integer,
	`VendorBillNo` text,
	`VendorBillDate` text,
	`PaymentMode` text DEFAULT 'credit',
	`PaymentStatus` text DEFAULT 'pending',
	`SubTotal` real,
	`DiscountAmount` real,
	`DiscountPercent` real,
	`VATAmount` real,
	`TotalAmount` real,
	`PaidAmount` real,
	`CreditPeriod` integer DEFAULT 30,
	`IsDonation` integer DEFAULT 0,
	`DonationId` integer,
	`Remarks` text,
	`IsVerified` integer DEFAULT 0,
	`VerifiedBy` integer,
	`VerifiedOn` text,
	`IsCancelled` integer DEFAULT 0,
	`CancelledBy` integer,
	`CancelledOn` text,
	`CancelRemarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`PurchaseOrderId`) REFERENCES `InventoryPurchaseOrder`(`PurchaseOrderId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryGoodsReceipt`("GoodsReceiptId", "tenant_id", "GRNumber", "GRDate", "VendorId", "PurchaseOrderId", "StoreId", "VendorBillNo", "VendorBillDate", "PaymentMode", "PaymentStatus", "SubTotal", "DiscountAmount", "DiscountPercent", "VATAmount", "TotalAmount", "PaidAmount", "CreditPeriod", "IsDonation", "DonationId", "Remarks", "IsVerified", "VerifiedBy", "VerifiedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "GoodsReceiptId", "tenant_id", "GRNumber", "GRDate", "VendorId", "PurchaseOrderId", "StoreId", "VendorBillNo", "VendorBillDate", "PaymentMode", "PaymentStatus", "SubTotal", "DiscountAmount", "DiscountPercent", "VATAmount", "TotalAmount", "PaidAmount", "CreditPeriod", "IsDonation", "DonationId", "Remarks", "IsVerified", "VerifiedBy", "VerifiedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryGoodsReceipt`;--> statement-breakpoint
DROP TABLE `InventoryGoodsReceipt`;--> statement-breakpoint
ALTER TABLE `__new_InventoryGoodsReceipt` RENAME TO `InventoryGoodsReceipt`;--> statement-breakpoint
CREATE INDEX `idx_inv_gr_payment` ON `InventoryGoodsReceipt` (`tenant_id`,`PaymentStatus`);--> statement-breakpoint
CREATE INDEX `idx_inv_gr_date` ON `InventoryGoodsReceipt` (`tenant_id`,`GRDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_gr_po` ON `InventoryGoodsReceipt` (`PurchaseOrderId`);--> statement-breakpoint
CREATE INDEX `idx_inv_gr_vendor` ON `InventoryGoodsReceipt` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_gr_tenant` ON `InventoryGoodsReceipt` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryGoodsReceiptItem` (
	`GRItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`GoodsReceiptId` integer,
	`ItemId` integer,
	`POItemId` integer,
	`BatchNo` text,
	`ExpiryDate` text,
	`ManufactureDate` text,
	`ReceivedQuantity` integer NOT NULL,
	`FreeQuantity` integer DEFAULT 0,
	`RejectedQuantity` integer DEFAULT 0,
	`ItemRate` real NOT NULL,
	`MRP` real,
	`VATPercent` real,
	`VATAmount` real,
	`DiscountPercent` real,
	`DiscountAmount` real,
	`SubTotal` real,
	`TotalAmount` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`GoodsReceiptId`) REFERENCES `InventoryGoodsReceipt`(`GoodsReceiptId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`POItemId`) REFERENCES `InventoryPurchaseOrderItem`(`POItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryGoodsReceiptItem`("GRItemId", "GoodsReceiptId", "ItemId", "POItemId", "BatchNo", "ExpiryDate", "ManufactureDate", "ReceivedQuantity", "FreeQuantity", "RejectedQuantity", "ItemRate", "MRP", "VATPercent", "VATAmount", "DiscountPercent", "DiscountAmount", "SubTotal", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn") SELECT "GRItemId", "GoodsReceiptId", "ItemId", "POItemId", "BatchNo", "ExpiryDate", "ManufactureDate", "ReceivedQuantity", "FreeQuantity", "RejectedQuantity", "ItemRate", "MRP", "VATPercent", "VATAmount", "DiscountPercent", "DiscountAmount", "SubTotal", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryGoodsReceiptItem`;--> statement-breakpoint
DROP TABLE `InventoryGoodsReceiptItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryGoodsReceiptItem` RENAME TO `InventoryGoodsReceiptItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_gritem_batch` ON `InventoryGoodsReceiptItem` (`BatchNo`);--> statement-breakpoint
CREATE INDEX `idx_inv_gritem_item` ON `InventoryGoodsReceiptItem` (`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_gritem_gr` ON `InventoryGoodsReceiptItem` (`GoodsReceiptId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryItem` (
	`ItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ItemName` text NOT NULL,
	`ItemCode` text,
	`ItemCategoryId` integer,
	`SubCategoryId` integer,
	`UOMId` integer,
	`StandardRate` real,
	`ReOrderLevel` integer DEFAULT 0,
	`MinStockQuantity` integer DEFAULT 0,
	`BudgetedQuantity` integer DEFAULT 0,
	`Description` text,
	`IsVATApplicable` integer DEFAULT 0,
	`VATPercentage` real,
	`IsFixedAsset` integer DEFAULT 0,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`ItemCategoryId`) REFERENCES `InventoryItemCategory`(`ItemCategoryId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`SubCategoryId`) REFERENCES `InventoryItemSubCategory`(`SubCategoryId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`UOMId`) REFERENCES `InventoryUnitOfMeasurement`(`UOMId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryItem`("ItemId", "tenant_id", "ItemName", "ItemCode", "ItemCategoryId", "SubCategoryId", "UOMId", "StandardRate", "ReOrderLevel", "MinStockQuantity", "BudgetedQuantity", "Description", "IsVATApplicable", "VATPercentage", "IsFixedAsset", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "ItemId", "tenant_id", "ItemName", "ItemCode", "ItemCategoryId", "SubCategoryId", "UOMId", "StandardRate", "ReOrderLevel", "MinStockQuantity", "BudgetedQuantity", "Description", "IsVATApplicable", "VATPercentage", "IsFixedAsset", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryItem`;--> statement-breakpoint
DROP TABLE `InventoryItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryItem` RENAME TO `InventoryItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_item_category` ON `InventoryItem` (`ItemCategoryId`);--> statement-breakpoint
CREATE INDEX `idx_inv_item_code` ON `InventoryItem` (`tenant_id`,`ItemCode`);--> statement-breakpoint
CREATE INDEX `idx_inv_item_name` ON `InventoryItem` (`tenant_id`,`ItemName`);--> statement-breakpoint
CREATE INDEX `idx_inv_item_tenant` ON `InventoryItem` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryItemCategory` (
	`ItemCategoryId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`CategoryName` text NOT NULL,
	`CategoryCode` text,
	`Description` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryItemCategory`("ItemCategoryId", "tenant_id", "CategoryName", "CategoryCode", "Description", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "ItemCategoryId", "tenant_id", "CategoryName", "CategoryCode", "Description", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryItemCategory`;--> statement-breakpoint
DROP TABLE `InventoryItemCategory`;--> statement-breakpoint
ALTER TABLE `__new_InventoryItemCategory` RENAME TO `InventoryItemCategory`;--> statement-breakpoint
CREATE INDEX `idx_inv_category_name` ON `InventoryItemCategory` (`tenant_id`,`CategoryName`);--> statement-breakpoint
CREATE INDEX `idx_inv_category_tenant` ON `InventoryItemCategory` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryItemSubCategory` (
	`SubCategoryId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ItemCategoryId` integer,
	`SubCategoryName` text NOT NULL,
	`SubCategoryCode` text,
	`Description` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`ItemCategoryId`) REFERENCES `InventoryItemCategory`(`ItemCategoryId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryItemSubCategory`("SubCategoryId", "tenant_id", "ItemCategoryId", "SubCategoryName", "SubCategoryCode", "Description", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "SubCategoryId", "tenant_id", "ItemCategoryId", "SubCategoryName", "SubCategoryCode", "Description", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryItemSubCategory`;--> statement-breakpoint
DROP TABLE `InventoryItemSubCategory`;--> statement-breakpoint
ALTER TABLE `__new_InventoryItemSubCategory` RENAME TO `InventoryItemSubCategory`;--> statement-breakpoint
CREATE INDEX `idx_inv_subcategory_cat` ON `InventoryItemSubCategory` (`ItemCategoryId`);--> statement-breakpoint
CREATE INDEX `idx_inv_subcategory_tenant` ON `InventoryItemSubCategory` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryPurchaseOrder` (
	`PurchaseOrderId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`PONumber` text,
	`PODate` text,
	`VendorId` integer,
	`StoreId` integer,
	`ReferenceNo` text,
	`POStatus` text DEFAULT 'pending',
	`SubTotal` real,
	`DiscountAmount` real,
	`DiscountPercent` real,
	`VATAmount` real,
	`TotalAmount` real,
	`DeliveryAddress` text,
	`DeliveryDays` integer DEFAULT 7,
	`ExpectedDeliveryDate` text,
	`TermsConditions` text,
	`Remarks` text,
	`IsVerified` integer DEFAULT 0,
	`VerifiedBy` integer,
	`VerifiedOn` text,
	`IsCancelled` integer DEFAULT 0,
	`CancelledBy` integer,
	`CancelledOn` text,
	`CancelRemarks` text,
	`IsActive` integer DEFAULT 1,
	`IsPostedToAcc` integer DEFAULT 0,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryPurchaseOrder`("PurchaseOrderId", "tenant_id", "PONumber", "PODate", "VendorId", "StoreId", "ReferenceNo", "POStatus", "SubTotal", "DiscountAmount", "DiscountPercent", "VATAmount", "TotalAmount", "DeliveryAddress", "DeliveryDays", "ExpectedDeliveryDate", "TermsConditions", "Remarks", "IsVerified", "VerifiedBy", "VerifiedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "IsActive", "IsPostedToAcc", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "PurchaseOrderId", "tenant_id", "PONumber", "PODate", "VendorId", "StoreId", "ReferenceNo", "POStatus", "SubTotal", "DiscountAmount", "DiscountPercent", "VATAmount", "TotalAmount", "DeliveryAddress", "DeliveryDays", "ExpectedDeliveryDate", "TermsConditions", "Remarks", "IsVerified", "VerifiedBy", "VerifiedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "IsActive", "IsPostedToAcc", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryPurchaseOrder`;--> statement-breakpoint
DROP TABLE `InventoryPurchaseOrder`;--> statement-breakpoint
ALTER TABLE `__new_InventoryPurchaseOrder` RENAME TO `InventoryPurchaseOrder`;--> statement-breakpoint
CREATE INDEX `idx_inv_po_date` ON `InventoryPurchaseOrder` (`tenant_id`,`PODate`);--> statement-breakpoint
CREATE INDEX `idx_inv_po_status` ON `InventoryPurchaseOrder` (`tenant_id`,`POStatus`);--> statement-breakpoint
CREATE INDEX `idx_inv_po_vendor` ON `InventoryPurchaseOrder` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_po_tenant` ON `InventoryPurchaseOrder` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryPurchaseOrderDraft` (
	`DraftPurchaseOrderId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`DraftPurchaseOrderNo` text,
	`FiscalYearId` integer,
	`VendorId` integer,
	`Status` text DEFAULT 'active',
	`SubTotal` real,
	`VATAmount` real,
	`TotalAmount` real,
	`DeliveryDate` text,
	`Remarks` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	`DiscardedOn` text,
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryPurchaseOrderDraft`("DraftPurchaseOrderId", "tenant_id", "DraftPurchaseOrderNo", "FiscalYearId", "VendorId", "Status", "SubTotal", "VATAmount", "TotalAmount", "DeliveryDate", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn", "DiscardedOn") SELECT "DraftPurchaseOrderId", "tenant_id", "DraftPurchaseOrderNo", "FiscalYearId", "VendorId", "Status", "SubTotal", "VATAmount", "TotalAmount", "DeliveryDate", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn", "DiscardedOn" FROM `InventoryPurchaseOrderDraft`;--> statement-breakpoint
DROP TABLE `InventoryPurchaseOrderDraft`;--> statement-breakpoint
ALTER TABLE `__new_InventoryPurchaseOrderDraft` RENAME TO `InventoryPurchaseOrderDraft`;--> statement-breakpoint
CREATE INDEX `idx_inv_podraft_vendor` ON `InventoryPurchaseOrderDraft` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_podraft_tenant` ON `InventoryPurchaseOrderDraft` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryPurchaseOrderDraftItem` (
	`DraftPurchaseOrderItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`DraftPurchaseOrderId` integer,
	`ItemId` integer,
	`Quantity` integer,
	`ItemRate` real,
	`VATPercentage` real,
	`VATAmount` real,
	`TotalAmount` real,
	`Remarks` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`DraftPurchaseOrderId`) REFERENCES `InventoryPurchaseOrderDraft`(`DraftPurchaseOrderId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryPurchaseOrderDraftItem`("DraftPurchaseOrderItemId", "DraftPurchaseOrderId", "ItemId", "Quantity", "ItemRate", "VATPercentage", "VATAmount", "TotalAmount", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "DraftPurchaseOrderItemId", "DraftPurchaseOrderId", "ItemId", "Quantity", "ItemRate", "VATPercentage", "VATAmount", "TotalAmount", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryPurchaseOrderDraftItem`;--> statement-breakpoint
DROP TABLE `InventoryPurchaseOrderDraftItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryPurchaseOrderDraftItem` RENAME TO `InventoryPurchaseOrderDraftItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_podraftitem_draft` ON `InventoryPurchaseOrderDraftItem` (`DraftPurchaseOrderId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryPurchaseOrderItem` (
	`POItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`PurchaseOrderId` integer,
	`ItemId` integer,
	`Quantity` integer NOT NULL,
	`ReceivedQuantity` integer DEFAULT 0,
	`PendingQuantity` integer,
	`StandardRate` real,
	`VATPercent` real,
	`VATAmount` real,
	`SubTotal` real,
	`TotalAmount` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`PurchaseOrderId`) REFERENCES `InventoryPurchaseOrder`(`PurchaseOrderId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryPurchaseOrderItem`("POItemId", "PurchaseOrderId", "ItemId", "Quantity", "ReceivedQuantity", "PendingQuantity", "StandardRate", "VATPercent", "VATAmount", "SubTotal", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn") SELECT "POItemId", "PurchaseOrderId", "ItemId", "Quantity", "ReceivedQuantity", "PendingQuantity", "StandardRate", "VATPercent", "VATAmount", "SubTotal", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryPurchaseOrderItem`;--> statement-breakpoint
DROP TABLE `InventoryPurchaseOrderItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryPurchaseOrderItem` RENAME TO `InventoryPurchaseOrderItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_poitem_item` ON `InventoryPurchaseOrderItem` (`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_poitem_po` ON `InventoryPurchaseOrderItem` (`PurchaseOrderId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryQuotation` (
	`QuotationId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`RFQId` integer,
	`VendorId` integer,
	`QuotationNo` text,
	`QuotationDate` text,
	`Status` text DEFAULT 'pending',
	`TotalPrice` real,
	`ReferenceNo` text,
	`Remarks` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`RFQId`) REFERENCES `InventoryRequestForQuotation`(`RFQId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryQuotation`("QuotationId", "tenant_id", "RFQId", "VendorId", "QuotationNo", "QuotationDate", "Status", "TotalPrice", "ReferenceNo", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "QuotationId", "tenant_id", "RFQId", "VendorId", "QuotationNo", "QuotationDate", "Status", "TotalPrice", "ReferenceNo", "Remarks", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryQuotation`;--> statement-breakpoint
DROP TABLE `InventoryQuotation`;--> statement-breakpoint
ALTER TABLE `__new_InventoryQuotation` RENAME TO `InventoryQuotation`;--> statement-breakpoint
CREATE INDEX `idx_inv_quotation_vendor` ON `InventoryQuotation` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_quotation_rfq` ON `InventoryQuotation` (`RFQId`);--> statement-breakpoint
CREATE INDEX `idx_inv_quotation_tenant` ON `InventoryQuotation` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryQuotationItem` (
	`QuotationItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`QuotationId` integer,
	`ItemId` integer,
	`QuotedQuantity` integer,
	`QuotedRate` real NOT NULL,
	`Description` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`QuotationId`) REFERENCES `InventoryQuotation`(`QuotationId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryQuotationItem`("QuotationItemId", "QuotationId", "ItemId", "QuotedQuantity", "QuotedRate", "Description", "CreatedBy", "CreatedOn") SELECT "QuotationItemId", "QuotationId", "ItemId", "QuotedQuantity", "QuotedRate", "Description", "CreatedBy", "CreatedOn" FROM `InventoryQuotationItem`;--> statement-breakpoint
DROP TABLE `InventoryQuotationItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryQuotationItem` RENAME TO `InventoryQuotationItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_quotitem_quot` ON `InventoryQuotationItem` (`QuotationId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryRequestForQuotation` (
	`RFQId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`RFQNo` text,
	`Subject` text,
	`Description` text,
	`RequestedOn` text,
	`RequestedBy` integer,
	`RequestedCloseDate` text,
	`Status` text DEFAULT 'active',
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryRequestForQuotation`("RFQId", "tenant_id", "RFQNo", "Subject", "Description", "RequestedOn", "RequestedBy", "RequestedCloseDate", "Status", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "RFQId", "tenant_id", "RFQNo", "Subject", "Description", "RequestedOn", "RequestedBy", "RequestedCloseDate", "Status", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryRequestForQuotation`;--> statement-breakpoint
DROP TABLE `InventoryRequestForQuotation`;--> statement-breakpoint
ALTER TABLE `__new_InventoryRequestForQuotation` RENAME TO `InventoryRequestForQuotation`;--> statement-breakpoint
CREATE INDEX `idx_inv_rfq_status` ON `InventoryRequestForQuotation` (`tenant_id`,`Status`);--> statement-breakpoint
CREATE INDEX `idx_inv_rfq_tenant` ON `InventoryRequestForQuotation` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryRequestForQuotationItem` (
	`RFQItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`RFQId` integer,
	`ItemId` integer,
	`Quantity` integer NOT NULL,
	`Description` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`RFQId`) REFERENCES `InventoryRequestForQuotation`(`RFQId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryRequestForQuotationItem`("RFQItemId", "RFQId", "ItemId", "Quantity", "Description", "CreatedBy", "CreatedOn") SELECT "RFQItemId", "RFQId", "ItemId", "Quantity", "Description", "CreatedBy", "CreatedOn" FROM `InventoryRequestForQuotationItem`;--> statement-breakpoint
DROP TABLE `InventoryRequestForQuotationItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryRequestForQuotationItem` RENAME TO `InventoryRequestForQuotationItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_rfqitem_rfq` ON `InventoryRequestForQuotationItem` (`RFQId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryRequestForQuotationVendor` (
	`RFQVendorId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`RFQId` integer,
	`VendorId` integer,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`RFQId`) REFERENCES `InventoryRequestForQuotation`(`RFQId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryRequestForQuotationVendor`("RFQVendorId", "RFQId", "VendorId", "IsActive", "CreatedBy", "CreatedOn") SELECT "RFQVendorId", "RFQId", "VendorId", "IsActive", "CreatedBy", "CreatedOn" FROM `InventoryRequestForQuotationVendor`;--> statement-breakpoint
DROP TABLE `InventoryRequestForQuotationVendor`;--> statement-breakpoint
ALTER TABLE `__new_InventoryRequestForQuotationVendor` RENAME TO `InventoryRequestForQuotationVendor`;--> statement-breakpoint
CREATE INDEX `idx_inv_rfqvendor_vendor` ON `InventoryRequestForQuotationVendor` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_rfqvendor_rfq` ON `InventoryRequestForQuotationVendor` (`RFQId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryRequisition` (
	`RequisitionId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`RequisitionNo` text,
	`RequisitionDate` text,
	`RequestingStoreId` integer,
	`SourceStoreId` integer,
	`DepartmentId` integer,
	`RequisitionStatus` text DEFAULT 'pending',
	`Priority` text DEFAULT 'normal',
	`RequiredDate` text,
	`Remarks` text,
	`IsApproved` integer DEFAULT 0,
	`ApprovedBy` integer,
	`ApprovedOn` text,
	`IsCancelled` integer DEFAULT 0,
	`CancelledBy` integer,
	`CancelledOn` text,
	`CancelRemarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`RequestingStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`SourceStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryRequisition`("RequisitionId", "tenant_id", "RequisitionNo", "RequisitionDate", "RequestingStoreId", "SourceStoreId", "DepartmentId", "RequisitionStatus", "Priority", "RequiredDate", "Remarks", "IsApproved", "ApprovedBy", "ApprovedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "RequisitionId", "tenant_id", "RequisitionNo", "RequisitionDate", "RequestingStoreId", "SourceStoreId", "DepartmentId", "RequisitionStatus", "Priority", "RequiredDate", "Remarks", "IsApproved", "ApprovedBy", "ApprovedOn", "IsCancelled", "CancelledBy", "CancelledOn", "CancelRemarks", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryRequisition`;--> statement-breakpoint
DROP TABLE `InventoryRequisition`;--> statement-breakpoint
ALTER TABLE `__new_InventoryRequisition` RENAME TO `InventoryRequisition`;--> statement-breakpoint
CREATE INDEX `idx_inv_req_date` ON `InventoryRequisition` (`tenant_id`,`RequisitionDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_req_status` ON `InventoryRequisition` (`tenant_id`,`RequisitionStatus`);--> statement-breakpoint
CREATE INDEX `idx_inv_req_store` ON `InventoryRequisition` (`RequestingStoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_req_tenant` ON `InventoryRequisition` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryRequisitionItem` (
	`RequisitionItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`RequisitionId` integer,
	`ItemId` integer,
	`RequestedQuantity` integer NOT NULL,
	`ApprovedQuantity` integer DEFAULT 0,
	`DispatchedQuantity` integer DEFAULT 0,
	`PendingQuantity` integer,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`RequisitionId`) REFERENCES `InventoryRequisition`(`RequisitionId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryRequisitionItem`("RequisitionItemId", "RequisitionId", "ItemId", "RequestedQuantity", "ApprovedQuantity", "DispatchedQuantity", "PendingQuantity", "Remarks", "CreatedBy", "CreatedOn") SELECT "RequisitionItemId", "RequisitionId", "ItemId", "RequestedQuantity", "ApprovedQuantity", "DispatchedQuantity", "PendingQuantity", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryRequisitionItem`;--> statement-breakpoint
DROP TABLE `InventoryRequisitionItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryRequisitionItem` RENAME TO `InventoryRequisitionItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_reqitem_item` ON `InventoryRequisitionItem` (`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_reqitem_req` ON `InventoryRequisitionItem` (`RequisitionId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryReturnToVendor` (
	`ReturnId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ReturnNo` text,
	`ReturnDate` text,
	`VendorId` integer,
	`GoodsReceiptId` integer,
	`StoreId` integer,
	`Reason` text,
	`TotalAmount` real,
	`CreditNoteNo` text,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`VendorId`) REFERENCES `InventoryVendor`(`VendorId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`GoodsReceiptId`) REFERENCES `InventoryGoodsReceipt`(`GoodsReceiptId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryReturnToVendor`("ReturnId", "tenant_id", "ReturnNo", "ReturnDate", "VendorId", "GoodsReceiptId", "StoreId", "Reason", "TotalAmount", "CreditNoteNo", "Remarks", "CreatedBy", "CreatedOn") SELECT "ReturnId", "tenant_id", "ReturnNo", "ReturnDate", "VendorId", "GoodsReceiptId", "StoreId", "Reason", "TotalAmount", "CreditNoteNo", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryReturnToVendor`;--> statement-breakpoint
DROP TABLE `InventoryReturnToVendor`;--> statement-breakpoint
ALTER TABLE `__new_InventoryReturnToVendor` RENAME TO `InventoryReturnToVendor`;--> statement-breakpoint
CREATE INDEX `idx_inv_return_date` ON `InventoryReturnToVendor` (`tenant_id`,`ReturnDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_return_vendor` ON `InventoryReturnToVendor` (`VendorId`);--> statement-breakpoint
CREATE INDEX `idx_inv_return_tenant` ON `InventoryReturnToVendor` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryReturnToVendorItem` (
	`ReturnItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ReturnId` integer,
	`GRItemId` integer,
	`ItemId` integer,
	`BatchNo` text,
	`ReturnQuantity` integer NOT NULL,
	`ItemRate` real,
	`TotalAmount` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`ReturnId`) REFERENCES `InventoryReturnToVendor`(`ReturnId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`GRItemId`) REFERENCES `InventoryGoodsReceiptItem`(`GRItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryReturnToVendorItem`("ReturnItemId", "ReturnId", "GRItemId", "ItemId", "BatchNo", "ReturnQuantity", "ItemRate", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn") SELECT "ReturnItemId", "ReturnId", "GRItemId", "ItemId", "BatchNo", "ReturnQuantity", "ItemRate", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryReturnToVendorItem`;--> statement-breakpoint
DROP TABLE `InventoryReturnToVendorItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryReturnToVendorItem` RENAME TO `InventoryReturnToVendorItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_returnitem_return` ON `InventoryReturnToVendorItem` (`ReturnId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryStock` (
	`StockId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ItemId` integer,
	`StoreId` integer,
	`GRItemId` integer,
	`BatchNo` text,
	`ExpiryDate` text,
	`AvailableQuantity` integer DEFAULT 0,
	`CostPrice` real,
	`MRP` real,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`GRItemId`) REFERENCES `InventoryGoodsReceiptItem`(`GRItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryStock`("StockId", "tenant_id", "ItemId", "StoreId", "GRItemId", "BatchNo", "ExpiryDate", "AvailableQuantity", "CostPrice", "MRP", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "StockId", "tenant_id", "ItemId", "StoreId", "GRItemId", "BatchNo", "ExpiryDate", "AvailableQuantity", "CostPrice", "MRP", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryStock`;--> statement-breakpoint
DROP TABLE `InventoryStock`;--> statement-breakpoint
ALTER TABLE `__new_InventoryStock` RENAME TO `InventoryStock`;--> statement-breakpoint
CREATE INDEX `idx_inv_stock_qty` ON `InventoryStock` (`AvailableQuantity`);--> statement-breakpoint
CREATE INDEX `idx_inv_stock_expiry` ON `InventoryStock` (`ExpiryDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_stock_batch` ON `InventoryStock` (`BatchNo`);--> statement-breakpoint
CREATE INDEX `idx_inv_stock_store` ON `InventoryStock` (`tenant_id`,`StoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_stock_item` ON `InventoryStock` (`tenant_id`,`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_stock_tenant` ON `InventoryStock` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryStockTransaction` (
	`TransactionId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ItemId` integer,
	`StockId` integer,
	`StoreId` integer,
	`TransactionType` text NOT NULL,
	`ReferenceNo` text,
	`ReferenceId` integer,
	`InQuantity` integer DEFAULT 0,
	`OutQuantity` integer DEFAULT 0,
	`BalanceQuantity` integer DEFAULT 0,
	`TransactionDate` text,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StockId`) REFERENCES `InventoryStock`(`StockId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryStockTransaction`("TransactionId", "tenant_id", "ItemId", "StockId", "StoreId", "TransactionType", "ReferenceNo", "ReferenceId", "InQuantity", "OutQuantity", "BalanceQuantity", "TransactionDate", "Remarks", "CreatedBy", "CreatedOn") SELECT "TransactionId", "tenant_id", "ItemId", "StockId", "StoreId", "TransactionType", "ReferenceNo", "ReferenceId", "InQuantity", "OutQuantity", "BalanceQuantity", "TransactionDate", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryStockTransaction`;--> statement-breakpoint
DROP TABLE `InventoryStockTransaction`;--> statement-breakpoint
ALTER TABLE `__new_InventoryStockTransaction` RENAME TO `InventoryStockTransaction`;--> statement-breakpoint
CREATE INDEX `idx_inv_trans_date` ON `InventoryStockTransaction` (`TransactionDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_trans_type` ON `InventoryStockTransaction` (`TransactionType`);--> statement-breakpoint
CREATE INDEX `idx_inv_trans_store` ON `InventoryStockTransaction` (`tenant_id`,`StoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_trans_item` ON `InventoryStockTransaction` (`tenant_id`,`ItemId`);--> statement-breakpoint
CREATE INDEX `idx_inv_trans_tenant` ON `InventoryStockTransaction` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryStore` (
	`StoreId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`StoreName` text NOT NULL,
	`StoreCode` text,
	`StoreType` text DEFAULT 'main',
	`Address` text,
	`ContactPerson` text,
	`ContactPhone` text,
	`ParentStoreId` integer,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	FOREIGN KEY (`ParentStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryStore`("StoreId", "tenant_id", "StoreName", "StoreCode", "StoreType", "Address", "ContactPerson", "ContactPhone", "ParentStoreId", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "StoreId", "tenant_id", "StoreName", "StoreCode", "StoreType", "Address", "ContactPerson", "ContactPhone", "ParentStoreId", "IsActive", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryStore`;--> statement-breakpoint
DROP TABLE `InventoryStore`;--> statement-breakpoint
ALTER TABLE `__new_InventoryStore` RENAME TO `InventoryStore`;--> statement-breakpoint
CREATE INDEX `idx_inv_store_type` ON `InventoryStore` (`tenant_id`,`StoreType`);--> statement-breakpoint
CREATE INDEX `idx_inv_store_name` ON `InventoryStore` (`tenant_id`,`StoreName`);--> statement-breakpoint
CREATE INDEX `idx_inv_store_tenant` ON `InventoryStore` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventorySubstoreReturn` (
	`ReturnId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ReturnDate` text,
	`TargetStoreId` integer,
	`SourceStoreId` integer,
	`Remarks` text,
	`ReceivedBy` integer,
	`ReceivedOn` text,
	`ReceivedRemarks` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`TargetStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`SourceStoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventorySubstoreReturn`("ReturnId", "tenant_id", "ReturnDate", "TargetStoreId", "SourceStoreId", "Remarks", "ReceivedBy", "ReceivedOn", "ReceivedRemarks", "IsActive", "CreatedBy", "CreatedOn") SELECT "ReturnId", "tenant_id", "ReturnDate", "TargetStoreId", "SourceStoreId", "Remarks", "ReceivedBy", "ReceivedOn", "ReceivedRemarks", "IsActive", "CreatedBy", "CreatedOn" FROM `InventorySubstoreReturn`;--> statement-breakpoint
DROP TABLE `InventorySubstoreReturn`;--> statement-breakpoint
ALTER TABLE `__new_InventorySubstoreReturn` RENAME TO `InventorySubstoreReturn`;--> statement-breakpoint
CREATE INDEX `idx_inv_subret_source` ON `InventorySubstoreReturn` (`SourceStoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_subret_target` ON `InventorySubstoreReturn` (`TargetStoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_subret_tenant` ON `InventorySubstoreReturn` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventorySubstoreReturnItem` (
	`ReturnItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ReturnId` integer,
	`ItemId` integer,
	`BatchNo` text,
	`ReturnQuantity` integer NOT NULL,
	`Remarks` text,
	`ReceivedQuantity` integer DEFAULT 0,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`ReturnId`) REFERENCES `InventorySubstoreReturn`(`ReturnId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventorySubstoreReturnItem`("ReturnItemId", "ReturnId", "ItemId", "BatchNo", "ReturnQuantity", "Remarks", "ReceivedQuantity", "CreatedBy", "CreatedOn") SELECT "ReturnItemId", "ReturnId", "ItemId", "BatchNo", "ReturnQuantity", "Remarks", "ReceivedQuantity", "CreatedBy", "CreatedOn" FROM `InventorySubstoreReturnItem`;--> statement-breakpoint
DROP TABLE `InventorySubstoreReturnItem`;--> statement-breakpoint
ALTER TABLE `__new_InventorySubstoreReturnItem` RENAME TO `InventorySubstoreReturnItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_subretitem_ret` ON `InventorySubstoreReturnItem` (`ReturnId`);--> statement-breakpoint
CREATE TABLE `__new_InventoryUnitOfMeasurement` (
	`UOMId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`UOMName` text NOT NULL,
	`Description` text,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryUnitOfMeasurement`("UOMId", "tenant_id", "UOMName", "Description", "IsActive", "CreatedBy", "CreatedOn") SELECT "UOMId", "tenant_id", "UOMName", "Description", "IsActive", "CreatedBy", "CreatedOn" FROM `InventoryUnitOfMeasurement`;--> statement-breakpoint
DROP TABLE `InventoryUnitOfMeasurement`;--> statement-breakpoint
ALTER TABLE `__new_InventoryUnitOfMeasurement` RENAME TO `InventoryUnitOfMeasurement`;--> statement-breakpoint
CREATE INDEX `idx_inv_uom_tenant` ON `InventoryUnitOfMeasurement` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryVendor` (
	`VendorId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`VendorName` text NOT NULL,
	`VendorCode` text,
	`ContactPerson` text,
	`ContactPhone` text,
	`ContactEmail` text,
	`ContactAddress` text,
	`City` text,
	`Country` text,
	`PANNo` text,
	`CreditPeriod` integer DEFAULT 30,
	`IsActive` integer DEFAULT 1,
	`IsTDSApplicable` integer DEFAULT 0,
	`TDSPercent` real,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	`ModifiedBy` integer,
	`ModifiedOn` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryVendor`("VendorId", "tenant_id", "VendorName", "VendorCode", "ContactPerson", "ContactPhone", "ContactEmail", "ContactAddress", "City", "Country", "PANNo", "CreditPeriod", "IsActive", "IsTDSApplicable", "TDSPercent", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn") SELECT "VendorId", "tenant_id", "VendorName", "VendorCode", "ContactPerson", "ContactPhone", "ContactEmail", "ContactAddress", "City", "Country", "PANNo", "CreditPeriod", "IsActive", "IsTDSApplicable", "TDSPercent", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn" FROM `InventoryVendor`;--> statement-breakpoint
DROP TABLE `InventoryVendor`;--> statement-breakpoint
ALTER TABLE `__new_InventoryVendor` RENAME TO `InventoryVendor`;--> statement-breakpoint
CREATE INDEX `idx_inv_vendor_active` ON `InventoryVendor` (`tenant_id`,`IsActive`);--> statement-breakpoint
CREATE INDEX `idx_inv_vendor_name` ON `InventoryVendor` (`tenant_id`,`VendorName`);--> statement-breakpoint
CREATE INDEX `idx_inv_vendor_tenant` ON `InventoryVendor` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryVendorTerms` (
	`TermsId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`TermsText` text NOT NULL,
	`IsActive` integer DEFAULT 1,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryVendorTerms`("TermsId", "tenant_id", "TermsText", "IsActive", "CreatedBy", "CreatedOn") SELECT "TermsId", "tenant_id", "TermsText", "IsActive", "CreatedBy", "CreatedOn" FROM `InventoryVendorTerms`;--> statement-breakpoint
DROP TABLE `InventoryVendorTerms`;--> statement-breakpoint
ALTER TABLE `__new_InventoryVendorTerms` RENAME TO `InventoryVendorTerms`;--> statement-breakpoint
CREATE INDEX `idx_inv_terms_tenant` ON `InventoryVendorTerms` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryWriteOff` (
	`WriteOffId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`WriteOffNo` text,
	`WriteOffDate` text,
	`StoreId` integer,
	`Reason` text NOT NULL,
	`Description` text,
	`TotalAmount` real,
	`IsApproved` integer DEFAULT 0,
	`ApprovedBy` integer,
	`ApprovedOn` text,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`StoreId`) REFERENCES `InventoryStore`(`StoreId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryWriteOff`("WriteOffId", "tenant_id", "WriteOffNo", "WriteOffDate", "StoreId", "Reason", "Description", "TotalAmount", "IsApproved", "ApprovedBy", "ApprovedOn", "Remarks", "CreatedBy", "CreatedOn") SELECT "WriteOffId", "tenant_id", "WriteOffNo", "WriteOffDate", "StoreId", "Reason", "Description", "TotalAmount", "IsApproved", "ApprovedBy", "ApprovedOn", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryWriteOff`;--> statement-breakpoint
DROP TABLE `InventoryWriteOff`;--> statement-breakpoint
ALTER TABLE `__new_InventoryWriteOff` RENAME TO `InventoryWriteOff`;--> statement-breakpoint
CREATE INDEX `idx_inv_writeoff_date` ON `InventoryWriteOff` (`tenant_id`,`WriteOffDate`);--> statement-breakpoint
CREATE INDEX `idx_inv_writeoff_store` ON `InventoryWriteOff` (`StoreId`);--> statement-breakpoint
CREATE INDEX `idx_inv_writeoff_tenant` ON `InventoryWriteOff` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_InventoryWriteOffItem` (
	`WriteOffItemId` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`WriteOffId` integer,
	`ItemId` integer,
	`StockId` integer,
	`BatchNo` text,
	`ExpiryDate` text,
	`Quantity` integer NOT NULL,
	`ItemRate` real,
	`TotalAmount` real,
	`Remarks` text,
	`CreatedBy` integer,
	`CreatedOn` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`WriteOffId`) REFERENCES `InventoryWriteOff`(`WriteOffId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ItemId`) REFERENCES `InventoryItem`(`ItemId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`StockId`) REFERENCES `InventoryStock`(`StockId`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_InventoryWriteOffItem`("WriteOffItemId", "WriteOffId", "ItemId", "StockId", "BatchNo", "ExpiryDate", "Quantity", "ItemRate", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn") SELECT "WriteOffItemId", "WriteOffId", "ItemId", "StockId", "BatchNo", "ExpiryDate", "Quantity", "ItemRate", "TotalAmount", "Remarks", "CreatedBy", "CreatedOn" FROM `InventoryWriteOffItem`;--> statement-breakpoint
DROP TABLE `InventoryWriteOffItem`;--> statement-breakpoint
ALTER TABLE `__new_InventoryWriteOffItem` RENAME TO `InventoryWriteOffItem`;--> statement-breakpoint
CREATE INDEX `idx_inv_writeoffitem_writeoff` ON `InventoryWriteOffItem` (`WriteOffId`);--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`invited_by` integer NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','doctor','nurse','laboratory','reception','md','director','pharmacist','accountant')),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "tenant_id", "email", "role", "token", "invited_by", "expires_at", "accepted_at", "created_at") SELECT "id", "tenant_id", "email", "role", "token", "invited_by", "expires_at", "accepted_at", "created_at" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
CREATE INDEX `idx_invitations_tenant` ON `invitations` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invitations_token` ON `invitations` (`token`);--> statement-breakpoint
CREATE TABLE `__new_ipd_charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`admission_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`charge_date` text NOT NULL,
	`charge_type` text DEFAULT 'room' NOT NULL,
	`description` text,
	`amount` real NOT NULL,
	`posted_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ipd_charges`("id", "tenant_id", "admission_id", "patient_id", "charge_date", "charge_type", "description", "amount", "posted_by", "created_at") SELECT "id", "tenant_id", "admission_id", "patient_id", "charge_date", "charge_type", "description", "amount", "posted_by", "created_at" FROM `ipd_charges`;--> statement-breakpoint
DROP TABLE `ipd_charges`;--> statement-breakpoint
ALTER TABLE `__new_ipd_charges` RENAME TO `ipd_charges`;--> statement-breakpoint
CREATE INDEX `idx_ipd_charges_date` ON `ipd_charges` (`charge_date`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_ipd_charges_admission` ON `ipd_charges` (`admission_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_ipd_charges_tenant` ON `ipd_charges` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_medical_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`admission_id` integer,
	`doctor_id` integer,
	`file_number` text,
	`discharge_type` text,
	`discharge_condition` text,
	`is_operation_conducted` integer DEFAULT 0,
	`operation_date` text,
	`operation_diagnosis` text,
	`gestational_week` integer,
	`gestational_day` integer,
	`number_of_babies` integer,
	`blood_lost_ml` integer,
	`gravita` text,
	`referred_date` text,
	`referred_time` text,
	`referred_to` text,
	`referred_reason` text,
	`is_file_cleared` integer DEFAULT 0,
	`file_cleared_by` text,
	`file_cleared_on` text,
	`remarks` text,
	`is_active` integer DEFAULT 1,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_medical_records`("id", "tenant_id", "patient_id", "visit_id", "admission_id", "doctor_id", "file_number", "discharge_type", "discharge_condition", "is_operation_conducted", "operation_date", "operation_diagnosis", "gestational_week", "gestational_day", "number_of_babies", "blood_lost_ml", "gravita", "referred_date", "referred_time", "referred_to", "referred_reason", "is_file_cleared", "file_cleared_by", "file_cleared_on", "remarks", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "admission_id", "doctor_id", "file_number", "discharge_type", "discharge_condition", "is_operation_conducted", "operation_date", "operation_diagnosis", "gestational_week", "gestational_day", "number_of_babies", "blood_lost_ml", "gravita", "referred_date", "referred_time", "referred_to", "referred_reason", "is_file_cleared", "file_cleared_by", "file_cleared_on", "remarks", "is_active", "created_by", "created_at", "updated_at" FROM `medical_records`;--> statement-breakpoint
DROP TABLE `medical_records`;--> statement-breakpoint
ALTER TABLE `__new_medical_records` RENAME TO `medical_records`;--> statement-breakpoint
CREATE INDEX `idx_mr_tenant_patient` ON `medical_records` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_mr_tenant_visit` ON `medical_records` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_mr_file_number` ON `medical_records` (`tenant_id`,`file_number`);--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` integer,
	`type` text DEFAULT 'system' NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`link` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "tenant_id", "user_id", "type", "title", "message", "is_read", "link", "created_at") SELECT "id", "tenant_id", "user_id", "type", "title", "message", "is_read", "link", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
CREATE INDEX `idx_notifications_tenant_user` ON `notifications` (`tenant_id`,`user_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `__new_nur_care_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`problem` text,
	`goal` text,
	`intervention` text,
	`evaluation` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_care_plans`("id", "tenant_id", "patient_id", "visit_id", "problem", "goal", "intervention", "evaluation", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "problem", "goal", "intervention", "evaluation", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_care_plans`;--> statement-breakpoint
DROP TABLE `nur_care_plans`;--> statement-breakpoint
ALTER TABLE `__new_nur_care_plans` RENAME TO `nur_care_plans`;--> statement-breakpoint
CREATE INDEX `idx_nur_care_plans_patient` ON `nur_care_plans` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_care_plans_visit` ON `nur_care_plans` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_care_plans_tenant` ON `nur_care_plans` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_handover` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`shift` text NOT NULL,
	`given_by` integer,
	`taken_by` integer,
	`content` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_handover`("id", "tenant_id", "patient_id", "visit_id", "shift", "given_by", "taken_by", "content", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "shift", "given_by", "taken_by", "content", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_handover`;--> statement-breakpoint
DROP TABLE `nur_handover`;--> statement-breakpoint
ALTER TABLE `__new_nur_handover` RENAME TO `nur_handover`;--> statement-breakpoint
CREATE INDEX `idx_nur_handover_patient` ON `nur_handover` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_handover_visit` ON `nur_handover` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_handover_tenant` ON `nur_handover` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_intake_output` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`intake_type` text,
	`intake_amount` real,
	`intake_unit` text DEFAULT 'ml',
	`output_type` text,
	`output_amount` real,
	`output_unit` text DEFAULT 'ml',
	`remarks` text,
	`recorded_on` text DEFAULT (datetime('now', '+6 hours')),
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_intake_output`("id", "tenant_id", "patient_id", "visit_id", "intake_type", "intake_amount", "intake_unit", "output_type", "output_amount", "output_unit", "remarks", "recorded_on", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "intake_type", "intake_amount", "intake_unit", "output_type", "output_amount", "output_unit", "remarks", "recorded_on", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_intake_output`;--> statement-breakpoint
DROP TABLE `nur_intake_output`;--> statement-breakpoint
ALTER TABLE `__new_nur_intake_output` RENAME TO `nur_intake_output`;--> statement-breakpoint
CREATE INDEX `idx_nur_io_visit` ON `nur_intake_output` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_io_tenant` ON `nur_intake_output` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_iv_drugs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`drug_name` text NOT NULL,
	`dosing` text,
	`rate` text,
	`start_time` text,
	`end_time` text,
	`status` text DEFAULT 'running',
	`note` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_iv_drugs`("id", "tenant_id", "patient_id", "visit_id", "drug_name", "dosing", "rate", "start_time", "end_time", "status", "note", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "drug_name", "dosing", "rate", "start_time", "end_time", "status", "note", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_iv_drugs`;--> statement-breakpoint
DROP TABLE `nur_iv_drugs`;--> statement-breakpoint
ALTER TABLE `__new_nur_iv_drugs` RENAME TO `nur_iv_drugs`;--> statement-breakpoint
CREATE INDEX `idx_nur_iv_visit` ON `nur_iv_drugs` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_iv_tenant` ON `nur_iv_drugs` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_medication_admin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`medication_name` text NOT NULL,
	`dose` text,
	`route` text,
	`frequency` text,
	`administered_on` text DEFAULT (datetime('now', '+6 hours')),
	`administered_by` integer,
	`remarks` text,
	`status` text DEFAULT 'given',
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_medication_admin`("id", "tenant_id", "patient_id", "visit_id", "medication_name", "dose", "route", "frequency", "administered_on", "administered_by", "remarks", "status", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "medication_name", "dose", "route", "frequency", "administered_on", "administered_by", "remarks", "status", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_medication_admin`;--> statement-breakpoint
DROP TABLE `nur_medication_admin`;--> statement-breakpoint
ALTER TABLE `__new_nur_medication_admin` RENAME TO `nur_medication_admin`;--> statement-breakpoint
CREATE INDEX `idx_nur_mar_patient` ON `nur_medication_admin` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_mar_visit` ON `nur_medication_admin` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_mar_tenant` ON `nur_medication_admin` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`note_type` text NOT NULL,
	`note` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_notes`("id", "tenant_id", "patient_id", "visit_id", "note_type", "note", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "note_type", "note", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_notes`;--> statement-breakpoint
DROP TABLE `nur_notes`;--> statement-breakpoint
ALTER TABLE `__new_nur_notes` RENAME TO `nur_notes`;--> statement-breakpoint
CREATE INDEX `idx_nur_notes_visit` ON `nur_notes` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_notes_tenant` ON `nur_notes` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_patient_monitoring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`temperature` real,
	`temperature_unit` text DEFAULT 'F',
	`pulse` integer,
	`respiration` integer,
	`bp_systolic` integer,
	`bp_diastolic` integer,
	`spo2` real,
	`pain_scale` integer,
	`remarks` text,
	`recorded_on` text DEFAULT (datetime('now', '+6 hours')),
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_patient_monitoring`("id", "tenant_id", "patient_id", "visit_id", "temperature", "temperature_unit", "pulse", "respiration", "bp_systolic", "bp_diastolic", "spo2", "pain_scale", "remarks", "recorded_on", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "temperature", "temperature_unit", "pulse", "respiration", "bp_systolic", "bp_diastolic", "spo2", "pain_scale", "remarks", "recorded_on", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_patient_monitoring`;--> statement-breakpoint
DROP TABLE `nur_patient_monitoring`;--> statement-breakpoint
ALTER TABLE `__new_nur_patient_monitoring` RENAME TO `nur_patient_monitoring`;--> statement-breakpoint
CREATE INDEX `idx_nur_monitoring_visit` ON `nur_patient_monitoring` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_monitoring_tenant` ON `nur_patient_monitoring` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_nur_wound_care` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer NOT NULL,
	`wound_site` text,
	`wound_type` text,
	`size` text,
	`depth` text,
	`exudate` text,
	`description` text,
	`treatment` text,
	`next_dressing_due` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_by` integer,
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_nur_wound_care`("id", "tenant_id", "patient_id", "visit_id", "wound_site", "wound_type", "size", "depth", "exudate", "description", "treatment", "next_dressing_due", "is_active", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "wound_site", "wound_type", "size", "depth", "exudate", "description", "treatment", "next_dressing_due", "is_active", "created_by", "created_at", "updated_by", "updated_at" FROM `nur_wound_care`;--> statement-breakpoint
DROP TABLE `nur_wound_care`;--> statement-breakpoint
ALTER TABLE `__new_nur_wound_care` RENAME TO `nur_wound_care`;--> statement-breakpoint
CREATE INDEX `idx_nur_wound_visit` ON `nur_wound_care` (`tenant_id`,`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_nur_wound_tenant` ON `nur_wound_care` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_ot_bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`booked_for_date` text NOT NULL,
	`surgery_type` text,
	`diagnosis` text,
	`procedure_type` text,
	`anesthesia_type` text,
	`remarks` text,
	`consent_form_path` text,
	`pac_form_path` text,
	`cancellation_remarks` text,
	`cancelled_by` integer,
	`cancelled_on` text,
	`is_active` integer DEFAULT 1,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ot_bookings`("id", "tenant_id", "patient_id", "visit_id", "booked_for_date", "surgery_type", "diagnosis", "procedure_type", "anesthesia_type", "remarks", "consent_form_path", "pac_form_path", "cancellation_remarks", "cancelled_by", "cancelled_on", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "visit_id", "booked_for_date", "surgery_type", "diagnosis", "procedure_type", "anesthesia_type", "remarks", "consent_form_path", "pac_form_path", "cancellation_remarks", "cancelled_by", "cancelled_on", "is_active", "created_by", "created_at", "updated_at" FROM `ot_bookings`;--> statement-breakpoint
DROP TABLE `ot_bookings`;--> statement-breakpoint
ALTER TABLE `__new_ot_bookings` RENAME TO `ot_bookings`;--> statement-breakpoint
CREATE INDEX `idx_ot_bookings_active_date` ON `ot_bookings` (`tenant_id`,`is_active`,`booked_for_date`);--> statement-breakpoint
CREATE INDEX `idx_ot_bookings_date` ON `ot_bookings` (`tenant_id`,`booked_for_date`);--> statement-breakpoint
CREATE INDEX `idx_ot_bookings_patient` ON `ot_bookings` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_ot_bookings_tenant` ON `ot_bookings` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_ot_checklist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` integer NOT NULL,
	`item_name` text NOT NULL,
	`item_value` integer DEFAULT 0,
	`item_details` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`booking_id`) REFERENCES `ot_bookings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ot_checklist_items`("id", "tenant_id", "booking_id", "item_name", "item_value", "item_details", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "booking_id", "item_name", "item_value", "item_details", "created_by", "created_at", "updated_at" FROM `ot_checklist_items`;--> statement-breakpoint
DROP TABLE `ot_checklist_items`;--> statement-breakpoint
ALTER TABLE `__new_ot_checklist_items` RENAME TO `ot_checklist_items`;--> statement-breakpoint
CREATE INDEX `idx_ot_checklist_booking` ON `ot_checklist_items` (`tenant_id`,`booking_id`);--> statement-breakpoint
CREATE TABLE `__new_ot_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` integer NOT NULL,
	`team_member_id` integer,
	`pre_op_diagnosis` text,
	`post_op_diagnosis` text,
	`anesthesia` text,
	`ot_charge` real,
	`ot_description` text,
	`category` text,
	`nurse_signature` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`booking_id`) REFERENCES `ot_bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_member_id`) REFERENCES `ot_team_members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ot_summaries`("id", "tenant_id", "booking_id", "team_member_id", "pre_op_diagnosis", "post_op_diagnosis", "anesthesia", "ot_charge", "ot_description", "category", "nurse_signature", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "booking_id", "team_member_id", "pre_op_diagnosis", "post_op_diagnosis", "anesthesia", "ot_charge", "ot_description", "category", "nurse_signature", "created_by", "created_at", "updated_at" FROM `ot_summaries`;--> statement-breakpoint
DROP TABLE `ot_summaries`;--> statement-breakpoint
ALTER TABLE `__new_ot_summaries` RENAME TO `ot_summaries`;--> statement-breakpoint
CREATE INDEX `idx_ot_summaries_booking` ON `ot_summaries` (`tenant_id`,`booking_id`);--> statement-breakpoint
CREATE TABLE `__new_ot_team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`staff_id` integer NOT NULL,
	`role_type` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`booking_id`) REFERENCES `ot_bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ot_team_members`("id", "tenant_id", "booking_id", "patient_id", "visit_id", "staff_id", "role_type", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "booking_id", "patient_id", "visit_id", "staff_id", "role_type", "created_by", "created_at", "updated_at" FROM `ot_team_members`;--> statement-breakpoint
DROP TABLE `ot_team_members`;--> statement-breakpoint
ALTER TABLE `__new_ot_team_members` RENAME TO `ot_team_members`;--> statement-breakpoint
CREATE INDEX `idx_ot_team_role` ON `ot_team_members` (`tenant_id`,`role_type`);--> statement-breakpoint
CREATE INDEX `idx_ot_team_staff` ON `ot_team_members` (`tenant_id`,`staff_id`);--> statement-breakpoint
CREATE INDEX `idx_ot_team_booking` ON `ot_team_members` (`tenant_id`,`booking_id`);--> statement-breakpoint
CREATE TABLE `__new_patient_active_medications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`formulary_item_id` integer,
	`medication_name` text NOT NULL,
	`generic_name` text,
	`strength` text,
	`dosage_form` text,
	`dosage` text,
	`frequency` text,
	`duration` text,
	`instructions` text,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`status_reason` text,
	`source` text DEFAULT 'prescribed',
	`prescribed_by` integer,
	`prescription_id` integer,
	`is_active` integer DEFAULT 1,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`formulary_item_id`) REFERENCES `formulary_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_patient_active_medications`("id", "tenant_id", "patient_id", "formulary_item_id", "medication_name", "generic_name", "strength", "dosage_form", "dosage", "frequency", "duration", "instructions", "start_date", "end_date", "status", "status_reason", "source", "prescribed_by", "prescription_id", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "formulary_item_id", "medication_name", "generic_name", "strength", "dosage_form", "dosage", "frequency", "duration", "instructions", "start_date", "end_date", "status", "status_reason", "source", "prescribed_by", "prescription_id", "is_active", "created_by", "created_at", "updated_at" FROM `patient_active_medications`;--> statement-breakpoint
DROP TABLE `patient_active_medications`;--> statement-breakpoint
ALTER TABLE `__new_patient_active_medications` RENAME TO `patient_active_medications`;--> statement-breakpoint
CREATE INDEX `idx_patient_meds_generic` ON `patient_active_medications` (`tenant_id`,`generic_name`);--> statement-breakpoint
CREATE INDEX `idx_patient_meds_status` ON `patient_active_medications` (`tenant_id`,`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_patient_meds_patient` ON `patient_active_medications` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_patient_meds_tenant` ON `patient_active_medications` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_patient_allergies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`allergy_type` text NOT NULL,
	`allergen` text NOT NULL,
	`severity` text DEFAULT 'mild',
	`reaction` text,
	`onset_date` text,
	`notes` text,
	`is_active` integer DEFAULT 1,
	`verified_by` integer,
	`verified_at` text,
	`created_by` integer,
	`source` text DEFAULT 'clinician' NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_patient_allergies`("id", "tenant_id", "patient_id", "allergy_type", "allergen", "severity", "reaction", "onset_date", "notes", "is_active", "verified_by", "verified_at", "created_by", "source", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "allergy_type", "allergen", "severity", "reaction", "onset_date", "notes", "is_active", "verified_by", "verified_at", "created_by", "source", "created_at", "updated_at" FROM `patient_allergies`;--> statement-breakpoint
DROP TABLE `patient_allergies`;--> statement-breakpoint
ALTER TABLE `__new_patient_allergies` RENAME TO `patient_allergies`;--> statement-breakpoint
CREATE INDEX `idx_allergies_type` ON `patient_allergies` (`tenant_id`,`allergy_type`);--> statement-breakpoint
CREATE INDEX `idx_allergies_patient` ON `patient_allergies` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_allergies_tenant` ON `patient_allergies` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_patient_bed_infos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`admission_id` integer NOT NULL,
	`bed_id` integer NOT NULL,
	`ward_name` text,
	`bed_number` text,
	`bed_type` text,
	`rate_per_day` real DEFAULT 0 NOT NULL,
	`started_on` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`ended_on` text,
	`days` integer DEFAULT 0,
	`charge_amount` real DEFAULT 0,
	`is_billed` integer DEFAULT 0,
	`billed_bill_id` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_patient_bed_infos`("id", "tenant_id", "patient_id", "admission_id", "bed_id", "ward_name", "bed_number", "bed_type", "rate_per_day", "started_on", "ended_on", "days", "charge_amount", "is_billed", "billed_bill_id", "created_at") SELECT "id", "tenant_id", "patient_id", "admission_id", "bed_id", "ward_name", "bed_number", "bed_type", "rate_per_day", "started_on", "ended_on", "days", "charge_amount", "is_billed", "billed_bill_id", "created_at" FROM `patient_bed_infos`;--> statement-breakpoint
DROP TABLE `patient_bed_infos`;--> statement-breakpoint
ALTER TABLE `__new_patient_bed_infos` RENAME TO `patient_bed_infos`;--> statement-breakpoint
CREATE INDEX `idx_pbi_tenant` ON `patient_bed_infos` (`tenant_id`,`admission_id`);--> statement-breakpoint
CREATE INDEX `idx_pbi_patient` ON `patient_bed_infos` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_pbi_bed` ON `patient_bed_infos` (`tenant_id`,`bed_id`);--> statement-breakpoint
CREATE INDEX `idx_pbi_unbilled` ON `patient_bed_infos` (`tenant_id`,`is_billed`,`ended_on`);--> statement-breakpoint
CREATE TABLE `__new_patient_insurance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`scheme_id` integer NOT NULL,
	`policy_no` text,
	`member_id` text,
	`valid_from` text,
	`valid_to` text,
	`credit_limit` real,
	`status` text DEFAULT 'active',
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_patient_insurance`("id", "tenant_id", "patient_id", "scheme_id", "policy_no", "member_id", "valid_from", "valid_to", "credit_limit", "status", "is_active", "created_at") SELECT "id", "tenant_id", "patient_id", "scheme_id", "policy_no", "member_id", "valid_from", "valid_to", "credit_limit", "status", "is_active", "created_at" FROM `patient_insurance`;--> statement-breakpoint
DROP TABLE `patient_insurance`;--> statement-breakpoint
ALTER TABLE `__new_patient_insurance` RENAME TO `patient_insurance`;--> statement-breakpoint
CREATE INDEX `idx_patient_ins_tenant` ON `patient_insurance` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_patient_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`admission_id` integer,
	`systolic` integer,
	`diastolic` integer,
	`temperature` real,
	`heart_rate` integer,
	`spo2` integer,
	`respiratory_rate` integer,
	`weight` real,
	`notes` text,
	`recorded_by` text,
	`recorded_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`source` text DEFAULT 'recorded' NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_patient_vitals`("id", "tenant_id", "patient_id", "admission_id", "systolic", "diastolic", "temperature", "heart_rate", "spo2", "respiratory_rate", "weight", "notes", "recorded_by", "recorded_at", "source") SELECT "id", "tenant_id", "patient_id", "admission_id", "systolic", "diastolic", "temperature", "heart_rate", "spo2", "respiratory_rate", "weight", "notes", "recorded_by", "recorded_at", "source" FROM `patient_vitals`;--> statement-breakpoint
DROP TABLE `patient_vitals`;--> statement-breakpoint
ALTER TABLE `__new_patient_vitals` RENAME TO `patient_vitals`;--> statement-breakpoint
CREATE INDEX `idx_vitals_patient` ON `patient_vitals` (`tenant_id`,`patient_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `__new_payment_gateway_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`bill_id` integer NOT NULL,
	`gateway` text NOT NULL,
	`payment_id` text,
	`amount` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw_response` text,
	`initiated_by` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_payment_gateway_logs`("id", "tenant_id", "bill_id", "gateway", "payment_id", "amount", "status", "raw_response", "initiated_by", "created_at", "updated_at") SELECT "id", "tenant_id", "bill_id", "gateway", "payment_id", "amount", "status", "raw_response", "initiated_by", "created_at", "updated_at" FROM `payment_gateway_logs`;--> statement-breakpoint
DROP TABLE `payment_gateway_logs`;--> statement-breakpoint
ALTER TABLE `__new_payment_gateway_logs` RENAME TO `payment_gateway_logs`;--> statement-breakpoint
CREATE INDEX `idx_pgl_payment` ON `payment_gateway_logs` (`gateway`,`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_pgl_bill` ON `payment_gateway_logs` (`tenant_id`,`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_pgl_tenant` ON `payment_gateway_logs` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_pharmacy_return_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL,
	`sale_item_id` integer NOT NULL,
	`medicine_id` integer NOT NULL,
	`returned_qty` integer NOT NULL,
	`unit_price` real NOT NULL,
	`line_total` real NOT NULL,
	`batch_no` text,
	`expiry_date` text,
	`reason` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_pharmacy_return_items`("id", "return_id", "sale_item_id", "medicine_id", "returned_qty", "unit_price", "line_total", "batch_no", "expiry_date", "reason", "created_at") SELECT "id", "return_id", "sale_item_id", "medicine_id", "returned_qty", "unit_price", "line_total", "batch_no", "expiry_date", "reason", "created_at" FROM `pharmacy_return_items`;--> statement-breakpoint
DROP TABLE `pharmacy_return_items`;--> statement-breakpoint
ALTER TABLE `__new_pharmacy_return_items` RENAME TO `pharmacy_return_items`;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_return_items_return` ON `pharmacy_return_items` (`return_id`);--> statement-breakpoint
CREATE TABLE `__new_pharmacy_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`return_no` text NOT NULL,
	`sale_invoice_id` integer NOT NULL,
	`patient_id` integer,
	`total_return_amount` real DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'cash',
	`remarks` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_pharmacy_returns`("id", "tenant_id", "return_no", "sale_invoice_id", "patient_id", "total_return_amount", "payment_method", "remarks", "created_by", "created_at") SELECT "id", "tenant_id", "return_no", "sale_invoice_id", "patient_id", "total_return_amount", "payment_method", "remarks", "created_by", "created_at" FROM `pharmacy_returns`;--> statement-breakpoint
DROP TABLE `pharmacy_returns`;--> statement-breakpoint
ALTER TABLE `__new_pharmacy_returns` RENAME TO `pharmacy_returns`;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_returns_tenant` ON `pharmacy_returns` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_returns_no` ON `pharmacy_returns` (`tenant_id`,`return_no`);--> statement-breakpoint
CREATE TABLE `__new_pharmacy_sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`medicine_id` integer,
	`medicine_name` text NOT NULL,
	`batch_no` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` real NOT NULL,
	`discount` real NOT NULL,
	`line_total` real NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`sale_id`) REFERENCES `pharmacy_sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_pharmacy_sale_items`("id", "sale_id", "medicine_id", "medicine_name", "batch_no", "quantity", "unit_price", "discount", "line_total", "tenant_id", "created_at") SELECT "id", "sale_id", "medicine_id", "medicine_name", "batch_no", "quantity", "unit_price", "discount", "line_total", "tenant_id", "created_at" FROM `pharmacy_sale_items`;--> statement-breakpoint
DROP TABLE `pharmacy_sale_items`;--> statement-breakpoint
ALTER TABLE `__new_pharmacy_sale_items` RENAME TO `pharmacy_sale_items`;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_sale_items_tenant` ON `pharmacy_sale_items` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_sale_items_sale` ON `pharmacy_sale_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `__new_pharmacy_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer,
	`patient_name` text,
	`invoice_no` text,
	`total_amount` real NOT NULL,
	`discount` real NOT NULL,
	`net_amount` real NOT NULL,
	`payment_method` text DEFAULT 'cash',
	`status` text DEFAULT 'completed',
	`sold_by` integer,
	`remarks` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_pharmacy_sales`("id", "tenant_id", "patient_id", "patient_name", "invoice_no", "total_amount", "discount", "net_amount", "payment_method", "status", "sold_by", "remarks", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "patient_name", "invoice_no", "total_amount", "discount", "net_amount", "payment_method", "status", "sold_by", "remarks", "created_at", "updated_at" FROM `pharmacy_sales`;--> statement-breakpoint
DROP TABLE `pharmacy_sales`;--> statement-breakpoint
ALTER TABLE `__new_pharmacy_sales` RENAME TO `pharmacy_sales`;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_sales_date` ON `pharmacy_sales` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_sales_patient` ON `pharmacy_sales` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_sales_tenant` ON `pharmacy_sales` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_prescription_safety_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`prescription_id` integer,
	`patient_id` integer NOT NULL,
	`medication_name` text NOT NULL,
	`generic_name` text,
	`check_type` text NOT NULL,
	`has_warnings` integer DEFAULT 0,
	`warning_count` integer DEFAULT 0,
	`warnings_json` text,
	`action_taken` text DEFAULT 'reviewed',
	`override_reason` text,
	`checked_by` integer NOT NULL,
	`checked_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_prescription_safety_checks`("id", "tenant_id", "prescription_id", "patient_id", "medication_name", "generic_name", "check_type", "has_warnings", "warning_count", "warnings_json", "action_taken", "override_reason", "checked_by", "checked_at") SELECT "id", "tenant_id", "prescription_id", "patient_id", "medication_name", "generic_name", "check_type", "has_warnings", "warning_count", "warnings_json", "action_taken", "override_reason", "checked_by", "checked_at" FROM `prescription_safety_checks`;--> statement-breakpoint
DROP TABLE `prescription_safety_checks`;--> statement-breakpoint
ALTER TABLE `__new_prescription_safety_checks` RENAME TO `prescription_safety_checks`;--> statement-breakpoint
CREATE INDEX `idx_safety_checks_type` ON `prescription_safety_checks` (`tenant_id`,`check_type`);--> statement-breakpoint
CREATE INDEX `idx_safety_checks_rx` ON `prescription_safety_checks` (`tenant_id`,`prescription_id`);--> statement-breakpoint
CREATE INDEX `idx_safety_checks_patient` ON `prescription_safety_checks` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_safety_checks_tenant` ON `prescription_safety_checks` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_prescriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rx_no` text NOT NULL,
	`patient_id` integer NOT NULL,
	`doctor_id` integer,
	`appointment_id` integer,
	`bp` text,
	`temperature` text,
	`weight` text,
	`spo2` text,
	`chief_complaint` text,
	`diagnosis` text,
	`examination_notes` text,
	`advice` text,
	`lab_tests` text,
	`follow_up_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`dispense_status` text DEFAULT 'pending' NOT NULL,
	`share_token` text,
	`share_expires_at` text,
	`delivery_status` text DEFAULT 'none',
	`delivery_address` text,
	`delivery_phone` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_prescriptions`("id", "rx_no", "patient_id", "doctor_id", "appointment_id", "bp", "temperature", "weight", "spo2", "chief_complaint", "diagnosis", "examination_notes", "advice", "lab_tests", "follow_up_date", "status", "created_by", "tenant_id", "created_at", "updated_at", "dispense_status", "share_token", "share_expires_at", "delivery_status", "delivery_address", "delivery_phone") SELECT "id", "rx_no", "patient_id", "doctor_id", "appointment_id", "bp", "temperature", "weight", "spo2", "chief_complaint", "diagnosis", "examination_notes", "advice", "lab_tests", "follow_up_date", "status", "created_by", "tenant_id", "created_at", "updated_at", "dispense_status", "share_token", "share_expires_at", "delivery_status", "delivery_address", "delivery_phone" FROM `prescriptions`;--> statement-breakpoint
DROP TABLE `prescriptions`;--> statement-breakpoint
ALTER TABLE `__new_prescriptions` RENAME TO `prescriptions`;--> statement-breakpoint
CREATE INDEX `idx_rx_share_token` ON `prescriptions` (`share_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prescriptions_rxno_unique` ON `prescriptions` (`rx_no`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_prescriptions_appt` ON `prescriptions` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `idx_prescriptions_doctor` ON `prescriptions` (`doctor_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_prescriptions_patient` ON `prescriptions` (`patient_id`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_price_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`category_name` text NOT NULL,
	`category_code` text,
	`description` text,
	`is_default` integer DEFAULT 0,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_price_categories`("id", "tenant_id", "category_name", "category_code", "description", "is_default", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "category_name", "category_code", "description", "is_default", "is_active", "created_at", "updated_at" FROM `price_categories`;--> statement-breakpoint
DROP TABLE `price_categories`;--> statement-breakpoint
ALTER TABLE `__new_price_categories` RENAME TO `price_categories`;--> statement-breakpoint
CREATE INDEX `idx_price_categories_tenant` ON `price_categories` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_procedure_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`order_no` text NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_id` integer,
	`service_item_id` integer,
	`procedure_name` text NOT NULL,
	`instructions` text,
	`ordered_by` integer,
	`performed_by` integer,
	`status` text DEFAULT 'ordered' NOT NULL,
	`ordered_at` text DEFAULT (datetime('now', '+6 hours')),
	`performed_at` text,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_item_id`) REFERENCES `billing_service_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "procedure_orders_check_1" CHECK(status IN ('ordered','in_progress','completed','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_procedure_orders`("id", "tenant_id", "order_no", "patient_id", "visit_id", "service_item_id", "procedure_name", "instructions", "ordered_by", "performed_by", "status", "ordered_at", "performed_at", "notes", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "order_no", "patient_id", "visit_id", "service_item_id", "procedure_name", "instructions", "ordered_by", "performed_by", "status", "ordered_at", "performed_at", "notes", "created_by", "created_at", "updated_at" FROM `procedure_orders`;--> statement-breakpoint
DROP TABLE `procedure_orders`;--> statement-breakpoint
ALTER TABLE `__new_procedure_orders` RENAME TO `procedure_orders`;--> statement-breakpoint
CREATE INDEX `idx_procedure_orders_tenant` ON `procedure_orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_procedure_orders_patient` ON `procedure_orders` (`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_procedure_orders_visit` ON `procedure_orders` (`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_procedure_orders_status` ON `procedure_orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_procedure_orders_order_no` ON `procedure_orders` (`tenant_id`,`order_no`);--> statement-breakpoint
CREATE TABLE `__new_push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh_key` text NOT NULL,
	`auth_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_push_subscriptions`("id", "tenant_id", "user_id", "endpoint", "p256dh_key", "auth_key", "created_at") SELECT "id", "tenant_id", "user_id", "endpoint", "p256dh_key", "auth_key", "created_at" FROM `push_subscriptions`;--> statement-breakpoint
DROP TABLE `push_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_push_subscriptions` RENAME TO `push_subscriptions`;--> statement-breakpoint
CREATE INDEX `idx_push_sub_tenant` ON `push_subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `__new_ssf_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`ssf_patient_id` integer,
	`invoice_date` text NOT NULL,
	`total_amount` real,
	`claimed_amount` real,
	`invoice_status` text DEFAULT 'pending',
	`remarks` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ssf_invoices`("id", "tenant_id", "patient_id", "ssf_patient_id", "invoice_date", "total_amount", "claimed_amount", "invoice_status", "remarks", "is_active", "created_at") SELECT "id", "tenant_id", "patient_id", "ssf_patient_id", "invoice_date", "total_amount", "claimed_amount", "invoice_status", "remarks", "is_active", "created_at" FROM `ssf_invoices`;--> statement-breakpoint
DROP TABLE `ssf_invoices`;--> statement-breakpoint
ALTER TABLE `__new_ssf_invoices` RENAME TO `ssf_invoices`;--> statement-breakpoint
CREATE INDEX `idx_ssf_invoices_patient` ON `ssf_invoices` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_ssf_patient_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`ssf_policy_no` text,
	`ssf_scheme_code` text,
	`member_no` text,
	`claim_code` text,
	`claim_status` text DEFAULT 'pending',
	`ssf_claim_id` text,
	`remarks` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ssf_patient_info`("id", "tenant_id", "patient_id", "ssf_policy_no", "ssf_scheme_code", "member_no", "claim_code", "claim_status", "ssf_claim_id", "remarks", "is_active", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "ssf_policy_no", "ssf_scheme_code", "member_no", "claim_code", "claim_status", "ssf_claim_id", "remarks", "is_active", "created_at", "updated_at" FROM `ssf_patient_info`;--> statement-breakpoint
DROP TABLE `ssf_patient_info`;--> statement-breakpoint
ALTER TABLE `__new_ssf_patient_info` RENAME TO `ssf_patient_info`;--> statement-breakpoint
CREATE INDEX `idx_ssf_patient` ON `ssf_patient_info` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `__new_ssf_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`ssf_api_url` text,
	`ssf_api_code` text,
	`hosp_code` text,
	`username` text,
	`password` text,
	`is_active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_ssf_settings`("id", "tenant_id", "ssf_api_url", "ssf_api_code", "hosp_code", "username", "password", "is_active", "created_at") SELECT "id", "tenant_id", "ssf_api_url", "ssf_api_code", "hosp_code", "username", "password", "is_active", "created_at" FROM `ssf_settings`;--> statement-breakpoint
DROP TABLE `ssf_settings`;--> statement-breakpoint
ALTER TABLE `__new_ssf_settings` RENAME TO `ssf_settings`;--> statement-breakpoint
CREATE TABLE `__new_visit_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`visit_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`service_type` text NOT NULL,
	`description` text,
	`service_item_id` integer,
	`doctor_id` integer,
	`amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`reference_type` text,
	`reference_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`bill_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_item_id`) REFERENCES `billing_service_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visit_services_check_1" CHECK(service_type IN ('doctor_visit','test','procedure','admission','medicine','package','other')),
	CONSTRAINT "visit_services_check_2" CHECK(status IN ('pending','billed','cancelled','refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_visit_services`("id", "tenant_id", "visit_id", "patient_id", "service_type", "description", "service_item_id", "doctor_id", "amount", "discount_amount", "quantity", "total_amount", "reference_type", "reference_id", "status", "bill_id", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "visit_id", "patient_id", "service_type", "description", "service_item_id", "doctor_id", "amount", "discount_amount", "quantity", "total_amount", "reference_type", "reference_id", "status", "bill_id", "created_by", "created_at", "updated_at" FROM `visit_services`;--> statement-breakpoint
DROP TABLE `visit_services`;--> statement-breakpoint
ALTER TABLE `__new_visit_services` RENAME TO `visit_services`;--> statement-breakpoint
CREATE INDEX `idx_visit_services_tenant` ON `visit_services` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_visit_services_visit` ON `visit_services` (`visit_id`);--> statement-breakpoint
CREATE INDEX `idx_visit_services_patient` ON `visit_services` (`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_visit_services_status` ON `visit_services` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_visit_services_bill` ON `visit_services` (`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_visit_services_created` ON `visit_services` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`visit_no` text,
	`doctor_id` integer,
	`visit_type` text DEFAULT 'opd' NOT NULL,
	`admission_flag` integer DEFAULT 0 NOT NULL,
	`admission_no` text,
	`admission_date` text,
	`discharge_date` text,
	`notes` text,
	`tenant_id` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours')),
	`icd10_code` text,
	`icd10_description` text,
	`icd11_code` text,
	`icd11_description` text,
	`branch_id` integer,
	`visit_date` text,
	`status` text DEFAULT 'initiated',
	`appointment_id` integer,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_visits`("id", "patient_id", "visit_no", "doctor_id", "visit_type", "admission_flag", "admission_no", "admission_date", "discharge_date", "notes", "tenant_id", "created_by", "created_at", "updated_at", "icd10_code", "icd10_description", "icd11_code", "icd11_description", "branch_id", "visit_date", "status", "appointment_id") SELECT "id", "patient_id", "visit_no", "doctor_id", "visit_type", "admission_flag", "admission_no", "admission_date", "discharge_date", "notes", "tenant_id", "created_by", "created_at", "updated_at", "icd10_code", "icd10_description", "icd11_code", "icd11_description", "branch_id", "visit_date", "status", "appointment_id" FROM `visits`;--> statement-breakpoint
DROP TABLE `visits`;--> statement-breakpoint
ALTER TABLE `__new_visits` RENAME TO `visits`;--> statement-breakpoint
CREATE INDEX `idx_visits_patient` ON `visits` (`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_visits_tenant` ON `visits` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_visits_date` ON `visits` (`visit_date`);--> statement-breakpoint
CREATE TABLE `__new_vital_alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text DEFAULT '0' NOT NULL,
	`vital_type` text NOT NULL,
	`min_value` real,
	`max_value` real,
	`severity` text DEFAULT 'warning' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_vital_alert_rules`("id", "tenant_id", "vital_type", "min_value", "max_value", "severity", "is_active", "created_at") SELECT "id", "tenant_id", "vital_type", "min_value", "max_value", "severity", "is_active", "created_at" FROM `vital_alert_rules`;--> statement-breakpoint
DROP TABLE `vital_alert_rules`;--> statement-breakpoint
ALTER TABLE `__new_vital_alert_rules` RENAME TO `vital_alert_rules`;--> statement-breakpoint
CREATE INDEX `idx_vital_alert_rules_tenant` ON `vital_alert_rules` (`tenant_id`,`vital_type`,`is_active`);--> statement-breakpoint
CREATE TABLE `__new_vital_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`vital_id` integer NOT NULL,
	`rule_id` integer NOT NULL,
	`vital_type` text NOT NULL,
	`recorded_value` real NOT NULL,
	`threshold_min` real,
	`threshold_max` real,
	`severity` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` text,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	CONSTRAINT "invitations_check_1" CHECK(role IN ('hospital_admin','laboratory','reception','md','director','pharmacist','accountant'),
	CONSTRAINT "payment_gateway_logs_check_2" CHECK(gateway IN ('bkash', 'nagad'),
	CONSTRAINT "payment_gateway_logs_check_3" CHECK(status IN ('pending', 'success', 'failed', 'cancelled'),
	CONSTRAINT "consultations_check_4" CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'),
	CONSTRAINT "appointments_check_5" CHECK(visit_type IN ('opd', 'followup', 'emergency'),
	CONSTRAINT "appointments_check_6" CHECK(status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'),
	CONSTRAINT "prescriptions_check_7" CHECK(status IN ('draft','final'),
	CONSTRAINT "patient_messages_check_8" CHECK(sender_type IN ('patient', 'doctor'),
	CONSTRAINT "prescription_refill_requests_check_9" CHECK(status IN ('pending', 'approved', 'denied', 'completed'),
	CONSTRAINT "patient_family_links_check_10" CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other'),
	CONSTRAINT "drug_interaction_pairs_check_11" CHECK(severity IN ('minor', 'moderate', 'major', 'contraindicated'),
	CONSTRAINT "drug_interaction_pairs_check_12" CHECK(evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report'),
	CONSTRAINT "patient_active_medications_check_13" CHECK(status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended'),
	CONSTRAINT "patient_active_medications_check_14" CHECK(source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy'),
	CONSTRAINT "prescription_safety_checks_check_15" CHECK(check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined'),
	CONSTRAINT "prescription_safety_checks_check_16" CHECK(action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled'),
	CONSTRAINT "patients_check_17" CHECK(gender IN ('male', 'female', 'other'),
	CONSTRAINT "serials_check_18" CHECK(status IN ('waiting', 'in-progress', 'completed'),
	CONSTRAINT "tests_check_19" CHECK(status IN ('pending', 'completed'),
	CONSTRAINT "payments_check_20" CHECK(payment_type IN ('current', 'due'),
	CONSTRAINT "income_check_21" CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'),
	CONSTRAINT "expenses_check_22" CHECK(status IN ('pending', 'approved', 'rejected'),
	CONSTRAINT "staff_check_23" CHECK(status IN ('active', 'inactive'),
	CONSTRAINT "shareholders_check_24" CHECK(type IN ('profit', 'owner'),
	CONSTRAINT "chart_of_accounts_check_25" CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity'),
	CONSTRAINT "recurring_expenses_check_26" CHECK(frequency IN ('daily', 'weekly', 'monthly'),
	CONSTRAINT "audit_logs_check_27" CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')
);
--> statement-breakpoint
INSERT INTO `__new_vital_alerts`("id", "tenant_id", "patient_id", "vital_id", "rule_id", "vital_type", "recorded_value", "threshold_min", "threshold_max", "severity", "status", "acknowledged_by", "acknowledged_at", "resolved_at", "created_at") SELECT "id", "tenant_id", "patient_id", "vital_id", "rule_id", "vital_type", "recorded_value", "threshold_min", "threshold_max", "severity", "status", "acknowledged_by", "acknowledged_at", "resolved_at", "created_at" FROM `vital_alerts`;--> statement-breakpoint
DROP TABLE `vital_alerts`;--> statement-breakpoint
ALTER TABLE `__new_vital_alerts` RENAME TO `vital_alerts`;--> statement-breakpoint
CREATE INDEX `idx_vital_alerts_patient` ON `vital_alerts` (`tenant_id`,`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vital_alerts_tenant` ON `vital_alerts` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_catalog_loinc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loinc_num` text NOT NULL,
	`component` text NOT NULL,
	`long_common_name` text NOT NULL,
	`short_name` text,
	`class` text,
	`property` text,
	`time_aspect` text,
	`system_type` text,
	`scale_type` text,
	`units` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_catalog_loinc`("id", "loinc_num", "component", "long_common_name", "short_name", "class", "property", "time_aspect", "system_type", "scale_type", "units", "status", "created_at") SELECT "id", "loinc_num", "component", "long_common_name", "short_name", "class", "property", "time_aspect", "system_type", "scale_type", "units", "status", "created_at" FROM `catalog_loinc`;--> statement-breakpoint
DROP TABLE `catalog_loinc`;--> statement-breakpoint
ALTER TABLE `__new_catalog_loinc` RENAME TO `catalog_loinc`;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_loinc_loinc_num_unique` ON `catalog_loinc` (`loinc_num`);--> statement-breakpoint
CREATE INDEX `idx_catalog_loinc_class` ON `catalog_loinc` (`class`);--> statement-breakpoint
CREATE INDEX `idx_catalog_loinc_component` ON `catalog_loinc` (`component`);--> statement-breakpoint
CREATE INDEX `idx_catalog_loinc_name` ON `catalog_loinc` (`long_common_name`);--> statement-breakpoint
CREATE TABLE `__new_catalog_snomed` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sctid` text NOT NULL,
	`term` text NOT NULL,
	`semantic_tag` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_catalog_snomed`("id", "sctid", "term", "semantic_tag", "is_active", "created_at") SELECT "id", "sctid", "term", "semantic_tag", "is_active", "created_at" FROM `catalog_snomed`;--> statement-breakpoint
DROP TABLE `catalog_snomed`;--> statement-breakpoint
ALTER TABLE `__new_catalog_snomed` RENAME TO `catalog_snomed`;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_snomed_sctid_unique` ON `catalog_snomed` (`sctid`);--> statement-breakpoint
CREATE INDEX `idx_catalog_snomed_tag` ON `catalog_snomed` (`semantic_tag`);--> statement-breakpoint
CREATE INDEX `idx_catalog_snomed_term` ON `catalog_snomed` (`term`);--> statement-breakpoint
CREATE TABLE `__new_catalog_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_system` text NOT NULL,
	`version` text NOT NULL,
	`loaded_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`record_count` integer,
	`notes` text
);
--> statement-breakpoint
INSERT INTO `__new_catalog_versions`("id", "code_system", "version", "loaded_at", "record_count", "notes") SELECT "id", "code_system", "version", "loaded_at", "record_count", "notes" FROM `catalog_versions`;--> statement-breakpoint
DROP TABLE `catalog_versions`;--> statement-breakpoint
ALTER TABLE `__new_catalog_versions` RENAME TO `catalog_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_versions_unique` ON `catalog_versions` (`code_system`,`version`);--> statement-breakpoint
CREATE TABLE `__new_global_family_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_identity_id` integer NOT NULL,
	`manager_auth_user_id` integer NOT NULL,
	`relationship` text NOT NULL,
	`access_role` text DEFAULT 'manager' NOT NULL,
	`verification_basis` text DEFAULT 'dependent_created' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_by_auth_user_id` integer,
	`revoked_by_auth_user_id` integer,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_global_family_links`("id", "patient_identity_id", "manager_auth_user_id", "relationship", "access_role", "verification_basis", "status", "notes", "created_by_auth_user_id", "revoked_by_auth_user_id", "revoked_at", "created_at", "updated_at") SELECT "id", "patient_identity_id", "manager_auth_user_id", "relationship", "access_role", "verification_basis", "status", "notes", "created_by_auth_user_id", "revoked_by_auth_user_id", "revoked_at", "created_at", "updated_at" FROM `global_family_links`;--> statement-breakpoint
DROP TABLE `global_family_links`;--> statement-breakpoint
ALTER TABLE `__new_global_family_links` RENAME TO `global_family_links`;--> statement-breakpoint
CREATE INDEX `idx_gfl_patient_identity` ON `global_family_links` (`patient_identity_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_gfl_manager_auth` ON `global_family_links` (`manager_auth_user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gfl_active_unique` ON `global_family_links` (`patient_identity_id`,`manager_auth_user_id`);--> statement-breakpoint
CREATE TABLE `__new_global_family_proxy_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_identity_id` integer NOT NULL,
	`inviter_auth_user_id` integer NOT NULL,
	`invitee_auth_user_id` integer NOT NULL,
	`relationship` text NOT NULL,
	`access_role` text DEFAULT 'manager' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`declined_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_global_family_proxy_invites`("id", "patient_identity_id", "inviter_auth_user_id", "invitee_auth_user_id", "relationship", "access_role", "status", "notes", "expires_at", "accepted_at", "declined_at", "revoked_at", "created_at", "updated_at") SELECT "id", "patient_identity_id", "inviter_auth_user_id", "invitee_auth_user_id", "relationship", "access_role", "status", "notes", "expires_at", "accepted_at", "declined_at", "revoked_at", "created_at", "updated_at" FROM `global_family_proxy_invites`;--> statement-breakpoint
DROP TABLE `global_family_proxy_invites`;--> statement-breakpoint
ALTER TABLE `__new_global_family_proxy_invites` RENAME TO `global_family_proxy_invites`;--> statement-breakpoint
CREATE INDEX `idx_gfpi_patient` ON `global_family_proxy_invites` (`patient_identity_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_gfpi_inviter` ON `global_family_proxy_invites` (`inviter_auth_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_gfpi_invitee` ON `global_family_proxy_invites` (`invitee_auth_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_global_patient_auth` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id` integer,
	`national_id` text,
	`uhid` text,
	`email` text,
	`phone` text,
	`password_hash` text,
	`google_sub` text,
	`google_email` text,
	`name` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_login_at` text,
	`email_verified` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_global_patient_auth`("id", "identity_id", "national_id", "uhid", "email", "phone", "password_hash", "google_sub", "google_email", "name", "is_active", "last_login_at", "email_verified", "created_at", "updated_at") SELECT "id", "identity_id", "national_id", "uhid", "email", "phone", "password_hash", "google_sub", "google_email", "name", "is_active", "last_login_at", "email_verified", "created_at", "updated_at" FROM `global_patient_auth`;--> statement-breakpoint
DROP TABLE `global_patient_auth`;--> statement-breakpoint
ALTER TABLE `__new_global_patient_auth` RENAME TO `global_patient_auth`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gpa_email` ON `global_patient_auth` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gpa_phone` ON `global_patient_auth` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gpa_google` ON `global_patient_auth` (`google_sub`);--> statement-breakpoint
CREATE INDEX `idx_gpa_nid` ON `global_patient_auth` (`national_id`);--> statement-breakpoint
CREATE INDEX `idx_gpa_uhid` ON `global_patient_auth` (`uhid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gpa_identity_id` ON `global_patient_auth` (`identity_id`);--> statement-breakpoint
CREATE TABLE `__new_global_patient_identity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`national_id` text,
	`uhid` text NOT NULL,
	`primary_name` text,
	`primary_phone` text,
	`primary_email` text,
	`blood_group` text,
	`date_of_birth` text,
	`gender` text,
	`brn` text,
	`verification_level` integer DEFAULT 0,
	`nid_front_url` text,
	`nid_back_url` text,
	`profile_picture_url` text,
	`verification_metadata` text,
	`claim_status` text DEFAULT 'unclaimed' NOT NULL,
	`claimed_auth_user_id` integer,
	`claimed_at` text,
	`created_source` text DEFAULT 'hospital' NOT NULL,
	`created_tenant_id` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')),
	`updated_at` text DEFAULT (datetime('now', '+6 hours'))
);
--> statement-breakpoint
INSERT INTO `__new_global_patient_identity`("id", "national_id", "uhid", "primary_name", "primary_phone", "primary_email", "blood_group", "date_of_birth", "gender", "brn", "verification_level", "nid_front_url", "nid_back_url", "profile_picture_url", "verification_metadata", "claim_status", "claimed_auth_user_id", "claimed_at", "created_source", "created_tenant_id", "created_at", "updated_at") SELECT "id", "national_id", "uhid", "primary_name", "primary_phone", "primary_email", "blood_group", "date_of_birth", "gender", "brn", "verification_level", "nid_front_url", "nid_back_url", "profile_picture_url", "verification_metadata", "claim_status", "claimed_auth_user_id", "claimed_at", "created_source", "created_tenant_id", "created_at", "updated_at" FROM `global_patient_identity`;--> statement-breakpoint
DROP TABLE `global_patient_identity`;--> statement-breakpoint
ALTER TABLE `__new_global_patient_identity` RENAME TO `global_patient_identity`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_global_identity_nid` ON `global_patient_identity` (`national_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_global_identity_uhid` ON `global_patient_identity` (`uhid`);--> statement-breakpoint
CREATE INDEX `idx_gpi_brn` ON `global_patient_identity` (`brn`);--> statement-breakpoint
CREATE INDEX `idx_gpi_claim_status` ON `global_patient_identity` (`claim_status`);--> statement-breakpoint
CREATE TABLE `__new_global_patient_vitals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uhid` text NOT NULL,
	`logged_on` text NOT NULL,
	`systolic` integer,
	`diastolic` integer,
	`heart_rate` integer,
	`blood_sugar` real,
	`blood_sugar_context` text,
	`notes` text,
	`source` text DEFAULT 'patient_reported' NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`reviewed_at` text,
	`review_notes` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_global_patient_vitals`("id", "uhid", "logged_on", "systolic", "diastolic", "heart_rate", "blood_sugar", "blood_sugar_context", "notes", "source", "review_status", "reviewed_at", "review_notes", "created_at", "updated_at") SELECT "id", "uhid", "logged_on", "systolic", "diastolic", "heart_rate", "blood_sugar", "blood_sugar_context", "notes", "source", "review_status", "reviewed_at", "review_notes", "created_at", "updated_at" FROM `global_patient_vitals`;--> statement-breakpoint
DROP TABLE `global_patient_vitals`;--> statement-breakpoint
ALTER TABLE `__new_global_patient_vitals` RENAME TO `global_patient_vitals`;--> statement-breakpoint
CREATE INDEX `idx_gpv_uhid` ON `global_patient_vitals` (`uhid`,`logged_on`);--> statement-breakpoint
CREATE INDEX `idx_gpv_review_status` ON `global_patient_vitals` (`review_status`);--> statement-breakpoint
CREATE TABLE `__new_mpi_duplicate_suspects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id_1` integer NOT NULL,
	`identity_id_2` integer NOT NULL,
	`match_type` text NOT NULL,
	`confidence` integer NOT NULL,
	`match_details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mpi_duplicate_suspects`("id", "identity_id_1", "identity_id_2", "match_type", "confidence", "match_details", "status", "reviewed_by", "reviewed_at", "notes", "created_at") SELECT "id", "identity_id_1", "identity_id_2", "match_type", "confidence", "match_details", "status", "reviewed_by", "reviewed_at", "notes", "created_at" FROM `mpi_duplicate_suspects`;--> statement-breakpoint
DROP TABLE `mpi_duplicate_suspects`;--> statement-breakpoint
ALTER TABLE `__new_mpi_duplicate_suspects` RENAME TO `mpi_duplicate_suspects`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dup_suspects_unique` ON `mpi_duplicate_suspects` (`identity_id_1`,`identity_id_2`);--> statement-breakpoint
CREATE INDEX `idx_dup_suspects_status` ON `mpi_duplicate_suspects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_dup_suspects_id1` ON `mpi_duplicate_suspects` (`identity_id_1`);--> statement-breakpoint
CREATE INDEX `idx_dup_suspects_id2` ON `mpi_duplicate_suspects` (`identity_id_2`);--> statement-breakpoint
CREATE TABLE `__new_patient_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`alias_type` text NOT NULL,
	`alias_value` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`reason` text,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_patient_aliases`("id", "tenant_id", "patient_id", "alias_type", "alias_value", "valid_from", "valid_to", "reason", "created_by", "created_at") SELECT "id", "tenant_id", "patient_id", "alias_type", "alias_value", "valid_from", "valid_to", "reason", "created_by", "created_at" FROM `patient_aliases`;--> statement-breakpoint
DROP TABLE `patient_aliases`;--> statement-breakpoint
ALTER TABLE `__new_patient_aliases` RENAME TO `patient_aliases`;--> statement-breakpoint
CREATE INDEX `idx_aliases_patient` ON `patient_aliases` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_aliases_type_value` ON `patient_aliases` (`alias_type`,`alias_value`);--> statement-breakpoint
CREATE TABLE `__new_patient_claim_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_id` integer NOT NULL,
	`code_hash` text NOT NULL,
	`code_last4` text NOT NULL,
	`issued_by_tenant_id` text,
	`issued_for_patient_id` integer,
	`issued_by_user_id` integer,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_patient_claim_codes`("id", "identity_id", "code_hash", "code_last4", "issued_by_tenant_id", "issued_for_patient_id", "issued_by_user_id", "expires_at", "used_at", "created_at") SELECT "id", "identity_id", "code_hash", "code_last4", "issued_by_tenant_id", "issued_for_patient_id", "issued_by_user_id", "expires_at", "used_at", "created_at" FROM `patient_claim_codes`;--> statement-breakpoint
DROP TABLE `patient_claim_codes`;--> statement-breakpoint
ALTER TABLE `__new_patient_claim_codes` RENAME TO `patient_claim_codes`;--> statement-breakpoint
CREATE INDEX `idx_patient_claim_codes_identity` ON `patient_claim_codes` (`identity_id`,`used_at`);--> statement-breakpoint
CREATE INDEX `idx_patient_claim_codes_expires` ON `patient_claim_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_patient_guardians` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`guardian_name` text NOT NULL,
	`relationship` text NOT NULL,
	`national_id` text,
	`phone` text,
	`address` text,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '+6 hours')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_patient_guardians`("id", "tenant_id", "patient_id", "guardian_name", "relationship", "national_id", "phone", "address", "is_primary", "is_active", "created_by", "created_at", "updated_at") SELECT "id", "tenant_id", "patient_id", "guardian_name", "relationship", "national_id", "phone", "address", "is_primary", "is_active", "created_by", "created_at", "updated_at" FROM `patient_guardians`;--> statement-breakpoint
DROP TABLE `patient_guardians`;--> statement-breakpoint
ALTER TABLE `__new_patient_guardians` RENAME TO `patient_guardians`;--> statement-breakpoint
CREATE INDEX `idx_guardians_patient` ON `patient_guardians` (`tenant_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_guardians_nid` ON `patient_guardians` (`national_id`);--> statement-breakpoint
CREATE INDEX `idx_guardians_phone` ON `patient_guardians` (`phone`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `appointment_type` text DEFAULT 'new_patient' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `original_fee` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `discount_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `final_fee` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `discount_reason` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `billing_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `external_referring_doctor_id` integer;--> statement-breakpoint
CREATE INDEX `idx_appointments_billing_status` ON `appointments` (`tenant_id`,`billing_status`);--> statement-breakpoint
CREATE INDEX `idx_appointments_type_billing` ON `appointments` (`tenant_id`,`appointment_type`,`billing_status`);--> statement-breakpoint
CREATE INDEX `idx_appointments_ext_ref_doctor` ON `appointments` (`external_referring_doctor_id`);--> statement-breakpoint
ALTER TABLE `billing_counters` ADD `counter_type` text DEFAULT 'billing';--> statement-breakpoint
ALTER TABLE `billing_counters` ADD `location` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `discount_reason` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `approved_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `bills` ADD `tax_total` real;--> statement-breakpoint
ALTER TABLE `bills` ADD `counter_session_id` integer;--> statement-breakpoint
ALTER TABLE `bills` ADD `referring_doctor_id` integer;--> statement-breakpoint
ALTER TABLE `expenses` ADD `receipt_key` text;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `tax_amount` real;--> statement-breakpoint
ALTER TABLE `payments` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `external_transaction_id` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `counter_id` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `counter_session_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `mobile` text;--> statement-breakpoint
CREATE INDEX `idx_users_mobile` ON `users` (`mobile`);