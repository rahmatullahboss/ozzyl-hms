import { describe, expect, it } from 'vitest';
import { buildProfitDistributionDeclaredLines, type ResolvedAccountMappings } from '../src/lib/accounting-posting';

describe('shareholder dividend declaration accounting', () => {
  const mappings: ResolvedAccountMappings = {
    retained_earnings: 1,
    shareholder_payable: 2,
    withholding_payable: 3,
  };

  it('posts gross dividend, net shareholder payable, and withholding payable', () => {
    expect(buildProfitDistributionDeclaredLines({ amount: 1000, withheldAmount: 100, netPayable: 900 }, mappings)).toEqual([
      { accountId: 1, debit: 1000, credit: 0, memo: 'Declare gross shareholder dividend from retained earnings' },
      { accountId: 2, debit: 0, credit: 900, memo: 'Shareholder dividend payable net of withholding' },
      { accountId: 3, debit: 0, credit: 100, memo: 'Dividend withholding payable' },
    ]);
  });

  it('does not require withholding mapping when no amount is withheld', () => {
    expect(buildProfitDistributionDeclaredLines({ amount: 1000, withheldAmount: 0 }, {
      retained_earnings: 1,
      shareholder_payable: 2,
    })).toEqual([
      { accountId: 1, debit: 1000, credit: 0, memo: 'Declare gross shareholder dividend from retained earnings' },
      { accountId: 2, debit: 0, credit: 1000, memo: 'Shareholder dividend payable net of withholding' },
    ]);
  });
});
