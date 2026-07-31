import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrintTemplateSettings from './PrintTemplateSettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((_key: unknown, path: string) => ({
    data: path === '/api/print-templates'
      ? {
          data: [
            {
              id: 7,
              template_type: 'prescription',
              template_name: 'A4 Prescription',
              hospital_name: 'City Care Hospital',
              paper_size: 'a4',
              orientation: 'portrait',
              show_logo: 1,
              show_hospital_name: 1,
              is_default: 1,
              is_active: 1,
            },
          ],
        }
      : { settings: { hospital_logo_url: '/api/settings/logo' } },
    isLoading: false,
  })),
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../lib/apiClient', () => ({ api: { put: vi.fn(), delete: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('PrintTemplateSettings', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('offers a dedicated test print action for template alignment', () => {
    render(<PrintTemplateSettings role="hospital_admin" />);

    fireEvent.click(screen.getByRole('button', { name: /test print/i }));

    expect(window.open).toHaveBeenCalledWith('/api/print-templates/7/preview?testPrint=1', '_blank');
  });
});
