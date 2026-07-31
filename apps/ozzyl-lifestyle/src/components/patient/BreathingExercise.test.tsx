import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BreathingExercise from './BreathingExercise';

describe('BreathingExercise Validation', () => {
  it('P0: renders breathing animation circle', () => {
    // @ts-ignore
    render(<BreathingExercise />);
    expect(screen.getByText('Take a moment to breathe')).toBeInTheDocument();
  });
});
