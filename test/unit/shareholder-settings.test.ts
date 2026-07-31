import { describe, expect, it } from 'vitest';
import { normalizeShareholderSettings } from '../../src/lib/shareholder-settings';

describe('shareholder settings normalization', () => {
  it('maps legacy UI keys to the canonical shareholder settings keys', () => {
    expect(
      normalizeShareholderSettings({
        share_price: '100000',
        total_shares: '300',
        profit_partner_count: '100',
        owner_partner_count: '200',
        profit_percentage: '30',
      }),
    ).toMatchObject({
      share_price: '100000',
      share_value_per_share: '100000',
      total_shares: '300',
      max_total_shares: '300',
      profit_partner_count: '100',
      max_investor_shares: '100',
      owner_partner_count: '200',
      max_owner_shares: '200',
      profit_percentage: '30',
    });
  });

  it('preserves explicit canonical values when they are already present', () => {
    expect(
      normalizeShareholderSettings({
        share_price: '100000',
        share_value_per_share: '120000',
        total_shares: '300',
        max_total_shares: '250',
      }),
    ).toMatchObject({
      share_price: '100000',
      share_value_per_share: '120000',
      total_shares: '300',
      max_total_shares: '250',
    });
  });
});
