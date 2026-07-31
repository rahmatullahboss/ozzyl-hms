export type EmpCashTransactionType =
  | 'CashSales' | 'SalesReturn' | 'DepositDeduct' | 'ReturnDeposit'
  | 'CollectionFromReceivable' | 'CashDiscountGiven' | 'CashDiscountReceived';

export async function recordEmpCashTransaction(
  db: D1Database,
  tenantId: string,
  employeeId: number,
  data: {
    transactionType: EmpCashTransactionType;
    amount: number;
    counterId?: number;
    counterSessionId?: number;
    referenceId?: number;
    referenceType?: string;
    paymentMethod?: string;
    description?: string;
  }
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO emp_cash_transactions (
      tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
      reference_id, reference_type, payment_method, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    employeeId,
    data.counterId ?? null,
    data.counterSessionId ?? null,
    data.transactionType,
    data.amount,
    data.referenceId ?? null,
    data.referenceType ?? null,
    data.paymentMethod ?? null,
    data.description ?? null
  ).run();

  return result.meta.last_row_id as number;
}
