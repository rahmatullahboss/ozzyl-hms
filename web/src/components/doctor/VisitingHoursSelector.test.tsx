import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VisitingHoursSelector } from './VisitingHoursSelector';

describe('VisitingHoursSelector', () => {
  it('updates schedule string when days and times are selected', () => {
    const onChange = vi.fn();
    render(<VisitingHoursSelector value="" onChange={onChange} />);

    // Select Sat and Mon
    fireEvent.click(screen.getByText('Sat'));
    fireEvent.click(screen.getByText('Mon'));

    // Change start time to 10:00 (which is 10:00 AM)
    const startTimeInput = screen.getAllByLabelText(/From|To/i)[0] || document.querySelector('input[type="time"]');
    // Using querySelector since labels might not be perfectly linked in the snippet
    const inputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(inputs[0], { target: { value: '10:00' } });
    fireEvent.change(inputs[1], { target: { value: '14:00' } });

    // Expect onChange to be called with the formatted string
    // Last call should be the one we want
    expect(onChange).toHaveBeenLastCalledWith('Sat, Mon 10:00 AM - 02:00 PM');
  });

  it('allows manual entry when toggled', () => {
    const onChange = vi.fn();
    render(<VisitingHoursSelector value="Existing Schedule" onChange={onChange} />);

    fireEvent.click(screen.getByText('Manual Entry'));

    const input = screen.getByPlaceholderText('e.g. Sat-Thu 9am-1pm') as HTMLInputElement;
    expect(input.value).toBe('Existing Schedule');

    fireEvent.change(input, { target: { value: 'New Manual Value' } });
    expect(onChange).toHaveBeenCalledWith('New Manual Value');
  });
});
