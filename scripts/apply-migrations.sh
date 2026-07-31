#!/bin/bash
# Apply migrations 0143-0148 safely to production D1
# Each ALTER TABLE runs independently — duplicates are ignored.
#
# Supports --dry-run: print the commands that would run, but do not
# execute any of them. Use this in CI/QA before touching production.
#
# Supports --max=N to bound how many ALTER TABLE statements we attempt
# per table. Default 1000 (i.e. effectively unbounded for the current
# 0143-0148 range).

set -euo pipefail

DB="hms-super-admin-production"
FLAGS="--remote"
DRY_RUN=0
MAX_PER_TABLE=1000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --max=*)
      MAX_PER_TABLE="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--dry-run] [--max=N]" >&2
      exit 2
      ;;
  esac
done

run_sql() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [DRY-RUN] would run: $1"
    return 0
  fi
  echo "  → $1"
  echo "$1" | wrangler d1 execute "$DB" $FLAGS --command="$1" 2>/dev/null || true
}

echo "═══════════════════════════════════════════════════════"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  DRY-RUN MODE — no statements will be executed"
fi
echo "  Applying migrations 0143-0148 to PRODUCTION"
echo "═══════════════════════════════════════════════════════"

echo ""
echo "── 0143: LIS Full Upgrade ──"
echo "Creating new tables..."
LIS_0143_SQL='CREATE TABLE IF NOT EXISTS lab_machines (id INTEGER PRIMARY KEY AUTOINCREMENT, machine_name TEXT NOT NULL, machine_code TEXT NOT NULL, machine_type TEXT, manufacturer TEXT, model_number TEXT, serial_number TEXT, protocol TEXT DEFAULT '"'"'astm'"'"', connection_type TEXT DEFAULT '"'"'tcp'"'"', host_address TEXT, port INTEGER, baud_rate INTEGER, is_bidirectional INTEGER DEFAULT 0, status TEXT DEFAULT '"'"'active'"'"', last_communication_at DATETIME, tenant_id TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_machines_code ON lab_machines(tenant_id, machine_code);
CREATE INDEX IF NOT EXISTS idx_lab_machines_tenant ON lab_machines(tenant_id, is_active);
CREATE TABLE IF NOT EXISTS lab_machine_test_map (id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id INTEGER NOT NULL, lab_test_id INTEGER NOT NULL, machine_test_code TEXT NOT NULL, machine_test_name TEXT, machine_unit TEXT, conversion_factor REAL DEFAULT 1.0, is_active INTEGER DEFAULT 1, tenant_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, machine_id, machine_test_code));
CREATE INDEX IF NOT EXISTS idx_lab_mtm_machine ON lab_machine_test_map(machine_id);
CREATE TABLE IF NOT EXISTS lab_machine_result_log (id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id INTEGER, raw_message TEXT NOT NULL, message_type TEXT, parsed_data TEXT, processing_status TEXT DEFAULT '"'"'received'"'"', error_message TEXT, matched_order_id INTEGER, matched_item_id INTEGER, tenant_id TEXT NOT NULL, received_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_machine ON lab_machine_result_log(machine_id);
CREATE INDEX IF NOT EXISTS idx_lab_mrl_tenant ON lab_machine_result_log(tenant_id, received_at);
CREATE TABLE IF NOT EXISTS lab_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_order_id INTEGER NOT NULL, lab_order_item_id INTEGER, report_date DATETIME DEFAULT CURRENT_TIMESTAMP, specimen_num TEXT, report_status TEXT DEFAULT '"'"'pending'"'"', review_status TEXT DEFAULT '"'"'pending'"'"', reviewed_by INTEGER, reviewed_at DATETIME, report_notes TEXT, pathologist_notes TEXT, tenant_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_lab_reports_order ON lab_reports(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_tenant ON lab_reports(tenant_id, report_status);
CREATE TABLE IF NOT EXISTS lab_results (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_report_id INTEGER NOT NULL, lab_test_id INTEGER NOT NULL, result_code TEXT, result_text TEXT, result_value TEXT, result_numeric REAL, units TEXT, normal_range TEXT, abnormal_flag TEXT DEFAULT '"'"'pending'"'"', result_status TEXT DEFAULT '"'"'preliminary'"'"', value_type TEXT DEFAULT '"'"'numeric'"'"', comments TEXT, entered_by INTEGER, machine_id INTEGER, tenant_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_lab_results_report ON lab_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_abnormal ON lab_results(tenant_id, abnormal_flag);'
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  [DRY-RUN] would execute the 0143 multi-statement block"
else
  wrangler d1 execute "$DB" $FLAGS --command="$LIS_0143_SQL" 2>&1
fi

echo "Adding columns to lab_test_catalog..."
count=0
for col in "parent_id INTEGER" "test_type TEXT DEFAULT 'single'" "specimen_type TEXT" "specimen_volume TEXT" "specimen_container TEXT" "department TEXT" "tat_minutes INTEGER" "display_sequence INTEGER DEFAULT 0" "interpretation_template TEXT" "value_type TEXT DEFAULT 'numeric'" "is_outsourced INTEGER DEFAULT 0" "outsource_vendor_id INTEGER"; do
  [[ $count -ge $MAX_PER_TABLE ]] && break
  run_sql "ALTER TABLE lab_test_catalog ADD COLUMN $col"
  count=$((count+1))
done

echo "Adding columns to lab_orders..."
count=0
for col in "status TEXT DEFAULT 'pending'" "priority TEXT DEFAULT 'routine'" "specimen_type TEXT" "specimen_fasting TEXT" "clinical_history TEXT" "control_id TEXT" "date_transmitted DATETIME" "machine_id INTEGER" "vendor_id INTEGER" "notes TEXT"; do
  [[ $count -ge $MAX_PER_TABLE ]] && break
  run_sql "ALTER TABLE lab_orders ADD COLUMN $col"
  count=$((count+1))
done

echo "Adding columns to lab_order_items..."
count=0
for col in "specimen_type TEXT" "specimen_num TEXT" "result_status TEXT DEFAULT 'pending'" "machine_id INTEGER" "machine_result_log_id INTEGER" "control_id TEXT"; do
  [[ $count -ge $MAX_PER_TABLE ]] && break
  run_sql "ALTER TABLE lab_order_items ADD COLUMN $col"
  count=$((count+1))
done

echo ""
echo "── 0144: Lab Signatories ──"
LAB_SIG_0144_SQL='CREATE TABLE IF NOT EXISTS lab_report_signatories (id INTEGER PRIMARY KEY AUTOINCREMENT, signatory_name TEXT NOT NULL, designation TEXT NOT NULL, qualification TEXT, registration_no TEXT, signature_image TEXT, display_order INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, tenant_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_lab_sig_tenant ON lab_report_signatories(tenant_id, is_active);'
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  [DRY-RUN] would execute the 0144 multi-statement block"
else
  wrangler d1 execute "$DB" $FLAGS --command="$LAB_SIG_0144_SQL" 2>&1
fi

count=0
for col in "signatory_ids TEXT" "printed_at DATETIME" "print_count INTEGER DEFAULT 0" "delivered_via TEXT" "delivered_at DATETIME"; do
  [[ $count -ge $MAX_PER_TABLE ]] && break
  run_sql "ALTER TABLE lab_reports ADD COLUMN $col"
  count=$((count+1))
done
count=0
for col in "previous_value TEXT" "delta_flag TEXT"; do
  [[ $count -ge $MAX_PER_TABLE ]] && break
  run_sql "ALTER TABLE lab_results ADD COLUMN $col"
  count=$((count+1))
done

echo ""
echo "── 0145: Clinical Reminders ──"
run_file() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [DRY-RUN] would execute file: $1"
  else
    wrangler d1 execute "$DB" $FLAGS --file="$1" 2>&1
  fi
}
run_file migrations/0145_clinical_reminders.sql

echo ""
echo "── 0146: Dynamic RBAC ──"
run_file migrations/0146_dynamic_rbac.sql

echo ""
echo "── 0147: Order Sets ──"
run_file migrations/0147_order_sets.sql

echo ""
echo "── 0148: Consent + Documents + KPI ──"
run_file migrations/0148_consent_documents_kpi.sql

echo ""
echo "═══════════════════════════════════════════════════════"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  DRY-RUN COMPLETE — no statements were executed"
else
  echo "  DONE — All migrations applied"
fi
echo "═══════════════════════════════════════════════════════"
