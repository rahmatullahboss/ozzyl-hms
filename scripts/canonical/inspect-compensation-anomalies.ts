import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

interface CountRow {
  category: string;
  count: number;
}

interface CliOptions {
  databasePath: string;
  tenantId: string;
}

function parseArgs(args: string[]): CliOptions {
  let databasePath = '';
  let tenantId = '100';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--database') databasePath = value;
    else if (arg === '--tenant') tenantId = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  if (!databasePath) throw new Error('--database is required');
  if (!/^\d+$/.test(tenantId)) throw new Error('--tenant must be numeric text');
  return { databasePath, tenantId };
}

function grouped(db: DatabaseSync, sql: string, tenantId: string): Record<string, number> {
  const parameterCount = sql.match(/\?/g)?.length ?? 0;
  const rows = db.prepare(sql).all(...Array.from({ length: parameterCount }, () => tenantId)) as unknown as CountRow[];
  return Object.fromEntries(rows.map((row) => [String(row.category), Number(row.count)]));
}

export function inspectCompensationAnomalies(databasePath: string, tenantId = '100') {
  if (!/^\d+$/.test(tenantId)) throw new Error('tenantId must be numeric text');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const compensationRows = grouped(db, `
      SELECT category,COUNT(*) count FROM (
        SELECT 'rules' category FROM canonical_compensation_rules WHERE tenant_id=?
        UNION ALL SELECT 'accruals' FROM canonical_compensation_accruals WHERE tenant_id=?
        UNION ALL SELECT 'settlements' FROM canonical_compensation_settlements WHERE tenant_id=?
        UNION ALL SELECT 'allocations' FROM canonical_compensation_settlement_allocations WHERE tenant_id=?
        UNION ALL SELECT 'adjustments' FROM canonical_compensation_adjustments WHERE tenant_id=?
      ) GROUP BY category ORDER BY category
    `, tenantId);

    const issueDispositions = grouped(db, `
      SELECT status||':'||issue_code category,COUNT(*) count
      FROM canonical_processing_issues
      WHERE tenant_id=? AND issue_type='compensation_backfill'
      GROUP BY status,issue_code ORDER BY status,issue_code
    `, tenantId);

    const mappingDispositions = grouped(db, `
      SELECT entity_type||':'||mapping_status category,COUNT(*) count
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type IN (
        'compensation_rule','compensation_accrual','compensation_adjustment',
        'compensation_settlement','compensation_settlement_allocation'
      )
      GROUP BY entity_type,mapping_status ORDER BY entity_type,mapping_status
    `, tenantId);

    const issues = grouped(db, `
      SELECT issue_code category, COUNT(*) count
      FROM canonical_processing_issues
      WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
      GROUP BY issue_code ORDER BY issue_code
    `, tenantId);

    const invoiceLineBySource = grouped(db, `
      SELECT source_type category, COUNT(*) count
      FROM canonical_processing_issues
      WHERE tenant_id=? AND issue_type='compensation_backfill'
        AND status='open' AND issue_code='COMPENSATION_INVOICE_LINE_UNRESOLVED'
      GROUP BY source_type ORDER BY source_type
    `, tenantId);

    const reserveInvoiceLine = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) reserve_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_INVOICE_LINE_UNRESOLVED'
          AND source_type='legacy_diagnostic_performer_reserve'
      ), classified AS (
        SELECT CASE
          WHEN m.canonical_public_id IS NULL OR m.mapping_status!='mapped' THEN 'invoice_item_mapping_missing'
          WHEN l.line_public_id IS NULL THEN 'mapped_invoice_line_missing'
          WHEN i.status!='posted' THEN 'invoice_not_posted'
          WHEN l.service_event_public_id IS NULL THEN 'service_event_missing'
          ELSE 'exact_line_ready'
        END category
        FROM affected a
        JOIN diagnostic_performer_reserves r ON r.id=a.reserve_id AND CAST(r.tenant_id AS TEXT)=?
        LEFT JOIN canonical_source_mappings m
          ON m.tenant_id=CAST(r.tenant_id AS TEXT)
         AND m.entity_type='invoice_line' AND m.source_type='legacy_invoice_item'
         AND m.source_public_id=CAST(r.invoice_item_id AS TEXT)
        LEFT JOIN canonical_invoice_lines l
          ON l.tenant_id=m.tenant_id AND l.line_public_id=m.canonical_public_id
        LEFT JOIN canonical_invoices i
          ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
      ) SELECT category,COUNT(*) count FROM classified GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const accrualInvoiceLine = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_INVOICE_LINE_UNRESOLVED'
          AND source_type='legacy_doctor_commission_accrual'
      ), base AS (
        SELECT a.id,a.performer_reserve_id,a.lab_order_item_id,a.bill_id,
          (SELECT COUNT(*) FROM canonical_source_mappings m
            WHERE m.tenant_id=CAST(a.tenant_id AS TEXT) AND m.entity_type='compensation_accrual'
              AND m.source_type='legacy_diagnostic_performer_reserve'
              AND m.source_public_id=CAST(a.performer_reserve_id AS TEXT)
              AND m.mapping_status='mapped') reserve_accrual_maps,
          (SELECT COUNT(*) FROM canonical_invoice_lines l
            WHERE l.tenant_id=CAST(a.tenant_id AS TEXT) AND l.service_event_public_id=(
              SELECT m.canonical_public_id FROM canonical_source_mappings m
              WHERE m.tenant_id=CAST(a.tenant_id AS TEXT) AND m.entity_type='service_event'
                AND m.source_type='legacy_lab_order_item'
                AND m.source_public_id=CAST(a.lab_order_item_id AS TEXT)
                AND m.mapping_status='mapped' LIMIT 1
            )) lab_event_lines,
          (SELECT COUNT(*) FROM canonical_invoice_lines l
            WHERE l.tenant_id=CAST(a.tenant_id AS TEXT) AND l.invoice_public_id=(
              SELECT m.canonical_public_id FROM canonical_source_mappings m
              WHERE m.tenant_id=CAST(a.tenant_id AS TEXT) AND m.entity_type='invoice'
                AND m.source_type='legacy_bill' AND m.source_public_id=CAST(a.bill_id AS TEXT)
                AND m.mapping_status='mapped' LIMIT 1
            ) AND l.line_type='service') bill_service_lines
        FROM affected x
        JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
      ), classified AS (
        SELECT CASE
          WHEN performer_reserve_id IS NOT NULL AND reserve_accrual_maps=1 THEN 'linked_reserve_accrual_ready'
          WHEN lab_order_item_id IS NOT NULL AND lab_event_lines=1 THEN 'unique_lab_event_line_ready'
          WHEN lab_order_item_id IS NOT NULL AND lab_event_lines>1 THEN 'lab_event_line_ambiguous'
          WHEN bill_id IS NOT NULL AND bill_service_lines=1 THEN 'unique_bill_service_line_ready'
          WHEN bill_id IS NOT NULL AND bill_service_lines>1 THEN 'bill_service_line_ambiguous'
          ELSE 'no_exact_line_authority'
        END category FROM base
      ) SELECT category,COUNT(*) count FROM classified GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const unresolvedAccrualIssueKinds = grouped(db, `
      WITH affected AS (
        SELECT issue_code,CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code IN ('COMPENSATION_INVOICE_LINE_UNRESOLVED','COMPENSATION_AMOUNT_MISMATCH')
          AND source_type='legacy_doctor_commission_accrual'
      )
      SELECT x.issue_code||':'||LOWER(a.source_type)||':'||LOWER(a.incentive_type) category,COUNT(*) count
      FROM affected x
      JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
      GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const unresolvedAccrualKinds = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code IN ('COMPENSATION_INVOICE_LINE_UNRESOLVED','COMPENSATION_AMOUNT_MISMATCH')
          AND source_type='legacy_doctor_commission_accrual'
      )
      SELECT LOWER(a.source_type)||':'||LOWER(a.incentive_type) category,COUNT(*) count
      FROM affected x
      JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
      GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const unresolvedRuleScopes = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code IN ('COMPENSATION_INVOICE_LINE_UNRESOLVED','COMPENSATION_AMOUNT_MISMATCH')
          AND source_type='legacy_doctor_commission_accrual'
      )
      SELECT COALESCE(r.scope_type,'missing')||':'||COALESCE(r.category_key,'') category,COUNT(*) count
      FROM affected x
      JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
      LEFT JOIN canonical_source_mappings rm
        ON rm.tenant_id=CAST(a.tenant_id AS TEXT) AND rm.entity_type='compensation_rule'
        AND rm.source_type='legacy_doctor_commission_rule'
        AND rm.source_public_id=CAST(a.commission_rule_id AS TEXT) AND rm.mapping_status='mapped'
      LEFT JOIN canonical_compensation_rules r
        ON r.tenant_id=rm.tenant_id AND r.rule_public_id=rm.canonical_public_id
      GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const accrualRuleScopeResolution = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code IN ('COMPENSATION_INVOICE_LINE_UNRESOLVED','COMPENSATION_AMOUNT_MISMATCH')
          AND source_type='legacy_doctor_commission_accrual'
      ), authority AS (
        SELECT a.id,a.gross_amount,r.scope_type,r.category_key,r.service_public_id,
          COUNT(l.id) total_service_lines,
          SUM(CASE WHEN r.scope_type='service' AND e.service_public_id=r.service_public_id THEN 1
                   WHEN r.scope_type='category' AND s.item_kind=CASE r.category_key
                     WHEN 'test' THEN 'laboratory'
                     WHEN 'lab_test' THEN 'laboratory'
                     WHEN 'doctor_visit' THEN 'consultation'
                     WHEN 'operation' THEN 'procedure'
                     WHEN 'medicine' THEN 'product'
                     ELSE r.category_key END THEN 1
                   ELSE 0 END) scoped_line_count,
          SUM(CASE WHEN (
                    (r.scope_type='service' AND e.service_public_id=r.service_public_id)
                    OR (r.scope_type='category' AND s.item_kind=CASE r.category_key
                      WHEN 'test' THEN 'laboratory'
                      WHEN 'lab_test' THEN 'laboratory'
                      WHEN 'doctor_visit' THEN 'consultation'
                      WHEN 'operation' THEN 'procedure'
                      WHEN 'medicine' THEN 'product'
                      ELSE r.category_key END)
                  ) AND l.line_amount_minor=ROUND(a.gross_amount*100) THEN 1 ELSE 0 END) scoped_amount_match_count
        FROM affected x
        JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
        LEFT JOIN canonical_source_mappings rm
          ON rm.tenant_id=CAST(a.tenant_id AS TEXT) AND rm.entity_type='compensation_rule'
          AND rm.source_type='legacy_doctor_commission_rule'
          AND rm.source_public_id=CAST(a.commission_rule_id AS TEXT) AND rm.mapping_status='mapped'
        LEFT JOIN canonical_compensation_rules r
          ON r.tenant_id=rm.tenant_id AND r.rule_public_id=rm.canonical_public_id
        LEFT JOIN canonical_source_mappings im
          ON im.tenant_id=CAST(a.tenant_id AS TEXT) AND im.entity_type='invoice'
          AND im.source_type='legacy_bill' AND im.source_public_id=CAST(a.bill_id AS TEXT)
          AND im.mapping_status='mapped'
        LEFT JOIN canonical_invoice_lines l
          ON l.tenant_id=im.tenant_id AND l.invoice_public_id=im.canonical_public_id
          AND l.line_type='service'
        LEFT JOIN canonical_service_events e
          ON e.tenant_id=l.tenant_id AND e.event_public_id=l.service_event_public_id
        LEFT JOIN canonical_service_catalog_items s
          ON s.tenant_id=e.tenant_id AND s.service_public_id=e.service_public_id
        GROUP BY a.id,r.scope_type,r.category_key,r.service_public_id
      ), classified AS (
        SELECT CASE
          WHEN scope_type='service' AND scoped_line_count=1 AND scoped_amount_match_count=1
            THEN 'service_scope_unique_line_and_amount'
          WHEN scope_type='service' AND scoped_line_count=1
            THEN 'service_scope_unique_line_amount_differs'
          WHEN scope_type='service' AND scoped_line_count>1 THEN 'service_scope_ambiguous'
          WHEN scope_type='category' AND scoped_line_count=1 AND scoped_amount_match_count=1
            THEN 'category_scope_unique_line_and_amount'
          WHEN scope_type='category' AND scoped_line_count=1
            THEN 'category_scope_unique_line_amount_differs'
          WHEN scope_type='category' AND scoped_line_count>1 THEN 'category_scope_ambiguous'
          WHEN scope_type='all' THEN 'all_scope_not_line_authoritative'
          WHEN scope_type IS NULL THEN 'rule_authority_missing'
          ELSE 'scoped_line_missing'
        END category FROM authority
      ) SELECT category,COUNT(*) count FROM classified GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const missingRuleCandidates = grouped(db, `
      WITH affected AS (
        SELECT CAST(source_public_id AS INTEGER) accrual_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_RULE_UNRESOLVED'
          AND source_type='legacy_doctor_commission_accrual'
      ), candidate_counts AS (
        SELECT a.id,COUNT(r.id) candidate_count
        FROM affected x
        JOIN doctor_commission_accruals a ON a.id=x.accrual_id AND CAST(a.tenant_id AS TEXT)=?
        LEFT JOIN doctor_commission_rules r
          ON CAST(r.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT)
         AND r.doctor_id=a.doctor_id
         AND r.incentive_type=a.incentive_type
         AND r.service_type=a.source_type
         AND COALESCE(r.is_active,1)=1
         AND (r.effective_from IS NULL OR date(r.effective_from)<=date(COALESCE(a.accrued_date,a.created_at)))
         AND (r.effective_to IS NULL OR date(r.effective_to)>=date(COALESCE(a.accrued_date,a.created_at)))
        GROUP BY a.id
      )
      SELECT CASE candidate_count
        WHEN 0 THEN 'no_exact_applicable_rule'
        WHEN 1 THEN 'one_exact_applicable_rule'
        ELSE 'multiple_applicable_rules'
      END category,COUNT(*) count
      FROM candidate_counts GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const amountMismatch = grouped(db, `
      WITH affected AS (
        SELECT source_type,CAST(source_public_id AS INTEGER) source_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_AMOUNT_MISMATCH'
      ), reserve_flags AS (
        SELECT CASE
          WHEN ROUND(r.unit_service_amount*100)!=l.line_amount_minor
            AND ROUND(r.net_unit_service_amount*100)!=ROUND((r.unit_service_amount-r.unit_discount_amount)*100)
            THEN 'reserve_line_and_net_mismatch'
          WHEN ROUND(r.unit_service_amount*100)!=l.line_amount_minor THEN 'reserve_line_amount_mismatch'
          WHEN ROUND(r.net_unit_service_amount*100)!=ROUND((r.unit_service_amount-r.unit_discount_amount)*100)
            THEN 'reserve_net_arithmetic_mismatch'
          WHEN cr.rate_type='fixed' AND cr.rate_value!=ROUND(r.reserved_amount*100)
            THEN 'reserve_fixed_rule_snapshot_mismatch'
          ELSE 'reserve_other_mismatch'
        END category
        FROM affected a
        JOIN diagnostic_performer_reserves r ON a.source_type='legacy_diagnostic_performer_reserve' AND r.id=a.source_id
        LEFT JOIN canonical_source_mappings lm ON lm.tenant_id=CAST(r.tenant_id AS TEXT)
          AND lm.entity_type='invoice_line' AND lm.source_type='legacy_invoice_item'
          AND lm.source_public_id=CAST(r.invoice_item_id AS TEXT) AND lm.mapping_status='mapped'
        LEFT JOIN canonical_invoice_lines l ON l.tenant_id=lm.tenant_id AND l.line_public_id=lm.canonical_public_id
        LEFT JOIN canonical_source_mappings rm ON rm.tenant_id=CAST(r.tenant_id AS TEXT)
          AND rm.entity_type='compensation_rule' AND rm.source_type='legacy_diagnostic_performer_rule'
          AND rm.source_public_id=CAST(r.rule_id AS TEXT) AND rm.mapping_status='mapped'
        LEFT JOIN canonical_compensation_rules cr ON cr.tenant_id=rm.tenant_id AND cr.rule_public_id=rm.canonical_public_id
      ), accrual_flags AS (
        SELECT CASE
          WHEN ROUND(a.gross_amount*100)!=l.line_amount_minor THEN 'accrual_line_amount_mismatch'
          WHEN ROUND((COALESCE(NULLIF(a.earned_commission_amount,0),a.commission_amount)-a.doctor_waiver_amount)*100)
               !=ROUND(a.payable_commission_amount*100) THEN 'accrual_payable_snapshot_mismatch'
          WHEN a.status='paid' AND (ROUND(a.paid_amount*100)!=ROUND(a.payable_commission_amount*100) OR ROUND(a.balance_amount*100)!=0)
            THEN 'accrual_paid_snapshot_mismatch'
          WHEN a.status!='paid' AND (ROUND(a.paid_amount*100)!=0 OR ROUND(a.balance_amount*100)!=ROUND(a.payable_commission_amount*100))
            THEN 'accrual_open_snapshot_mismatch'
          ELSE 'accrual_other_mismatch'
        END category
        FROM affected x
        JOIN doctor_commission_accruals a ON x.source_type='legacy_doctor_commission_accrual' AND a.id=x.source_id
        LEFT JOIN canonical_source_mappings im ON im.tenant_id=CAST(a.tenant_id AS TEXT)
          AND im.entity_type='invoice' AND im.source_type='legacy_bill'
          AND im.source_public_id=CAST(a.bill_id AS TEXT) AND im.mapping_status='mapped'
        LEFT JOIN canonical_invoice_lines l ON l.tenant_id=im.tenant_id AND l.invoice_public_id=im.canonical_public_id
          AND l.line_type='service'
        GROUP BY a.id
        HAVING COUNT(l.id)<=1
      )
      SELECT category,COUNT(*) count FROM (
        SELECT category FROM reserve_flags UNION ALL SELECT category FROM accrual_flags
      ) GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const ruleUnresolved = grouped(db, `
      WITH affected AS (
        SELECT source_type,CAST(source_public_id AS INTEGER) source_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_RULE_UNRESOLVED'
      )
      SELECT CASE
        WHEN x.source_type='legacy_doctor_commission_accrual' AND a.commission_rule_id IS NULL
          THEN 'legacy_accrual_rule_id_null'
        WHEN x.source_type='legacy_doctor_commission_accrual' THEN 'legacy_accrual_rule_mapping_missing'
        WHEN x.source_type='legacy_diagnostic_performer_reserve' THEN 'performer_rule_mapping_missing'
        ELSE 'other'
      END category,COUNT(*) count
      FROM affected x
      LEFT JOIN doctor_commission_accruals a
        ON x.source_type='legacy_doctor_commission_accrual' AND a.id=x.source_id
      GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    const settlementAccrual = grouped(db, `
      WITH affected_settlements AS (
        SELECT CAST(source_public_id AS INTEGER) settlement_id
        FROM canonical_processing_issues
        WHERE tenant_id=? AND issue_type='compensation_backfill' AND status='open'
          AND issue_code='COMPENSATION_SETTLEMENT_ACCRUAL_UNRESOLVED'
      ), item_state AS (
        SELECT CASE
          WHEN m.mapping_status='mapped' AND m.canonical_public_id IS NOT NULL THEN 'mapped_now'
          WHEN pi.issue_code IS NOT NULL THEN 'blocked_by_'||LOWER(pi.issue_code)
          WHEN m.mapping_status='ambiguous' THEN 'ambiguous_without_open_issue'
          WHEN m.canonical_public_id IS NULL THEN 'mapping_missing'
          ELSE 'other'
        END category
        FROM affected_settlements s
        JOIN doctor_commission_settlement_items i ON i.settlement_id=s.settlement_id
        LEFT JOIN canonical_source_mappings m
          ON m.tenant_id=CAST(i.tenant_id AS TEXT) AND m.entity_type='compensation_accrual'
          AND m.source_type='legacy_doctor_commission_accrual'
          AND m.source_public_id=CAST(i.accrual_id AS TEXT)
        LEFT JOIN canonical_processing_issues pi
          ON pi.tenant_id=CAST(i.tenant_id AS TEXT) AND pi.issue_type='compensation_backfill'
          AND pi.status='open' AND pi.source_type='legacy_doctor_commission_accrual'
          AND pi.source_public_id=CAST(i.accrual_id AS TEXT)
      ) SELECT category,COUNT(*) count FROM item_state GROUP BY category ORDER BY category
    `.replace('WHERE tenant_id=?', `WHERE tenant_id='${tenantId}'`), tenantId);

    return {
      schemaVersion: 1,
      tenantId,
      aggregateOnly: true,
      compensationRows,
      issueDispositions,
      mappingDispositions,
      issues,
      invoiceLineBySource,
      reserveInvoiceLine,
      accrualInvoiceLine,
      unresolvedAccrualIssueKinds,
      unresolvedAccrualKinds,
      unresolvedRuleScopes,
      accrualRuleScopeResolution,
      amountMismatch,
      ruleUnresolved,
      missingRuleCandidates,
      settlementAccrual,
    };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = inspectCompensationAnomalies(options.databasePath, options.tenantId);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
