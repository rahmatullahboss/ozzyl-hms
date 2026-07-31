import { describe, expect, it } from 'vitest';
import { buildPrintableHealthCardHtml } from './printableHealthCard';

describe('buildPrintableHealthCardHtml', () => {
  it('renders blood group, global UHID, and tenant MRN without relying on clipped content', () => {
    const html = buildPrintableHealthCardHtml({
      name: 'Sokina Begum',
      age: 27,
      gender: 'female',
      mobile: '01718128478',
      address: 'DKP Road, Bogura',
      bloodGroup: 'AB+',
      patientCode: 'P-000041',
      uhid: 'OZ-8F4K-92Q7',
      qrSvg: '<svg data-testid="qr"></svg>',
      issuedAt: new Date('2026-04-30T00:00:00.000Z'),
    });

    expect(html).toContain('AB+');
    expect(html).toContain('Global ID');
    expect(html).toContain('OZ-8F4K-92Q7');
    expect(html).toContain('Hospital MRN');
    expect(html).toContain('P-000041');
    expect(html).toContain('data-testid="qr"');
    expect(html).toContain('overflow:visible');
    expect(html).toContain('break-word');
    expect(html).not.toContain('overflow:hidden');
  });

  it('escapes patient supplied fields before writing printable markup', () => {
    const html = buildPrintableHealthCardHtml({
      name: '<img src=x onerror=alert(1)>',
      mobile: '01718128478',
      address: '<script>alert(1)</script>',
      patientCode: 'P-000041',
      uhid: 'OZ-8F4K-92Q7',
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
