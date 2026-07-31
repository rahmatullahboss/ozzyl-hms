import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  recordAccountingPostingEvent,
} from '../accounting-posting';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

const NON_CASH_GATEWAYS = new Set(['bkash', 'nagad']);

export interface GatewayPaymentLegacyInput {
  tenantId: string;
  userId: string;
  gatewayLogId: number;
  billId: number;
  patientId: number;
  expectedBillTotal: number;
  expectedBillPaid: number;
  expectedBillStatus: string;
  confirmedAmount: number;
  amountForBill: number;
  depositAmount: number;
  newPaid: number;
  newBillStatus: string;
  receiptNo: string;
  advanceReceiptNo: string;
  gateway: string;
  paymentId: string;
  externalTransactionId: string;
  businessDate: string;
  rawResponseJson: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function cents(value: number, label: string): number {
  nonNegativeMoney(value, label);
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(minor / 100 - value) > 1e-9) {
    throw new RangeError(`${label} must have at most two decimal places`);
  }
  return minor;
}

function validateStrictInput(input: GatewayPaymentLegacyInput): void {
  exact(input.tenantId, 'tenantId');
  exact(input.userId, 'userId');
  positiveInteger(input.gatewayLogId, 'gatewayLogId');
  positiveInteger(input.billId, 'billId');
  positiveInteger(input.patientId, 'patientId');
  exact(input.expectedBillStatus, 'expectedBillStatus');
  exact(input.newBillStatus, 'newBillStatus');
  exact(input.receiptNo, 'receiptNo');
  exact(input.advanceReceiptNo, 'advanceReceiptNo');
  const gateway = exact(input.gateway, 'gateway').toLowerCase();
  if (!NON_CASH_GATEWAYS.has(gateway)) {
    throw new RangeError('Gateway settlement must use a reviewed non-cash provider');
  }
  exact(input.paymentId, 'paymentId');
  exact(input.externalTransactionId, 'externalTransactionId');
  exact(input.businessDate, 'businessDate');
  exact(input.rawResponseJson, 'rawResponseJson');
  JSON.parse(input.rawResponseJson);

  const totalMinor = cents(input.expectedBillTotal, 'expectedBillTotal');
  const paidMinor = cents(input.expectedBillPaid, 'expectedBillPaid');
  const confirmedMinor = cents(input.confirmedAmount, 'confirmedAmount');
  const billMinor = cents(input.amountForBill, 'amountForBill');
  const depositMinor = cents(input.depositAmount, 'depositAmount');
  const newPaidMinor = cents(input.newPaid, 'newPaid');

  if (confirmedMinor <= 0) throw new RangeError('confirmedAmount must be positive');
  if (paidMinor > totalMinor) throw new RangeError('expectedBillPaid cannot exceed expectedBillTotal');
  if (billMinor + depositMinor !== confirmedMinor) {
    throw new RangeError('Gateway settlement portions must equal the confirmed amount');
  }
  if (newPaidMinor !== Math.min(totalMinor, paidMinor + billMinor)) {
    throw new RangeError('newPaid does not reconcile with the bill snapshot');
  }
  if (billMinor === 0 && depositMinor === 0) {
    throw new RangeError('Gateway settlement must create a payment or deposit');
  }
  if (billMinor === 0 && newPaidMinor !== paidMinor) {
    throw new RangeError('Deposit-only settlement cannot change bill paid amount');
  }
  if (depositMinor === 0 && input.advanceReceiptNo === input.receiptNo) {
    return;
  }
  if (depositMinor > 0 && input.advanceReceiptNo === input.receiptNo) {
    throw new RangeError('Advance deposit requires a distinct receipt number');
  }
}

export function prepareGatewayPaymentOriginalLegacyStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  if (input.amountForBill > 0) {
    statements.push(
      db.prepare(`
        INSERT INTO payments (
          bill_id, amount, payment_type, receipt_no, payment_method, received_by,
          tenant_id, date, idempotency_key, external_transaction_id
        )
        VALUES (?, ?, 'current', ?, ?, ?, ?, datetime('now', '+6 hours'), ?, ?)
      `).bind(
        input.billId,
        input.amountForBill,
        input.receiptNo,
        input.gateway,
        input.userId,
        input.tenantId,
        input.paymentId,
        input.externalTransactionId,
      ),
      db.prepare(
        `UPDATE bills SET paid = ?, status = ?, due = MAX(0, total - ?) WHERE id = ? AND tenant_id = ?`,
      ).bind(
        input.newPaid,
        input.newBillStatus,
        input.newPaid,
        input.billId,
        input.tenantId,
      ),
      db.prepare(`
        INSERT INTO income (date, source, amount, description, bill_id, tenant_id)
        VALUES (date('now', '+6 hours'), 'other', ?, ?, ?, ?)
      `).bind(
        input.amountForBill,
        `Gateway payment ${input.receiptNo}`,
        input.billId,
        input.tenantId,
      ),
    );
  }

  if (input.depositAmount > 0) {
    statements.push(db.prepare(`
      INSERT INTO billing_deposits
        (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, payment_method, remarks, reference_bill_id, created_by)
      VALUES (?, ?, ?, ?, 'deposit', ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.patientId,
      input.advanceReceiptNo,
      input.depositAmount,
      input.gateway,
      `Gateway overpayment held as advance from bill ${input.billId}`,
      input.billId,
      input.userId,
    ));
  }

  statements.push(
    db.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id, employee_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
      VALUES (?, ?, 'CashSales', ?, ?, 'payment_gateway', ?, ?)
    `).bind(
      input.tenantId,
      input.userId,
      input.confirmedAmount,
      input.gatewayLogId,
      input.gateway,
      `Gateway payment ${input.receiptNo}`,
    ),
    db.prepare(
      `UPDATE payment_gateway_logs SET status = 'success', raw_response = ?, updated_at = datetime('now', '+6 hours') WHERE id = ?`,
    ).bind(input.rawResponseJson, input.gatewayLogId),
  );

  return statements;
}

export function prepareGatewayPaymentStrictStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[] {
  validateStrictInput(input);
  const operationKey = `gateway-payment:${input.gatewayLogId}:${input.paymentId}`;
  const statements: D1PreparedStatement[] = [];
  const pushAsserted = (statement: D1PreparedStatement, stepKey: string): void => {
    statements.push(
      statement,
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey,
        expectedChanges: 1,
      }),
    );
  };

  if (input.amountForBill > 0) {
    pushAsserted(db.prepare(`
      INSERT INTO payments (
        bill_id, amount, payment_type, receipt_no, payment_method, received_by,
        tenant_id, date, idempotency_key, external_transaction_id
      )
      SELECT ?, ?, 'current', ?, ?, ?, ?, datetime('now', '+6 hours'), ?, ?
      WHERE EXISTS (
        SELECT 1 FROM bills
        WHERE id = ? AND tenant_id = ? AND patient_id = ?
          AND total = ? AND paid = ? AND status = ?
      )
        AND NOT EXISTS (
          SELECT 1 FROM payments
          WHERE tenant_id = ? AND (receipt_no = ? OR idempotency_key = ?)
        )
    `).bind(
      input.billId,
      input.amountForBill,
      input.receiptNo,
      input.gateway,
      input.userId,
      input.tenantId,
      input.paymentId,
      input.externalTransactionId,
      input.billId,
      input.tenantId,
      input.patientId,
      input.expectedBillTotal,
      input.expectedBillPaid,
      input.expectedBillStatus,
      input.tenantId,
      input.receiptNo,
      input.paymentId,
    ), 'payment_insert');

    pushAsserted(db.prepare(`
      UPDATE bills
      SET paid = ?, status = ?, due = MAX(0, total - ?)
      WHERE id = ? AND tenant_id = ? AND patient_id = ?
        AND total = ? AND paid = ? AND status = ?
        AND EXISTS (
          SELECT 1 FROM payments
          WHERE tenant_id = ? AND bill_id = ? AND receipt_no = ? AND idempotency_key = ?
        )
    `).bind(
      input.newPaid,
      input.newBillStatus,
      input.newPaid,
      input.billId,
      input.tenantId,
      input.patientId,
      input.expectedBillTotal,
      input.expectedBillPaid,
      input.expectedBillStatus,
      input.tenantId,
      input.billId,
      input.receiptNo,
      input.paymentId,
    ), 'bill_update');

    pushAsserted(db.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id)
      SELECT date('now', '+6 hours'), 'other', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM payments
        WHERE tenant_id = ? AND bill_id = ? AND receipt_no = ? AND idempotency_key = ?
      )
    `).bind(
      input.amountForBill,
      `Gateway payment ${input.receiptNo}`,
      input.billId,
      input.tenantId,
      input.tenantId,
      input.billId,
      input.receiptNo,
      input.paymentId,
    ), 'income_insert');
  }

  if (input.depositAmount > 0) {
    pushAsserted(db.prepare(`
      INSERT INTO billing_deposits
        (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, payment_method, remarks, reference_bill_id, created_by)
      SELECT ?, ?, ?, ?, 'deposit', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM bills
        WHERE id = ? AND tenant_id = ? AND patient_id = ?
          AND total = ? AND paid = ? AND status = ?
      )
        AND NOT EXISTS (
          SELECT 1 FROM billing_deposits
          WHERE tenant_id = ? AND deposit_receipt_no = ?
        )
    `).bind(
      input.tenantId,
      input.patientId,
      input.advanceReceiptNo,
      input.depositAmount,
      input.gateway,
      `Gateway overpayment held as advance from bill ${input.billId}`,
      input.billId,
      input.userId,
      input.billId,
      input.tenantId,
      input.patientId,
      input.expectedBillTotal,
      input.newPaid,
      input.newBillStatus,
      input.tenantId,
      input.advanceReceiptNo,
    ), 'deposit_insert');
  }

  const paymentExistsClause = input.amountForBill > 0
    ? `AND EXISTS (
        SELECT 1 FROM payments
        WHERE tenant_id = ? AND bill_id = ? AND receipt_no = ? AND idempotency_key = ?
      )`
    : '';
  const depositExistsClause = input.depositAmount > 0
    ? `AND EXISTS (
        SELECT 1 FROM billing_deposits
        WHERE tenant_id = ? AND deposit_receipt_no = ?
      )`
    : '';
  const cashParams: unknown[] = [
    input.tenantId,
    input.userId,
    input.confirmedAmount,
    input.gatewayLogId,
    input.gateway,
    `Gateway payment ${input.receiptNo}`,
    input.gatewayLogId,
    input.tenantId,
    input.billId,
  ];
  if (input.amountForBill > 0) {
    cashParams.push(input.tenantId, input.billId, input.receiptNo, input.paymentId);
  }
  if (input.depositAmount > 0) {
    cashParams.push(input.tenantId, input.advanceReceiptNo);
  }
  pushAsserted(db.prepare(`
    INSERT INTO emp_cash_transactions
      (tenant_id, employee_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
    SELECT ?, ?, 'CashSales', ?, ?, 'payment_gateway', ?, ?
    WHERE EXISTS (
      SELECT 1 FROM payment_gateway_logs
      WHERE id = ? AND tenant_id = ? AND bill_id = ? AND status = 'verifying'
    )
    ${paymentExistsClause}
    ${depositExistsClause}
  `).bind(...cashParams), 'cash_transaction');

  pushAsserted(db.prepare(`
    UPDATE payment_gateway_logs
    SET status = 'success', raw_response = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND bill_id = ? AND status = 'verifying'
  `).bind(
    input.rawResponseJson,
    input.gatewayLogId,
    input.tenantId,
    input.billId,
  ), 'gateway_log_success');

  if (input.amountForBill > 0) {
    const eventType = ACCOUNTING_EVENT_TYPES.paymentReceived;
    const payloadJson = JSON.stringify({
      billId: input.billId,
      receiptNo: input.receiptNo,
      patientId: input.patientId,
      amount: input.amountForBill,
      paymentMethod: input.gateway,
      paymentType: 'current',
      idempotencyKey: input.paymentId,
      externalTransactionId: input.externalTransactionId,
    });
    pushAsserted(db.prepare(`
      INSERT INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'payment', ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, source_event_key) DO UPDATE SET
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        event_type = excluded.event_type,
        event_date = excluded.event_date,
        payload_json = excluded.payload_json,
        created_by = excluded.created_by
    `).bind(
      input.tenantId,
      createPostingEventKey('payment', input.receiptNo, eventType),
      input.receiptNo,
      eventType,
      input.businessDate,
      payloadJson,
      input.userId,
    ), 'payment_accounting_event');
  }

  if (input.depositAmount > 0) {
    const eventType = ACCOUNTING_EVENT_TYPES.patientDepositReceived;
    const payloadJson = JSON.stringify({
      receiptNo: input.advanceReceiptNo,
      referenceBillId: input.billId,
      patientId: input.patientId,
      amount: input.depositAmount,
      paymentMethod: input.gateway,
      idempotencyKey: `${input.paymentId}:advance`,
      externalTransactionId: input.externalTransactionId,
    });
    pushAsserted(db.prepare(`
      INSERT INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'deposit', ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, source_event_key) DO UPDATE SET
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        event_type = excluded.event_type,
        event_date = excluded.event_date,
        payload_json = excluded.payload_json,
        created_by = excluded.created_by
    `).bind(
      input.tenantId,
      createPostingEventKey('deposit', input.advanceReceiptNo, eventType),
      input.advanceReceiptNo,
      eventType,
      input.businessDate,
      payloadJson,
      input.userId,
    ), 'deposit_accounting_event');
  }

  statements.push(prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey));
  return statements;
}

async function recordGatewayLegacyPostCommitAccounting(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): Promise<void> {
  const sideEffects: Promise<unknown>[] = [];
  if (input.amountForBill > 0) {
    sideEffects.push(recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'payment',
      sourceId: input.receiptNo,
      eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
      eventDate: input.businessDate,
      createdBy: input.userId,
      payload: {
        billId: input.billId,
        receiptNo: input.receiptNo,
        patientId: input.patientId,
        amount: input.amountForBill,
        paymentMethod: input.gateway,
        paymentType: 'current',
        idempotencyKey: input.paymentId,
        externalTransactionId: input.externalTransactionId,
      },
    }));
  }
  if (input.depositAmount > 0) {
    sideEffects.push(recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'deposit',
      sourceId: input.advanceReceiptNo,
      eventType: ACCOUNTING_EVENT_TYPES.patientDepositReceived,
      eventDate: input.businessDate,
      createdBy: input.userId,
      payload: {
        receiptNo: input.advanceReceiptNo,
        referenceBillId: input.billId,
        patientId: input.patientId,
        amount: input.depositAmount,
        paymentMethod: input.gateway,
        idempotencyKey: `${input.paymentId}:advance`,
        externalTransactionId: input.externalTransactionId,
      },
    }));
  }
  await Promise.all(sideEffects);
}

export function prepareGatewayPaymentLegacyStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[] {
  const originalLegacyStatements = prepareGatewayPaymentOriginalLegacyStatements(db, input);
  Object.defineProperties(originalLegacyStatements, {
    strictAuthoritativeStatements: {
      value: () => prepareGatewayPaymentStrictStatements(db, input),
      enumerable: false,
      configurable: false,
      writable: false,
    },
    legacyPostCommit: {
      value: () => recordGatewayLegacyPostCommitAccounting(db, input),
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
  return originalLegacyStatements;
}
