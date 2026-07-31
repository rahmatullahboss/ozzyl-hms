import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('billing master scheme cap fields', () => {
  it('wires monthly and yearly cap fields through scheme form payload', () => {
    const source = readFileSync('src/pages/BillingMasterPage.tsx', 'utf8');
    expect(source).toContain('max_discount_amount_per_month');
    expect(source).toContain('max_discount_amount_per_year');
    expect(source).toContain('Max discount per month');
    expect(source).toContain('Max discount per year');
    expect(source).toContain('parseFloat(form.max_discount_amount_per_month) || 0');
    expect(source).toContain('parseFloat(form.max_discount_amount_per_year) || 0');
  });

  it('shows bill monthly and yearly caps in the scheme list', () => {
    const source = readFileSync('src/pages/BillingMasterPage.tsx', 'utf8');
    expect(source).toContain('<th>Caps</th>');
    expect(source).toContain('SkeletonRows cols={7}');
    expect(source).toContain('colSpan={7}');
    expect(source).toContain('Bill ৳{Number(s.max_discount_amount_per_bill ?? 0)}');
    expect(source).toContain('Month ৳{Number(s.max_discount_amount_per_month ?? 0)}');
    expect(source).toContain('Year ৳{Number(s.max_discount_amount_per_year ?? 0)}');
  });

  it('wires scheme member management into the scheme list', () => {
    const source = readFileSync('src/pages/BillingMasterPage.tsx', 'utf8');
    expect(source).toContain('interface SchemeMember');
    expect(source).toContain("['billing-master', 'scheme-members'");
    expect(source).toContain("'/api/billing-master/schemes/' + (memberScheme?.id ?? 0) + '/members'");
    expect(source).toContain('setMemberScheme(s)');
    expect(source).toContain('Scheme members —');
    expect(source).toContain('saveMemberMutation.mutate');
    expect(source).toContain("'/api/billing-master/schemes/' + String(vars.schemeId) + '/members'");
    expect(source).toContain("'/api/billing-master/scheme-members/' + String(vars.memberId)");
    expect(source).toContain("'/api/billing-master/scheme-members/' + id");
    expect(source).toContain('editMember(member)');
    expect(source).toContain('deleteMemberMutation.mutate(member.id)');
    expect(source).toContain('Cancel edit');
    expect(source).toContain('Update member');
  });
});
