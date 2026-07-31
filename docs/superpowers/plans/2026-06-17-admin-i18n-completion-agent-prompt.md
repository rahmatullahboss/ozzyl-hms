# Agent Prompt: Complete Admin i18n Cleanup for Ozzyl HMS

You are working in the private repository `rahmatullahboss/ozzyl-hms` on branch `main`.

## Goal
Complete clean Bengali/English i18n for all remaining `web/src/pages/admin/**` pages without relying on raw English fallback keys. Convert pages to explicit namespaces and nested keys.

## Existing completed work
The following admin pages have already been converted and committed:

- `web/src/pages/admin/PendingApprovals.tsx` -> namespace `adminPages`, keys `pendingApprovals.*`
- `web/src/pages/admin/AlertsExceptions.tsx` -> namespace `adminPages`, keys `alerts.*`
- `web/src/pages/admin/TasksFollowups.tsx` -> namespace `adminPages`, keys `tasks.*`
- `web/src/pages/admin/AuditExplorer.tsx` -> namespace `adminPages`, keys `auditExplorer.*`
- `web/src/pages/admin/LoginSessions.tsx` -> namespace `adminPages`, keys `loginSessions.*`
- `web/src/pages/admin/FinancialAudit.tsx` -> namespace `adminPages`, keys `financialAudit.*`
- `web/src/pages/admin/SuspiciousActivities.tsx` -> namespace `adminPages`, keys `suspiciousActivities.*`
- `web/src/pages/admin/ExportHistory.tsx` -> namespace `adminPages`, keys `exportHistory.*`
- `web/src/pages/admin/CashDrawerDetail.tsx` -> namespace `adminCash`, keys `cashDrawerDetail.*`
- `web/src/pages/admin/ShiftHandoverDetail.tsx` -> namespace `adminCash`, keys `shiftHandoverDetail.*`
- `web/src/pages/admin/DailyCollectionReport.tsx` -> namespace `adminCash`, keys `dailyCollection.*`
- `web/src/pages/admin/RefundDetail.tsx` -> namespace `adminRefund`, keys `refundDetail.*`
- `web/src/pages/admin/RefundRequestDetail.tsx` -> namespace `adminRefund`, keys `refundRequestDetail.*`

Locale files currently involved:

- `web/public/locales/en/adminPages.json`
- `web/public/locales/bn/adminPages.json`
- `web/public/locales/en/adminCash.json`
- `web/public/locales/bn/adminCash.json`
- `web/public/locales/en/adminRefund.json`
- `web/public/locales/bn/adminRefund.json`
- `web/public/locales/en/adminExpense.json` (created but not wired to page yet)
- `web/public/locales/bn/adminExpense.json` (created but not wired to page yet)
- `web/public/locales/en/adminPayout.json` (created but not wired to page yet)
- `web/public/locales/bn/adminPayout.json` (created but not wired to page yet)
- `web/public/locales/en/adminSettings.json` (created but not wired to page yet)
- `web/public/locales/bn/adminSettings.json` (created but not wired to page yet)

`web/src/lib/i18n.ts` already includes `adminPages`, `adminCash`, and `adminRefund`. It may not explicitly include `adminExpense`, `adminPayout`, or `adminSettings`; add them if needed, or rely on dynamic namespace loading only after verifying it works.

## Files blocked during prior tool attempts
The following page updates were attempted but blocked by the GitHub tool safety filter. Retry locally or through Codex/Cursor using direct file edit:

1. `web/src/pages/admin/ExpenseDetailPage.tsx`
   - Locale files already exist:
     - `web/public/locales/en/adminExpense.json`
     - `web/public/locales/bn/adminExpense.json`
   - Convert to `const { t } = useTranslation('adminExpense')`.
   - Replace all raw labels: Loading, Expense not found, Expense, Amount, Category, Requested By, Paid From, Description, Voucher, View Voucher, Details, Approval History, Expense No, Department, Requested, Approved By, Approved At, Approval history placeholder, Reject, Approve.
   - Translate status badges using `t('expenseDetail.statusLabels.' + e.status, { defaultValue: e.status })`.

2. `web/src/pages/admin/DoctorPayoutDetail.tsx`
   - Locale files already exist:
     - `web/public/locales/en/adminPayout.json`
     - `web/public/locales/bn/adminPayout.json`
   - Convert to `const { t } = useTranslation('adminPayout')`.
   - Replace all raw labels: Loading, not found, title, OPD Visits, OPD Income, Procedure Income, Diagnostic Share, Total Earnings, Balance, tab labels, empty states, table headers, payout status badges.

3. `web/src/pages/admin/HospitalProfile.tsx`
   - Locale files already exist:
     - `web/public/locales/en/adminSettings.json`
     - `web/public/locales/bn/adminSettings.json`
   - Convert to `const { t } = useTranslation('adminSettings')`.
   - Replace all raw labels: Loading, Hospital Profile, Basic Information, Hospital Name, Address, Hotline, Email, Website, Registration Number, Quick Stats, Branches, Departments, Beds, Established.

## Remaining pages to inspect and convert
Start with these, then run a scan to find more:

- `web/src/pages/admin/DiscountReview.tsx`
  - Translation keys exist in `tenantAdmin.json`, but the page currently uses default namespace. Either switch to `useTranslation('tenantAdmin')` if all keys exist, or move keys into a cleaner admin namespace.
- `web/src/pages/admin/DiscountReferenceAnalytics.tsx`
- `web/src/pages/admin/CollectionFollowup.tsx`
- `web/src/pages/admin/DueReceivables.tsx`
- `web/src/pages/admin/InventoryAlerts.tsx`
- `web/src/pages/admin/StockOverview.tsx`
- `web/src/pages/admin/StockMovementPage.tsx`
- `web/src/pages/admin/BranchComparisonPage.tsx`
- `web/src/pages/admin/FinancialReports.tsx`
- `web/src/pages/admin/StaffActivityLog.tsx`
- `web/src/pages/admin/TelemedicineMonitor.tsx`
- settings pages such as `ApprovalPolicies`, `EscalationRules`, `NotificationSettings`, `DepartmentSetup`, `PaymentSettings`, and related admin settings screens.

## Required pattern
Use clean nested keys, not raw-English fallback keys.

Good:

```tsx
const { t } = useTranslation('adminCash');

t('dailyCollection.title')
t('dailyCollection.summary.totalCollection')
t(`refundRequestDetail.statusLabels.${status}`, { defaultValue: status })
```

Avoid:

```tsx
t('Daily Collection Report')
t('Amount')
t(status)
```

## Translation style
English: concise professional admin UI text.

Bangla: Bangladesh hospital admin/reception friendly, simple and practical. Prefer common terms used in hospitals:

- পেন্ডিং
- অনুমোদিত
- রিজেক্টেড
- রিফান্ড
- কালেকশন
- কাউন্টার
- শিফট
- হ্যান্ডওভার
- ইনভয়েস
- ভাউচার
- স্ট্যাটাস

## Validation checklist
After each page:

1. Page imports `useTranslation('<explicitNamespace>')`.
2. No visible hardcoded English remains in JSX labels, buttons, table headers, empty states, tab labels, card labels, or badge labels.
3. Backend-provided dynamic names, patient names, doctor names, invoice numbers, and amounts remain dynamic.
4. Dynamic enum badges use nested `statusLabels`, `typeLabels`, `severityLabels`, etc. with `defaultValue`.
5. Both English and Bangla locale files have the same key structure.
6. Run TypeScript/build checks if possible.
7. Commit in small safe commits per page or per namespace.

## Suggested commit style

- `fix(i18n): translate expense detail admin page`
- `fix(i18n): add Bangla payout admin translations`
- `fix(i18n): translate hospital profile admin page`
- `fix(i18n): translate discount review admin page`

## Final output expected from agent
Return:

- List of completed pages
- List of locale files modified
- Any pages skipped and why
- Any TypeScript/build result
- Commit SHAs
