/**
 * Shared authentication helpers for API requests.
 * All pages should import from here instead of duplicating these functions.
 */

/** Get the stored JWT token */
export const getToken = (): string =>
  localStorage.getItem('hms_token') ?? '';

/** Build an Authorization header object for axios */
export const authHeader = (): { Authorization: string } =>
  ({ Authorization: `Bearer ${getToken()}` });
