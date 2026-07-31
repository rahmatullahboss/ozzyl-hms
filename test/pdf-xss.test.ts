import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml, renderPatientCardHtml } from '../src/lib/pdf-bangla';

describe('PDF XSS Prevention', () => {
  describe('renderInvoiceHtml', () => {
    it('should escape script tags in patient name', () => {
      const html = renderInvoiceHtml({
        invoiceNo: 'INV-001',
        date: '2024-01-15',
        patientName: "<script>alert('xss')</script>",
        hospitalName: 'Test Hospital',
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500, total: 500 }],
        subtotal: 500,
        totalAmount: 500,
        paidAmount: 500,
        dueAmount: 0,
      });

      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('alert(&#39;xss&#39;)');
    });

    it('should escape event handlers in item descriptions', () => {
      const html = renderInvoiceHtml({
        invoiceNo: 'INV-002',
        date: '2024-01-15',
        patientName: 'Safe Patient',
        hospitalName: 'Test Hospital',
        items: [
          {
            description: '<img src=x onerror=alert(1)>',
            descriptionBn: '" onclick="alert(1)"',
            quantity: 1,
            unitPrice: 100,
            total: 100,
          },
        ],
        subtotal: 100,
        totalAmount: 100,
        paidAmount: 100,
        dueAmount: 0,
      });

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&quot; onclick=&quot;');
    });

    it('should escape XSS in hospital name and address', () => {
      const html = renderInvoiceHtml({
        invoiceNo: 'INV-003',
        date: '2024-01-15',
        patientName: 'Patient',
        hospitalName: "<img onerror=alert('hack') src=x>",
        hospitalAddress: '"><script>document.cookie</script>',
        items: [{ description: 'Test', quantity: 1, unitPrice: 10, total: 10 }],
        subtotal: 10,
        totalAmount: 10,
        paidAmount: 10,
        dueAmount: 0,
      });

      expect(html).not.toContain('<img onerror=');
      expect(html).not.toContain('<script>document.cookie</script>');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&gt;');
    });

    it('should pass normal data through correctly', () => {
      const html = renderInvoiceHtml({
        invoiceNo: 'INV-000001',
        date: '2024-01-15',
        patientName: 'রহিম মিয়া',
        patientCode: 'PT-001',
        patientMobile: '01712345678',
        hospitalName: 'City General Hospital',
        hospitalAddress: 'Dhaka, Bangladesh',
        hospitalPhone: '+880-1234',
        items: [
          { description: 'OPD Consultation', descriptionBn: 'ওপিডি পরামর্শ', quantity: 1, unitPrice: 500, total: 500 },
          { description: 'Lab Test', quantity: 2, unitPrice: 300, total: 600 },
        ],
        subtotal: 1100,
        discount: 100,
        totalAmount: 1000,
        paidAmount: 800,
        dueAmount: 200,
      });

      expect(html).toContain('রহিম মিয়া');
      expect(html).toContain('PT-001');
      expect(html).toContain('01712345678');
      expect(html).toContain('City General Hospital');
      expect(html).toContain('OPD Consultation');
      expect(html).toContain('ওপিডি পরামর্শ');
      expect(html).toContain('INV-000001');
    });
  });

  describe('renderPatientCardHtml', () => {
    it('should escape script tags in patient name', () => {
      const html = renderPatientCardHtml({
        patientCode: 'PT-001',
        name: "<script>alert('xss')</script>",
        mobile: '01712345678',
        registrationDate: '2024-01-15',
        hospitalName: 'Test Hospital',
      });

      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape XSS in gender field', () => {
      const html = renderPatientCardHtml({
        patientCode: 'PT-002',
        name: 'Patient',
        gender: "<img onerror=alert(1) src=x>",
        mobile: '01712345678',
        registrationDate: '2024-01-15',
        hospitalName: 'Test Hospital',
      });

      expect(html).not.toContain('<img onerror=');
      expect(html).toContain('&lt;img');
    });

    it('should escape XSS in blood group field', () => {
      const html = renderPatientCardHtml({
        patientCode: 'PT-003',
        name: 'Patient',
        bloodGroup: '"><script>alert(1)</script>',
        mobile: '01712345678',
        registrationDate: '2024-01-15',
        hospitalName: 'Test Hospital',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape XSS in address and emergency contact', () => {
      const html = renderPatientCardHtml({
        patientCode: 'PT-004',
        name: 'Patient',
        mobile: '01712345678',
        address: '<b onload=alert("xss")>Addr</b>',
        emergencyContact: "'; DROP TABLE patients;--",
        registrationDate: '2024-01-15',
        hospitalName: 'Test Hospital',
      });

      expect(html).not.toContain('<b onload=');
      expect(html).toContain('&lt;b');
      expect(html).toContain('&#39;; DROP TABLE patients;--');
    });

    it('should pass normal patient data through correctly', () => {
      const html = renderPatientCardHtml({
        patientCode: 'PT-000001',
        name: 'Karim Ali',
        nameBn: 'করিম আলী',
        dateOfBirth: '1990-05-15',
        gender: 'Male',
        mobile: '01712345678',
        address: 'Dhaka, Bangladesh',
        bloodGroup: 'O+',
        registrationDate: '2024-01-15',
        emergencyContact: '01898765432',
        hospitalName: 'City Hospital',
      });

      expect(html).toContain('Karim Ali');
      expect(html).toContain('করিম আলী');
      expect(html).toContain('PT-000001');
      expect(html).toContain('পুরুষ / Male');
      expect(html).toContain('O+');
      expect(html).toContain('01712345678');
      expect(html).toContain('Dhaka, Bangladesh');
      expect(html).toContain('01898765432');
      expect(html).toContain('City Hospital');
    });
  });
});
