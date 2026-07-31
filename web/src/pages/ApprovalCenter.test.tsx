import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ApprovalCenter from './ApprovalCenter';

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="approval-center-redirect" data-to={to} data-replace={String(Boolean(replace))} />
  ),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ApprovalCenter compatibility route', () => {
  it('redirects the legacy component to the canonical Action Center overview', () => {
    render(<ApprovalCenter />);

    const redirect = screen.getByTestId('approval-center-redirect');
    expect(redirect).toHaveAttribute('data-to', '/h/city-hospital/action');
    expect(redirect).toHaveAttribute('data-replace', 'true');
    expect(screen.queryByText('approvalCenter.title')).not.toBeInTheDocument();
  });
});
