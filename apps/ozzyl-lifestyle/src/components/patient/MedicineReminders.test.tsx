import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MedicineReminders } from './MedicineReminders';

describe('MedicineReminders Validation', () => {
  it('P0: renders the medicine reminders component', () => {
    // @ts-ignore
    render(<MedicineReminders reminders={[]} />);
    expect(screen.getByText('Medicine Reminders')).toBeInTheDocument();
  });
});
