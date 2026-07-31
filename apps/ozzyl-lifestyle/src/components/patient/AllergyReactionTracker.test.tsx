import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AllergyReactionTracker } from './AllergyReactionTracker';
import { useAdverseReactions, useLogAdverseReaction } from '../../hooks/usePatientWellness';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/usePatientWellness', () => ({
  useAdverseReactions: vi.fn(),
  useLogAdverseReaction: vi.fn(),
}));

describe('AllergyReactionTracker Validation', () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mockAllergies = [
    { id: 1, medication_name: 'Peanuts', severity: 'severe', reaction: 'Anaphylaxis', created_at: '2025-01-01', review_status: 'verified' }
  ];

  it('P0: renders the component container and allergy list', () => {
    (useAdverseReactions as any).mockReturnValue({ data: { adverse_reactions: mockAllergies }, isLoading: false });
    (useLogAdverseReaction as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    
    render(<AllergyReactionTracker />, { wrapper });
    expect(screen.getByText('Allergies & Reactions')).toBeInTheDocument();
    expect(screen.getByText('Peanuts')).toBeInTheDocument();
  });

  it('P1: prominently displays severity badges', () => {
    (useAdverseReactions as any).mockReturnValue({ data: { adverse_reactions: mockAllergies }, isLoading: false });
    (useLogAdverseReaction as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    
    render(<AllergyReactionTracker />, { wrapper });
    expect(screen.getByText('severe')).toBeInTheDocument();
  });
});
