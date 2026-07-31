# [MODULE ID] — [Module Name] Production Review

**ClickUp task:**  
**Reviewer:**  
**Hospital/test tenant:**  
**Environment:**  
**Release commit SHA:**  
**Review started:**  
**Review completed:**  
**Current verdict:** `NOT STARTED`

---

## 1. Scope

### Included

- 

### Excluded / N/A

- 

### Responsible hospital roles

- 

---

## 2. Implementation evidence

### Backend/API

- 

### Database/migrations

- 

### Frontend/UI

- 

### Permissions/approvals/audit

- 

### Reports/prints/exports/integrations

- 

### Existing automated tests

- 

---

## 3. Happy-path test

| Step | Input/action | Expected result | Actual result | Evidence | Status |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |

---

## 4. Negative and edge cases

| Test case | Expected result | Actual result | Evidence | Status |
|---|---|---|---|---|
| Unauthorized role | Request rejected and audited |  |  |  |
| Cross-tenant ID | No data read/write |  |  |  |
| Duplicate submit/retry | No duplicate effect |  |  |  |
| Cancel/reversal | Original effect correctly reversed |  |  |  |
| Invalid/missing input | Clear validation error |  |  |  |
| Provider/network failure | Visible and recoverable failure |  |  |  |

---

## 5. Reconciliation

| Area | Before | Expected after | Actual after | Status |
|---|---:|---:|---:|---|
| Money |  |  |  |  |
| Stock |  |  |  |  |
| Ledger |  |  |  |  |
| Patient/order/result state |  |  |  |  |

Delete rows that do not apply and add module-specific rows.

---

## 6. Operational readiness

- [ ] Required configuration documented
- [ ] Print/report/export verified
- [ ] Monitoring and alert path known
- [ ] Backup/restore impact known
- [ ] Downtime/manual fallback documented
- [ ] Staff training requirement documented
- [ ] External provider/device commissioned or marked N/A

---

## 7. Defects

| Bug/task link | Severity | Summary | Fix status | Retest status |
|---|---|---|---|---|
|  |  |  |  |  |

---

## 8. Evidence summary

- `C` Code/API/schema: `YES / NO / N/A`
- `U` Usable UI: `YES / NO / N/A`
- `A` Automated test: `YES / NO / N/A`
- `M` Manual E2E: `YES / NO / N/A`
- `O` Operational readiness: `YES / NO / N/A`
- `S` Sign-off: `YES / NO / N/A`

---

## 9. Residual risks

| Risk | Impact | Mitigation | Accepted by | Expiry/review date |
|---|---|---|---|---|
|  |  |  |  |  |

---

## 10. Final verdict

Choose exactly one:

- [ ] `PASS`
- [ ] `PASS WITH ACCEPTED RISK`
- [ ] `FAIL`
- [ ] `N/A FOR THIS HOSPITAL`

### Decision notes


### Required follow-up


### Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Engineering |  |  |  |
| QA |  |  |  |
| Department owner |  |  |  |
| Product/release owner |  |  |  |
