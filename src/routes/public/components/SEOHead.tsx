/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { safeJsonStringify } from '../../../lib/security';

interface SEOHeadProps {
  hospitalName: string;
  description?: string;
  url?: string;
  doctors?: { name: string; specialty?: string }[];
}

/**
 * Generates JSON-LD structured data for SEO.
 * Returns a <script type="application/ld+json"> tag.
 */
export const SEOHead: FC<SEOHeadProps> = ({ hospitalName, description, url, doctors }) => {
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'MedicalOrganization',
    name: hospitalName,
    description: description || `${hospitalName} — A trusted healthcare provider`,
    url: url || '',
    '@id': url || '',
    medicalSpecialty: doctors
      ?.map((d) => d.specialty)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      || [],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonStringify(orgSchema) }}
    />
  );
};
