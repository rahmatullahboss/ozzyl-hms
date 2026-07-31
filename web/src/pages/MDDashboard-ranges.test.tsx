import { describe, expect, it } from 'vitest';
import { dateParamFor, executiveDateParams, pendingRequestWindowFor } from './MDDashboard.helpers';

describe('executiveDateParams', () => {
  it('encodes named presets with the shared preset parameter', () => {
    expect(executiveDateParams('today', '', '')).toBe('?preset=today');
    expect(executiveDateParams('yesterday', '', '')).toBe('?preset=yesterday');
    expect(executiveDateParams('this_week', '', '')).toBe('?preset=this_week');
    expect(executiveDateParams('this_month', '', '')).toBe('?preset=this_month');
    expect(executiveDateParams('last_month', '', '')).toBe('?preset=last_month');
    expect(executiveDateParams('7d', '', '')).toBe('?preset=7d');
    expect(executiveDateParams('30d', '', '')).toBe('?preset=30d');
  });

  it('encodes a valid custom range', () => {
    expect(executiveDateParams('custom', '2026-07-01', '2026-07-31')).toBe(
      '?preset=custom&startDate=2026-07-01&endDate=2026-07-31',
    );
  });

  it.each([
    ['', '2026-07-31'],
    ['2026-07-01', ''],
    ['2026-07-31', '2026-07-01'],
    ['bad', '2026-07-01'],
    ['2026-02-30', '2026-03-01'],
  ])('rejects invalid custom dates (%s, %s)', (startDate, endDate) => {
    expect(executiveDateParams('custom', startDate, endDate)).toBe('');
  });
});

describe('dateParamFor compatibility wrapper', () => {
  it('keeps the existing MD dashboard URL behavior while callers migrate', () => {
    expect(dateParamFor('today', '')).toBe('');
    expect(dateParamFor('7d', '')).toBe('?range=7d');
    expect(dateParamFor('30d', '')).toBe('?range=30d');
    expect(dateParamFor('custom', '2026-01-15')).toBe('?date=2026-01-15');
  });

  it('does not emit an invalid legacy custom date', () => {
    expect(dateParamFor('custom', '')).toBe('');
    expect(dateParamFor('custom', 'bad & value')).toBe('');
  });

  it('maps the picker to pending request creation windows', () => {
    expect(pendingRequestWindowFor('today', '', '2026-07-18')).toEqual({ from: '2026-07-18', to: '2026-07-18' });
    expect(pendingRequestWindowFor('7d', '', '2026-07-18')).toEqual({ from: '2026-07-12', to: '2026-07-18' });
    expect(pendingRequestWindowFor('30d', '', '2026-07-18')).toEqual({ from: '2026-06-19', to: '2026-07-18' });
    expect(pendingRequestWindowFor('custom', '2026-07-03', '2026-07-18')).toEqual({ from: '2026-07-03', to: '2026-07-03' });
  });
});
