/// <reference types="@cloudflare/workers-types" />
/**
 * Mock D1 Database factory for integration tests.
 *
 * Simulates the Cloudflare D1 `.prepare().bind().all() / .first() / .run()`
 * chain so route handlers can execute without a real database.
 *
 * Usage:
 *   const { db, queries } = createMockDB({
 *     tables: {
 *       admissions: [{ id: 1, tenant_id: 'tenant-1', ... }],
 *       patients: [...],
 *     },
 *   });
 */

export interface MockDBOptions {
  /** Map of table name → array of row objects to return */
  tables?: Record<string, Record<string, unknown>[]>;
  /**
   * Optional override: given (sql, params) returns a custom result.
   * If provided and returns non-null, this value is used instead of table data.
   */
  queryOverride?: (sql: string, params: unknown[]) => MockQueryResult | null;
  /**
   * When true, .first() never returns null — returns a universal fallback row
   * with common field names. This forces handlers past "not found" guards.
   */
  universalFallback?: boolean;
  /**
   * When true, route-level Canonical identity and command lookups receive a
   * coherent compatibility state instead of generic fallback rows.
   */
  canonicalCompatibility?: boolean;
  /**
   * When set, db.batch() throws this error instead of executing statements.
   * Used to test failure paths for code that calls db.batch().
   */
  batchError?: Error | string;
}

export interface MockQueryResult {
  results?: Record<string, unknown>[];
  first?: Record<string, unknown> | null;
  success?: boolean;
  meta?: Record<string, unknown>;
}

/** Recorded query for assertions in tests */
export interface RecordedQuery {
  sql: string;
  params: unknown[];
  method: 'all' | 'first' | 'run';
}

export interface MockDB {
  /** Mock D1Database interface (compatible with Cloudflare D1) */
  db: D1Database;
  /** All queries executed so far — use for assertions */
  queries: RecordedQuery[];
  /**
   * Each entry is the list of SQL strings passed in a single db.batch() call,
   * in execution order. Useful for asserting that several state-mutating
   * statements were committed atomically (i.e. within a single batch).
   */
  batchCalls: string[][];
  /** Reset recorded queries + batch calls between tests */
  reset(): void;
}

// ─── Internal D1 stub types ────────────────────────────────────────────────

interface MockBound {
  __sql?: string;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { last_row_id: number; changes: number; duration: number } }>;
  /** Drizzle internally calls raw() to get column values as arrays instead of objects */
  raw<T = unknown[]>(): Promise<T[]>;
}

// ─── Row-ID counter (resets per `createMockDB` call) ──────────────────────

let _rowIdCounter = 1000;

// ─── Factory ───────────────────────────────────────────────────────────────

export function createMockDB(options: MockDBOptions = {}): MockDB {
  const queries: RecordedQuery[] = [];
  const batchCalls: string[][] = [];
  const sourceTables = options.tables ?? {};
  const tables: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    Object.entries(sourceTables).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
  );
  const {
    queryOverride,
    universalFallback = false,
    canonicalCompatibility = true,
    batchError,
  } = options;
  let lastAppointmentContext: Record<string, unknown> | null = null;
  let lastPatientLinkPublicId = 'patient-link-1';
  let lastLegacyPatientId = 1;
  const noUniversalFallbackTables = new Set([
    'inventoryconsumptionrule',
    'inventoryconsumptionruleitem',
    'inventoryconsumptionevent',
    'inventoryconsumptioneventitem',
  ]);

  function shouldUseUniversalFallback(table: string | null): boolean {
    return Boolean(
      universalFallback
      && table
      && !table.startsWith('canonical_')
      && !noUniversalFallbackTables.has(table),
    );
  }

  // Universal fallback row — provides common fields for any table
  const FALLBACK_ROW: Record<string, unknown> = {
    id: 1, name: 'Test', status: 'active', tenant_id: 'tenant-1',
    patient_id: 1, doctor_id: 1, bill_id: 1, amount: 500, total: 1000,
    counter_id: 1, counter_session_id: 1, counter_name: 'Main Billing Counter',
    counter_code: 'BILL-1', counter_type: 'billing', opening_cash: 0,
    opened_at: '2025-01-01 09:00:00',
    due: 500, paid: 500, fee: 500, price: 500, quantity: 10,
    created_at: '2025-01-01', updated_at: '2025-01-01',
    email: 'test@test.com', role: 'hospital_admin', is_active: 1,
    is_read: 0, type: 'cash', category: 'general', description: 'Test',
    patient_name: 'Ali', doctor_name: 'Dr Khan', mobile: '017',
    address: 'Dhaka', gender: 'Male', age: 30, specialization: 'General',
    visit_type: 'opd', triage_level: 'yellow', chief_complaint: 'Test',
    diagnosis: 'Test', notes: 'Test notes', procedure: 'Test',
    ward: 'General', bed_number: 'B1', rate_per_day: 500,
    policy_number: 'P1', provider: 'ABC', allergen: 'Test',
    severity: 'low', share_token: 'tok123', token: 'tok123',
    subdomain: 'test', plan: 'premium', password_hash: '$2a$10$x',
    bill_no: 'B001', order_number: 'L001', patient_code: 'P001',
    share_count: 10, investment: 50000, profit_percentage: 50,
    code: '1000', unit_price: 500, sale_price: 1000,
    admission_id: 1, bed_id: 1, visit_id: 1, surgeon_id: 1,
    ot_date: '2025-06-01', appt_date: '2025-06-15',
    admission_date: '2025-01-01', discharge_date: '2025-01-05',
    key: 'hospital_name', value: 'Test Hospital',
    slug: 'about', title: 'About', content: 'Info',
    batch_number: 'B1', expiry_date: '2026-12-31',
    medicine_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS',
    day_of_week: 'monday', start_time: '09:00', end_time: '17:00',
    subject: 'Test', body: 'Hello', sender_id: 1, recipient_id: 2,
    from_user: 1, to_user: 2, reason: 'Test', balance: 5000,
    salary: 20000, position: 'Nurse', bank_account: 'B123',
    systolic: 120, diastolic: 80, pulse: 72, temperature: 98.6,
    month: '2025-01', total_profit: 100000, distributable_profit: 60000,
    next_run_date: '2025-02-01', is_active_num: 1,
    contact: '017', company: 'ABC', contact_person: 'Ali',
    // Additional fields for deeper handler coverage
    is_deleted: 0, verified: 1, category_id: 1,
    share_expires: new Date(Date.now() + 86400000).toISOString(),
    invited_by: 1, accepted_at: null,
    last_run_date: '2025-01-01', parent_id: null,
    generic_name: 'Test', form: 'Tablet', strength: '500mg',
    reorder_level: 20, stock_quantity: 100,
    sample_status: 'received', rx_no: 'RX001',
    supplier_id: 1, purchase_date: '2025-01-01',
    invoice_no: 'INV001', batch_no_2: 'B001',
    reference_no: 'REF001', debit_account_id: 1, credit_account_id: 2,
    lab_test_id: 1, test_name: 'CBC', result: '5.5',
    recorded_at: '2025-01-01', recorded_by: 1,
    visit_no: 'V001', visit_date: '2025-01-01',
    order_no: 'L001', order_date: '2025-01-01',
    charge_date: '2025-01-01', cn_no: 'CN001',
    requested_by: 1, expires_at: '2099-12-31',
    arrival_time: '2025-01-01T10:00:00Z', assigned_doctor: 1,
    discharge_notes_text: 'Stable', discharge_disposition: 'home',
    alert_type: 'vitals',
    task_type: 'medication', assigned_to: 1, priority: 'high',
    consultation_fee: 500, follow_up_date: '2025-01-15',
    sort_order: 1, icon: '🔹',
    invited_by_name: 'Admin', account_name: 'Cash',
    debit_account_name: 'Cash', credit_account_name: 'Bank',
    lab_test_name: 'CBC', medicine_id: 1,
    service_type: 'consultation', percentage: 20, flat_amount: 0,
    profit_sharing_percent: 60, reserve_percent: 10,
    distributable: 30000, net_profit: 20000,
    total_income: 50000, total_expense: 30000,
    period: '2025-01', heart_rate: 72, spo2: 99,
    date_of_birth: '1990-01-01',
    reaction: 'Rash', coverage_type: 'full', policy_no: 'P001',
    claim_amount: 5000,
  };

  function rememberOverrideContext(sql: string, override: MockQueryResult): void {
    const lower = sql.toLowerCase();
    if (lower.includes('from appointments') && override.first?.id != null) {
      lastAppointmentContext = { ...override.first };
      const patientId = Number(override.first.patient_id ?? 1);
      if (Number.isSafeInteger(patientId) && patientId > 0) {
        lastLegacyPatientId = patientId;
        lastPatientLinkPublicId = `patient-link-${patientId}`;
      }
    }
  }

  function canonicalCompatibilityFirst(
    sql: string,
    params: unknown[],
  ): { handled: boolean; row: Record<string, unknown> | null } {
    if (!canonicalCompatibility) return { handled: false, row: null };
    const lower = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      lastAppointmentContext
      && lower.includes(' from appointments ')
      && !lower.includes(' join ')
      && lower.includes(' where ')
    ) {
      return {
        handled: true,
        row: {
          ...FALLBACK_ROW,
          ...lastAppointmentContext,
          appt_time: lastAppointmentContext.appt_time ?? '09:00',
          appointment_type: lastAppointmentContext.appointment_type ?? 'consultation',
          visit_type: lastAppointmentContext.visit_type ?? 'opd',
          source: lastAppointmentContext.source ?? 'walk_in',
          canonical_source_key: lastAppointmentContext.canonical_source_key
            ?? String(lastAppointmentContext.id ?? params.at(-1) ?? 1),
        },
      };
    }

    if (
      lastAppointmentContext
      && lower.includes(' from visits ')
      && lower.includes('patient_id')
      && lower.includes('doctor_id')
      && lower.includes('visit_type')
      && lower.includes('canonical_source_key')
      && lower.includes(' where ')
    ) {
      return {
        handled: true,
        row: {
          ...FALLBACK_ROW,
          id: Number(lastAppointmentContext.visit_id ?? 1),
          patient_id: Number(lastAppointmentContext.patient_id ?? 1),
          doctor_id: Number(lastAppointmentContext.doctor_id ?? 1),
          visit_type: String(lastAppointmentContext.visit_type ?? 'opd'),
          visit_date: String(lastAppointmentContext.appt_date ?? '2025-01-01'),
          status: 'initiated',
          appointment_id: Number(lastAppointmentContext.id ?? 1),
          canonical_source_key: String(lastAppointmentContext.visit_id ?? 1),
        },
      };
    }

    if (lower.includes('from canonical_tenant_patient_links')) {
      if (lower.includes('select legacy_patient_id')) {
        return {
          handled: true,
          row: {
            legacy_patient_id: lastLegacyPatientId,
            link_status: 'active',
            effective_to_utc: null,
          },
        };
      }
      const patientId = Number(params[1] ?? lastAppointmentContext?.patient_id ?? lastLegacyPatientId);
      if (Number.isSafeInteger(patientId) && patientId > 0) {
        lastLegacyPatientId = patientId;
        lastPatientLinkPublicId = `patient-link-${patientId}`;
      }
      return {
        handled: true,
        row: {
          link_count: 1,
          patient_link_public_id: lastPatientLinkPublicId,
        },
      };
    }

    if (lower.includes('from canonical_source_mappings')) {
      const sourcePublicId = String(params.at(-1) ?? '1');
      if (sourcePublicId.startsWith('docsrc_') || sourcePublicId.startsWith('vissrc_')) {
        return { handled: true, row: null };
      }
      const entityType = lower.match(/entity_type\s*=\s*'([^']+)'/)?.[1]
        ?? (lower.includes("entity_type='appointment'") ? 'appointment' : null)
        ?? (lower.includes("entity_type='practitioner'") ? 'practitioner' : null)
        ?? (lower.includes("entity_type='encounter'") ? 'encounter' : null)
        ?? 'canonical';
      if (entityType === 'encounter') {
        const knownEncounterSources = new Set([
          String(lastAppointmentContext?.visit_id ?? ''),
          String(lastAppointmentContext?.id ?? ''),
        ].filter(Boolean));
        if (!knownEncounterSources.has(sourcePublicId)) {
          return { handled: true, row: null };
        }
        return {
          handled: true,
          row: { canonical_public_id: 'encounter-test', mapping_status: 'mapped' },
        };
      }
      if (entityType === 'appointment') {
        const appointmentSource = String(
          lastAppointmentContext?.canonical_source_key
          ?? lastAppointmentContext?.id
          ?? '',
        );
        if (!appointmentSource || sourcePublicId !== appointmentSource) {
          return { handled: true, row: null };
        }
        return {
          handled: true,
          row: { canonical_public_id: `appointment-${sourcePublicId}`, mapping_status: 'mapped' },
        };
      }
      if (entityType === 'practitioner' && /^\d+$/.test(sourcePublicId)) {
        const knownPractitionerSource = String(lastAppointmentContext?.doctor_id ?? '');
        if (!knownPractitionerSource || sourcePublicId !== knownPractitionerSource) {
          return { handled: true, row: null };
        }
        return {
          handled: true,
          row: { canonical_public_id: `practitioner-${sourcePublicId}`, mapping_status: 'mapped' },
        };
      }
      return { handled: true, row: null };
    }

    if (lower.includes('from canonical_appointments')) {
      return {
        handled: true,
        row: { current_status: 'arrived', status_version: 1 },
      };
    }

    if (lower.includes('from canonical_encounters')) {
      const requestedEncounterPublicId = String(params.at(-1) ?? 'encounter-test');
      if (requestedEncounterPublicId.startsWith('enc_') && requestedEncounterPublicId !== 'encounter-test') {
        return { handled: true, row: null };
      }
      return {
        handled: true,
        row: {
          encounter_public_id: 'encounter-test',
          legacy_patient_id: lastLegacyPatientId,
          patient_link_public_id: lastPatientLinkPublicId,
          encounter_type: 'outpatient',
          status: 'in_progress',
          encounter_version: 1,
          started_at_utc: '2025-01-01T03:00:00.000Z',
          ended_at_utc: null,
        },
      };
    }

    return { handled: false, row: null };
  }

  /**
   * Extract column names from SELECT clause in SQL.
   * Drizzle reads values by position via .raw(), so we need to know column order.
   */
  function extractSelectColumns(sql: string): string[] {
    const upper = sql.toUpperCase().trim();
    const selectMatch = upper.match(/^SELECT\s+(.+?)\s+FROM\s/);
    if (!selectMatch) return [];
    return selectMatch[1]
      .split(',')
      .map(col => col.trim().replace(/"/g, '').split('.').pop()!.toLowerCase())
      .filter(Boolean);
  }

  /**
   * Reorder object values to match the SQL SELECT column order.
   * Drizzle reads values by position via .raw(), so we need to return
   * values in the exact order of the SELECT clause.
   */
  function reorderRowToSelectOrder(row: Record<string, unknown>, selectCols: string[]): unknown[] {
    if (selectCols.length === 0) return Object.values(row);
    return selectCols.map(col => {
      if (col in row) return row[col];
      const actualKey = Object.keys(row).find(k => k.toLowerCase() === col);
      return actualKey ? row[actualKey] : null;
    });
  }

  /**
   * SQL → table-name extractor.
   * For SELECT queries with subqueries (e.g. COALESCE(SELECT ... FROM inner)),
   * finds the OUTERMOST FROM by tracking parenthesis depth.
   */
  function extractTableName(sql: string): string | null {
    const normalised = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    // Skip leading subquery parentheses to find the actual query structure
    let working = normalised;
    if (working.startsWith('(')) {
      // Remove outer parentheses to expose the inner query
      working = working.replace(/^\s*\(/, '').trim();
      // For UNION queries, the outer structure is always billing_service_items (first part of UNION)
      if (working.startsWith('SELECT') && working.includes('UNION')) {
        return 'billing_service_items';
      }
    }

    // INSERT INTO table
    let m = normalised.match(/INSERT\s+INTO\s+([A-Z_]+)/);
    if (m) return m[1].toLowerCase();
    // UPDATE table
    m = normalised.match(/^UPDATE\s+([A-Z_]+)/);
    if (m) return m[1].toLowerCase();
    // DELETE FROM table
    m = normalised.match(/DELETE\s+FROM\s+([A-Z_]+)/);
    if (m) return m[1].toLowerCase();
    // SELECT ... FROM table — find outermost FROM (depth == 0)
    let depth = 0;
    for (let i = 0; i < working.length; i++) {
      if (working[i] === '(') { depth++; continue; }
      if (working[i] === ')') { depth--; continue; }
      if (depth === 0 && working.substring(i, i + 5) === 'FROM ') {
        const rest = working.substring(i + 5).trimStart();
        const tableMatch = rest.match(/^([A-Z_]+)/);
        if (tableMatch) return tableMatch[1].toLowerCase();
      }
    }
    return null;
  }

  function extractReturningColumns(sql: string): string[] {
    const match = sql.match(/\bRETURNING\b\s+(.+)$/i);
    if (!match) return [];

    return match[1]
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        const quoted = trimmed.match(/"([^"]+)"/);
        if (quoted) return quoted[1].toLowerCase();
        return trimmed.replace(/[`"'[\]]/g, '').split(/\s+/)[0].toLowerCase();
      })
      .filter(Boolean);
  }

  function buildReturningRow(sql: string): Record<string, unknown> {
    const columns = extractReturningColumns(sql);
    if (columns.length === 0) return { ...FALLBACK_ROW };

    const row: Record<string, unknown> = {};
    for (const column of columns) {
      const value = FALLBACK_ROW[column];
      row[column] = value ?? null;
    }
    return row;
  }

  function materializeSimpleLegacyInsert(sql: string, params: unknown[], rowId: number): void {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const match = normalized.match(/^INSERT\s+INTO\s+(doctors)\s*\((.+)\)\s*VALUES\s*\((.+)\)$/i);
    if (!match) return;

    const table = match[1].toLowerCase();
    const columns = match[2].split(',').map((column) => column.trim().replace(/[`"']/g, '').toLowerCase());
    const valueTokens = match[3].split(',').map((token) => token.trim());
    if (columns.length !== valueTokens.length) return;

    let paramIndex = 0;
    const row: Record<string, unknown> = { id: rowId };
    for (let index = 0; index < columns.length; index++) {
      const token = valueTokens[index];
      if (token === '?') {
        row[columns[index]] = params[paramIndex++];
      } else if (/^NULL$/i.test(token)) {
        row[columns[index]] = null;
      } else if (/^-?\d+(?:\.\d+)?$/.test(token)) {
        row[columns[index]] = Number(token);
      } else {
        row[columns[index]] = token.replace(/^'(.*)'$/, '$1');
      }
    }

    const rows = tables[table] ?? (tables[table] = []);
    const sourceKey = row.canonical_source_key;
    const existingIndex = sourceKey == null
      ? -1
      : rows.findIndex((candidate) => candidate.canonical_source_key === sourceKey);
    if (existingIndex >= 0) rows[existingIndex] = row;
    else rows.push(row);
  }

  /**
   * Filter rows from a table by the bound params.
   *
   * Handles:
   * - `col = ?`  equality conditions
   * - `col LIKE ?` pattern conditions
   * - `col IN (?, ?, ...)` multi-value membership
   */
  function filterRows(
    sql: string,
    params: unknown[],
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const upper = sql.toUpperCase();
    const whereIndex = upper.indexOf(' WHERE ');
    const shouldEvaluateWhereOnly = (upper.trim().startsWith('UPDATE ') || upper.trim().startsWith('DELETE ')) && whereIndex >= 0;
    const conditionSource = shouldEvaluateWhereOnly ? upper.slice(whereIndex) : upper;
    const initialParamOffset = shouldEvaluateWhereOnly
      ? (upper.slice(0, whereIndex).match(/\?/g) || []).length
      : 0;

    type Condition =
      | { col: string; op: 'eq'; paramIdx: number }
      | { col: string; op: 'like'; paramIdx: number }
      | { col: string; op: 'neq'; paramIdx: number }
      | { col: string; op: 'gte'; paramIdx: number }
      | { col: string; op: 'lte'; paramIdx: number }
      | { col: string; op: 'gt'; paramIdx: number }
      | { col: string; op: 'lt'; paramIdx: number }
      | { col: string; op: 'in'; values: unknown[] };

    const conditions: Condition[] = [];
    let paramOffset = initialParamOffset;

    // Positional scan: walk the normalised SQL and assign params as they appear
    // Updated regex: handles optional table alias (e.g., a.col_name) and more operators
    const tokenRegex = /(?:[A-Z_]+\.)?([A-Z_]+)\s+(>=|<=|<>|!=|=|LIKE|>|<)\s+\?|(?:[A-Z_]+\.)?([A-Z_]+)\s+IN\s*\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(conditionSource)) !== null) {
      if (match[1] && match[2]) {
        // equality, comparison, or LIKE
        const col = match[1].toLowerCase();
        const rawOp = match[2];
        let op: Condition['op'];
        if (rawOp === 'LIKE') op = 'like';
        else if (rawOp === '>=' ) op = 'gte';
        else if (rawOp === '<=') op = 'lte';
        else if (rawOp === '>' ) op = 'gt';
        else if (rawOp === '<' ) op = 'lt';
        else if (rawOp === '!=' || rawOp === '<>') op = 'neq';
        else op = 'eq';
        conditions.push({ col, op, paramIdx: paramOffset });
        paramOffset++;
      } else if (match[3] && match[4]) {
        // IN (?, 'literal', ...) — include both bound values and simple SQL literals.
        // This keeps tenant fallback queries such as tenant_id IN (?, '0') testable.
        const col = match[3].toLowerCase();
        const inContent = match[4];
        const questionCount = (inContent.match(/\?/g) || []).length;
        const boundValues = params.slice(paramOffset, paramOffset + questionCount);
        const literalValues = inContent
          .split(',')
          .map(part => part.trim())
          .filter(part => part !== '?' && part.length > 0)
          .map(part => part.replace(/^['"]|['"]$/g, ''));
        const values = [...boundValues, ...literalValues];
        if (questionCount > 0 && values.length > 0) {
          conditions.push({ col, op: 'in', values });
        }
        paramOffset += questionCount;
      }
    }

    if (conditions.length === 0 || params.length === 0) return rows;

    return rows.filter(row => {
      for (const cond of conditions) {
        let val: any = row[cond.col];
        if (val === undefined) {
          const actualKey = Object.keys(row).find(k => k.toLowerCase() === cond.col);
          if (actualKey) val = row[actualKey];
        }
        
        if (cond.op === 'in') {
          if (!cond.values.includes(val)) return false;
          continue;
        }

        const paramVal = params[cond.paramIdx] as any;
        
        // Let D1 loose equality handle number-string conversions correctly (e.g., 1 == "1")
        if (cond.op === 'eq') { if (val != paramVal) return false; }
        else if (cond.op === 'neq') { if (val == paramVal) return false; }
        else if (cond.op === 'like') {
          const regex = new RegExp(`^${String(paramVal).replace(/%/g, '.*')}$`, 'i');
          if (!regex.test(String(val))) return false;
        }
        else if (cond.op === 'gt') { if (val <= paramVal) return false; }
        else if (cond.op === 'gte') { if (val < paramVal) return false; }
        else if (cond.op === 'lt') { if (val >= paramVal) return false; }
        else if (cond.op === 'lte') { if (val > paramVal) return false; }
      }
      return true;
    });
  }

  /**
   * Handle aggregate queries — COUNT(*), COALESCE(SUM(...)), etc.
   * Returns { cnt: N, count: N, balance: 0, returned: 0 } as a sensible default.
   */
  function handleAggregate(
    sql: string,
    params: unknown[],
    table: string,
  ): Record<string, unknown> | null {
    const upper = sql.toUpperCase();

    const maxPlusOne = sql.match(
      /COALESCE\s*\(\s*MAX\s*\(\s*([A-Z0-9_.]+)\s*\)\s*,\s*0\s*\)\s*\+\s*1\s+AS\s+([A-Z_]+)/i,
    );
    if (maxPlusOne) {
      const rows = tables[table] ?? [];
      const filtered = filterRows(sql, params, rows);
      const column = maxPlusOne[1].split('.').at(-1)?.toLowerCase() ?? 'id';
      const alias = maxPlusOne[2].toLowerCase();
      const maximum = filtered.reduce((current, row) => {
        const value = Number(row[column] ?? 0);
        return Number.isFinite(value) ? Math.max(current, value) : current;
      }, 0);
      return { [alias]: maximum + 1 };
    }

    if (/COUNT\s*\(\s*\*\s*\)/i.test(sql)) {
      const rows = tables[table] ?? [];
      const filtered = filterRows(sql, params, rows);
      const alias = sql.match(/COUNT\s*\(\s*\*\s*\)\s+AS\s+([A-Z_]+)/i)?.[1]?.toLowerCase();
      return {
        cnt: filtered.length,
        count: filtered.length,
        ...(alias ? { [alias]: filtered.length } : {}),
      };
    }

    // Aggregate with COALESCE/SUM — sum actual rows instead of returning 0
    // Only match COALESCE when it wraps an aggregate (SUM/COUNT/etc.), not
    // COALESCE(column, default) used in WHERE clauses.
    const outerAggregate = /^\s*SELECT\s+(?:COALESCE\s*\(\s*)?(?:SUM|COUNT|AVG|MIN|MAX)\s*\(/i.test(sql);
    if (outerAggregate) {
      const rows = tables[table] ?? [];
      const filtered = filterRows(sql, params, rows);
      const total = filtered.reduce((sum, row) => {
        const amt = Number(
          row['amount']
          ?? row['pending_amount']
          ?? row['total_amount']
          ?? row['due']
          ?? row['fee']
          ?? row['line_total']
          ?? row['quantity']
          ?? 0,
        );
        return sum + (isNaN(amt) ? 0 : amt);
      }, 0);
      const firstRow = filtered[0] ?? {};
      return {
        ...firstRow,
        appointment_id: firstRow['appointment_id'] ?? firstRow['id'],
        amount: total,
        balance: total,
        returned: 0,
        new_total: total,
        pending_amount: total,
        pending_item_count: filtered.length,
        cnt: filtered.length,
      };
    }

    return null;
  }

  function applyApprovalPolicyMutation(sql: string, params: unknown[]): { changes: number; lastRowId?: number } | null {
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    if (normalized.startsWith('INSERT INTO APPROVAL_DECISIONS')) {
      const revisionAware = normalized.includes('APPROVAL_REVISION');
      const tenantId = params[0];
      const approvalSource = params[1];
      const approvalRequestId = params[2];
      const approvalRevision = revisionAware ? Number(params[3] ?? 1) : 1;
      const approverId = params[revisionAware ? 4 : 3];
      const approverRole = params[revisionAware ? 5 : 4];
      const notes = params[revisionAware ? 6 : 5];
      const requests = tables.approval_requests ?? [];
      const decisions = tables.approval_decisions ?? (tables.approval_decisions = []);
      const request = requests.find((row) => String(row.tenant_id) === String(tenantId)
        && Number(row.id) === Number(approvalRequestId));
      const duplicate = decisions.some((row) => String(row.tenant_id) === String(tenantId)
        && String(row.approval_source ?? 'approval_requests') === String(approvalSource)
        && Number(row.approval_request_id) === Number(approvalRequestId)
        && Number(row.approval_revision ?? 1) === approvalRevision
        && row.superseded_at == null
        && Number(row.approver_id) === Number(approverId));
      const genericSource = String(approvalSource) !== 'approval_requests';
      const genericSubjectEligible = genericSource && (() => {
        if (String(approvalSource) === 'billing_handovers') {
          return (tables.billing_handovers ?? []).some((row) => String(row.tenant_id) === String(tenantId)
            && Number(row.id) === Number(approvalRequestId)
            && ['receiver_verified', 'disputed'].includes(String(row.status))
            && String(row.admin_verification_status ?? 'pending_admin') === 'pending_admin');
        }
        if (String(approvalSource) === 'expenses') {
          return (tables.expenses ?? []).some((row) => String(row.tenant_id) === String(tenantId)
            && Number(row.id) === Number(approvalRequestId)
            && String(row.approval_status ?? row.status ?? 'pending') === 'pending');
        }
        return false;
      })();
      const genericRequiredApprovals = Math.max(1, Number(params[revisionAware ? 11 : 9] ?? 2));
      const genericApprovalCount = decisions.filter((row) => String(row.tenant_id) === String(tenantId)
        && String(row.approval_source ?? 'approval_requests') === String(approvalSource)
        && Number(row.approval_request_id) === Number(approvalRequestId)
        && Number(row.approval_revision ?? 1) === approvalRevision
        && row.superseded_at == null
        && String(row.decision ?? 'approve') === 'approve').length;
      if (duplicate
        || (genericSource && (!genericSubjectEligible || genericApprovalCount >= genericRequiredApprovals))
        || (!genericSource && (!request
          || Number(request.approval_revision ?? 1) !== approvalRevision
          || !['pending', 'partially_approved'].includes(String(request.status))
          || Number(request.requested_by) === Number(approverId)))) {
        return { changes: 0 };
      }
      const id = ++_rowIdCounter;
      decisions.push({
        id,
        tenant_id: tenantId,
        approval_source: approvalSource,
        approval_request_id: approvalRequestId,
        approval_revision: approvalRevision,
        approver_id: approverId,
        approver_role: approverRole,
        decision: 'approve',
        notes: notes ?? null,
        superseded_at: null,
        superseded_by_revision: null,
        superseded_reason: null,
        created_at: '2026-07-19 18:00:00',
      });
      return { changes: 1, lastRowId: id };
    }

    if (normalized.startsWith('UPDATE APPROVAL_REQUESTS')
      && normalized.includes('SET APPROVAL_COUNT = MIN(REQUIRED_APPROVALS')) {
      const revisionAware = normalized.includes('D.APPROVAL_REVISION = APPROVAL_REQUESTS.APPROVAL_REVISION');
      const tenantId = params.at(revisionAware ? -3 : -2);
      const approvalRequestId = params.at(revisionAware ? -2 : -1);
      const approvalRevision = revisionAware
        ? Number(params.at(-1) ?? 1)
        : Number((tables.approval_requests ?? []).find((row) => Number(row.id) === Number(approvalRequestId))?.approval_revision ?? 1);
      const request = (tables.approval_requests ?? []).find((row) => String(row.tenant_id) === String(tenantId)
        && Number(row.id) === Number(approvalRequestId));
      if (!request
        || Number(request.approval_revision ?? 1) !== approvalRevision
        || !['pending', 'partially_approved'].includes(String(request.status))) {
        return { changes: 0 };
      }
      const approvalSource = String(params[0] ?? 'approval_requests');
      const required = Math.max(1, Number(request.required_approvals ?? 2));
      const count = (tables.approval_decisions ?? []).filter((row) => String(row.tenant_id) === String(tenantId)
        && String(row.approval_source ?? 'approval_requests') === approvalSource
        && Number(row.approval_request_id) === Number(approvalRequestId)
        && Number(row.approval_revision ?? 1) === approvalRevision
        && row.superseded_at == null
        && String(row.decision ?? 'approve') === 'approve').length;
      request.required_approvals = required;
      request.approval_count = Math.min(required, count);
      request.status = count >= required ? 'approved' : count > 0 ? 'partially_approved' : request.status;
      if (count > 0 && !request.first_approved_at) request.first_approved_at = '2026-07-19 18:00:00';
      if (count >= required && !request.fully_approved_at) request.fully_approved_at = '2026-07-19 18:00:00';
      return { changes: 1 };
    }

    return null;
  }

  function buildBound(sql: string, params: unknown[]): MockBound {
    return {
      __sql: sql,
      async all<T = Record<string, unknown>>() {
        queries.push({ sql, params, method: 'all' });
        const table = extractTableName(sql);
        const upper = sql.replace(/\s+/g, ' ').trim().toUpperCase();

        // Ensure returning on INSERT/UPDATE returns our fallback row so handlers dont crash
        if ((upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) && upper.includes('RETURNING')) {
          return { results: [buildReturningRow(sql)] as T[], success: true, meta: {} };
        }
        if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
          const approvalMutation = applyApprovalPolicyMutation(sql, params);
          const rowId = approvalMutation?.lastRowId ?? ++_rowIdCounter;
          if (!approvalMutation && upper.startsWith('INSERT')) {
            materializeSimpleLegacyInsert(sql, params, rowId);
          }
          return {
            results: [] as T[],
            success: true,
            meta: {
              last_row_id: rowId,
              changes: approvalMutation?.changes ?? 1,
              duration: 0,
            },
          };
        }

        // Handle aggregate queries in all() — needed for batch() which calls all()
        if (table) {
          const agg = handleAggregate(sql, params, table);
          if (agg !== null) {
            return { results: [agg] as T[], success: true, meta: {} };
          }
        }

        const rows = table ? filterRows(sql, params, tables[table] ?? []) : [];
        // If universalFallback is on and query returned no rows, return a
        // single fallback row so handlers proceed to data-processing code
        if (rows.length === 0 && shouldUseUniversalFallback(table)) {
          return { results: [FALLBACK_ROW] as T[], success: true, meta: {} };
        }
        return { results: rows as T[], success: true, meta: {} };
      },
      async first<T = Record<string, unknown>>() {
        queries.push({ sql, params, method: 'first' });
        const compatibility = canonicalCompatibilityFirst(sql, params);
        if (compatibility.handled) return compatibility.row as T | null;
        const table = extractTableName(sql);
        if (!table) return null;

        // Handle aggregate queries
        const agg = handleAggregate(sql, params, table);
        if (agg !== null) return agg as T;

        const rows = filterRows(sql, params, tables[table] ?? []);
        if (rows[0]) return rows[0] as T;
        // If universalFallback is on, return a generic row instead of null
        if (shouldUseUniversalFallback(table)) return FALLBACK_ROW as T;
        return null;
      },
      async run() {
        queries.push({ sql, params, method: 'run' });
        const upper = sql.replace(/\s+/g, ' ').trim().toUpperCase();
        const approvalMutation = applyApprovalPolicyMutation(sql, params);
        if (approvalMutation) {
          return {
            success: true,
            meta: {
              last_row_id: approvalMutation.lastRowId ?? ++_rowIdCounter,
              changes: approvalMutation.changes,
              duration: 0,
            },
          };
        }
        const rowId = ++_rowIdCounter;
        let changes = 1; // default for INSERT
        // For UPDATE/DELETE, calculate changes based on matching rows
        if (upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
          const table = extractTableName(sql);
          if (table) {
            const rows = tables[table] ?? [];
            const filtered = filterRows(sql, params, rows);
            changes = table === 'inventory_issue_operation' && rows.length === 0
              ? 1
              : filtered.length;
          } else {
            changes = 0;
          }
        }
        return {
          success: true,
          meta: {
            last_row_id: rowId,
            changes,
            duration: 0,
          },
        };
      },
      async raw<T = unknown[]>() {
        queries.push({ sql, params, method: 'all' });
        const upper = sql.toUpperCase();
        if ((upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) && upper.includes('RETURNING')) {
          const row = buildReturningRow(sql);
          return [Object.values(row)] as T[];
        }
        const table = extractTableName(sql);
        const rows = table ? filterRows(sql, params, tables[table] ?? []) : [];
        const finalRows = (rows.length === 0 && shouldUseUniversalFallback(table)) ? [FALLBACK_ROW] : rows;
        // raw() returns array-of-arrays (column values) instead of array-of-objects
        return finalRows.map((row) => Object.values(row)) as T[];
      },
    };
  }

  function buildStatement(sql: string) {
    const bindFn = function(...params: unknown[]): MockBound {
      // Custom override hook
      if (queryOverride) {
        const override = queryOverride(sql, params);
        if (override !== null) {
          rememberOverrideContext(sql, override);
          const bound: MockBound = {
            __sql: sql,
            async all<T>() {
              queries.push({ sql, params, method: 'all' });
              return {
                results: (override.results ?? []) as T[],
                success: override.success ?? true,
                meta: {
                  last_row_id: Number(override.meta?.last_row_id ?? ++_rowIdCounter),
                  changes: Number(override.meta?.changes ?? 1),
                  duration: 0,
                },
              };
            },
            async first<T>() {
              queries.push({ sql, params, method: 'first' });
              // Use override.first if set, otherwise fall back to first result row
              return (override.first ?? override.results?.[0] ?? null) as T | null;
            },
            async run() {
              queries.push({ sql, params, method: 'run' });
              return {
                success: override.success ?? true,
                meta: {
                  last_row_id: Number(override.meta?.last_row_id ?? ++_rowIdCounter),
                  changes: Number(override.meta?.changes ?? 1),
                  duration: 0,
                },
              };
            },
            async raw<T = unknown[]>() {
              queries.push({ sql, params, method: 'all' });
              const rows = override.results ?? [];
              const selectCols = extractSelectColumns(sql);
              return rows.map((row) => reorderRowToSelectOrder(row, selectCols)) as T[];
            },
          };
          return bound;
        }
      }
      return buildBound(sql, params);
    };

    return {
      bind: bindFn,
      async first<T = Record<string, unknown>>() {
        return bindFn().first<T>();
      },
      async all<T = Record<string, unknown>>() {
        return bindFn().all<T>();
      },
      async run() {
        return bindFn().run();
      },
      async raw<T = unknown[]>() {
        return bindFn().raw<T>();
      }
    };
  }

  const db = {
    prepare(sql: string) {
      return buildStatement(sql);
    },
    dump() {
      return Promise.resolve(new ArrayBuffer(0));
    },
    /** Execute a batch of statements — calls all() on each to match real D1 batch behaviour */
    async batch(statements: Array<MockBound>) {
      if (batchError !== undefined) {
        throw typeof batchError === 'string' ? new Error(batchError) : batchError;
      }
      // Record the SQL of every statement in this batch so tests can assert
      // atomicity (i.e. multiple mutations went through a single batch).
      // Each statement's bind() creates a fresh entry in queries; capture
      // the SQL right after bind() so we get the per-statement SQL.
      const batchSqls: string[] = [];
      const results = [];
      let previousChanges: number | null = null;
      for (const stmt of statements) {
        const isInventoryGuardStatement = stmt.__sql?.includes('INSERT INTO inventory_issue_batch_guard') ?? false;
        if (previousChanges === 0 && !isInventoryGuardStatement) break;

        const beforeLen = queries.length;
        const result = await stmt.all();
        results.push(result);
        const currentSqls: string[] = [];
        for (let i = beforeLen; i < queries.length; i++) {
          batchSqls.push(queries[i].sql);
          currentSqls.push(queries[i].sql);
        }
        const isInventoryGuard = currentSqls.some((sql) => sql.includes('INSERT INTO inventory_issue_batch_guard'));
        if (isInventoryGuard && previousChanges === 0) {
          batchCalls.push(batchSqls);
          throw new Error('CHECK constraint failed: assertion_value = 1');
        }
        previousChanges = Number((result.meta as { changes?: number } | undefined)?.changes ?? 1);
      }
      batchCalls.push(batchSqls);
      return results;
    },
    exec() {
      return Promise.resolve({ count: 0, duration: 0 });
    },
  } as unknown as D1Database;

  return {
    db,
    queries,
    batchCalls,
    reset() {
      queries.length = 0;
      batchCalls.length = 0;
    },
  };
}

// ─── Mock KV Namespace ─────────────────────────────────────────────────────

export interface MockKV {
  kv: KVNamespace;
  store: Map<string, string>;
  reset(): void;
}

export function createMockKV(initial: Record<string, string> = {}): MockKV {
  const store = new Map<string, string>(Object.entries(initial));

  const kv = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, _opts?: object): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }> }> {
      return { keys: [...store.keys()].map((name) => ({ name })) };
    },
  } as unknown as KVNamespace;

  return {
    kv,
    store,
    reset() {
      store.clear();
      Object.entries(initial).forEach(([k, v]) => store.set(k, v));
    },
  };
}
