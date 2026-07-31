import { describe, expect, it } from 'vitest';
import { buildHospitalInfo, flattenSettingsPayload } from '../../src/routes/tenant/settings';

describe('tenant settings hospital profile helpers', () => {
  it('round-trips the full admin blueprint hospital profile fields', () => {
    const payload = flattenSettingsPayload({
      hospital_info: {
        name: 'City Care Hospital',
        short_name: 'CCH',
        address: 'Dhaka',
        phone: '01700000000',
        email: 'info@citycare.test',
        website: 'https://citycare.test',
        registration_number: 'LIC-123',
        bin_tin: 'TIN-456',
        tagline: 'Care with trust',
        footer_text: 'Thank you',
      },
    });

    expect(payload).toMatchObject({
      hospital_name: 'City Care Hospital',
      hospital_short_name: 'CCH',
      hospital_address: 'Dhaka',
      hospital_phone: '01700000000',
      hospital_email: 'info@citycare.test',
      hospital_website: 'https://citycare.test',
      hospital_registration_number: 'LIC-123',
      hospital_bin_tin: 'TIN-456',
      hospital_tagline: 'Care with trust',
      hospital_footer_text: 'Thank you',
    });

    expect(buildHospitalInfo(payload as Record<string, string>)).toEqual({
      name: 'City Care Hospital',
      short_name: 'CCH',
      address: 'Dhaka',
      phone: '01700000000',
      email: 'info@citycare.test',
      website: 'https://citycare.test',
      registration_number: 'LIC-123',
      bin_tin: 'TIN-456',
      tagline: 'Care with trust',
      footer_text: 'Thank you',
    });
  });
});
