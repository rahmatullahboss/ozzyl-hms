import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FamilyHealthHub } from './FamilyHealthHub';
import '@testing-library/jest-dom';

describe('FamilyHealthHub Component', () => {
  it('renders header correctly', () => {
    render(<FamilyHealthHub />);
    expect(screen.getByText('Family Health Hub')).toBeInTheDocument();
    expect(screen.getByText('Manage health for your loved ones')).toBeInTheDocument();
  });

  it('renders family member avatars', () => {
    render(<FamilyHealthHub />);
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Abul')).toBeInTheDocument();
  });

  it('displays active member details', () => {
    render(<FamilyHealthHub />);
    // By default, first member is active
    expect(screen.getByText('At a Glance - Rahim (Self)')).toBeInTheDocument();
    expect(screen.getByText('All vitals normal. Sleep has improved.')).toBeInTheDocument();
    expect(screen.getByText('Cardiology Follow-up')).toBeInTheDocument();
  });

  it('switches active member on avatar click', () => {
    render(<FamilyHealthHub />);
    
    const sarahAvatar = screen.getByTestId('family-avatar-2');
    fireEvent.click(sarahAvatar);

    expect(screen.getByText('At a Glance - Sarah')).toBeInTheDocument();
    expect(screen.getByText('Due for vaccination.')).toBeInTheDocument();
    expect(screen.getByText('Pediatrician')).toBeInTheDocument();
  });

  it('shows no appointments message when empty', () => {
    render(<FamilyHealthHub />);
    
    const abulAvatar = screen.getByTestId('family-avatar-3');
    fireEvent.click(abulAvatar);

    expect(screen.getByText('At a Glance - Abul')).toBeInTheDocument();
    expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument();
  });
});
