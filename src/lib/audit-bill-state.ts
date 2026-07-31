export function buildAuditBillStateSelect(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid bill table alias');
  }

  const total = `COALESCE(${alias}.total, 0)`;
  const storedPaid = `COALESCE(${alias}.paid, 0)`;
  const due = `CASE
    WHEN LOWER(COALESCE(${alias}.status, '')) = 'paid' THEN 0
    WHEN COALESCE(${alias}.due, 0) > 0 THEN MIN(${total}, MAX(0, ${alias}.due))
    ELSE MAX(0, ${total} - ${storedPaid})
  END`;

  return `
    ${alias}.status AS billStatus,
    ${total} AS billTotal,
    MAX(0, ${total} - (${due})) AS billPaid,
    ${due} AS billDue
  `;
}
