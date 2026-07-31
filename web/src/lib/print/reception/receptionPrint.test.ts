import { describe, expect, it } from 'vitest';
import {
  buildReceptionFooter,
  buildReceptionHeader,
  type ReceptionContext,
  wrapReceptionPage,
} from './receptionPrint';

const baseCtx: ReceptionContext = {
  hospitalName: 'Test Hospital',
  branchName: 'Main Branch',
  address: '123 Test Street',
  phone: '+880 1700 000000',
  counterName: 'Counter R01',
  counterCode: 'R01',
  shiftId: 'SHIFT-1',
  shiftName: 'Morning',
  cashierName: 'Test Cashier',
  status: 'submitted',
  documentNo: 'DOC-001',
  documentTitle: 'Test Document',
  generatedAt: '2026-06-23 10:00:00',
  generatedBy: 'Test Cashier',
};

describe('receptionPrint', () => {
  it('exports buildReceptionHeader and buildReceptionFooter', () => {
    expect(typeof buildReceptionHeader).toBe('function');
    expect(typeof buildReceptionFooter).toBe('function');
  });

  describe('buildReceptionHeader', () => {
    it('includes hospital name', () => {
      const html = buildReceptionHeader(baseCtx);
      expect(html).toContain('Test Hospital');
    });

    it('includes document title and no', () => {
      const html = buildReceptionHeader(baseCtx);
      expect(html).toContain('Test Document');
      expect(html).toContain('DOC-001');
    });

    it('includes branch name when provided', () => {
      const html = buildReceptionHeader(baseCtx);
      expect(html).toContain('Main Branch');
    });

    it('includes status badge when status provided', () => {
      const html = buildReceptionHeader(baseCtx);
      expect(html).toMatch(/rec-status/);
      expect(html).toMatch(/SUBMITTED/);
    });

    it('omits status badge when no status', () => {
      const html = buildReceptionHeader({ ...baseCtx, status: null });
      expect(html).not.toMatch(/rec-status/);
    });

    it('includes meta strip with shift/counter/cashier', () => {
      const html = buildReceptionHeader(baseCtx);
      expect(html).toContain('Morning');
      expect(html).toContain('Counter R01');
      expect(html).toContain('Test Cashier');
    });

    it('escapes HTML special characters in hospital name (XSS)', () => {
      const html = buildReceptionHeader({ ...baseCtx, hospitalName: '<script>alert(1)</script>' });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('wrapReceptionPage', () => {
    it('produces a full HTML document', () => {
      const html = wrapReceptionPage(baseCtx, '<p>Body content</p>');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
      expect(html).toContain('<body>');
      expect(html).toContain('Body content');
    });

    it('sets A5 page size by default', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>');
      expect(html).toMatch(/@page\s*{\s*size:\s*A5/);
    });

    it('honors A4 page size option', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { pageSize: 'a4' });
      expect(html).toMatch(/@page\s*{\s*size:\s*A4/);
    });

    it('renders watermark when provided', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { watermark: 'duplicate' });
      expect(html).toMatch(/rec-watermark/);
      expect(html).toContain('DUPLICATE COPY');
    });

    it('renders DRAFT watermark when watermark=draft', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { watermark: 'draft' });
      expect(html).toContain('DRAFT');
    });

    it('renders copy number indicator when copyNumber > 1', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { copyNumber: 3 });
      expect(html).toContain('COPY #3');
    });

    it('does not render copy indicator for copy 1', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { copyNumber: 1 });
      expect(html).not.toMatch(/COPY #/);
    });

    it('includes Noto Sans Bengali font for Bangla support', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>');
      expect(html).toContain('Noto+Sans+Bengali');
    });

    it('hides toolbar when hideToolbar is true', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { hideToolbar: true });
      // CSS may still reference .rec-toolbar but no actual toolbar div should be rendered
      expect(html).not.toMatch(/<div class="rec-toolbar">/);
    });

    it('renders QR when qrPayload is provided', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { qrPayload: 'https://verify.example/123' });
      expect(html).toMatch(/rec-qr/);
      expect(html).toContain('api.qrserver.com');
    });

    it('omits QR when disableQR is true', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', { qrPayload: 'x', disableQR: true });
      // The rec-qr CSS class may still be in <style> but no actual <img> tag
      expect(html).not.toMatch(/<img[^>]*rec-qr/);
    });

    it('renders custom signature lines when provided', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>', {
        signatures: [
          { role: 'cashier', label: 'Counted By' },
          { role: 'supervisor', label: 'Verified By' },
        ],
      });
      expect(html).toContain('Counted By');
      expect(html).toContain('Verified By');
    });

    it('sets @media print rules for clean print output', () => {
      const html = wrapReceptionPage(baseCtx, '<p>x</p>');
      expect(html).toMatch(/@media print/);
      expect(html).toMatch(/\.rec-toolbar\s*{\s*display:\s*none/);
    });
  });
});
