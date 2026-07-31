import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityRings from './ActivityRings';

describe('ActivityRings Validation', () => {
  it('P0: renders fitness rings', () => {
    // @ts-ignore
    render(<ActivityRings />);
    expect(screen.getByText('Activity Rings')).toBeInTheDocument();
  });
});
