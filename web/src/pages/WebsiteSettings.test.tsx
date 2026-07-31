import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebsiteSettings from './WebsiteSettings';
import { useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ slug: 'patient-care-hospital' }),
  };
});

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WebsiteSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((_queryKey: unknown, path: string) => {
      if (path === '/api/website/config') {
        return {
          data: {
            data: {
              is_enabled: 1,
              theme: 'arogyaseva',
              tagline: '',
              tagline_bn: '',
              about_text: '',
              about_text_bn: '',
              mission_text: '',
              mission_text_bn: '',
              founded_year: '',
              bed_count: '',
              operating_hours: '',
              google_maps_embed: '',
              whatsapp_number: '',
              facebook_url: '',
              emergency_number: '',
              ambulance_number: '',
              emergency_hours: '',
              seo_title: '',
              seo_description: '',
              seo_keywords: '',
              primary_color: '#0891b2',
              secondary_color: '#059669',
              hospital_logo_url: null,
            },
          },
          isLoading: false,
        };
      }

      return { data: { data: [] }, isLoading: false };
    });
  });

  it('links the live website card to the current hospital public site, not the directory', () => {
    render(<WebsiteSettings role="hospital_admin" />);

    const openWebsite = screen.getByRole('link', { name: /open website/i });

    expect(openWebsite).toHaveAttribute('href', '/site');
    expect(screen.getByText('/site')).toBeInTheDocument();
  });
});
