-- Performance Optimization: Additional Database Indexes
-- These indexes improve query performance for common operations

-- ===============================
-- PATIENT QUERY OPTIMIZATION
-- ===============================

-- Search patients by name (common operation)
CREATE INDEX IF NOT EXISTS idx_patients_name 
ON patients(name);

-- Search patients by mobile (for quick lookup)
CREATE INDEX IF NOT EXISTS idx_patients_mobile 
ON patients(mobile);

-- Filter patients by registration date
CREATE INDEX IF NOT EXISTS idx_patients_created 
ON patients(created_at);

-- ===============================
-- BILLING OPTIMIZATION
-- ===============================

-- Find bills by patient
CREATE INDEX IF NOT EXISTS idx_bills_patient 
ON bills(patient_id);

-- Find bills by status
CREATE INDEX IF NOT EXISTS idx_bills_status 
ON bills(status);

-- Find bills by date range
CREATE INDEX IF NOT EXISTS idx_bills_date 
ON bills(created_at);

-- ===============================
-- PAYMENT OPTIMIZATION
-- ===============================

-- Find payments by bill
CREATE INDEX IF NOT EXISTS idx_payments_bill 
ON payments(bill_id);

-- Find payments by date
CREATE INDEX IF NOT EXISTS idx_payments_date 
ON payments(date);

-- ===============================
-- INCOME/EXPENSE OPTIMIZATION
-- ===============================

-- Find income by source
CREATE INDEX IF NOT EXISTS idx_income_source 
ON income(source);

-- Find income by date range
CREATE INDEX IF NOT EXISTS idx_income_date 
ON income(date);

-- Find expenses by category
CREATE INDEX IF NOT EXISTS idx_expenses_category 
ON expenses(category);

-- Find expenses by status
CREATE INDEX IF NOT EXISTS idx_expenses_status 
ON expenses(status);

-- Find expenses by date range
CREATE INDEX IF NOT EXISTS idx_expenses_date 
ON expenses(date);

-- ===============================
-- STAFF OPTIMIZATION
-- ===============================

-- Find staff by position
CREATE INDEX IF NOT EXISTS idx_staff_position 
ON staff(position);

-- Find staff by status
CREATE INDEX IF NOT EXISTS idx_staff_status 
ON staff(status);

-- Find salary payments by staff
CREATE INDEX IF NOT EXISTS idx_salary_staff 
ON salary_payments(staff_id);

-- Find salary payments by month
CREATE INDEX IF NOT EXISTS idx_salary_month 
ON salary_payments(month);

-- ===============================
-- PHARMACY OPTIMIZATION
-- ===============================

-- Find medicines by name
CREATE INDEX IF NOT EXISTS idx_medicines_name 
ON medicines(name);

-- Find medicines by low stock
CREATE INDEX IF NOT EXISTS idx_medicines_quantity 
ON medicines(quantity);

-- Find stock by batch
CREATE INDEX IF NOT EXISTS idx_stock_batch 
ON medicine_stock_batches(batch_no);

-- Find stock by expiry
CREATE INDEX IF NOT EXISTS idx_stock_expiry 
ON medicine_stock_batches(expiry_date);

-- ===============================
-- ACCOUNTING OPTIMIZATION
-- ===============================

-- Find journal entries by date
CREATE INDEX IF NOT EXISTS idx_journal_date 
ON journal_entries(entry_date);

-- Find journal entries by account
CREATE INDEX IF NOT EXISTS idx_journal_debit 
ON journal_entries(debit_account_id);

CREATE INDEX IF NOT EXISTS idx_journal_credit 
ON journal_entries(credit_account_id);

-- Find audit logs by user
CREATE INDEX IF NOT EXISTS idx_audit_user 
ON audit_logs(user_id);

-- Find audit logs by table
CREATE INDEX IF NOT EXISTS idx_audit_table 
ON audit_logs(table_name);

-- Find audit logs by date
CREATE INDEX IF NOT EXISTS idx_audit_date 
ON audit_logs(created_at);

-- ===============================
-- DASHBOARD OPTIMIZATION
-- ===============================

-- Daily summaries pre-computed
CREATE INDEX IF NOT EXISTS idx_daily_income 
ON daily_income_summary(date, source);

CREATE INDEX IF NOT EXISTS idx_monthly_expense 
ON monthly_expense_summary(year_month, category);

-- ===============================
-- PROFIT OPTIMIZATION
-- ===============================

-- Find shareholders by type
CREATE INDEX IF NOT EXISTS idx_shareholders_type 
ON shareholders(type);

-- Find profit distributions by period
CREATE INDEX IF NOT EXISTS idx_profit_period 
ON profit_distributions(month);

-- ===============================
-- QUERY OPTIMIZATION TIPS
-- ===============================

-- Use EXPLAIN QUERY PLAN to analyze slow queries
-- Example: EXPLAIN QUERY PLAN SELECT * FROM patients WHERE name LIKE 'A%';

-- Best practices:
-- 1. Always use indexed columns in WHERE clauses
-- 2. Avoid SELECT * - specify only needed columns
-- 3. Use LIMIT for pagination
-- 4. Consider covering indexes for frequently used queries
-- 5. Regular ANALYZE to update query planner statistics
