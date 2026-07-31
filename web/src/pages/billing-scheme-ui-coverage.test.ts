import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('billing scheme UI coverage', () => {
  it.each([
    ['billing counter invoice', 'src/pages/BillingCounterPage.tsx', 'service_item'],
    ['billing counter appointment', 'src/pages/BillingCounterPage.tsx', 'appointment_payment'],
    ['reception dashboard quick bill', 'src/pages/ReceptionDashboard.tsx', 'quick_service_bill'],
    ['reception dashboard visit service bill', 'src/pages/ReceptionDashboard.tsx', 'visit_service_bill'],
    ['reception dashboard final visit bill', 'src/pages/ReceptionDashboard.tsx', 'reception_visit_bill'],
    ['reception dashboard appointment payment', 'src/pages/ReceptionDashboard.tsx', 'appointment_payment'],
    ['appointment scheduler pay now', 'src/pages/AppointmentScheduler.tsx', 'appointment_payment'],
    ['provisional billing conversion', 'src/pages/ProvisionalBillingPage.tsx', 'provisional_bill'],
  ])('%s has optional scheme preview wiring', (_label, path, serviceCategory) => {
    const source = read(path);
    expect(source).toContain('/api/billing-master/apply-scheme-preview');
    expect(source).toContain('schemeApplication');
    expect(source).toContain(serviceCategory);
  });

  it('keeps drawer quick bill scheme preview wiring', () => {
    const source = read('src/components/reception/ReceptionPatientDrawer.tsx');
    expect(source).toContain('/api/billing-master/apply-scheme-preview');
    expect(source).toContain('patient_drawer_quick_bill');
    expect(source).toContain('schemeApplication: schemePreview?.eligible');
    expect(source).toContain('cartLinesWithGlobalDiscount().map');
  });
});
