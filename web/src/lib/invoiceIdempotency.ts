import { ApiClientError } from './apiClient';

const IN_PROGRESS_MESSAGE = /already being processed|retry shortly/i;

export function shouldRotateInvoiceAttemptKey(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.status >= 500) return false;
  if (error.status === 409 && IN_PROGRESS_MESSAGE.test(error.message)) return false;
  return error.status >= 400 && error.status < 500;
}
