import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementGallery from './AchievementGallery';

describe('AchievementGallery', () => {
  it('renders the generic header and level component', () => {
    render(<AchievementGallery />);
    expect(screen.getByText('Achievement Gallery')).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
  });

  it('renders all mock badges with their details', () => {
    render(<AchievementGallery />);
    
    // Check titles
    const expectedBadges = ['7 Days Active', 'Hydration Hero', 'Mindful Master', 'Wellness Champion'];
    expectedBadges.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
    
    // Check an unearned badge requirement
    expect(screen.getByText('5 / 7')).toBeInTheDocument();
    expect(screen.getByText('85 / 90')).toBeInTheDocument();
  });

  it('renders the "Earned" text for badges that are completed', () => {
    render(<AchievementGallery />);
    // "7 Days Active" -> 2 Days Ago
    expect(screen.getByText('Earned 2 Days Ago')).toBeInTheDocument();
    // "Mindful Master" -> Last Week
    expect(screen.getByText('Earned Last Week')).toBeInTheDocument();
  });
});
