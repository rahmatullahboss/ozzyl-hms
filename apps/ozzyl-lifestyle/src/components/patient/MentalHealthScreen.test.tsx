import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MentalHealthScreen from './MentalHealthScreen';

describe('MentalHealthScreen Validation', () => {
  it('P0: renders mental health assessment flow', () => {
    // @ts-ignore
    render(<MentalHealthScreen />);
    expect(screen.getByText(/Mental Health Assessment/i)).toBeInTheDocument();
  });
});
