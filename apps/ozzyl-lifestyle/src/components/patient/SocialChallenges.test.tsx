import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SocialChallenges from './SocialChallenges';

describe('SocialChallenges', () => {
  it('renders the featured challenge', () => {
    render(<SocialChallenges />);
    expect(screen.getByText('Community Challenges')).toBeInTheDocument();
    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(screen.getByText('Marathon May')).toBeInTheDocument();
  });

  it('renders active challenges', () => {
    render(<SocialChallenges />);
    expect(screen.getByText('10K Steps Daily')).toBeInTheDocument();
    expect(screen.getByText('1,243 joined')).toBeInTheDocument();
    
    expect(screen.getByText('Sleep Masters')).toBeInTheDocument();
    expect(screen.getByText('3,201 joined')).toBeInTheDocument();
  });

  it('renders joinable challenges', () => {
    render(<SocialChallenges />);
    expect(screen.getByText('Sugar-Free Weekend')).toBeInTheDocument();
    expect(screen.getByText('842 joined')).toBeInTheDocument();
  });
});
