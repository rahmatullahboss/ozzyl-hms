# Quick Start Guide: MD/Director Dashboard

## Introduction

The Accounting Dashboard provides real-time financial insights for Managing Directors (MD) and Directors of your hospital. All amounts are in Bangladeshi Taka (BDT).

---

## Accessing the Dashboard

Navigate to:
- **MD:** `/md/accounting`
- **Director:** `/director/accounting`

---

## Dashboard Overview

### Today's Financials
- **Today's Income** - Revenue collected today
- **Today's Expenses** - Expenses approved today
- **Today's Profit** - Today's income minus expenses

### Month-to-Date (MTD)
Shows cumulative figures from the 1st of the month:
- MTD Income
- MTD Expenses  
- MTD Profit

### Visualizations
- **Income Breakdown** - Pie chart showing income by source (Pharmacy, Lab, Admission, etc.)
- **Expense Breakdown** - Pie chart showing expenses by category
- **6-Month Trends** - Line chart showing income vs expenses over 6 months

### Real-time Updates
The dashboard auto-updates via WebSocket when:
- New income is recorded
- Expenses are approved/rejected
- Recurring expenses are generated

---

## Navigation

| Page | Purpose |
|------|---------|
| `/md/accounting` | Main dashboard with real-time stats |
| `/md/income` | View and manage all income entries |
| `/md/expenses` | View, create, and approve expenses |
| `/md/recurring` | Manage recurring expenses (salary, rent, etc.) |
| `/md/accounts` | Chart of accounts management |
| `/md/reports` | Financial reports (P&L, breakdowns) |
| `/md/audit` | Audit logs for all financial operations |

---

## Common Tasks

### Adding Manual Income
1. Go to **Income** page
2. Click **Add Income**
3. Fill in: Date, Source, Amount, Description
4. Click **Save**

### Creating an Expense
1. Go to **Expenses** page
2. Click **Add Expense**
3. Fill in: Date, Category, Amount, Description
4. Click **Save**
5. If amount exceeds threshold, it will require Director approval

### Approving Expenses (Director Only)
1. Go to **Expenses** page
2. Find pending expenses (yellow badge)
3. Click **Approve** or **Reject**

### Setting Up Recurring Expenses
1. Go to **Recurring** page
2. Click **Add Recurring Expense**
3. Select category (e.g., Salary, Rent)
4. Set amount and frequency (daily/weekly/monthly)
5. Set start date
6. Click **Save**

The system will automatically create expenses on the specified dates.

### Viewing Reports
1. Go to **Reports** page
2. Select report type:
   - **P&L** - Profit & Loss statement
   - **Income by Source** - Breakdown of income
   - **Expense by Category** - Breakdown of expenses
   - **Monthly** - Month-by-month summary
3. Set date range
4. Click **Print** or **Export PDF**

### Checking Audit Logs
1. Go to **Audit** page
2. Filter by:
   - Table (income, expenses, etc.)
   - User
   - Date range
3. View changes with before/after values

---

## Expense Approval Workflow

### Automatic Approval
Expenses below the threshold are automatically approved.

### Manual Approval Required
Expenses above the threshold:
1. Created with "pending" status
2. Director must review and approve/reject
3. Once approved, expense is reflected in dashboard

---

## Profit Distribution

The system calculates monthly profit and can distribute 30% to shareholders:

1. Go to **Reports** or access profit endpoint
2. Calculate profit for the month
3. Approve distribution (Director only)
4. System automatically splits profit based on shareholder percentages

---

## Tips

- **Real-time monitoring**: Keep the dashboard open for live updates
- **Recurring expenses**: Set up salary, rent, and utilities as recurring to save time
- **Regular reviews**: Check daily income/expenses at start of each day
- **Audit trail**: Use audit logs to track all financial changes
- **Reports**: Run monthly P&L reports for financial review meetings

---

## Support

For technical issues or questions, contact the system administrator.
