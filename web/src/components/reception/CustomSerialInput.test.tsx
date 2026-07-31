import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}));

import CustomSerialInput from './CustomSerialInput';

describe('CustomSerialInput', () => {
  it('renders with Auto placeholder', () => {
    render(<CustomSerialInput value="" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Auto');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '99999');
  });

  it('strips non-digit characters', async () => {
    const onChange = vi.fn();
    render(<CustomSerialInput value="" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Auto'), '12abc34');
    const allArgs = onChange.mock.calls.map(c => c[0]);
    expect(allArgs).not.toContain('12abc34');
    expect(allArgs.some(a => /[^0-9]/.test(a))).toBe(false);
  });

  it('caps input length at 5 digits', async () => {
    const onChange = vi.fn();
    render(<CustomSerialInput value="" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Auto'), '123456789');
    const allArgs = onChange.mock.calls.map(c => c[0]);
    expect(allArgs.every(a => a.length <= 5)).toBe(true);
  });

  it('displays the provided value', () => {
    render(<CustomSerialInput value="42" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Auto')).toHaveValue(42);
  });
});
