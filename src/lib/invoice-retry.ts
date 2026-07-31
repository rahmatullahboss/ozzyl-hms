type RetryResult = {
  invoiceNo: string;
  billId: number;
  [key: string]: unknown;
};

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Error) {
    if (/UNIQUE constraint failed/i.test(error.message)) return true;
    if ((error as Error & { code?: string }).code?.includes('SQLITE_CONSTRAINT_UNIQUE')) return true;
    if ((error as Error & { code?: string }).code?.includes('SQLITE_CONSTRAINT')) return true;
  }
  return false;
}

export async function withInvoiceRetry<T extends RetryResult>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isUniqueConstraintError(error) || attempt === maxRetries) {
        throw error;
      }
    }
  }
  throw lastError;
}
