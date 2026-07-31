/**
 * Infer the service type for a visit service item based on its name and department.
 * Used by reception.ts for visit service classification and billing category assignment.
 */
export function inferReceptionVisitServiceType(serviceItem: { item_name?: unknown; department_name?: unknown }): string {
  const haystack = `${serviceItem.department_name ?? ''} ${serviceItem.item_name ?? ''}`.toLowerCase();
  if (/(lab|test|pathology|radiology|x-?ray|ultra|usg|\bct\b|mri|cbc|blood|urine|sugar|antibody|aptt)/.test(haystack)) return 'test';
  if (/(operation|surgery|\bot\b|procedure|dressing|stitch|suture|injection|cannula|nebul)/.test(haystack)) return 'procedure';
  if (/(admission|bed|ward|cabin|\broom\b|ipd)/.test(haystack)) return 'admission';
  if (/(pharmacy|medicine|drug)/.test(haystack)) return 'medicine';
  if (/(doctor|consult|opd|visit|follow)/.test(haystack)) return 'doctor_visit';
  return 'other';
}
