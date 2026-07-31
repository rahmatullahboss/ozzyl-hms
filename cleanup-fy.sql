DELETE FROM fiscal_years WHERE fiscal_year_name LIKE 'FY-E2E-%';
DELETE FROM fiscal_years WHERE fiscal_year_name LIKE 'FY-Perm-Test-%';
DELETE FROM fiscal_years WHERE fiscal_year_name LIKE 'FY-Reject-Test-%';
DELETE FROM fiscal_years WHERE fiscal_year_name LIKE 'FY-Accept-Test-%';
SELECT 'Cleanup done' AS status;