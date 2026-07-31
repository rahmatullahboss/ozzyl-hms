# OpenEMR Lab System - Reference Documentation

> **📍 Location:** `/Users/rahmatullahzisan/Desktop/Dev/hms/openemr-reference/`

This folder contains a complete **OpenEMR v7.x** reference implementation with full lab/LIS system documentation.

## 📚 Documentation Files (You Are Here)

### 1. **OPENEMR_LAB_SYSTEM_ANALYSIS.md** (18 KB, 692 lines)
Complete architectural analysis of OpenEMR's lab system:
- System overview & design philosophy
- Data model (all 7 core tables)
- HL7 v2.3 message flow (orders & results)
- Lab integration protocols (DL, SFTP, FS, HTTP)
- Service layer pattern (PSR-4)
- Specimen tracking & QOE system
- Error handling & audit logging
- FHIR R4 mapping
- Frontend workflow
- **Best for:** Understanding the complete architecture

### 2. **OPENEMR_LAB_FILE_STRUCTURE.md** (13 KB, 396 lines)
Quick reference for file locations and code patterns:
- Directory tree with annotations
- Key files quick reference (6 main categories)
- Code examples for integration
- Database schema (visual representation)
- UI pages & workflows
- Integration points for HMS
- Performance tips & testing
- **Best for:** Finding specific files & writing extensions

### 3. **OPENEMR_LAB_README.md** (This File)
Navigation guide & overview.

---

## 🎯 Quick Start: Find What You Need

### I want to understand...

**HL7 Order Generation**
→ Read: OPENEMR_LAB_SYSTEM_ANALYSIS.md § 3.1 HL7 Message Flow
→ Code: `gen_hl7_order.inc.php` (line 82)

**How Results Are Received**
→ Read: OPENEMR_LAB_SYSTEM_ANALYSIS.md § 3.2 Result Receipt
→ Code: `receive_hl7_results.inc.php` (line 36+)

**Multi-Test Order Support**
→ Read: OPENEMR_LAB_SYSTEM_ANALYSIS.md § 2.1 Data Model
→ Code: `procedure_order_save_functions.php` (line 22)

**Lab-Specific Integrations**
→ Read: OPENEMR_LAB_SYSTEM_ANALYSIS.md § 4.2 Lab Implementations
→ Code: `/interface/procedure_tools/{lab}/gen_hl7_order.inc.php`

**Database Schema**
→ Read: OPENEMR_LAB_FILE_STRUCTURE.md § 6 Database Tables
→ Code: `/sql/3_2_0-to-4_0_0_upgrade.sql`

**FHIR Mapping**
→ Read: OPENEMR_LAB_SYSTEM_ANALYSIS.md § 9 FHIR Mapping
→ Code: `/src/Services/ProcedureService.php`

---

## 🏗️ System Architecture at a Glance

```
┌─────────────────────────────────────────────┐
│          Physician UI (Clinic)              │
│   - Order Entry Form (/forms/procedure_order)
│   - Pending Orders (/orders/pending_orders.php)
│   - Result Review (/orders/orders_results.php)
└────────────────┬──────────────────────────┘
                 │
                 ↓
      ┌──────────────────────┐
      │  OpenEMR DB Tables   │
      ├──────────────────────┤
      │ procedure_order      │
      │ procedure_order_code │ ← Multi-test support
      │ procedure_report     │
      │ procedure_result     │
      │ procedure_specimen   │
      │ procedure_providers  │
      └────────┬─────────────┘
               │
               ↓
      ┌──────────────────────────────┐
      │    HL7 Order Generation      │
      │  gen_hl7_order.inc.php       │
      │  (MSH|PID|ORC|OBR|OBX...)    │
      └────────┬─────────────────────┘
               │
               ↓
      ┌──────────────────────────────┐
      │   Lab Transmission Layer     │
      ├──────────────────────────────┤
      │ DL (Download/Manual)         │
      │ SFTP (Encrypted Transfer)    │
      │ FS (File System)             │
      │ HTTP (Custom API)            │
      └────────┬─────────────────────┘
               │
               ↓
       ┌──────────────┐
       │ Lab LIS/LIMS │
       │ (LabCorp,    │
       │  Quest, etc) │
       └──────┬───────┘
              │
              ↓
    ┌─────────────────────┐
    │  Result File (HL7)  │
    │  (specimen_num sent │
    │   back by lab)      │
    └────────┬────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  OpenEMR HL7 Result Parser             │
│ receive_hl7_results.inc.php            │
│ - Parse PID, OBX segments              │
│ - Match control_id to order            │
│ - Validate data types (NM, ST, SN...)  │
│ - Insert procedure_report/result       │
└────────┬───────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────┐
│   Patient Portal / Result Summary      │
│   /interface/patient_file/summary/     │
│   labdata.php                          │
└────────────────────────────────────────┘
```

---

## 📋 Core Tables Summary

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `procedure_order` | Lab order header | order_id, patient_id, provider_id, lab_id, control_id |
| `procedure_order_code` | Multiple tests per order | order_seq (1,2,3...), procedure_code, diagnoses |
| `procedure_report` | Results grouping | report_id, specimen_num, report_status, review_status |
| `procedure_result` | Individual test results | result_id, result (value), units, range, abnormal, result_status |
| `procedure_providers` | Lab configuration | ppid, protocol (SFTP/DL/FS), orders_path, results_path |
| `procedure_questions` | Lab-specific Q&A | lab_id, procedure_code, question_code, fldtype (T/N/S/D) |
| `procedure_specimen` | Specimen tracking | specimen_source, specimen_num, date_collected |

---

## 🔌 Integration Patterns

### Pattern 1: Custom Lab Integration
```php
// File: /interface/procedure_tools/your-lab/gen_hl7_order.inc.php
function your_lab_gen_hl7_order(int $orderid): Hl7OrderResult {
    // Custom HL7 formatting for your lab's requirements
    // Return Hl7OrderResult with HL7 text
}

function your_lab_send_hl7_order($ppid, $hl7Text) {
    // Custom transmission method (SFTP, HTTP, etc.)
}
```

### Pattern 2: Machine Interface (ASTM → HL7)
```
Lab Machine (ASTM protocol)
    ↓
Custom ASTM Parser (converts to HL7)
    ↓
HL7 Result File
    ↓
receive_hl7_results.inc.php (existing OpenEMR parser)
```

### Pattern 3: Modern REST API
```php
// Add endpoint: POST /api/v1/lab-results
// {
//   "specimen_id": "ABC123",
//   "tests": [
//     {"code": "85025", "result": "13.5", "units": "g/dL", "abnormal": "no"}
//   ]
// }
// → Converts to HL7 internally → Inserts into DB
```

---

## ✅ Key Features Supported

- ✅ **Multi-test orders** (sequence-based)
- ✅ **HL7 v2.3 standard** (industry norm)
- ✅ **Result parsing** with data type validation
- ✅ **Specimen tracking** (barcode support)
- ✅ **Question on Entry (QOE)** (lab-specific questions)
- ✅ **Pluggable labs** (LabCorp, Quest, generic)
- ✅ **FHIR R4 mapping** (modern standards)
- ✅ **Audit trail** (compliance-ready)
- ✅ **Service layer** (PSR-4/modern PHP)
- ✅ **UUID support** (FHIR compatibility)

---

## ⚠️ Not Yet Implemented (Future Enhancements)

- ❌ Real-time HL7 queue (currently file-based)
- ❌ ASTM-E1394 protocol (lab machines)
- ❌ RESTful result submission API
- ❌ SNOMED-CT specimen codes
- ❌ Automated result interpretation rules
- ❌ Machine learning for abnormal detection

---

## 📊 File Statistics

```
Total Files Analyzed:    50+
PHP Source Files:        20+
SQL Migration Files:     12+
Service Classes:          5
HTML/Twig Templates:      8
Lines of Lab Code:     ~5,000+
```

---

## 🚀 For HMS Implementation

### Immediate Opportunities

1. **Adopt the `procedure_order` → `procedure_report` → `procedure_result` hierarchy**
   - Proven pattern from 15+ years of OpenEMR
   - Multi-test support built-in
   - FHIR-ready with UUID fields

2. **Use the HL7 generation code as reference**
   - Correct message structure (MSH|PID|ORC|OBR|OBX)
   - Proper delimiter handling
   - Example implementations (LabCorp, Quest)

3. **Pluggable lab integration pattern**
   - Add custom protocol handlers in `/procedure_tools/`
   - No need to modify core code
   - Each lab gets its own HL7 formatting rules

4. **Result matching algorithm**
   - Primary: control_id (lab returns this)
   - Secondary: specimen_num
   - Fallback: patient + test code

5. **Audit & compliance**
   - EventAuditLogger tracks all operations
   - Result status lifecycle (preliminary → final → reviewed)
   - Full patient data protection

---

## 📖 Reading Order

**For Architects:**
1. OPENEMR_LAB_SYSTEM_ANALYSIS.md (full read)
2. OPENEMR_LAB_FILE_STRUCTURE.md § Integration Points

**For Developers:**
1. OPENEMR_LAB_FILE_STRUCTURE.md (full read)
2. OPENEMR_LAB_SYSTEM_ANALYSIS.md § 5 (Service Layer)
3. Source code in `openemr-reference/`

**For DevOps/Database:**
1. OPENEMR_LAB_SYSTEM_ANALYSIS.md § 2 (Data Model)
2. OPENEMR_LAB_FILE_STRUCTURE.md § 6 (Database Tables)
3. `/sql/` directory for schema

---

## 🔗 Key Source Locations

```
openemr-reference/
├── interface/orders/
│   ├── gen_hl7_order.inc.php           ← HL7 generation (order → message)
│   └── receive_hl7_results.inc.php     ← HL7 parsing (message → DB)
│
├── interface/forms/procedure_order/
│   ├── common.php                      ← Multi-test order logic
│   └── procedure_order_save_functions.php ← Save/update handlers
│
├── src/Services/
│   ├── ProcedureService.php            ← Order lifecycle (modern)
│   ├── ObservationLabService.php       ← Result queries (modern)
│   └── ProcedureOrderRelationshipService.php ← Linking to clinical data
│
└── sql/
    └── 3_2_0-to-4_0_0_upgrade.sql      ← Table creation
```

---

## 💡 Pro Tips

1. **Always use prepared statements** (parameterized queries)
2. **Validate HL7 delimiters** on parse (prevent injection)
3. **Index on control_id** (result matching is hot path)
4. **Log everything** to EventAuditLogger (compliance requirement)
5. **UUID all new tables** (FHIR forward-compatible)
6. **Test with real lab files** (not just example HL7)
7. **Handle multi-part results** (component fields in OBX)

---

## 📞 Questions?

- **HL7 Syntax:** See OPENEMR_LAB_SYSTEM_ANALYSIS.md § 3
- **File Locations:** See OPENEMR_LAB_FILE_STRUCTURE.md § File Reference
- **Database Design:** See OPENEMR_LAB_FILE_STRUCTURE.md § 6
- **Code Examples:** All linked in OPENEMR_LAB_FILE_STRUCTURE.md

---

**Last Generated:** April 20, 2026  
**OpenEMR Version:** 7.x (March 2025)  
**Location:** `/Users/rahmatullahzisan/Desktop/Dev/hms/openemr-reference/`

---

### 🎓 Learning Resources

- [OpenEMR Official Docs](https://open-emr.org/wiki/index.php/Main_Page)
- [HL7 v2.3 Standard](http://www.hl7.org/implement/standards/product_brief.cfm?product_id=185)
- [LOINC Codes](https://loinc.org/) (test codes)
- [SNOMED-CT](https://www.snomed.org/) (clinical concepts)
- [FHIR R4 Specification](https://www.hl7.org/fhir/r4/)
