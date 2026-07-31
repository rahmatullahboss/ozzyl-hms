# Ozzyl HMS — Hospital Management System

A comprehensive, multi-tenant Hospital Management System built on **Cloudflare Workers + D1 + React**.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange)
![React](https://img.shields.io/badge/React-18-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)

---

## 🚀 Live Demo

**URL:** `https://hms-saas.rahmatullahzisan.workers.dev`

**Direct login (no slug needed):** `/login`  
**Tenant login:** `/h/demo-hospital/login`

### 🔑 Demo Accounts

All passwords: **`Demo@1234`**

| Role | Email | Access |
|------|-------|--------|
| **Hospital Admin** | `admin@demo-hospital.com` | Full access — settings, staff, reports, all modules |
| **MD** | `md@demo-hospital.com` | Clinical overview, all reports, patient records |
| **Director** | `director@demo-hospital.com` | Full reports, financials, shareholder data |
| **Doctor** | `doctor@demo-hospital.com` | Patient records, prescriptions, orders, clinical notes |
| **Nurse** | `nurse@demo-hospital.com` | Nursing notes, vitals, medication administration, ward tasks |
| **Reception** | `reception@demo-hospital.com` | Patient registration, billing, OPD visits |
| **Laboratory** | `lab@demo-hospital.com` | Lab orders, test results, lab catalog |
| **Pharmacist** | `pharmacy@demo-hospital.com` | Medicine stock, dispensing, purchases |
| **Accountant** | `accounts@demo-hospital.com` | Income, expenses, journal, salary |

> Hospital slug: `demo-hospital` | 20 demo patients already registered with visits, lab orders, and bills.

---

## 🔬 How Lab Tests Work

### Flow Overview

```
Reception creates bill  →  Lab order created  →  Lab staff enters results  →  Report printable
```

### Step-by-Step

**1. Patient Visit (Reception)**
- Receptionist registers a patient visit (OPD)
- Selects tests from the **lab test catalog**
- Adds tests to the bill (`test_bill` column in `bills` table)
- Bill is generated with test charges

**2. Lab Order Creation**
- When tests are billed, a **Lab Order** (`lab_orders` table) is auto-created
- Each test becomes a **Lab Order Item** (`lab_order_items`) with `status = 'pending'`
- Lab staff can see all pending orders from their portal

**3. Result Entry (Laboratory Login)**
- Lab staff logs in as `lab@demo-hospital.com`
- Sees list of pending lab orders
- Enters test results (free text: e.g., `Hb: 12.5 g/dL, WBC: 11,000/μL`)
- Marks item as `status = 'completed'`

**4. Report Print**
- Completed results are printable from the lab or reception
- Patient/doctor can view results

### Lab Test Pricing (Demo)

Prices are stored in **paisa** (1 BDT = 100 paisa):

| Test | Price (BDT) |
|------|-------------|
| CBC (Complete Blood Count) | ৳500 |
| ECG | ৳300 |
| Echocardiography | ৳2,500 |
| HbA1c | ৳1,200 |
| Dengue NS1 | ৳800 |
| Troponin I | ৳2,000 |
| KFT (Kidney Function) | ৳1,500 |

---

## 💰 How Billing & Accounts Work

### Bill Structure

Each bill (`bills` table) has separate columns per service category:

| Column | Description |
|--------|-------------|
| `test_bill` | Lab test charges |
| `doctor_visit_bill` | Consultation fee |
| `admission_bill` | IPD room/bed charges |
| `operation_bill` | Surgery charges |
| `medicine_bill` | Pharmacy dispensing |
| `discount` | Total discount applied |
| `total` | Final total (sum - discount) |
| `paid` | Amount collected |
| `due` | Outstanding balance |
| `status` | `paid` / `partial` / `unpaid` |

### Payment Flow

```
Bill created (status: unpaid)
    ↓
Partial payment received (status: partial, paid=X, due=total-X)
    ↓
Full payment received (status: paid, due=0)
```

### Income Tracking

Payments are logged in the `income` table by `source`:
- `consultation` — doctor fees
- `lab` — test revenue
- `pharmacy` — medicine sales
- `admission` — IPD fees
- (custom sources possible)

### Expense Tracking

Expenses (`expenses` table) have categories:
- `salary` — staff salaries
- `utilities` — electricity, water, internet
- `medicine` — pharmacy stock purchases
- `equipment` — maintenance, reagents
- `rent` — building rent
- `other` — miscellaneous

### Accounting (Double Entry)

All major transactions create **journal entries** in the `journal_entries` table following double-entry bookkeeping via the `chart_of_accounts`.

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Backend | Cloudflare Workers (Hono) |
| Database | Cloudflare D1 (SQLite) |
| Auth | JWT (slug-free + slug-based) |
| Deployment | Cloudflare Workers (single worker) |

---

## 📁 Project Structure

```
ozzyl-hms/
├── src/
│   ├── index.ts              # Main Hono app
│   ├── routes/               # API route handlers
│   │   ├── patients.ts
│   │   ├── bills.ts
│   │   ├── lab-orders.ts
│   │   ├── medicines.ts
│   │   ├── income.ts
│   │   ├── expenses.ts
│   │   ├── login-direct.ts   # Slug-free login
│   │   └── ...
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── tenant.ts
│   │   └── rate-limit.ts
│   └── types.ts
├── web/
│   └── src/
│       ├── pages/            # UI pages
│       └── components/       # Reusable components
├── migrations/
│   ├── 0001_fix_schema_add_missing_tables.sql
│   ├── ...
│   └── seed_demo.sql         # Demo hospital seed data
├── docs/
└── wrangler.jsonc
```

---

## 🛠️ Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+
- Cloudflare account with Workers & D1

### Installation

```bash
git clone <repo-url>
cd ozzyl-hms
pnpm install
```

### Development (API only — single worker)

```bash
pnpm run dev       # Starts worker on :8787 (serves both API + static files)
```

### Apply Migrations

```bash
# Local
npx wrangler d1 execute DB --local --file=migrations/0001_fix_schema_add_missing_tables.sql

# Production
npx wrangler d1 execute DB --remote --file=migrations/0001_fix_schema_add_missing_tables.sql
```

### Seed Demo Data

```bash
npx wrangler d1 execute DB --remote --file=migrations/seed_demo.sql
```

### Build & Deploy

```bash
pnpm build         # Build frontend
npm run deploy     # Deploy to Cloudflare Workers
```

---

## 🔐 Authentication

Two login flows are supported:

| Flow | URL | Description |
|------|-----|-------------|
| **Direct (new)** | `/login` | Email-only, backend finds hospital automatically |
| **Slug-based** | `/h/:slug/login` | Traditional per-hospital URL |

On login, a JWT is returned containing: `userId`, `role`, `tenantId`, `permissions`.

---

## 📊 API Endpoints Summary

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login-direct` | Slug-free login by email |
| POST | `/api/register` | New hospital signup |

### Patients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/patients` | List patients |
| POST | `/api/patients` | Register patient |
| GET | `/api/patients/:id` | Get patient detail |

### Lab
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lab-orders` | List lab orders |
| POST | `/api/lab-orders` | Create lab order |
| PUT | `/api/lab-orders/:id/items/:itemId` | Update test result |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bills` | List bills |
| POST | `/api/bills` | Create bill |
| POST | `/api/bills/:id/pay` | Process payment |

### Finance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/income` | Income records |
| GET/POST | `/api/expenses` | Expense records |

---

## 🔒 Security

- ✅ JWT authentication (8h expiry)
- ✅ Rate limiting (100 req/min, 5/min for login)
- ✅ Password hashing (bcrypt, 10 rounds)
- ✅ Role-based access control
- ✅ SQL injection prevention (prepared statements)
- ✅ Audit logging
- ✅ Multi-tenant data isolation

---

## License

MIT
