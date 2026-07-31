import { vi } from 'vitest';

const mockT = vi.fn((key: string) => key);
const mockI18n = {
  language: 'en',
  changeLanguage: vi.fn(),
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: mockI18n,
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

export { mockT, mockI18n };
