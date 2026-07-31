// Drizzle schema definitions for MPI Hardening tables

import { sqliteTable, text, integer, index, uniqueIndex, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { patients } from './schema';

export const globalPatientIdentity = sqliteTable('global_patient_identity', {
  id: integer().primaryKey({ autoIncrement: true }),
  nationalId: text('national_id'),
  uhid: text().notNull(),
  primaryName: text('primary_name'),
  primaryPhone: text('primary_phone'),
  primaryEmail: text('primary_email'),
  bloodGroup: text('blood_group'),
  dateOfBirth: text('date_of_birth'),
  gender: text(),
  brn: text(),
  verificationLevel: integer('verification_level').default(0),
  nidFrontUrl: text('nid_front_url'),
  nidBackUrl: text('nid_back_url'),
  profilePictureUrl: text('profile_picture_url'),
  verificationMetadata: text('verification_metadata'),
  claimStatus: text('claim_status').notNull().default('unclaimed'),
  claimedAuthUserId: integer('claimed_auth_user_id'),
  claimedAt: text('claimed_at'),
  createdSource: text('created_source').notNull().default('hospital'),
  createdTenantId: text('created_tenant_id'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  uniqueIndex('idx_global_identity_nid').on(table.nationalId),
  uniqueIndex('idx_global_identity_uhid').on(table.uhid),
  index('idx_gpi_brn').on(table.brn),
  index('idx_gpi_claim_status').on(table.claimStatus),
]);

export const globalPatientAuth = sqliteTable('global_patient_auth', {
  id: integer().primaryKey({ autoIncrement: true }),
  identityId: integer('identity_id'),
  nationalId: text('national_id'),
  uhid: text(),
  email: text(),
  phone: text(),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub'),
  googleEmail: text('google_email'),
  name: text(),
  isActive: integer('is_active').notNull().default(1),
  lastLoginAt: text('last_login_at'),
  emailVerified: integer('email_verified').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  uniqueIndex('idx_gpa_email').on(table.email),
  uniqueIndex('idx_gpa_phone').on(table.phone),
  uniqueIndex('idx_gpa_google').on(table.googleSub),
  index('idx_gpa_nid').on(table.nationalId),
  index('idx_gpa_uhid').on(table.uhid),
  uniqueIndex('idx_gpa_identity_id').on(table.identityId),
]);

export const patientClaimCodes = sqliteTable('patient_claim_codes', {
  id: integer().primaryKey({ autoIncrement: true }),
  identityId: integer('identity_id').notNull(),
  codeHash: text('code_hash').notNull(),
  codeLast4: text('code_last4').notNull(),
  issuedByTenantId: text('issued_by_tenant_id'),
  issuedForPatientId: integer('issued_for_patient_id'),
  issuedByUserId: integer('issued_by_user_id'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_patient_claim_codes_identity').on(table.identityId, table.usedAt),
  index('idx_patient_claim_codes_expires').on(table.expiresAt),
]);

export const patientGuardians = sqliteTable('patient_guardians', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  patientId: integer('patient_id').notNull().references(() => patients.id),
  guardianName: text('guardian_name').notNull(),
  relationship: text().notNull(),
  nationalId: text('national_id'),
  phone: text(),
  address: text(),
  isPrimary: integer('is_primary').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdBy: integer('created_by'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_guardians_patient').on(table.tenantId, table.patientId),
  index('idx_guardians_nid').on(table.nationalId),
  index('idx_guardians_phone').on(table.phone),
]);

export const patientAliases = sqliteTable('patient_aliases', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  patientId: integer('patient_id').notNull().references(() => patients.id),
  aliasType: text('alias_type').notNull(),
  aliasValue: text('alias_value').notNull(),
  validFrom: text('valid_from'),
  validTo: text('valid_to'),
  reason: text(),
  createdBy: integer('created_by'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_aliases_patient').on(table.tenantId, table.patientId),
  index('idx_aliases_type_value').on(table.aliasType, table.aliasValue),
]);

export const globalFamilyLinks = sqliteTable('global_family_links', {
  id: integer().primaryKey({ autoIncrement: true }),
  patientIdentityId: integer('patient_identity_id').notNull(),
  managerAuthUserId: integer('manager_auth_user_id').notNull(),
  relationship: text().notNull(),
  accessRole: text('access_role').notNull().default('manager'),
  verificationBasis: text('verification_basis').notNull().default('dependent_created'),
  status: text().notNull().default('active'),
  notes: text(),
  createdByAuthUserId: integer('created_by_auth_user_id'),
  revokedByAuthUserId: integer('revoked_by_auth_user_id'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_gfl_patient_identity').on(table.patientIdentityId, table.status),
  index('idx_gfl_manager_auth').on(table.managerAuthUserId, table.status),
  uniqueIndex('idx_gfl_active_unique').on(table.patientIdentityId, table.managerAuthUserId),
]);

export const globalFamilyProxyInvites = sqliteTable('global_family_proxy_invites', {
  id: integer().primaryKey({ autoIncrement: true }),
  patientIdentityId: integer('patient_identity_id').notNull(),
  inviterAuthUserId: integer('inviter_auth_user_id').notNull(),
  inviteeAuthUserId: integer('invitee_auth_user_id').notNull(),
  relationship: text().notNull(),
  accessRole: text('access_role').notNull().default('manager'),
  status: text().notNull().default('pending'),
  notes: text(),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  declinedAt: text('declined_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_gfpi_patient').on(table.patientIdentityId, table.status),
  index('idx_gfpi_inviter').on(table.inviterAuthUserId, table.status),
  index('idx_gfpi_invitee').on(table.inviteeAuthUserId, table.status),
]);

export const mpiDuplicateSuspects = sqliteTable('mpi_duplicate_suspects', {
  id: integer().primaryKey({ autoIncrement: true }),
  identityId1: integer('identity_id_1').notNull(),
  identityId2: integer('identity_id_2').notNull(),
  matchType: text('match_type').notNull(),
  confidence: integer().notNull(),
  matchDetails: text('match_details'),
  status: text().notNull().default('pending'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  notes: text(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  uniqueIndex('idx_dup_suspects_unique').on(table.identityId1, table.identityId2),
  index('idx_dup_suspects_status').on(table.status),
  index('idx_dup_suspects_id1').on(table.identityId1),
  index('idx_dup_suspects_id2').on(table.identityId2),
]);

export const globalPatientVitals = sqliteTable('global_patient_vitals', {
  id: integer().primaryKey({ autoIncrement: true }),
  uhid: text().notNull(),
  loggedOn: text('logged_on').notNull(),
  systolic: integer(),
  diastolic: integer(),
  heartRate: integer('heart_rate'),
  bloodSugar: real('blood_sugar'),
  bloodSugarContext: text('blood_sugar_context'),
  notes: text(),
  source: text().notNull().default('patient_reported'),
  reviewStatus: text('review_status').notNull().default('pending_review'),
  reviewedAt: text('reviewed_at'),
  reviewNotes: text('review_notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_gpv_uhid').on(table.uhid, table.loggedOn),
  index('idx_gpv_review_status').on(table.reviewStatus),
]);


export const patientMergeRecordMap = sqliteTable('patient_merge_record_map', {
  id: integer().primaryKey({ autoIncrement: true }),
  mergeLogId: integer('merge_log_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  tableName: text('table_name').notNull(),
  columnName: text('column_name').notNull(),
  recordId: integer('record_id').notNull(),
  originalPatientId: integer('original_patient_id').notNull(),
  targetPatientId: integer('target_patient_id').notNull(),
  movedAt: text('moved_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_merge_record_map_log').on(table.mergeLogId),
  index('idx_merge_record_map_record').on(table.tableName, table.columnName, table.recordId),
  index('idx_merge_record_map_tenant').on(table.tenantId, table.originalPatientId),
  uniqueIndex('idx_merge_map_unique_record').on(
    table.mergeLogId,
    table.tableName,
    table.columnName,
    table.recordId,
  ),
]);
