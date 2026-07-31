const EXCEL_FORMULA_PREFIX = /^[=+\-@＝＋－＠]/u;
const CONTROL_CHARACTER_PREFIX = /^[\t\r\n]/u;

/**
 * Encode a value as a spreadsheet-safe CSV cell.
 *
 * Every field is quoted and embedded quotes are doubled. Values that could be
 * interpreted as formulas by spreadsheet software are prefixed with an
 * apostrophe so the exported report is treated as text.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = EXCEL_FORMULA_PREFIX.test(raw) || CONTROL_CHARACTER_PREFIX.test(raw)
    ? `'${raw}`
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}

export function buildCsv(rows: ReadonlyArray<readonly unknown[]>): string {
  return `\uFEFF${rows.map(csvRow).join('\r\n')}\r\n`;
}
