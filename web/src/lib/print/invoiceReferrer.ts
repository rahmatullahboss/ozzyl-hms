export interface InvoiceReferrer {
  type?: string | null;
  name?: string | null;
  hospitalName?: string | null;
  doctorName?: string | null;
}

interface InvoiceReferrerLabels {
  self: string;
  doctor: string;
  hospital: string;
  other: string;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatInvoiceReferrer(
  referrer: InvoiceReferrer | null | undefined,
  labels: InvoiceReferrerLabels,
): string {
  const type = referrer?.type?.trim().toLowerCase() || 'self';

  if (type === 'self') return labels.self;
  if (type === 'doctor') {
    const name = referrer?.doctorName?.trim() || referrer?.name?.trim();
    return name ? `Dr. ${name.replace(/^Dr\.?\s*/i, '')}` : labels.doctor;
  }
  if (type === 'hospital') {
    return referrer?.hospitalName?.trim() || referrer?.name?.trim() || labels.hospital;
  }

  return referrer?.name?.trim() || (type === 'other' ? labels.other : titleCase(type));
}
