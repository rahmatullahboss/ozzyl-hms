import { Building2, Globe2, Mail, MapPin, Phone } from 'lucide-react';
import type { InvoiceHospitalInfo } from './types';

interface InvoiceFooterProps {
  hospital: InvoiceHospitalInfo;
  labels: {
    hotline: string;
    address: string;
    website: string;
    email: string;
    registration: string;
    binTin: string;
    thankYou: string;
  };
}

export default function InvoiceFooter({
  hospital,
  labels,
}: InvoiceFooterProps) {
  const contactCount = [
    hospital.phone,
    hospital.address,
    hospital.website,
    hospital.email,
    hospital.registrationNumber,
    hospital.binTin,
  ].filter(Boolean).length;

  return (
    <footer className="invoice-footer invoice-keep-together">
      {contactCount > 0 && (
        <div className={`invoice-footer-grid${contactCount === 2 ? ' invoice-footer-pair' : ''}`}>
          {hospital.phone && <div><Phone aria-hidden="true" /><span>{labels.hotline}</span><strong>{hospital.phone}</strong></div>}
          {hospital.address && <div><MapPin aria-hidden="true" /><span>{labels.address}</span><strong>{hospital.address}</strong></div>}
          {hospital.website && <div><Globe2 aria-hidden="true" /><span>{labels.website}</span><strong>{hospital.website}</strong></div>}
          {hospital.email && <div><Mail aria-hidden="true" /><span>{labels.email}</span><strong>{hospital.email}</strong></div>}
          {hospital.registrationNumber && <div><Building2 aria-hidden="true" /><span>{labels.registration}</span><strong>{hospital.registrationNumber}</strong></div>}
          {hospital.binTin && <div><Building2 aria-hidden="true" /><span>{labels.binTin}</span><strong>{hospital.binTin}</strong></div>}
        </div>
      )}
      {hospital.footerText && <p className="invoice-footer-message">{hospital.footerText}</p>}
      <div className="invoice-thank-you">
        <strong>{labels.thankYou} {hospital.name}</strong>
        {hospital.tagline && <span>{hospital.tagline}</span>}
      </div>
    </footer>
  );
}
