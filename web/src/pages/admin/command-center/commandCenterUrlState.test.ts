import { describe, expect, it } from 'vitest';
import {
  COMMAND_CENTER_TABS,
  closeCommandCenterInvoice,
  openCommandCenterDoctor,
  openCommandCenterInvoice,
  parseCommandCenterUrlState,
  parsePositiveCommandCenterId,
  updateCommandCenterUrl,
} from './commandCenterUrlState';

const today = '2026-07-27';

describe('command center URL state', () => {
  it.each([
    ['17', 17],
    ['0', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['abc', undefined],
    [null, undefined],
  ] as const)('normalizes command-center identity %s', (value, expected) => {
    expect(parsePositiveCommandCenterId(value)).toBe(expected);
  });

  it('resolves an empty query to Overview and Today', () => {
    expect(parseCommandCenterUrlState(new URLSearchParams(), today)).toEqual({
      tab: 'overview',
      filters: {
        preset: 'today',
        startDate: today,
        endDate: today,
      },
    });
  });

  it.each(COMMAND_CENTER_TABS)('supports the %s workspace', (tab) => {
    const state = parseCommandCenterUrlState(new URLSearchParams({ tab }), today);
    expect(state.tab).toBe(tab);
  });

  it('parses a valid custom period', () => {
    expect(parseCommandCenterUrlState(new URLSearchParams({
      range: 'custom',
      from: '2026-07-01',
      to: '2026-07-20',
    }), today).filters).toEqual({
      preset: 'custom',
      startDate: '2026-07-01',
      endDate: '2026-07-20',
    });
  });

  it('falls back to Today for an invalid date pair', () => {
    expect(parseCommandCenterUrlState(new URLSearchParams({
      range: 'custom',
      from: '2026-07-31',
      to: '2026-07-01',
    }), today).filters).toEqual({
      preset: 'today',
      startDate: today,
      endDate: today,
    });
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects invalid identity %s', (value) => {
    const state = parseCommandCenterUrlState(new URLSearchParams({
      doctorId: value,
      testId: value,
      invoiceId: value,
    }), today);
    expect(state.doctorId).toBeUndefined();
    expect(state.testId).toBeUndefined();
    expect(state.invoiceId).toBeUndefined();
  });

  it('parses valid drill identities, age bucket, and date basis', () => {
    expect(parseCommandCenterUrlState(new URLSearchParams({
      tab: 'patients',
      doctorId: '17',
      testId: '42',
      invoiceId: '91',
      ageBucket: '18_30',
      dateBasis: 'payment_date',
    }), today)).toMatchObject({
      tab: 'patients',
      doctorId: 17,
      testId: 42,
      invoiceId: 91,
      ageBucket: '18_30',
      dateBasis: 'payment_date',
    });
  });

  it.each(['adult', '18-30', '', 'unknowns'])('rejects invalid age bucket %s', (ageBucket) => {
    const state = parseCommandCenterUrlState(new URLSearchParams({ tab: 'patients', ageBucket }), today);
    expect(state.ageBucket).toBeUndefined();
  });

  it('preserves unknown query keys during updates', () => {
    const current = new URLSearchParams('tab=overview&range=7d&source=lab&sort=amount');
    const next = updateCommandCenterUrl(current, { tab: 'money' });
    expect(next.get('source')).toBe('lab');
    expect(next.get('sort')).toBe('amount');
    expect(next.get('tab')).toBe('money');
    expect(next.get('range')).toBe('7d');
  });

  it('opens and closes an age bucket while preserving period and other drill state', () => {
    const current = new URLSearchParams('tab=patients&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17');
    const opened = updateCommandCenterUrl(current, { ageBucket: '18_30' });
    expect(opened.toString()).toBe('tab=patients&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17&ageBucket=18_30');
    const closed = updateCommandCenterUrl(opened, { ageBucket: null });
    expect(closed.toString()).toBe('tab=patients&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17');
  });

  it('opening an invoice adds only invoiceId', () => {
    const current = new URLSearchParams('tab=money&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17');
    const next = openCommandCenterInvoice(current, 91);
    expect(next.toString()).toBe('tab=money&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17&invoiceId=91');
  });

  it('closing an invoice removes only invoiceId', () => {
    const current = new URLSearchParams('tab=money&range=7d&invoiceId=91&doctorId=17');
    const next = closeCommandCenterInvoice(current);
    expect(next.toString()).toBe('tab=money&range=7d&doctorId=17');
  });

  it('opening doctor 17 switches to Doctors and preserves other filters', () => {
    const current = new URLSearchParams('tab=overview&range=this_month&source=lab');
    const next = openCommandCenterDoctor(current, 17);
    expect(next.get('tab')).toBe('doctors');
    expect(next.get('doctorId')).toBe('17');
    expect(next.get('range')).toBe('this_month');
    expect(next.get('source')).toBe('lab');
  });
});
