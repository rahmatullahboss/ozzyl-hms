# HMS Accounting Module API Documentation

## Overview

The HMS Accounting Module provides comprehensive financial management for hospitals, including income tracking, expense management, reporting, and profit distribution.

**Base URL:** `/api`

**Authentication:** All endpoints require authentication via cookie token.

**Amounts:** All monetary values are in Bangladeshi Taka (BDT).

---

## Endpoints

### 1. Dashboard

#### 1.1 Get Dashboard Summary
```
GET /api/accounting/summary
```
Returns today's income, expenses, profit, and month-to-date totals.

**Response:**
```json
{
  "today": {
    "income": 50000,
    "expense": 20000,
    "profit": 30000
  },
  "mtd": {
    "income": 500000,
    "expense": 300000,
    "profit": 200000
  },
  "lastUpdated": "2024-01-15T10:30:00.000Z"
}
```

#### 1.2 Get Month-to-Date Stats
```
GET /api/accounting/mtd
```

#### 1.3 Get Trends (6 months)
```
GET /api/accounting/trends
```

#### 1.4 Get Income Breakdown
```
GET /api/accounting/income-breakdown
```
Returns income grouped by source (pharmacy, lab, admission, etc.)

#### 1.5 Get Expense Breakdown
```
GET /api/accounting/expense-breakdown
```
Returns expenses grouped by category.

#### 1.6 WebSocket for Real-time Updates
```
GET /api/accounting/ws
```
WebSocket endpoint for real-time dashboard updates.

---

### 2. Income Management

#### 2.1 List Income
```
GET /api/income
```
Query Parameters:
- `startDate` - Start date filter (YYYY-MM-DD)
- `endDate` - End date filter (YYYY-MM-DD)
- `source` - Filter by source

#### 2.2 Create Income
```
POST /api/income
```
```json
{
  "date": "2024-01-15",
  "source": "pharmacy",
  "amount": 5000,
  "description": "Medicine sales"
}
```

**Sources:** `pharmacy`, `laboratory`, `doctor_visit`, `admission`, `operation`, `ambulance`, `other`

#### 2.3 Get Income
```
GET /api/income/:id
```

#### 2.4 Update Income
```
PUT /api/income/:id
```

#### 2.5 Delete Income
```
DELETE /api/income/:id
```

---

### 3. Expense Management

#### 3.1 List Expenses
```
GET /api/expenses
```
Query Parameters:
- `startDate` - Start date filter
- `endDate` - End date filter
- `category` - Filter by category
- `status` - Filter by status (`pending`, `approved`, `rejected`)

#### 3.2 Create Expense
```
POST /api/expenses
```
```json
{
  "date": "2024-01-15",
  "category": "SALARY",
  "amount": 50000,
  "description": "Staff salary for January"
}
```

**Categories:** `SALARY`, `MEDICINE`, `RENT`, `ELECTRICITY`, `WATER`, `COMMUNICATION`, `MAINTENANCE`, `SUPPLIES`, `MARKETING`, `BANK`, `MISC`

**Note:** Expenses above threshold require approval.

#### 3.3 Get Expense
```
GET /api/expenses/:id
```

#### 3.4 Update Expense
```
PUT /api/expenses/:id
```

#### 3.5 Approve Expense
```
POST /api/expenses/:id/approve
```

#### 3.6 Reject Expense
```
POST /api/expenses/:id/reject
```

#### 3.7 List Pending Approvals
```
GET /api/expenses/pending
```

---

### 4. Recurring Expenses

#### 4.1 List Recurring Expenses
```
GET /api/recurring
```
Query Parameters:
- `isActive` - Filter by active status

#### 4.2 Create Recurring Expense
```
POST /api/recurring
```
```json
{
  "category_id": 1,
  "amount": 50000,
  "description": "Monthly rent",
  "frequency": "monthly",
  "next_run_date": "2024-02-01",
  "end_date": "2024-12-31"
}
```

**Frequency:** `daily`, `weekly`, `monthly`

#### 4.3 Update Recurring Expense
```
PUT /api/recurring/:id
```

#### 4.4 Delete (Deactivate) Recurring Expense
```
DELETE /api/recurring/:id
```

#### 4.5 Manually Trigger
```
POST /api/recurring/:id/run
```

---

### 5. Chart of Accounts

#### 5.1 List Accounts
```
GET /api/accounts
```
Query Parameters:
- `type` - Filter by type (`asset`, `liability`, `equity`, `income`, `expense`)

#### 5.2 Create Account
```
POST /api/accounts
```
```json
{
  "code": "5001",
  "name": "Medicine Purchase",
  "type": "expense"
}
```

#### 5.3 Get Account
```
GET /api/accounts/:id
```

#### 5.4 Update Account
```
PUT /api/accounts/:id
```
```json
{
  "name": "Updated Name",
  "type": "expense",
  "is_active": true
}
```

#### 5.5 Delete Account
```
DELETE /api/accounts/:id
```

#### 5.6 Verify Balance
```
GET /api/accounts/verify-balance
```
Verifies that debits equal credits in journal entries.

---

### 6. Journal Entries

#### 6.1 List Journal Entries
```
GET /api/journal
```
Query Parameters:
- `startDate`, `endDate` - Date filters
- `accountId` - Filter by account

#### 6.2 Create Journal Entry
```
POST /api/journal
```
```json
{
  "date": "2024-01-15",
  "description": "Medicine purchase",
  "entries": [
    { "account_id": 1, "debit": 5000, "credit": 0 },
    { "account_id": 2, "debit": 0, "credit": 5000 }
  ]
}
```

#### 6.3 Delete Journal Entry
```
DELETE /api/journal/:id
```

---

### 7. Reports

#### 7.1 Profit & Loss Report
```
GET /api/reports/pl
```
Query Parameters:
- `startDate`, `endDate` - Report period

#### 7.2 Income by Source
```
GET /api/reports/income-by-source
```

#### 7.3 Expense by Category
```
GET /api/reports/expense-by-category
```

#### 7.4 Monthly Summary
```
GET /api/reports/monthly
```

---

### 8. Audit Logs

#### 8.1 List Audit Logs
```
GET /api/audit
```
Query Parameters:
- `tableName` - Filter by table
- `userId` - Filter by user
- `startDate`, `endDate` - Date filters

#### 8.2 Get Audit Log
```
GET /api/audit/:id
```

---

### 9. Profit & Distribution

#### 9.1 Calculate Profit
```
GET /api/profit/calculate
```
Query Parameters:
- `month` - Month to calculate (YYYY-MM)

#### 9.2 Distribute Profit
```
POST /api/profit/distribute
```
```json
{
  "month": "2024-01"
}
```

**Note:** Distributes 30% of profit to shareholders based on their share percentage.

#### 9.3 Profit History
```
GET /api/profit/history
```

---

## Auto-Capture Integration

Income is automatically captured from:

1. **Pharmacy** - When a sale is completed
2. **Laboratory** - When a test is paid
3. **Admission** - When admission fee is paid
4. **Doctor Visit** - When consultation fee is paid
5. **Operation** - When operation fee is paid

---

## WebSocket Events

Connect to `/api/accounting/ws` for real-time updates.

**Event Types:**
- `income_update` - New income added
- `expense_update` - Expense status changed
- `sync` - Full data sync

---

## Error Responses

```json
{
  "error": "Error message"
}
```

**Status Codes:**
- 200 - Success
- 400 - Bad Request
- 403 - Unauthorized
- 404 - Not Found
- 500 - Server Error
