import { HTTPException } from 'hono/http-exception';
import type { D1Database } from '@cloudflare/workers-types';
import { createGlobalIdentity } from './global-identity';

export type FamilyRelationship =
  | 'child'
  | 'parent'
  | 'spouse'
  | 'sibling'
  | 'caregiver'
  | 'legal_guardian'
  | 'grandparent'
  | 'grandchild'
  | 'other';

export type FamilyAccessRole = 'primary_manager' | 'manager';

export interface CurrentAuthIdentity {
  authUserId: number;
  identityId: number;
  email: string | null;
  phone: string | null;
  uhid: string | null;
  name: string | null;
}

export interface ActingPortalContext {
  auth: CurrentAuthIdentity;
  actingIdentityId: number;
  actingIdentity: {
    id: number;
    uhid: string | null;
    primaryName: string | null;
    primaryPhone: string | null;
    primaryEmail: string | null;
    claimStatus: string | null;
  };
  managed: boolean;
  relationship: string | null;
}

export interface FamilyManagerLink {
  linkId: number;
  patientIdentityId: number;
  managerAuthUserId: number;
  relationship: string;
  accessRole: FamilyAccessRole;
  verificationBasis: string;
  status: string;
  notes: string | null;
  createdAt: string;
  managerName: string | null;
  managerEmail: string | null;
  managerPhone: string | null;
}

export interface FamilyProxyInviteSummary {
  id: number;
  patientIdentityId: number;
  inviterAuthUserId: number;
  inviteeAuthUserId: number;
  relationship: string;
  accessRole: FamilyAccessRole;
  status: string;
  notes: string | null;
  expiresAt: string;
  createdAt: string;
}

const tableColumnCache = new WeakMap<D1Database, Map<string, Set<string>>>();

async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isManagerAccessRole(role: string | null | undefined): role is FamilyAccessRole {
  return role === 'primary_manager' || role === 'manager';
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  let dbCache = tableColumnCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, Set<string>>();
    tableColumnCache.set(db, dbCache);
  }

  const cached = dbCache.get(tableName);
  if (cached) return cached;

  const { results } = await db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all<{ name: string }>();
  const columns = new Set((results ?? []).map((row) => String(row.name)));
  dbCache.set(tableName, columns);
  return columns;
}

async function getNextManagerAccessRole(
  db: D1Database,
  patientIdentityId: number,
): Promise<FamilyAccessRole> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS active_count
    FROM global_family_links
    WHERE patient_identity_id = ? AND status = 'active'
  `).bind(patientIdentityId).first<{ active_count: number }>();

  return Number(row?.active_count ?? 0) > 0 ? 'manager' : 'primary_manager';
}

export async function getCurrentAuthIdentity(
  db: D1Database,
  authUserId: number,
): Promise<CurrentAuthIdentity> {
  const row = await db.prepare(
    'SELECT identity_id, email, phone, uhid, name FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(authUserId).first<{
    identity_id: number | null;
    email: string | null;
    phone: string | null;
    uhid: string | null;
    name: string | null;
  }>();

  if (!row) {
    throw new HTTPException(404, { message: 'Global patient identity not found for this account' });
  }

  let identityId = row.identity_id ? Number(row.identity_id) : null;
  let resolvedUHID = row.uhid ?? null;

  if (!identityId) {
    const authColumns = await getTableColumns(db, 'global_patient_auth');
    const identityColumns = await getTableColumns(db, 'global_patient_identity');
    const nationalIdRow = authColumns.has('national_id')
      ? await db.prepare(
          'SELECT national_id FROM global_patient_auth WHERE id = ? AND is_active = 1',
        ).bind(authUserId).first<{ national_id: string | null }>()
      : null;

    const identitySelect = [
      'id',
      'uhid',
      identityColumns.has('claim_status') ? 'claim_status' : "'unclaimed' AS claim_status",
      identityColumns.has('claimed_auth_user_id') ? 'claimed_auth_user_id' : 'NULL AS claimed_auth_user_id',
    ].join(', ');

    const lookups: Array<{ sql: string; value: string | null | undefined }> = [
      {
        sql: `SELECT ${identitySelect} FROM global_patient_identity WHERE uhid = ?`,
        value: row.uhid,
      },
      {
        sql: `SELECT ${identitySelect} FROM global_patient_identity WHERE national_id = ?`,
        value: nationalIdRow?.national_id,
      },
      {
        sql: `SELECT ${identitySelect} FROM global_patient_identity WHERE primary_phone = ?`,
        value: row.phone,
      },
      {
        sql: `SELECT ${identitySelect} FROM global_patient_identity WHERE primary_email = ?`,
        value: row.email,
      },
    ];

    for (const lookup of lookups) {
      if (!lookup.value) continue;
      const existing = await db.prepare(lookup.sql).bind(lookup.value).first<{
        id: number;
        uhid: string | null;
        claim_status: string | null;
        claimed_auth_user_id: number | null;
      }>();
      if (!existing) continue;

      identityId = Number(existing.id);
      resolvedUHID = existing.uhid ?? resolvedUHID;
      break;
    }

    if (!identityId) {
      if (row.uhid) {
        const insertColumns = [
          identityColumns.has('national_id') ? 'national_id' : null,
          'uhid',
          identityColumns.has('primary_name') ? 'primary_name' : null,
          identityColumns.has('primary_phone') ? 'primary_phone' : null,
          identityColumns.has('primary_email') ? 'primary_email' : null,
          identityColumns.has('claim_status') ? 'claim_status' : null,
          identityColumns.has('created_source') ? 'created_source' : null,
        ].filter(Boolean) as string[];
        const insertValues: Array<string | null> = [];
        for (const column of insertColumns) {
          switch (column) {
            case 'national_id':
              insertValues.push(nationalIdRow?.national_id ?? null);
              break;
            case 'uhid':
              insertValues.push(row.uhid);
              break;
            case 'primary_name':
              insertValues.push(row.name ?? null);
              break;
            case 'primary_phone':
              insertValues.push(row.phone ?? null);
              break;
            case 'primary_email':
              insertValues.push(row.email ?? null);
              break;
            case 'claim_status':
              insertValues.push('claimed');
              break;
            case 'created_source':
              insertValues.push('self_signup');
              break;
            default:
              insertValues.push(null);
              break;
          }
        }
        const insert = await db.prepare(`
          INSERT INTO global_patient_identity (${insertColumns.join(', ')})
          VALUES (${insertColumns.map(() => '?').join(', ')})
        `).bind(...insertValues).run();
        identityId = Number(insert.meta.last_row_id);
        resolvedUHID = row.uhid;
      } else {
        const created = await createGlobalIdentity(db, {
          nationalId: nationalIdRow?.national_id ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          name: row.name ?? null,
          source: 'self_signup',
        });
        identityId = created.id;
        resolvedUHID = created.uhid;
      }
    }

    await db.prepare(`
      UPDATE global_patient_auth
      SET identity_id = ?, uhid = COALESCE(uhid, ?), updated_at = datetime('now')
      WHERE id = ? AND is_active = 1
    `).bind(identityId, resolvedUHID, authUserId).run();
  }

  return {
    authUserId,
    identityId: Number(identityId),
    email: row.email ?? null,
    phone: row.phone ?? null,
    uhid: resolvedUHID ?? null,
    name: row.name ?? null,
  };
}

export async function getIdentitySnapshot(
  db: D1Database,
  identityId: number,
): Promise<{
  id: number;
  uhid: string | null;
  primary_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  claim_status: string | null;
}> {
  const row = await db.prepare(`
    SELECT id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status
    FROM global_patient_identity
    WHERE id = ?
  `).bind(identityId).first<{
    id: number;
    uhid: string | null;
    primary_name: string | null;
    primary_phone: string | null;
    primary_email: string | null;
    date_of_birth: string | null;
    gender: string | null;
    claim_status: string | null;
  }>();

  if (!row) {
    throw new HTTPException(404, { message: 'Family profile not found' });
  }

  return row;
}

export async function resolveActingPortalContext(
  db: D1Database,
  authUserId: number,
  requestedManagedIdentityId?: number | null,
): Promise<ActingPortalContext> {
  const auth = await getCurrentAuthIdentity(db, authUserId);

  if (!requestedManagedIdentityId || requestedManagedIdentityId === auth.identityId) {
    const identity = await getIdentitySnapshot(db, auth.identityId);
    return {
      auth,
      actingIdentityId: auth.identityId,
      actingIdentity: {
        id: identity.id,
        uhid: identity.uhid,
        primaryName: identity.primary_name,
        primaryPhone: identity.primary_phone,
        primaryEmail: identity.primary_email,
        claimStatus: identity.claim_status,
      },
      managed: false,
      relationship: null,
    };
  }

  const link = await db.prepare(`
    SELECT id, patient_identity_id, relationship, access_role, status
    FROM global_family_links
    WHERE manager_auth_user_id = ? AND patient_identity_id = ? AND status = 'active'
  `).bind(authUserId, requestedManagedIdentityId).first<{
    id: number;
    patient_identity_id: number;
    relationship: string | null;
    access_role: string | null;
    status: string | null;
  }>();

  if (!link || !isManagerAccessRole(link.access_role)) {
    throw new HTTPException(403, { message: 'You do not have access to manage this family member' });
  }

  const identity = await getIdentitySnapshot(db, requestedManagedIdentityId);
  return {
    auth,
    actingIdentityId: requestedManagedIdentityId,
    actingIdentity: {
      id: identity.id,
      uhid: identity.uhid,
      primaryName: identity.primary_name,
      primaryPhone: identity.primary_phone,
      primaryEmail: identity.primary_email,
      claimStatus: identity.claim_status,
    },
    managed: true,
    relationship: link.relationship ?? null,
  };
}

export async function listActiveFamilyManagers(
  db: D1Database,
  patientIdentityId: number,
): Promise<FamilyManagerLink[]> {
  const { results } = await db.prepare(`
    SELECT gfl.id, gfl.patient_identity_id, gfl.manager_auth_user_id, gfl.relationship, gfl.access_role,
           gfl.verification_basis, gfl.status, gfl.notes, gfl.created_at,
           gpa.name AS manager_name, gpa.email AS manager_email, gpa.phone AS manager_phone
    FROM global_family_links gfl
    LEFT JOIN global_patient_auth gpa ON gpa.id = gfl.manager_auth_user_id
    WHERE gfl.patient_identity_id = ? AND gfl.status = 'active'
    ORDER BY CASE WHEN gfl.access_role = 'primary_manager' THEN 0 ELSE 1 END, datetime(gfl.created_at) ASC
  `).bind(patientIdentityId).all<{
    id: number;
    patient_identity_id: number;
    manager_auth_user_id: number;
    relationship: string;
    access_role: string;
    verification_basis: string;
    status: string;
    notes: string | null;
    created_at: string;
    manager_name: string | null;
    manager_email: string | null;
    manager_phone: string | null;
  }>();

  return (results ?? []).map((row) => ({
    linkId: Number(row.id),
    patientIdentityId: Number(row.patient_identity_id),
    managerAuthUserId: Number(row.manager_auth_user_id),
    relationship: row.relationship,
    accessRole: (row.access_role === 'primary_manager' ? 'primary_manager' : 'manager'),
    verificationBasis: row.verification_basis,
    status: row.status,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    managerName: row.manager_name ?? null,
    managerEmail: row.manager_email ?? null,
    managerPhone: row.manager_phone ?? null,
  }));
}

export async function resolvePatientLinksForIdentity(
  db: D1Database,
  identity: { uhid: string | null; primaryPhone?: string | null; primaryEmail?: string | null },
): Promise<Array<{ tenantId: string; patientId: number; hospitalName: string }>> {
  const conditions: string[] = [];
  const bindings: string[] = [];

  if (identity.uhid) {
    conditions.push('p.uhid = ?');
    bindings.push(identity.uhid);
  }
  if (identity.primaryEmail) {
    conditions.push('p.email = ?');
    bindings.push(identity.primaryEmail);
  }
  if (identity.primaryPhone) {
    conditions.push('p.mobile = ?');
    bindings.push(identity.primaryPhone);
  }

  if (!conditions.length) return [];

  const { results } = await db.prepare(`
    SELECT t.id as tenant_id, t.name as hospital_name, p.id as patient_id
    FROM patients p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE ${conditions.map((c) => `(${c})`).join(' OR ')}
  `).bind(...bindings).all<{ tenant_id: string; hospital_name: string; patient_id: number }>();

  return (results ?? []).map((row) => ({
    tenantId: String(row.tenant_id),
    patientId: Number(row.patient_id),
    hospitalName: String(row.hospital_name),
  }));
}

export async function createManagedDependent(
  db: D1Database,
  input: {
    managerAuthUserId: number;
    name: string;
    relationship: FamilyRelationship;
    dateOfBirth?: string | null;
    gender?: string | null;
    phone?: string | null;
    nationalId?: string | null;
    notes?: string | null;
  },
): Promise<{
  identityId: number;
  uhid: string;
  accessRole: FamilyAccessRole;
}> {
  const allowsUnverifiedIdentifiers = input.relationship === 'child';
  if (!allowsUnverifiedIdentifiers && (input.phone || input.nationalId)) {
    throw new HTTPException(403, {
      message: 'Adult or caregiver-managed profiles cannot add phone or NID without linking an existing verified card.',
    });
  }

  const identity = await createGlobalIdentity(db, {
    nationalId: input.nationalId ?? null,
    name: input.name,
    phone: input.phone ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
    source: 'family_proxy',
  });

  const accessRole = await getNextManagerAccessRole(db, identity.id);

  await db.prepare(`
    INSERT INTO global_family_links (
      patient_identity_id, manager_auth_user_id, relationship, access_role,
      verification_basis, status, notes, created_by_auth_user_id
    ) VALUES (?, ?, ?, ?, 'dependent_created', 'active', ?, ?)
  `).bind(
    identity.id,
    input.managerAuthUserId,
    input.relationship,
    accessRole,
    input.notes ?? null,
    input.managerAuthUserId,
  ).run();

  return {
    identityId: identity.id,
    uhid: identity.uhid,
    accessRole,
  };
}

export async function verifyExistingIdentityLinkProof(
  db: D1Database,
  identityId: number,
  input: { claimCode?: string | null; phone?: string | null; nationalId?: string | null },
): Promise<'claim_code' | 'phone' | 'national_id'> {
  if (input.claimCode) {
    const codeHash = await sha256(input.claimCode);
    const claimRow = await db.prepare(`
      SELECT id, code_hash
      FROM patient_claim_codes
      WHERE identity_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
      LIMIT 1
    `).bind(identityId, codeHash).first<{ id: number; code_hash: string }>();

    if (claimRow) return 'claim_code';
  }

  const identity = await db.prepare(`
    SELECT primary_phone, national_id
    FROM global_patient_identity
    WHERE id = ?
  `).bind(identityId).first<{ primary_phone: string | null; national_id: string | null }>();

  if (!identity) {
    throw new HTTPException(404, { message: 'Family profile not found' });
  }

  if (input.phone && identity.primary_phone && input.phone === identity.primary_phone) {
    return 'phone';
  }

  if (input.nationalId && identity.national_id && input.nationalId === identity.national_id) {
    return 'national_id';
  }

  throw new HTTPException(403, { message: 'Family link verification failed' });
}

export async function linkExistingManagedProfile(
  db: D1Database,
  input: {
    managerAuthUserId: number;
    uhid: string;
    relationship: FamilyRelationship;
    claimCode?: string | null;
    phone?: string | null;
    nationalId?: string | null;
    notes?: string | null;
  },
): Promise<{ identityId: number; verificationBasis: string; accessRole: FamilyAccessRole }> {
  const identity = await db.prepare(`
    SELECT id, claim_status, claimed_auth_user_id
    FROM global_patient_identity
    WHERE uhid = ?
  `).bind(input.uhid).first<{
    id: number;
    claim_status: string | null;
    claimed_auth_user_id: number | null;
  }>();

  if (!identity) {
    throw new HTTPException(404, { message: 'Health card not found' });
  }

  if (identity.claim_status === 'claimed' && identity.claimed_auth_user_id) {
    throw new HTTPException(409, { message: 'This family member already has their own active account. Direct proxy invite is required later.' });
  }

  const verificationBasis = await verifyExistingIdentityLinkProof(db, identity.id, {
    claimCode: input.claimCode ?? null,
    phone: input.phone ?? null,
    nationalId: input.nationalId ?? null,
  });

  const accessRole = await getNextManagerAccessRole(db, identity.id);

  await db.prepare(`
    INSERT INTO global_family_links (
      patient_identity_id, manager_auth_user_id, relationship, access_role,
      verification_basis, status, notes, created_by_auth_user_id
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).bind(
    identity.id,
    input.managerAuthUserId,
    input.relationship,
    accessRole,
    verificationBasis,
    input.notes ?? null,
    input.managerAuthUserId,
  ).run();

  return {
    identityId: identity.id,
    verificationBasis,
    accessRole,
  };
}

export async function createFamilyProxyInvite(
  db: D1Database,
  input: {
    inviterAuthUserId: number;
    uhid: string;
    relationship: FamilyRelationship;
    notes?: string | null;
  },
): Promise<FamilyProxyInviteSummary> {
  const identity = await db.prepare(`
    SELECT id, claim_status, claimed_auth_user_id
    FROM global_patient_identity
    WHERE uhid = ?
  `).bind(input.uhid).first<{
    id: number;
    claim_status: string | null;
    claimed_auth_user_id: number | null;
  }>();

  if (!identity) {
    throw new HTTPException(404, { message: 'Health card not found' });
  }

  if (identity.claim_status !== 'claimed' || !identity.claimed_auth_user_id) {
    throw new HTTPException(409, { message: 'This profile can be linked directly. Proxy invite is only for claimed family accounts.' });
  }

  if (identity.claimed_auth_user_id === input.inviterAuthUserId) {
    throw new HTTPException(409, { message: 'You cannot send a family manager invite to your own account' });
  }

  const existingLink = await db.prepare(`
    SELECT id
    FROM global_family_links
    WHERE patient_identity_id = ? AND manager_auth_user_id = ? AND status = 'active'
    LIMIT 1
  `).bind(identity.id, input.inviterAuthUserId).first<{ id: number }>();

  if (existingLink?.id) {
    throw new HTTPException(409, { message: 'This family member is already linked to your account' });
  }

  const existingInvite = await db.prepare(`
    SELECT id, status
    FROM global_family_proxy_invites
    WHERE patient_identity_id = ? AND inviter_auth_user_id = ? AND invitee_auth_user_id = ?
      AND status = 'pending' AND expires_at > datetime('now')
    LIMIT 1
  `).bind(identity.id, input.inviterAuthUserId, identity.claimed_auth_user_id).first<{
    id: number;
    status: string;
  }>();

  if (existingInvite?.id) {
    throw new HTTPException(409, { message: 'A pending family access invite already exists for this account' });
  }

  const accessRole = await getNextManagerAccessRole(db, identity.id);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();

  const result = await db.prepare(`
    INSERT INTO global_family_proxy_invites (
      patient_identity_id, inviter_auth_user_id, invitee_auth_user_id, relationship,
      access_role, status, notes, expires_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    identity.id,
    input.inviterAuthUserId,
    identity.claimed_auth_user_id,
    input.relationship,
    accessRole,
    input.notes ?? null,
    expiresAt,
  ).run();

  return {
    id: Number(result.meta?.last_row_id ?? 0),
    patientIdentityId: identity.id,
    inviterAuthUserId: input.inviterAuthUserId,
    inviteeAuthUserId: identity.claimed_auth_user_id,
    relationship: input.relationship,
    accessRole,
    status: 'pending',
    notes: input.notes ?? null,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
}

export async function listFamilyProxyInvites(
  db: D1Database,
  authUserId: number,
): Promise<{
  incoming: Array<FamilyProxyInviteSummary & { patientName: string | null; patientUhid: string | null; inviterName: string | null }>;
  outgoing: Array<FamilyProxyInviteSummary & { patientName: string | null; patientUhid: string | null; inviteeName: string | null }>;
}> {
  const incomingResult = await db.prepare(`
    SELECT gfpi.id, gfpi.patient_identity_id, gfpi.inviter_auth_user_id, gfpi.invitee_auth_user_id,
           gfpi.relationship, gfpi.access_role, gfpi.status, gfpi.notes, gfpi.expires_at, gfpi.created_at,
           gpi.primary_name AS patient_name, gpi.uhid AS patient_uhid, inviter.name AS inviter_name
    FROM global_family_proxy_invites gfpi
    JOIN global_patient_identity gpi ON gpi.id = gfpi.patient_identity_id
    LEFT JOIN global_patient_auth inviter ON inviter.id = gfpi.inviter_auth_user_id
    WHERE gfpi.invitee_auth_user_id = ? AND gfpi.status = 'pending' AND gfpi.expires_at > datetime('now')
    ORDER BY datetime(gfpi.created_at) DESC
  `).bind(authUserId).all<{
    id: number;
    patient_identity_id: number;
    inviter_auth_user_id: number;
    invitee_auth_user_id: number;
    relationship: string;
    access_role: string;
    status: string;
    notes: string | null;
    expires_at: string;
    created_at: string;
    patient_name: string | null;
    patient_uhid: string | null;
    inviter_name: string | null;
  }>();

  const outgoingResult = await db.prepare(`
    SELECT gfpi.id, gfpi.patient_identity_id, gfpi.inviter_auth_user_id, gfpi.invitee_auth_user_id,
           gfpi.relationship, gfpi.access_role, gfpi.status, gfpi.notes, gfpi.expires_at, gfpi.created_at,
           gpi.primary_name AS patient_name, gpi.uhid AS patient_uhid, invitee.name AS invitee_name
    FROM global_family_proxy_invites gfpi
    JOIN global_patient_identity gpi ON gpi.id = gfpi.patient_identity_id
    LEFT JOIN global_patient_auth invitee ON invitee.id = gfpi.invitee_auth_user_id
    WHERE gfpi.inviter_auth_user_id = ? AND gfpi.status = 'pending' AND gfpi.expires_at > datetime('now')
    ORDER BY datetime(gfpi.created_at) DESC
  `).bind(authUserId).all<{
    id: number;
    patient_identity_id: number;
    inviter_auth_user_id: number;
    invitee_auth_user_id: number;
    relationship: string;
    access_role: string;
    status: string;
    notes: string | null;
    expires_at: string;
    created_at: string;
    patient_name: string | null;
    patient_uhid: string | null;
    invitee_name: string | null;
  }>();

  return {
    incoming: (incomingResult.results ?? []).map((row) => ({
      id: Number(row.id),
      patientIdentityId: Number(row.patient_identity_id),
      inviterAuthUserId: Number(row.inviter_auth_user_id),
      inviteeAuthUserId: Number(row.invitee_auth_user_id),
      relationship: row.relationship,
      accessRole: row.access_role === 'primary_manager' ? 'primary_manager' : 'manager',
      status: row.status,
      notes: row.notes ?? null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      patientName: row.patient_name ?? null,
      patientUhid: row.patient_uhid ?? null,
      inviterName: row.inviter_name ?? null,
    })),
    outgoing: (outgoingResult.results ?? []).map((row) => ({
      id: Number(row.id),
      patientIdentityId: Number(row.patient_identity_id),
      inviterAuthUserId: Number(row.inviter_auth_user_id),
      inviteeAuthUserId: Number(row.invitee_auth_user_id),
      relationship: row.relationship,
      accessRole: row.access_role === 'primary_manager' ? 'primary_manager' : 'manager',
      status: row.status,
      notes: row.notes ?? null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      patientName: row.patient_name ?? null,
      patientUhid: row.patient_uhid ?? null,
      inviteeName: row.invitee_name ?? null,
    })),
  };
}

export async function respondToFamilyProxyInvite(
  db: D1Database,
  input: {
    inviteId: number;
    inviteeAuthUserId: number;
    action: 'accept' | 'decline';
  },
): Promise<{ accepted: boolean; link?: { patientIdentityId: number; managerAuthUserId: number; accessRole: FamilyAccessRole } }> {
  const invite = await db.prepare(`
    SELECT gfpi.id, gfpi.patient_identity_id, gfpi.inviter_auth_user_id, gfpi.invitee_auth_user_id,
           gfpi.relationship, gfpi.access_role, gfpi.status, gfpi.expires_at
    FROM global_family_proxy_invites gfpi
    WHERE gfpi.id = ?
  `).bind(input.inviteId).first<{
    id: number;
    patient_identity_id: number;
    inviter_auth_user_id: number;
    invitee_auth_user_id: number;
    relationship: string;
    access_role: string;
    status: string;
    expires_at: string;
  }>();

  if (!invite || invite.invitee_auth_user_id !== input.inviteeAuthUserId) {
    throw new HTTPException(404, { message: 'Family access invite not found' });
  }

  if (invite.status !== 'pending') {
    throw new HTTPException(409, { message: 'This family access invite is no longer pending' });
  }

  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new HTTPException(409, { message: 'This family access invite has expired' });
  }

  if (input.action === 'decline') {
    await db.prepare(`
      UPDATE global_family_proxy_invites
      SET status = 'declined', declined_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(input.inviteId).run();
    return { accepted: false };
  }

  const existingLink = await db.prepare(`
    SELECT id
    FROM global_family_links
    WHERE patient_identity_id = ? AND manager_auth_user_id = ? AND status = 'active'
    LIMIT 1
  `).bind(invite.patient_identity_id, invite.inviter_auth_user_id).first<{ id: number }>();

  if (existingLink?.id) {
    throw new HTTPException(409, { message: 'This family manager link already exists' });
  }

  const accessRole = await getNextManagerAccessRole(db, invite.patient_identity_id);

  await db.prepare(`
    INSERT INTO global_family_links (
      patient_identity_id, manager_auth_user_id, relationship, access_role,
      verification_basis, status, notes, created_by_auth_user_id
    ) VALUES (?, ?, ?, ?, 'invite_accept', 'active', ?, ?)
  `).bind(
    invite.patient_identity_id,
    invite.inviter_auth_user_id,
    invite.relationship,
    accessRole,
    'Accepted by claimed family account',
    input.inviteeAuthUserId,
  ).run();

  await db.prepare(`
    UPDATE global_family_proxy_invites
    SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(input.inviteId).run();

  return {
    accepted: true,
    link: {
      patientIdentityId: invite.patient_identity_id,
      managerAuthUserId: invite.inviter_auth_user_id,
      accessRole,
    },
  };
}

export async function transferPrimaryFamilyManager(
  db: D1Database,
  input: {
    currentManagerAuthUserId: number;
    targetLinkId: number;
  },
): Promise<{ patientIdentityId: number; primaryManagerLinkId: number }> {
  const targetLink = await db.prepare(`
    SELECT target_link.id, target_link.patient_identity_id, target_link.manager_auth_user_id,
           target_link.access_role, target_link.status
    FROM global_family_links target_link
    WHERE target_link.id = ?
  `).bind(input.targetLinkId).first<{
    id: number;
    patient_identity_id: number;
    manager_auth_user_id: number;
    access_role: string;
    status: string;
  }>();

  if (!targetLink || targetLink.status !== 'active') {
    throw new HTTPException(404, { message: 'Active target family manager link not found' });
  }

  const currentLink = await db.prepare(`
    SELECT current_link.id, current_link.patient_identity_id, current_link.manager_auth_user_id,
           current_link.access_role, current_link.status
    FROM global_family_links current_link
    WHERE current_link.patient_identity_id = ? AND current_link.manager_auth_user_id = ? AND current_link.status = 'active'
    LIMIT 1
  `).bind(targetLink.patient_identity_id, input.currentManagerAuthUserId).first<{
    id: number;
    patient_identity_id: number;
    manager_auth_user_id: number;
    access_role: string;
    status: string;
  }>();

  if (!currentLink || currentLink.access_role !== 'primary_manager') {
    throw new HTTPException(403, { message: 'Only the current primary manager can transfer primary access' });
  }

  await db.prepare(`
    UPDATE global_family_links
    SET access_role = CASE
      WHEN id = ? THEN 'primary_manager'
      WHEN id = ? THEN 'manager'
      ELSE access_role
    END,
    updated_at = datetime('now')
    WHERE patient_identity_id = ? AND id IN (?, ?)
  `).bind(
    targetLink.id,
    currentLink.id,
    targetLink.patient_identity_id,
    targetLink.id,
    currentLink.id,
  ).run();

  return {
    patientIdentityId: targetLink.patient_identity_id,
    primaryManagerLinkId: targetLink.id,
  };
}

export async function revokeFamilyManagerLink(
  db: D1Database,
  input: {
    linkId: number;
    actingAuthUserId: number;
  },
): Promise<{ revoked: true; promotedLinkId: number | null }> {
  const link = await db.prepare(`
    SELECT id, patient_identity_id, manager_auth_user_id, access_role, status
    FROM global_family_links
    WHERE id = ? AND status = 'active'
    LIMIT 1
  `).bind(input.linkId).first<{
    id: number;
    patient_identity_id: number;
    manager_auth_user_id: number;
    access_role: string;
    status: string;
  }>();

  if (!link) {
    throw new HTTPException(404, { message: 'Active family link not found' });
  }

  const actingLink = await db.prepare(`
    SELECT id, access_role
    FROM global_family_links
    WHERE patient_identity_id = ? AND manager_auth_user_id = ? AND status = 'active'
    LIMIT 1
  `).bind(link.patient_identity_id, input.actingAuthUserId).first<{
    id: number;
    access_role: string;
  }>();

  const selfRevocation = link.manager_auth_user_id === input.actingAuthUserId;
  const primaryControl = actingLink?.access_role === 'primary_manager';

  if (!selfRevocation && !primaryControl) {
    throw new HTTPException(403, { message: 'Only the primary manager can revoke another manager' });
  }

  await db.prepare(`
    UPDATE global_family_links
    SET status = 'revoked', revoked_at = datetime('now'), revoked_by_auth_user_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(input.actingAuthUserId, link.id).run();

  let promotedLinkId: number | null = null;
  if (link.access_role === 'primary_manager') {
    const candidate = await db.prepare(`
      SELECT id
      FROM global_family_links
      WHERE patient_identity_id = ? AND status = 'active'
      ORDER BY datetime(created_at) ASC
      LIMIT 1
    `).bind(link.patient_identity_id).first<{ id: number }>();

    if (candidate?.id) {
      await db.prepare(`
        UPDATE global_family_links
        SET access_role = 'primary_manager', updated_at = datetime('now')
        WHERE id = ?
      `).bind(candidate.id).run();
      promotedLinkId = candidate.id;
    }
  }

  return { revoked: true, promotedLinkId };
}
