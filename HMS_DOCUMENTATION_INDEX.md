# HMS Codebase Documentation Index

**Created:** April 20, 2026  
**Project:** Hospital Management System (HMS)  
**Version:** Complete Analysis

---

## 📋 DOCUMENTATION FILES

### 1. **CODEBASE_ANALYSIS.md** (1,247 lines)
**Comprehensive overview of the entire HMS system**

**Contents:**
- Top-level directory structure
- Complete backend routes breakdown (203 routes)
- Frontend pages overview (177 pages)
- Database models and schema files
- All 153 migration files listed
- 18+ feature modules organized by function
- Technology stack summary
- Summary statistics and observations

**Use this for:**
- Getting a complete system overview
- Understanding all available features
- Finding specific modules/features
- Learning architecture patterns

---

### 2. **ROUTES_SUMMARY.md** (367 lines)
**Detailed backend API route reference**

**Contents:**
- 203 route files organized into 17 categories
- Authentication routes (9 files)
- Tenant routes breakdown:
  - Clinical module (13 routes)
  - Patient management (7 routes)
  - Visit management (7 routes)
  - Billing & finance (19 routes)
  - Pharmacy (3 routes)
  - Laboratory (4 routes)
  - Radiology (5 routes)
  - Nursing (12 routes)
  - HR & staff (6 routes)
  - Inventory (14 routes)
  - Operations (15 routes)
  - And 6 more categories...
- API design patterns
- Middleware stack
- Database integration notes

**Use this for:**
- Finding a specific API endpoint
- Understanding route organization
- Learning API design patterns
- Navigating backend functionality

**Key Stats:**
- **Clinical Routes:** 13
- **Financial Routes:** 19
- **Pharmacy Routes:** 3
- **Nursing Routes:** 12
- **Inventory Routes:** 14
- **Operational Routes:** 15

---

### 3. **PAGES_SUMMARY.md** (412 lines)
**Frontend pages and components reference**

**Contents:**
- 177 page files organized into 21 categories
- Authentication pages (8)
- Dashboard pages (11)
- Super admin pages (7)
- Patient management (9)
- Clinical features (13)
- Billing & finance (13)
- Pharmacy module (27 pages)
- Laboratory (6)
- HR & staff (6)
- Operations (17)
- Advanced features (9)
- Accounting (9)
- And more...
- 39 reusable React components
- Component organization
- Frontend architecture patterns
- Feature coverage by interface
- User role pages

**Use this for:**
- Finding a specific page/screen
- Understanding UI organization
- Learning component structure
- Planning feature implementation

**Key Stats:**
- **Total Pages:** 177
- **Pharmacy Pages:** 27 (most comprehensive)
- **Operational Pages:** 17
- **Component Files:** 39

---

### 4. **MIGRATIONS_TIMELINE.md** (378 lines)
**Complete database schema evolution**

**Contents:**
- 153 migration files organized into 6 phases
- Phase 1: Foundation (0001-0020)
- Phase 2: Specialized modules (0020-0050)
- Phase 3: Tier-based ports from legacy (0040-0077)
- Phase 4: Operations & HR (0078-0095)
- Phase 5: Quality & compliance (0093-0117)
- Phase 6: Global health ecosystem (0118-0142)
- Seed data files
- Feature coverage by phase
- Database statistics
- Schema evolution patterns
- Migration best practices
- Deployment notes

**Use this for:**
- Understanding database evolution
- Tracing feature implementation timeline
- Planning database changes
- Understanding data model history

**Key Stats:**
- **Total Migrations:** 153
- **Total Tables:** 100+
- **Largest Migration:** 0037_inventory (30KB)

---

## 🎯 QUICK REFERENCE GUIDES

### Find Information About...

**A specific API endpoint?**
→ See **ROUTES_SUMMARY.md**
- Search by feature name (e.g., "pharmacy", "billing")
- Find the route file
- Check CODEBASE_ANALYSIS.md for detailed description

**A frontend page/feature?**
→ See **PAGES_SUMMARY.md**
- Search by page name or feature
- Find the TSX file location
- Understand the component structure

**Database/schema changes?**
→ See **MIGRATIONS_TIMELINE.md**
- Find migration by feature name
- Understand evolution timeline
- Check when feature was added

**Overall system architecture?**
→ See **CODEBASE_ANALYSIS.md**
- Start with "TOP-LEVEL DIRECTORY STRUCTURE"
- Read feature area summaries (Section 7)
- Review technology stack (Section 8)

---

## 📊 FEATURE AREAS AT A GLANCE

| Feature Area | Routes | Pages | Status |
|--------------|--------|-------|--------|
| **Clinical** | 13 | 13 | ✅ Complete |
| **Patient Management** | 7 | 9 | ✅ Complete |
| **Pharmacy** | 3 | 27 | ✅ Comprehensive |
| **Laboratory** | 4 | 6 | ✅ Complete |
| **Radiology** | 5 | 1 | ✅ Complete |
| **Nursing** | 12 | 1 | ✅ Complete |
| **Billing & Finance** | 19 | 13 | ✅ Complete |
| **Accounting** | 1 | 9 | ✅ Complete |
| **HR & Staff** | 6 | 6 | ✅ Complete |
| **Inventory** | 14 | 4 | ✅ Complete |
| **Operations** | 15 | 17 | ✅ Complete |
| **Telemedicine** | 4 | 4 | ✅ Complete |
| **Reporting** | 10 | 2 | ⏳ Basic |
| **Marketplace** | 3 | 5 | ✅ Complete |
| **Wellness & AI** | 6 | 2 | ✅ Emerging |

---

## 🏗️ SYSTEM STATISTICS

**Codebase Size:**
- Backend Route Files: **203**
- Frontend Pages: **177**
- React Components: **39**
- Database Schema Files: **7**
- Migration Files: **153**
- **Total: 579 major code files**

**Database:**
- Total Tables: **100+**
- Feature Modules: **18+**
- Tenant-Isolated Routes: **169**
- Public/Cross-Tenant Routes: **34**

**Frontend:**
- Main Dashboards: **11**
- User Admin Roles: **7**
- Feature Pages: **159**
- Component Categories: **6**

---

## 🔍 NAVIGATION TIPS

### By Feature Area
1. Open **CODEBASE_ANALYSIS.md** Section 7
2. Find your feature area
3. Use cross-reference to Routes/Pages docs

### By Technical Layer
**Backend API:**
→ **ROUTES_SUMMARY.md**

**Database Schema:**
→ **MIGRATIONS_TIMELINE.md**

**Frontend UI:**
→ **PAGES_SUMMARY.md**

**Full Architecture:**
→ **CODEBASE_ANALYSIS.md**

### By Implementation Status
Look at the status indicators in **PAGES_SUMMARY.md** Feature Coverage table:
- ✅ Complete
- ⏳ Basic/In Progress
- 🚀 Emerging

---

## 📁 FILE LOCATIONS

**Main Documentation:**
```
/HMS
├── CODEBASE_ANALYSIS.md         ← Start here for overview
├── ROUTES_SUMMARY.md            ← Backend API reference
├── PAGES_SUMMARY.md             ← Frontend UI reference
├── MIGRATIONS_TIMELINE.md       ← Database reference
└── HMS_DOCUMENTATION_INDEX.md   ← This file
```

**Source Code:**
```
/HMS
├── src/                         ← Backend (Cloudflare Workers)
│   ├── routes/                  ← 203 API route files
│   ├── db/schema/               ← 7 schema files
│   ├── middleware/
│   └── utils/
├── web/src/                     ← Frontend (React)
│   ├── pages/                   ← 177 page files
│   ├── components/              ← 39 component files
│   ├── hooks/
│   └── lib/
└── migrations/                  ← 153 SQL migration files
```

---

## 🚀 GETTING STARTED READING ORDER

1. **First Read:** CODEBASE_ANALYSIS.md
   - Gives you the "big picture"
   - ~20 min read
   - Sections 1-3 (essential overview)

2. **For Feature Deep-Dives:** Use specific docs
   - Working on backend? → ROUTES_SUMMARY.md
   - Building UI? → PAGES_SUMMARY.md
   - Database work? → MIGRATIONS_TIMELINE.md

3. **For Implementation:** Cross-reference
   - Find feature in CODEBASE_ANALYSIS.md
   - Check routes in ROUTES_SUMMARY.md
   - Check pages in PAGES_SUMMARY.md
   - Check migrations in MIGRATIONS_TIMELINE.md

---

## 💡 COMMON TASKS

### "How do I add a new feature?"
1. Check CODEBASE_ANALYSIS.md section 7 (Feature Areas)
2. Find similar existing feature
3. Map routes from ROUTES_SUMMARY.md
4. Map pages from PAGES_SUMMARY.md
5. Check schema from MIGRATIONS_TIMELINE.md

### "Where is the X feature implemented?"
1. Search feature name in all docs (Ctrl+F)
2. Cross-reference routes → pages → schema
3. Check module organization in Section 7 of CODEBASE_ANALYSIS.md

### "What tables does feature X use?"
1. Check MIGRATIONS_TIMELINE.md for feature migration
2. Look at table names in migration file
3. Check CODEBASE_ANALYSIS.md section 4 for schema details

### "How do I add a new API endpoint?"
1. Check ROUTES_SUMMARY.md for similar endpoint pattern
2. Create new route file in /src/routes/tenant/[module]/
3. Add corresponding pages if needed in /web/src/pages/
4. Consider migration if new database tables needed

---

## 📞 DOCUMENTATION MAINTENANCE

**Last Updated:** April 20, 2026  
**Analyzed By:** Claude Code Codebase Explorer  
**Analysis Scope:** Complete `/hms` directory  

**When to Update:**
- After major feature additions (new modules)
- After significant refactoring
- When migration count reaches +10 new files
- When route count exceeds 250

**How to Update:**
- Rerun codebase analysis
- Compare against these documents
- Update relevant sections
- Add new feature areas if needed

---

## 📚 ADDITIONAL RESOURCES IN PROJECT

**Existing Documentation:**
- `/docs/` - Various documentation
- `/feature-list.md` - Detailed feature listing
- `/README.md` - Project overview
- `/prd.md`, `/prd2.md` - Product requirements
- Various implementation plans and assessments

**Code Configuration:**
- `wrangler.toml` - Cloudflare Workers config
- `drizzle.config.ts` - Database config
- `playwright.config.ts` - E2E test config
- `package.json` - Dependencies

---

## ✅ ANALYSIS COMPLETENESS CHECKLIST

This analysis covers:
- ✅ All 203 backend route files
- ✅ All 177 frontend page files
- ✅ All 39 component files
- ✅ All 7 schema files
- ✅ All 153 migration files
- ✅ All 18+ feature modules
- ✅ 100+ database tables
- ✅ Directory structure
- ✅ Technology stack
- ✅ Architecture patterns

---

## 🎓 KEY TAKEAWAYS

**HMS is:**
- ✅ A comprehensive hospital management system
- ✅ Multi-tenant from core architecture
- ✅ Built on modern cloud infrastructure (Cloudflare)
- ✅ FHIR-compliant with interoperability focus
- ✅ Feature-complete for major hospital operations
- ✅ Well-organized modular codebase
- ✅ Production-ready platform with 153 migrations
- ✅ Combining clinical, operational, and financial capabilities

**Key Strengths:**
- Enterprise-grade multi-tenancy
- Comprehensive feature coverage
- Global health records infrastructure
- Compliance & audit-focused
- Modern tech stack

---

**End of Documentation Index**

For detailed information on any topic, refer to the specific documents listed above.
