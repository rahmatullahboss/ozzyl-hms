import { describe, expect, it } from 'vitest';
import {
  rangePendingApprovalDateWindow,
  singlePendingApprovalDateWindow,
} from './pendingApprovalDateWindow';

describe('pending approval date windows', () => {
  it('creates a single-day window', () => {
    expect(singlePendingApprovalDateWindow('2026-07-18')).toEqual({
      from: '2026-07-18',
      to: '2026-07-18',
    });
  });

  it('creates Today, 7-day, and 30-day windows ending on the supplied GMT+6 date', () => {
    expect(rangePendingApprovalDateWindow('today', '', '2026-07-18')).toEqual({ from: '2026-07-18', to: '2026-07-18' });
    expect(rangePendingApprovalDateWindow('7d', '', '2026-07-18')).toEqual({ from: '2026-07-12', to: '2026-07-18' });
    expect(rangePendingApprovalDateWindow('30d', '', '2026-07-18')).toEqual({ from: '2026-06-19', to: '2026-07-18' });
  });

  it('uses the custom date as a one-day window', () => {
    expect(rangePendingApprovalDateWindow('custom', '2026-07-05', '2026-07-18')).toEqual({
      from: '2026-07-05',
      to: '2026-07-05',
    });
  });
});
