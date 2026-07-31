import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DailyCheckInWidget from './DailyCheckInWidget';

describe('DailyCheckInWidget Validation', () => {
  it('P0: renders check-in mood selector with required props', () => {
    const { container } = render(
      <DailyCheckInWidget
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        currentStreak={0}
      />
    );
    expect(container.firstChild).toBeTruthy();
  });
});
