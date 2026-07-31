import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('billing master scheme member contracts', () => {
  it('keeps scheme member management endpoints available for benefit schemes', () => {
    const source = readFileSync('src/routes/tenant/billingMaster.ts', 'utf8');

    expect(source).toContain("billingMaster.get('/schemes/:schemeId/members'");
    expect(source).toContain("billingMaster.post('/schemes/:schemeId/members'");
    expect(source).toContain("billingMaster.put('/scheme-members/:id'");
    expect(source).toContain("billingMaster.delete('/scheme-members/:id'");
    expect(source).toContain('createSchemeMemberSchema');
    expect(source).toContain('updateSchemeMemberSchema');
  });

  it('keeps eligibility tied to active dated member codes and matched member metadata', () => {
    const source = readFileSync('src/lib/billing-scheme-eligibility.ts', 'utf8');

    expect(source).toContain('JOIN billing_scheme_members m');
    expect(source).toContain("LOWER(COALESCE(m.member_code, '')) = ?");
    expect(source).toContain("COALESCE(m.status, 'active') = 'active'");
    expect(source).toContain('matched_member_id: matchedMember?.id ?? null');
    expect(source).toContain("matched_member_code: matchedMember?.member_code ?? input.memberCode?.trim() ?? null");
    expect(source).toContain('matched_member_name: matchedMember?.member_name ?? null');
  });
});
