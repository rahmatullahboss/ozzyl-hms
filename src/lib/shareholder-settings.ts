type SettingValue = string | number | boolean | undefined;

export type ShareholderSettingsRecord = Record<string, SettingValue>;

const LEGACY_SHAREHOLDER_KEY_MAP = {
  share_price: 'share_value_per_share',
  total_shares: 'max_total_shares',
  profit_partner_count: 'max_investor_shares',
  owner_partner_count: 'max_owner_shares',
} as const;

export function normalizeShareholderSettings<T extends ShareholderSettingsRecord>(settings: T): T & ShareholderSettingsRecord {
  const normalized: ShareholderSettingsRecord = { ...settings };

  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_SHAREHOLDER_KEY_MAP)) {
    const legacyValue = settings[legacyKey];
    if (legacyValue === undefined) continue;

    if (normalized[canonicalKey] === undefined) {
      normalized[canonicalKey] = legacyValue;
    }
  }

  return normalized as T & ShareholderSettingsRecord;
}
