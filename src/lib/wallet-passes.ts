import type { Env } from '../types';

type WalletActingProfile = {
  identity_id: number;
  name: string;
  managed: boolean;
  relationship: string | null;
};

export type VisitPassWalletSnapshot = {
  kind: 'visit_pass';
  pass_code: string;
  expires_at: string;
  scope: string;
  qrcode_value: string;
  uhid: string | null;
  patient_name: string;
  acting_profile?: WalletActingProfile;
  hospitals: Array<{ hospital_name: string; tenant_id: string; patient_id: number }>;
};

export type EmergencyPackWalletSnapshot = {
  kind: 'emergency_pack';
  public_url: string;
  expires_at: string;
  source_hospital: string;
  patient_name: string;
  uhid: string | null;
  blood_group: string | null;
  profile: {
    patient: {
      name: string;
      age: number | null;
      gender: string | null;
      blood_group: string | null;
      uhid: string | null;
    };
    allergies: Array<{ allergen: string; severity: string | null; reaction: string | null }>;
    current_medications: Array<{ medication_name: string; generic_name: string | null }>;
    active_conditions: Array<{ description: string }>;
    emergency_contacts: Array<{ name: string; relationship: string; phone: string }>;
  };
  acting_profile?: WalletActingProfile;
};

type WalletSnapshot = VisitPassWalletSnapshot | EmergencyPackWalletSnapshot;

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', utf8ToBytes(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function normalizeObjectIdSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function pemToDerBytes(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  return base64UrlToBytes(cleaned.replace(/\+/g, '-').replace(/\//g, '_'));
}

async function createGoogleWalletSaveUrl(
  env: Env,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (!env.GOOGLE_WALLET_ISSUER_ID || !env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_WALLET_PRIVATE_KEY) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDerBytes(env.GOOGLE_WALLET_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const header = bytesToBase64Url(utf8ToBytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = bytesToBase64Url(utf8ToBytes(JSON.stringify({
    iss: env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    payload,
  })));
  const message = `${header}.${body}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8ToBytes(message));

  return `https://pay.google.com/gp/v/save/${message}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function buildApplePassSource(
  env: Env,
  passJson: Record<string, unknown>,
  downloadName: string,
  note: string,
) {
  if (!env.APPLE_WALLET_PASS_TYPE_ID || !env.APPLE_WALLET_TEAM_ID) {
    return {
      status: 'unavailable' as const,
      signing_required: true,
      note: 'Apple Wallet export needs pass type and team identifiers before a pass source can be prepared.',
    };
  }

  return {
    status: 'source_only' as const,
    signing_required: true,
    pass_json: passJson,
    download_name: downloadName,
    note,
  };
}

export async function encryptWalletSnapshot(secret: string, snapshot: WalletSnapshot): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8ToBytes(JSON.stringify(snapshot)),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptWalletSnapshot<T extends WalletSnapshot>(secret: string, encrypted: string): Promise<T> {
  const [ivPart, cipherPart] = encrypted.split('.');
  if (!ivPart || !cipherPart) {
    throw new Error('Invalid wallet snapshot payload');
  }
  const key = await deriveAesKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(ivPart) },
    key,
    base64UrlToBytes(cipherPart),
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plain))) as T;
}

export async function buildVisitPassWalletExport(
  env: Env,
  snapshot: VisitPassWalletSnapshot,
) {
  const googleIssuerId = env.GOOGLE_WALLET_ISSUER_ID;
  const classId = googleIssuerId ? `${googleIssuerId}.ozzyl_visit_pass` : null;
  const objectId = googleIssuerId
    ? `${googleIssuerId}.${normalizeObjectIdSegment(`visit-pass-${snapshot.uhid ?? 'unknown'}-${snapshot.pass_code}`)}`
    : null;

  const googlePayload = classId && objectId ? {
    genericClasses: [{
      id: classId,
      issuerName: 'Ozzyl Health',
      reviewStatus: 'UNDER_REVIEW',
    }],
    genericObjects: [{
      id: objectId,
      classId,
      state: 'ACTIVE',
      cardTitle: { defaultValue: { language: 'en-US', value: 'Ozzyl Visit Pass' } },
      header: { defaultValue: { language: 'en-US', value: snapshot.patient_name } },
      subheader: { defaultValue: { language: 'en-US', value: snapshot.uhid ?? 'Patient card holder' } },
      barcode: {
        type: 'QR_CODE',
        value: snapshot.qrcode_value,
        alternateText: snapshot.pass_code,
      },
      hexBackgroundColor: '#0f766e',
      textModulesData: [
        { id: 'scope', header: 'Scope', body: snapshot.scope },
        { id: 'expires', header: 'Valid until', body: new Date(snapshot.expires_at).toLocaleString('en-BD') },
        { id: 'hospitals', header: 'Linked hospitals', body: snapshot.hospitals.map((item) => item.hospital_name).join(', ') || 'Linked Ozzyl hospitals' },
      ],
    }],
  } : null;

  const googleSaveUrl = googlePayload ? await createGoogleWalletSaveUrl(env, googlePayload) : null;

  const applePassJson = {
    description: 'Ozzyl Visit Pass',
    formatVersion: 1,
    organizationName: 'Ozzyl Health',
    passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_ID ?? 'pass.com.ozzyl.unconfigured',
    serialNumber: `visit-pass-${snapshot.pass_code}`,
    teamIdentifier: env.APPLE_WALLET_TEAM_ID ?? 'UNCONFIGURED',
    logoText: 'Ozzyl Health',
    backgroundColor: 'rgb(15, 118, 110)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(226, 232, 240)',
    sharingProhibited: true,
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: snapshot.qrcode_value,
      messageEncoding: 'iso-8859-1',
      altText: snapshot.pass_code,
    }],
    generic: {
      primaryFields: [{ key: 'patient', label: 'Patient', value: snapshot.patient_name }],
      secondaryFields: [{ key: 'uhid', label: 'UHID', value: snapshot.uhid ?? 'Not linked' }],
      auxiliaryFields: [{ key: 'pass_code', label: 'Visit Pass', value: snapshot.pass_code }],
      backFields: [
        { key: 'expires', label: 'Valid until', value: new Date(snapshot.expires_at).toLocaleString('en-BD') },
        { key: 'scope', label: 'Scope', value: snapshot.scope },
        { key: 'hospitals', label: 'Linked hospitals', value: snapshot.hospitals.map((item) => item.hospital_name).join(', ') || 'Linked Ozzyl hospitals' },
      ],
    },
  };

  return {
    google_wallet: googleSaveUrl ? {
      status: 'ready' as const,
      save_url: googleSaveUrl,
      class_id: classId,
      object_id: objectId,
      note: 'This pass can be saved in Google Wallet and shown at the hospital desk.',
    } : {
      status: 'unavailable' as const,
      note: 'Google Wallet export needs issuer credentials before a save link can be generated.',
    },
    apple_wallet: buildApplePassSource(
      env,
      applePassJson,
      `ozzyl-visit-pass-${snapshot.pass_code}.pass-source.json`,
      'Apple Wallet needs a signed .pkpass certificate chain. This source bundle is ready for signing once certificates are configured.',
    ),
  };
}

export async function buildEmergencyPackWalletExport(
  env: Env,
  snapshot: EmergencyPackWalletSnapshot,
) {
  const googleIssuerId = env.GOOGLE_WALLET_ISSUER_ID;
  const classId = googleIssuerId ? `${googleIssuerId}.ozzyl_emergency_pack` : null;
  const objectId = googleIssuerId
    ? `${googleIssuerId}.${normalizeObjectIdSegment(`emergency-${snapshot.uhid ?? snapshot.patient_name}-${snapshot.expires_at}`)}`
    : null;

  const allergies = snapshot.profile.allergies.slice(0, 3).map((item) => `${item.allergen}${item.severity ? ` (${item.severity})` : ''}`).join(', ') || 'No major allergies listed';
  const meds = snapshot.profile.current_medications.slice(0, 3).map((item) => item.medication_name).join(', ') || 'No active medicines listed';

  const googlePayload = classId && objectId ? {
    genericClasses: [{
      id: classId,
      issuerName: 'Ozzyl Health',
      reviewStatus: 'UNDER_REVIEW',
    }],
    genericObjects: [{
      id: objectId,
      classId,
      state: 'ACTIVE',
      cardTitle: { defaultValue: { language: 'en-US', value: 'Ozzyl Emergency Pack' } },
      header: { defaultValue: { language: 'en-US', value: snapshot.patient_name } },
      subheader: { defaultValue: { language: 'en-US', value: snapshot.blood_group ? `Blood group ${snapshot.blood_group}` : 'Emergency profile' } },
      barcode: {
        type: 'QR_CODE',
        value: snapshot.public_url,
        alternateText: snapshot.uhid ?? 'Emergency pack',
      },
      hexBackgroundColor: '#991b1b',
      textModulesData: [
        { id: 'allergies', header: 'Major allergies', body: allergies },
        { id: 'meds', header: 'Current medicines', body: meds },
        { id: 'source', header: 'Source hospital', body: snapshot.source_hospital },
      ],
    }],
  } : null;

  const googleSaveUrl = googlePayload ? await createGoogleWalletSaveUrl(env, googlePayload) : null;

  const applePassJson = {
    description: 'Ozzyl Emergency Pack',
    formatVersion: 1,
    organizationName: 'Ozzyl Health',
    passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_ID ?? 'pass.com.ozzyl.unconfigured',
    serialNumber: `emergency-${snapshot.uhid ?? normalizeObjectIdSegment(snapshot.patient_name)}`,
    teamIdentifier: env.APPLE_WALLET_TEAM_ID ?? 'UNCONFIGURED',
    logoText: 'Ozzyl Emergency',
    backgroundColor: 'rgb(127, 29, 29)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(254, 226, 226)',
    sharingProhibited: true,
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: snapshot.public_url,
      messageEncoding: 'iso-8859-1',
      altText: snapshot.uhid ?? 'Emergency pack',
    }],
    generic: {
      primaryFields: [{ key: 'patient', label: 'Patient', value: snapshot.patient_name }],
      secondaryFields: [{ key: 'blood_group', label: 'Blood group', value: snapshot.blood_group ?? 'Unknown' }],
      auxiliaryFields: [{ key: 'uhid', label: 'UHID', value: snapshot.uhid ?? 'Unavailable' }],
      backFields: [
        { key: 'source_hospital', label: 'Source hospital', value: snapshot.source_hospital },
        { key: 'allergies', label: 'Major allergies', value: allergies },
        { key: 'medications', label: 'Current medicines', value: meds },
        { key: 'contacts', label: 'Emergency contacts', value: snapshot.profile.emergency_contacts.map((item) => `${item.name} (${item.relationship}) ${item.phone}`).join('; ') || 'No emergency contact listed' },
      ],
    },
  };

  return {
    google_wallet: googleSaveUrl ? {
      status: 'ready' as const,
      save_url: googleSaveUrl,
      class_id: classId,
      object_id: objectId,
      note: 'This emergency pass can be saved in Google Wallet for lockscreen-ready access.',
    } : {
      status: 'unavailable' as const,
      note: 'Google Wallet export needs issuer credentials before a save link can be generated.',
    },
    apple_wallet: buildApplePassSource(
      env,
      applePassJson,
      `ozzyl-emergency-pack-${snapshot.uhid ?? 'patient'}.pass-source.json`,
      'Apple Wallet needs a signed .pkpass certificate chain. This source bundle is ready for signing once certificates are configured.',
    ),
  };
}
