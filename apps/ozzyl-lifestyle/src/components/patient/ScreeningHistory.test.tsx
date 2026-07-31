import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScreeningHistory from './ScreeningHistory';

describe('ScreeningHistory', () => {
  it('renders title and total count', () => {
    render(<ScreeningHistory />);
    expect(screen.getByText('Screening History')).toBeInTheDocument();
    expect(screen.getByText('4 Records')).toBeInTheDocument();
  });

  it('renders all mock screening records', () => {
    render(<ScreeningHistory />);
    
    // Check for specific screening types
    expect(screen.getAllByText('PHQ-9')).toHaveLength(2);
    expect(screen.getAllByText('GAD-7')).toHaveLength(2);

    // Check for interpretation texts
    expect(screen.getByText('Mild Depression')).toBeInTheDocument();
    expect(screen.getByText('Moderate Anxiety')).toBeInTheDocument();
  });

  it('renders the scores correctly', () => {
    render(<ScreeningHistory />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });
});
