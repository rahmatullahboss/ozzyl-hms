import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/BillingMasterPage.tsx', 'utf8');

describe('Billing Master performer payout rule controls', () => {
  it('provides diagnostic-only fixed and percentage performer reserve setup', () => {
    expect(source).toContain('performer_payout_enabled');
    expect(source).toContain('performer_rate_type');
    expect(source).toContain("'flat' as 'flat' | 'percent'");
    expect(source).toContain('performer_flat_amount');
    expect(source).toContain('performer_percent');
    expect(source).toContain('performer_effective_from');
    expect(source).toContain('performer-payout-rule');
    expect(source).toContain('Performer Payout Rule');
    expect(source).toContain("department_code === 'LAB'");
    expect(source).toContain("department_code === 'RAD'");
  });

  it('shows the reserved amount and remaining commission base preview', () => {
    expect(source).toContain('performerReservePreview');
    expect(source).toContain('Remaining commission base');
    expect(source).toContain('Performer reserve');
  });

  it('does not create a duplicate rule version when only the service item is edited', () => {
    expect(source).toContain('loadedPerformerRule');
    expect(source).toContain('samePerformerRuleConfiguration');
    expect(source).toContain('const performerRuleChanged =');
    expect(source).toContain('loadedPerformerRule?.diagnostic_kind !== selectedDiagnosticKind');
    expect(source).toContain('if (isDiagnosticDepartment && performerRuleChanged)');
  });

  it('uses the latest configured version and defaults changes to the next valid effective date', () => {
    expect(source).toContain('history: PerformerPayoutRule[]');
    expect(source).toContain('rule.history?.[0] ?? rule.current');
    expect(source).toContain('nextCalendarDate');
    expect(source).toContain('minimumPerformerRuleEffectiveDate');
  });

  it('shows and persists linked lab commission eligibility in the service item modal', () => {
    expect(source).toContain('is_commissionable: true');
    expect(source).toContain('item.is_commissionable');
    expect(source).toContain("t('master.serviceItems.commissionEligibility')");
    expect(source).toContain("t('master.serviceItems.commissionEligibilityNo')");
    expect(source).toContain('is_commissionable: selectedDepartment?.department_code === \'LAB\'');
  });
});
