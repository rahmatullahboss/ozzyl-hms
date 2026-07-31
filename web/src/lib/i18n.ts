import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

const isProd = import.meta.env.PROD;
const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

if (isProd) {
  // i18next reads logger early during init; set a silent logger up-front
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (i18n as any).logger = silentLogger;
}

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'bn'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    debug: !isProd,
    ...(isProd ? { logger: silentLogger } : {}),

    // Each namespace corresponds to a feature area / file
    ns: ['common', 'sidebar', 'dashboard', 'auth', 'patients', 'billing',
         'pharmacy', 'laboratory', 'appointments', 'staff', 'accounting',
         'reports', 'settings', 'telemedicine', 'ipd', 'notifications', 'director',
          'emergency', 'ot', 'vitals', 'nursing', 'super-admin', 'inventory', 'hr', 'clinical', 'radiology', 'helpCenter', 'roleGuides', 'pageHelp', 'patientPortal',
         'maternity', 'ward_supply', 'setup_wizard', 'quality_kpi', 'mlc', 'mortuary', 'laundry', 'biomedical_waste', 'blood_bank',
         'reminders', 'documents', 'dental', 'doctor', 'reception',
         'tenantDashboard', 'tenantBilling', 'tenantClinical', 'tenantLab', 'tenantPharmacy', 'tenantAdmin', 'adminInterface', 'adminPages', 'adminCash', 'cashOperations', 'adminRefund',
         'adminExpense', 'adminPayout', 'adminSettings', 'adminDiscount', 'adminReceivables', 'adminStock'
    ],
    defaultNS: 'common',
    fallbackNS: ['adminInterface', 'adminPages'],

    interpolation: {
      escapeValue: false, // React already escapes
    },

    backend: {
      // Public folder: /locales/en/sidebar.json, /locales/bn/sidebar.json
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'hms_language',
    },
  });

export default i18n;
