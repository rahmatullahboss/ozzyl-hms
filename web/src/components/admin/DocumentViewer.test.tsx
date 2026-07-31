import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentViewer from './DocumentViewer';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (s: string) => s }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));

const mockDoc = {
  id: 'doc-1',
  url: 'https://example.com/invoice.jpg',
  fileName: 'INV-2026-001-photo.jpg',
  fileType: 'image/jpeg',
  uploadedBy: 'Karim',
  uploadedAt: '2026-06-11T10:30:00Z',
  documentType: 'Discount Supporting Document',
  relatedRecordType: 'Invoice',
  relatedRecordId: '891',
  versions: [
    { id: 'v2', url: 'https://example.com/invoice-v2.jpg', uploadedBy: 'Admin', uploadedAt: '2026-06-11T14:00:00Z', reason: 'Replaced unclear photo', fileType: 'image/jpeg' },
    { id: 'v1', url: 'https://example.com/invoice-v1.jpg', uploadedBy: 'Karim', uploadedAt: '2026-06-11T10:30:00Z', fileType: 'image/jpeg' },
  ],
};

describe('DocumentViewer', () => {
  it('renders with document info', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    expect(screen.getByText('INV-2026-001-photo.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Karim/)).toBeInTheDocument();
    expect(screen.getByText(/Discount Supporting Document/)).toBeInTheDocument();
  });

  it('renders image preview', () => {
    const docNoVersions = { ...mockDoc, versions: [] };
    render(<DocumentViewer document={docNoVersions} onClose={vi.fn()} />);
    const img = screen.getByAltText('INV-2026-001-photo.jpg');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/invoice.jpg');
  });

  it('renders toolbar buttons', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
    expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate')).toBeInTheDocument();
    expect(screen.getByTitle('Download')).toBeInTheDocument();
  });

  it('calls onClose when X clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<DocumentViewer document={mockDoc} onClose={onClose} />);
    const closeBtn = container.querySelector('button.p-2.hover\\:bg-gray-100.rounded-lg');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows version history when History clicked', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/History/));
    expect(screen.getByText('Version History')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('shows version reason in history', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/History/));
    expect(screen.getByText('"Replaced unclear photo"')).toBeInTheDocument();
  });

  it('renders file type in footer', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    expect(screen.getByText(/image\/jpeg/)).toBeInTheDocument();
  });

  it('renders related record info', () => {
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} />);
    expect(screen.getByText(/Invoice/)).toBeInTheDocument();
    expect(screen.getByText(/891/)).toBeInTheDocument();
  });

  it('calls onOpenRelated when Open clicked', () => {
    const onOpenRelated = vi.fn();
    render(<DocumentViewer document={mockDoc} onClose={vi.fn()} onOpenRelated={onOpenRelated} />);
    fireEvent.click(screen.getByText(/Open Invoice/));
    expect(onOpenRelated).toHaveBeenCalledWith('Invoice', '891');
  });

  it('handles non-image file type', () => {
    const pdfDoc = { ...mockDoc, fileType: 'application/pdf', url: 'https://example.com/doc.pdf', versions: [] };
    render(<DocumentViewer document={pdfDoc} onClose={vi.fn()} />);
    expect(screen.getByTitle('INV-2026-001-photo.jpg')).toBeInTheDocument();
  });

  it('handles unknown file type with fallback', () => {
    const unknownDoc = { ...mockDoc, fileType: 'application/zip', versions: [] };
    render(<DocumentViewer document={unknownDoc} onClose={vi.fn()} />);
    expect(screen.getByText('Preview not available')).toBeInTheDocument();
    expect(screen.getAllByText(/application\/zip/).length).toBeGreaterThanOrEqual(1);
  });
});
