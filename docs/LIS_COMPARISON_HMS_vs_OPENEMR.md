# LIS (Laboratory Information System) Review
## HMS vs OpenEMR — Complete Comparison

**Date:** April 20, 2026

---

## Executive Summary

Our HMS has a **solid LIS foundation** — test catalog, orders, results, barcode scanning, abnormal detection, and a machine webhook endpoint. However, OpenEMR's lab system is **significantly more mature** in real-world lab machine integration. The biggest gaps are: **true HL7v2 message generation/parsing**, **multi-lab provider support**, **hierarchical test panels**, and **compendium loading**.

---

## 1. DATA MODEL COMPARISON

### HMS Current Schema

```
lab_test_catalog          → Flat test catalog
  ├── id, code, name, category, price
  ├── unit, normal_range, method
  ├── critical_low, critical_high
  └── is_active, tenant_id

lab_orders                → Order header
  ├── id, order_no (LO-000001), patient_id, visit_id
  ├── ordered_by, order_date, status
  ├── print_count, last_printed_at
  └── tenant_id

lab_order_items           → Individual tests within an order
  ├── id, lab_order_id, lab_test_id
  ├── unit_price, discount, line_total
  ├── result, result_numeric, abnormal_flag
  ├── status (pending→collected→received→processing→completed→verified→rejected)
  ├── barcode, notes, source
  ├── verified_by, verified_at, completed_at
  ├── hl7_device_id
  └── tenant_id
```

### OpenEMR Schema (7 tables)

```
procedure_providers       → Lab company profiles (LabCorp, Quest, local labs)
  ├── ppid, name, npi
  ├── send_app_id, send_fac_id      ← MSH-3, MSH-4 (HL7 header fields)
  ├── recv_app_id, recv_fac_id      ← MSH-5, MSH-6
  ├── protocol (DL|SFTP|FS|HTTP)    ← How to transmit orders
  ├── remote_host, login, password  ← Connection credentials
  ├── orders_path, results_path     ← File system paths for HL7 files
  ├── direction (B|R)               ← Bidirectional or Results-only
  └── lab_director

procedure_type            → Hierarchical test catalog (tree structure!)
  ├── procedure_type_id, parent     ← Self-referencing tree
  ├── name, procedure_code
  ├── procedure_type (group|fgp|ord|for|res|rec|pro)
  │   ├── group = Top-level lab
  │   ├── ord   = Orderable test
  │   ├── res   = Individual result type
  │   └── rec   = Recommendation
  ├── lab_id                        ← References procedure_providers
  ├── specimen, body_site, route_admin
  ├── standard_code (CPT4:12345)
  ├── related_code                  ← Follow-up codes if abnormal
  ├── units, range
  └── transport

procedure_order           → Order header
  ├── procedure_order_id, uuid
  ├── provider_id, patient_id, encounter_id
  ├── date_collected, date_ordered
  ├── order_priority, order_status (pending|routed|complete|canceled)
  ├── control_id                    ← KEY: ID returned from lab for matching
  ├── lab_id                        ← Which lab provider
  ├── specimen_type, specimen_location, specimen_volume, specimen_fasting
  ├── date_transmitted              ← When HL7 was sent
  ├── clinical_hx                   ← Clinical history for lab
  ├── order_diagnosis
  ├── procedure_order_type (laboratory_test|radiology|...)
  └── FHIR fields: scheduled_date, performer_type, order_intent, location_id

procedure_order_code      → Multi-test support per order
  ├── procedure_order_id
  ├── procedure_order_seq (1, 2, 3...)  ← Sequence within order
  ├── procedure_code, procedure_name
  ├── procedure_source (1=original, 2=added after)
  ├── diagnoses
  ├── do_not_send                   ← Can exclude from transmission
  └── transport

procedure_report          → Report from lab (1 per test per order)
  ├── procedure_report_id, uuid
  ├── procedure_order_id, procedure_order_seq
  ├── date_collected, date_report   ← With timezone offsets!
  ├── specimen_num
  ├── report_status (received|complete|error)
  ├── review_status (received|reviewed)  ← Clinician review tracking
  └── report_notes

procedure_result          → Individual result values
  ├── procedure_result_id, uuid
  ├── procedure_report_id
  ├── result_data_type (N=Numeric, S=String, F=Formatted, E=External, L=Long text)
  ├── result_code (LOINC)
  ├── result_text, result, units, range
  ├── abnormal (no|yes|high|low)
  ├── result_status (preliminary|final|corrected|incomplete)
  ├── comments
  ├── document_id                   ← Can attach documents to results
  └── date, date_end, facility

procedure_answers         → Answers to lab questions (AOE - Ask at Order Entry)
  ├── procedure_order_id, procedure_order_seq
  ├── question_code, answer_seq
  └── answer
```

---

## 2. FEATURE-BY-FEATURE COMPARISON

| Feature | HMS | OpenEMR | Gap |
|---------|-----|---------|-----|
| **Test Catalog** | Flat list (code, name, category, price) | Hierarchical tree (group→panel→test→result) | HMS has no panel/profile support |
| **Multi-test Orders** | ✅ Multiple items per order | ✅ Via `procedure_order_seq` | Parity |
| **Order Status Flow** | ✅ 7 states with validation | ✅ 4 states (pending→routed→complete→canceled) | HMS more granular |
| **Result Entry** | ✅ Manual + machine webhook | ✅ HL7v2 parsing + manual | HMS lacks true HL7 parsing |
| **Abnormal Detection** | ✅ Auto-detect with critical thresholds | ✅ Via range field + flags | Parity — HMS slightly better with critical_low/high |
| **Result Verification** | ✅ Doctor/pathologist verify | ❌ review_status only (received/reviewed) | HMS better |
| **Barcode Scanning** | ✅ Dedicated endpoint | ❌ Not built-in | HMS better |
| **Bulk Import** | ✅ CSV catalog import | ✅ Compendium loading (lab-specific format) | Different approaches |
| **Lab Provider Management** | ❌ No provider profiles | ✅ Full provider management with HL7 config | **MAJOR GAP** |
| **HL7v2 Order Generation** | ❌ None | ✅ Full MSH\|PID\|ORC\|OBR\|DG1\|OBX\|NTE | **MAJOR GAP** |
| **HL7v2 Result Parsing** | ❌ JSON webhook only | ✅ Full HL7 result file parsing | **MAJOR GAP** |
| **Transmission Protocols** | ❌ HTTP webhook only | ✅ DL (direct), SFTP, File System, HTTP | **MAJOR GAP** |
| **Lab-Specific Handlers** | ❌ None | ✅ LabCorp, Quest, Universal HL7 | Missing |
| **Compendium Loading** | ❌ Only CSV | ✅ Load lab-specific test catalogs | Missing |
| **Hierarchical Tests** | ❌ Flat catalog | ✅ Group→Panel→Test→Result tree | **MAJOR GAP** |
| **LOINC Coding** | ❌ Not evident | ✅ Via result_code field | Missing |
| **Ask-at-Order-Entry (AOE)** | ❌ None | ✅ procedure_questions + procedure_answers | Missing |
| **Specimen Tracking** | 🟡 Basic (barcode + status) | ✅ Full (type, location, volume, fasting) | Needs enrichment |
| **Document Attachment** | ❌ No | ✅ document_id on results | Missing |
| **FHIR Support** | 🟡 Via separate fhir.ts route | ✅ UUID on all tables, ServiceRequest/DiagnosticReport/Observation | Needs work |
| **Billing Integration** | ✅ Built-in (unit_price, discount, line_total) | 🟡 Via CPT codes only | HMS better |
| **Pending Follow-ups** | ❌ None | ✅ pending_followup.php — tracks orders needing attention | Missing |
| **Statistics/Analytics** | ❌ Basic only | ✅ procedure_stats.php | Missing |
| **Multi-tenant** | ✅ Full tenant isolation | ❌ Single-instance | HMS better |
| **TAT Tracking** | 🟡 Via timestamps (ordered→completed) | 🟡 Via date_ordered→date_report | Parity |

---

## 3. HOW OPENEMR LAB MACHINE INTEGRATION WORKS

### Order Flow (Outbound)
```
Doctor places order
       ↓
procedure_order + procedure_order_code created
       ↓
gen_hl7_order.inc.php generates HL7v2.3 ORM^O01 message:
  MSH|^~\&|{send_app}|{send_fac}|{recv_app}|{recv_fac}|{timestamp}||ORM^O01|{control_id}|P|2.3
  PID|||{patient_id}||{last}^{first}||{DOB}|{sex}||{race}|{address}
  ORC|NW|{order_id}|||||||{order_date}|||{npi}^{doc_last}^{doc_first}
  OBR|{seq}|{order_id}||{procedure_code}^{procedure_name}|||{date_collected}
  DG1|1||{diagnosis_code}^{diagnosis_text}
  OBX|{seq}|{data_type}|{question_code}||{answer}     ← AOE answers
       ↓
Transmitted via configured protocol:
  - DL: Direct link (HTTP POST)
  - SFTP: Upload HL7 file to remote server
  - FS: Write to local filesystem path
  - HTTP: REST API call
       ↓
date_transmitted + control_id saved
```

### Result Flow (Inbound)
```
Lab machine/LIS produces HL7 result file (ORU^R01)
       ↓
receive_hl7_results.inc.php:
  1. Parse HL7 segments (MSH, PID, OBR, OBX, NTE, ZPS)
  2. Match to order via control_id
  3. Handle patient matching (auto-create or match dialog)
  4. Create procedure_report record
  5. Create procedure_result records (one per OBX)
  6. Set abnormal flags, result_status
  7. Handle comments (NTE segments)
  8. Update order status
       ↓
Clinician reviews results (review_status: received → reviewed)
       ↓
Results available in patient portal
```

### Lab-Specific Handlers (Plugin Architecture)
```
/interface/procedure_tools/
  ├── labcorp/
  │   └── gen_hl7_order.inc.php    ← LabCorp-specific HL7 generation
  ├── quest/
  │   └── gen_hl7_order.inc.php    ← Quest-specific HL7 generation
  ├── gen_universal_hl7/
  │   └── gen_hl7_order.inc.php    ← Universal fallback
  └── ereqs/                        ← Electronic requisitions
```

---

## 4. HMS's CURRENT MACHINE ENDPOINT (What We Have)

```typescript
// POST /api/lab/machine/receive — Our current approach
{
  "deviceId": "analyzer-01",
  "barcode": "BC-001234",              // Match by barcode
  "orderNo": "LO-000001",             // Or match by order no
  "patientId": 123,                    // + patient ID
  "testCodes": [
    {
      "code": "HGB",
      "result": "14.2",
      "abnormalFlag": "normal"
    }
  ]
}
```

**Problems with current approach:**
1. **Custom JSON format** — No lab machine natively speaks this. Needs middleware.
2. **No HL7 parsing** — Can't consume standard HL7 messages from analyzers.
3. **No HL7 generation** — Can't send orders to external reference labs.
4. **No provider profiles** — Can't configure different labs with different protocols.
5. **No ASTM support** — Most benchtop analyzers (Sysmex, Mindray, Beckman) use ASTM/LIS2-A2.
6. **Barcode-only matching** — OpenEMR uses control_id which is more robust.

---

## 5. WHAT REAL BANGLADESH HOSPITAL LABS USE

### Common Analyzers in BD Hospitals
| Machine | Protocol | Output |
|---------|----------|--------|
| Mindray BC-5000/6800 (Hematology) | ASTM/LIS2-A2 via RS232/TCP | ASTM frames |
| Beckman AU480/AU680 (Chemistry) | ASTM via RS232/TCP | ASTM frames |
| Sysmex XN-series (Hematology) | HL7v2 or ASTM | HL7/ASTM |
| Bio-Rad D-10 (HbA1c) | ASTM via serial | ASTM frames |
| Roche cobas (Chemistry) | HL7v2 via TCP | HL7 ORU^R01 |
| Siemens ADVIA (Chemistry) | HL7v2 | HL7 ORU^R01 |
| Abbott ARCHITECT (Immunoassay) | ASTM | ASTM frames |

**Reality:** Most BD hospital labs use **ASTM protocol** via serial port or TCP. A few newer machines support HL7v2. Almost none support direct HTTP/JSON.

---

## 6. RECOMMENDED IMPLEMENTATION ROADMAP

### Phase 1: Data Model Enhancement (Foundation)
```
1. Add `lab_providers` table (like procedure_providers)
   - name, npi, protocol, host, port, credentials
   - send_app_id, recv_app_id (HL7 header config)
   - direction (bidirectional/results-only)

2. Add hierarchical test support to lab_test_catalog
   - parent_id (self-referencing for panels/profiles)
   - procedure_type (group|panel|test|result)
   - loinc_code field
   - specimen_type, specimen_instructions

3. Add `lab_questions` + `lab_answers` tables (AOE)

4. Enrich lab_order_items
   - specimen_type, specimen_volume, specimen_fasting
   - control_id (lab tracking number)
   - date_transmitted
   - document_id (attachment support)
   - result_status (preliminary|final|corrected)

5. Add `lab_reports` table (separate from items)
   - Links order → report → results (3-level hierarchy)
   - report_status, review_status, report_notes
```

### Phase 2: ASTM/HL7 Middleware Service
```
Build a small middleware service (Node.js or Python):

  Lab Analyzer ←→ [ASTM/HL7 Middleware] ←→ HMS API

  - Listens on TCP port for ASTM frames or HL7 messages
  - Parses ASTM LIS2-A2 frames (ENQ, STX, ETX, EOT)
  - Parses HL7v2 ORU^R01 messages
  - Converts to our JSON format
  - POSTs to /api/lab/machine/receive
  - Supports serial port (RS232) via serialport library

This keeps the HMS API clean while supporting real machines.
```

### Phase 3: HL7v2 Order Generation
```
  - Generate ORM^O01 messages for external lab orders
  - Support SFTP/FS/HTTP transmission
  - Lab-specific handler plugins (like OpenEMR's procedure_tools/)
```

### Phase 4: Advanced Features
```
  - Compendium loading from lab providers
  - Pending follow-up tracking
  - Cumulative result view (same test over time)
  - Lab statistics dashboard
  - Auto-notification for critical results
  - Patient portal result viewing
```

---

## 7. PRIORITY MATRIX

| Item | Effort | Impact | Priority |
|------|--------|--------|----------|
| Lab provider table | Low | High | **P0** |
| Hierarchical test panels | Medium | High | **P0** |
| ASTM middleware | Medium | **Critical** | **P0** |
| Specimen tracking fields | Low | Medium | **P1** |
| Control ID matching | Low | High | **P1** |
| Lab report table (3-level hierarchy) | Medium | High | **P1** |
| AOE questions/answers | Low | Medium | **P2** |
| HL7v2 order generation | High | Medium | **P2** |
| Compendium loading | Medium | Low | **P3** |
| LOINC code mapping | Medium | Medium | **P3** |
| Cumulative result view | Medium | High | **P2** |
| Lab statistics | Low | Medium | **P3** |

---

## 8. BOTTOM LINE

**Where HMS wins:** Multi-tenant, billing integration, barcode scanning, granular status workflow (7 vs 4 states), result verification by role, bulk CSV import.

**Where OpenEMR wins:** True HL7v2 bidirectional integration, lab provider management, hierarchical test catalog, ASTM/SFTP/FS protocols, compendium loading, AOE questions, LOINC/FHIR readiness, document attachment to results, lab-specific plugin architecture.

**The critical missing piece:** A TCP middleware that can speak ASTM/HL7 to real lab machines. This is the #1 blocker for real hospital deployment. No Mindray, Beckman, or Sysmex analyzer will POST JSON to an HTTP endpoint — they speak ASTM over serial/TCP.

---

*Report generated: April 20, 2026*
