import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VitalsDashboard } from './VitalsDashboard';

describe('VitalsDashboard Validation', () => {
  it('P0: renders vitals dashboard component', () => {
    // @ts-ignore
    render(<VitalsDashboard vitals={{}} />);
    expect(screen.getByText('Vitals Tracker')).toBeInTheDocument();
  });
});
