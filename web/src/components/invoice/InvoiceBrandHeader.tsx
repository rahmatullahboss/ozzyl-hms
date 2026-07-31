import { CalendarDays, FileText } from 'lucide-react';
import type { InvoiceHospitalInfo } from './types';

interface InvoiceBrandHeaderProps {
  hospital: InvoiceHospitalInfo;
  invoiceNo: string;
  issueDate: string;
  appointmentNumber?: string | null;
  labels: {
    invoice: string;
    issueDate: string;
    appointmentId: string;
  };
}

export default function InvoiceBrandHeader({
  hospital,
  invoiceNo,
  issueDate,
  appointmentNumber,
  labels,
}: InvoiceBrandHeaderProps) {
  return (
    <header className="invoice-brand-header">
      <div className="invoice-brand-identity">
        {hospital.logoUrl && (
          <img src={hospital.logoUrl} alt={`${hospital.name} logo`} className="invoice-brand-logo" />
        )}
        <div>
          <h1>{hospital.name}</h1>
          {hospital.tagline && <p className="invoice-brand-tagline">{hospital.tagline}</p>}
          {(hospital.address || hospital.phone) && (
            <p className="invoice-brand-contact">
              {[hospital.address, hospital.phone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="invoice-identity">
        <h2 className="invoice-title">{labels.invoice}</h2>
        <div className="invoice-number-pill">{invoiceNo}</div>
        <div className="invoice-header-meta">
          <div><CalendarDays aria-hidden="true" /><span>{labels.issueDate}</span><strong>{issueDate}</strong></div>
          {appointmentNumber && (
            <div><FileText aria-hidden="true" /><span>{labels.appointmentId}</span><strong>{appointmentNumber}</strong></div>
          )}
        </div>
      </div>
    </header>
  );
}
