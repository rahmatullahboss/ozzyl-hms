const PRACTITIONER_EMPLOYEE_LINK_TABLE = 'canonical_practitioner_employee_links';

export function isMissingPractitionerEmployeeLinkTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('no such table')
    && message.includes(PRACTITIONER_EMPLOYEE_LINK_TABLE);
}

export async function withOptionalPractitionerEmployeeLink<T>(
  queryWithLink: () => Promise<T>,
  queryWithoutLink: () => Promise<T>,
): Promise<T> {
  try {
    return await queryWithLink();
  } catch (error) {
    if (!isMissingPractitionerEmployeeLinkTableError(error)) throw error;
    return queryWithoutLink();
  }
}
