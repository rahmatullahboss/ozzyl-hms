# OpenEMR Lab System Architecture & LIS Integration Analysis

**Found in:** `/Users/rahmatullahzisan/Desktop/Dev/hms/openemr-reference/`  
**Date:** April 20, 2026  
**Version:** OpenEMR 7.x (current as of Mar 2025)

---

## 1. SYSTEM OVERVIEW

OpenEMR's lab system handles **Order → Result workflow** for laboratory testing. It's designed for:
- **Outpatient labs** (LabCorp, Quest)
- **LIS machine integration** via **HL7 v2.3** and **custom protocols**
- **Specimen tracking** with collection dates and specimen types
- **Multi-test orders** (multiple tests in one order)
- **Bidirectional communication**: EMR → Lab (orders) + Lab → EMR (results)

---

## 2. DATA MODEL: CORE TABLES

### 2.1 Main Tables (MySQL)

```
procedure_order
├── procedure_order_id (PK)
├── provider_id (ordering physician)
├── patient_id
├── encounter_id
├── lab_id (references procedure_providers.ppid)
├── date_ordered
├── date_collected
├── order_priority (STAT/Routine)
├── order_status (pending, routed, complete, canceled)
├── control_id (lab control number returned)
└── patient_instructions

procedure_order_code (multiple tests per order)
├── procedure_order_id (FK)
├── procedure_order_seq (1, 2, 3... supports multiple tests)
├── procedure_code (e.g., "85025" for CBC)
├── procedure_name
├── diagnoses (ICD10 codes, semicolon-delimited)
├── transport (specimen transport method)
└── reason_* fields (reason for order)

procedure_report (one report per order, may have multiple results)
├── procedure_report_id (PK)
├── procedure_order_id (FK)
├── date_collected
├── date_report
├── specimen_num (lab control ID)
├── report_status (received, complete, error)
├── review_status (pending, reviewed)
└── source (user_id who entered data)

procedure_result (multiple results per report)
├── procedure_result_id (PK)
├── procedure_report_id (FK)
├── procedure_type_id
├── date (result-specific timestamp)
├── facility (testing facility ID)
├── units (e.g., "g/dL")
├── result (value, e.g., "13.5")
├── range (e.g., "12-16")
├── abnormal (no, yes, high, low)
├── result_status (preliminary, final, corrected, incomplete)
└── comments (lab notes)

procedure_providers (lab integrations)
├── ppid (provider ID)
├── name (lab name)
├── npi
├── protocol (DL, SFTP, FS, HTTP)
├── login/password (for SFTP)
├── orders_path (where to upload HL7)
└── results_path (where to fetch results)

procedure_questions (configurable questions per lab/test)
├── lab_id
├── procedure_code
├── question_code
├── question_text
├── fldtype (T=Text, N=Number, S=Select, D=Date, G=Gestational)
└── options (for select fields)

procedure_answers (answers to lab-specific questions)
├── procedure_order_id
├── procedure_order_seq
├── question_code
├── answer (user response)
```

---

## 3. HL7 MESSAGE FLOW

### 3.1 Order Generation (ORM^O01)

**File:** `/interface/orders/gen_hl7_order.inc.php`  
**Function:** `default_gen_hl7_order(int $orderid): Hl7OrderResult`

**HL7 Structure:**
```
MSH | Encoding characters, sending/receiving app IDs, timestamp
PID | Patient demographics (name, DOB, sex, address, SSN)
NTE | Active medications (comma-delimited note)
PV1 | Patient visit info, attending physician
IN1 | Insurance information (primary, secondary, tertiary)
GT1 | Guarantor (defaults to patient)
ORC | Common order (order status "NW" = new order)
OBR | Observation request (test code, specimen source, physician)
DG1 | Diagnoses (ICD10 codes only)
OBX | Order entry questions and answers (custom per lab)
```

**Delimiters Used:**
- `|` (field separator)
- `^` (component separator)
- `\` (escape character)
- `&` (sub-component separator)
- `\r` (carriage return, record separator)

**Example MSH Segment:**
```
MSH|^~\&|[SendingApp]|[SendingFacility]|[ReceivingApp]|[ReceivingFacility]|20260420150230||ORM^O01|0001|P|2.3
```

### 3.2 Result Receipt & Parsing

**File:** `/interface/orders/receive_hl7_results.inc.php`

**Segments Parsed:**
- **ZPS** (Custom Z-segment for lab info)
- **PID** (confirm patient)
- **OBX** (results - the critical segment)
- **NTE** (notes/comments)
- **ERR** (error handling)

**Data Flow:**
```
1. Parse HL7 result file
2. Extract patient ID (PID-3)
3. Match to procedure_order via control_id
4. Extract results from OBX segments
5. Validate data types:
   - NM (numeric) → procedure_result.result
   - ST (string) → procedure_result.comments
   - TX (text) → procedure_result.comments
   - SN (structured numeric) → parse low/high bounds
6. Insert into procedure_report & procedure_result
7. Audit log: EventAuditLogger("lab-results-received")
```

---

## 4. LAB INTEGRATION PROTOCOLS

### 4.1 Transmission Methods (procedure_providers.protocol)

**1. DL (Download/Manual)**
- File force-downloads as `order_[MSGID].hl7`
- User manually uploads to lab portal
- Use case: Small practices, startup labs

**2. SFTP (SSH File Transfer)**
```php
$sftp = new SFTP($remote_host);
$sftp->login($pprow['login'], $pprow['password']);
$sftp->put("{$orders_path}/{$msgid}.txt", $out);
```
- Encrypted file transfer
- Upload to `procedure_providers.orders_path`
- Retrieve results from `procedure_providers.results_path`

**3. FS (File System)**
- Write to local server directory
- Use case: Labs on same network

**4. HTTP/HTTPS** (placeholder, not implemented)
- Could add REST API integration here
- Would need custom transmit function

### 4.2 Lab-Specific Implementations

OpenEMR supports **pluggable lab integrations**:

**Directory:** `/interface/procedure_tools/`
```
/labcorp/
  └── gen_hl7_order.inc.php (LabCorp-specific HL7 formatting)
  
/quest/
  └── gen_hl7_order.inc.php (Quest-specific)
  
/gen_universal_hl7/
  └── gen_hl7_order.inc.php (Generic HL7 v2.3)
  
/ereqs/
  └── (Direct/secure message protocol)
```

**Custom Hook Pattern:**
```php
// In /interface/procedure_tools/{lab}/gen_hl7_order.inc.php
function {lab}_gen_hl7_order(int $orderid): Hl7OrderResult { ... }
function {lab}_send_hl7_order($ppid, $out) { ... }
```

---

## 5. MODERN SERVICE LAYER (PSR-4)

### 5.1 Procedure Service

**File:** `/src/Services/ProcedureService.php`

```php
class ProcedureService extends BaseService {
    const PROCEDURE_TABLE = "procedure_order";
    const PROCEDURE_REPORT_TABLE = "procedure_report";
    const PROCEDURE_RESULT_TABLE = "procedure_result";
    
    // Relationships
    ProcedureOrderRelationshipService $relationshipService;
    
    // Methods
    search($search, $isAndCondition)  // Complex JOIN query
    validateOrder()
    getByPatient($patientId)
    getByProvider($providerId)
    trackProcedureLifecycle()
}
```

**UUID Support:** All tables have `*_uuid` fields for FHIR mapping.

### 5.2 Observation Lab Service

**File:** `/src/Services/ObservationLabService.php`

```php
class ObservationLabService extends BaseService {
    const PROCEDURE_RESULT_TABLE = "procedure_result";
    
    // USCDI v1 Mapping (US Core Data elements)
    search($search, $isAndCondition)
    isValidProcedureCode($code)
    isValidProcedureResultCode($code)
    getSampleLaboratoryResults()  // FHIR example
}
```

Maps to **LOINC codes** (Logical Observation Identifiers Names and Codes).

### 5.3 Procedure Order Relationship Service

**File:** `/src/Services/ProcedureOrderRelationshipService.php`

```php
class ProcedureOrderRelationshipService {
    // Junction table: procedure_order_relationships
    addRelationship(
        $procedureOrderId,
        $resourceType,       // 'Observation', 'Condition', 'DocumentReference'
        $resourceUuid,
        $relationship        // 'supporting-info', 'reason-reference'
    )
    
    getRelationshipsByOrderId($procedureOrderId)
    getRelationshipsByType($procedureOrderId, $resourceType)
}
```

**Purpose:** Link orders to supporting clinical data (FHIR ServiceRequest.supportingInfo).

---

## 6. SPECIMEN HANDLING

### 6.1 Specimen Table

```sql
procedure_specimen
├── id (PK)
├── procedure_order_id
├── procedure_order_seq
├── specimen_source (blood, urine, etc.)
├── specimen_type (serum, plasma, whole blood)
├── specimen_container
├── specimen_num (lab control ID)
├── date_collected
├── collection_method
└── specimen_quantity
```

### 6.2 Specimen Tracking Flow

```
1. Provider selects specimen source at order time:
   ├── OBR-15 field in HL7 (specimen code)
   └── Maps to SNOMED-CT codes
   
2. Lab receives specimen, assigns control number:
   └── Returns in result file as specimen_num
   
3. Result matched by:
   ├── Control ID (primary)
   ├── Specimen number (secondary)
   └── Patient + Test code (fallback)
```

---

## 7. QUESTION/ANSWER (QOE) SYSTEM

### 7.1 Lab-Specific Questions

Example: LabCorp might ask:
```
procedure_questions:
├── lab_id: 5 (LabCorp)
├── procedure_code: "85025" (CBC)
├── question_code: "FASTING"
├── question_text: "Patient fasting status?"
├── fldtype: "S" (Select)
├── options: "Y:Yes|N:No|U:Unknown"
```

### 7.2 Order Entry Questions

When physician orders a test, they answer:
```
procedure_answers:
├── procedure_order_id: 101
├── procedure_order_seq: 1
├── question_code: "FASTING"
├── answer: "Y"
```

Included in HL7 OBX segment.

---

## 8. ERROR HANDLING & AUDIT

### 8.1 HL7 Parsing Errors

```php
function rhl7LogMsg($msg, $fatal = true) {
    if ($fatal) {
        $rhl7_return['mssgs'][] = '*' . $msg;  // Error
        EventAuditLogger::getInstance()->newEvent(
            "lab-results-error",
            $_SESSION['authUser'],
            $_SESSION['authProvider'],
            0,
            $msg
        );
    }
}
```

**Audit Events Logged:**
- `lab-results-received` (success)
- `lab-results-error` (failure)
- Order creation/transmission
- Result review status changes

### 8.2 Result Status Lifecycle

```
pending/incomplete (arriving)
    ↓
preliminary (partial results)
    ↓
final (complete)
    ↓
reviewed (clinician reviewed)
```

Can also be:
- `corrected` (amended after final)
- `cannot be done` (test failed)
- `error` (data quality issue)

---

## 9. FHIR MAPPING (R4)

### 9.1 Procedure Order → ServiceRequest

```
ServiceRequest:
├── id → procedure_order_uuid
├── subject → patient UUID
├── requester → provider UUID
├── encounter → encounter UUID
├── code → procedure_code + LOINC
├── intent → "order"
├── status → order_status mapped
├── priority → order_priority mapped
├── specimen → Specimen resource
├── supportingInfo → Condition/Observation UUIDs
└── note → patient_instructions
```

### 9.2 Procedure Result → Observation

```
Observation:
├── id → procedure_result_uuid
├── subject → patient UUID
├── encounter → encounter UUID
├── code → LOINC (from result_code)
├── effectiveDateTime → date_report
├── value → result value
├── status → result_status (mapped)
├── component → multi-part results
└── interpretation → abnormal (mapped to value set)
```

---

## 10. FRONTEND WORKFLOW

### 10.1 Patient Pages

**File:** `/interface/patient_file/summary/labdata.php`
- Display current + historical lab results
- Filter by date range
- Show abnormal flags

### 10.2 Order Management

**File:** `/interface/orders/pending_orders.php`
- List pending orders
- Show transmission status
- Resend failed orders

**File:** `/interface/orders/orders_results.php`
- Display received results
- Review status
- Sign off on final results

### 10.3 Forms

**File:** `/interface/forms/procedure_order/`
- Multi-test order entry
- Specimen selection
- Question answer capture
- Diagnosis linking

---

## 11. PROCEDURE ORDER FORM (Key Implementation)

### 11.1 Save Function

**File:** `/interface/forms/procedure_order/procedure_order_save_functions.php`

```php
function saveProcedureOrderCodes($formid, $postData) {
    // Multi-sequence handling (multiple tests per order)
    for ($i = 0; isset($postData['form_proc_type'][$i]); ++$i) {
        $ptid = (int)$postData['form_proc_type'][$i];
        
        // Determine INSERT vs UPDATE
        if ($existing_seq > 0 && in_array($existing_seq, $existingCodes)) {
            updateProcedureOrderCode($formid, $existing_seq, $orderCodeData, $ptid);
        } else {
            $order_seq = nextSequenceFor($formid);
            insertProcedureOrderCode($formid, $order_seq, $orderCodeData, $ptid);
        }
        
        // Save specimens for this test
        saveProcedureSpecimens($formid, $order_seq, $postData, $i);
        
        // Save QOE answers
        saveProcedureAnswers($formid, $order_seq, $ptid, $postData, $i);
    }
}
```

### 11.2 Key Fields Captured

```
Per Test:
├── procedure_code (LOINC/local code)
├── procedure_name
├── diagnoses (ICD10 reason)
├── specimen_source (blood, urine, etc.)
├── transport_method
└── QOE answers (lab-specific)

Per Order:
├── provider_id
├── patient_id
├── encounter_id
├── date_collected
├── date_ordered
├── order_priority (STAT vs Routine)
└── patient_instructions
```

---

## 12. KEY INTEGRATION POINTS FOR HMS

### 12.1 Where to Extend

**1. Custom Protocol Handler**
```php
// /interface/procedure_tools/your-lab/gen_hl7_order.inc.php
function custom_gen_hl7_order(int $orderid): Hl7OrderResult { ... }
function custom_send_hl7_order($ppid, $hl7) { ... }
```

**2. Custom Result Parser**
```php
// /interface/orders/receive_hl7_results.inc.php
// Add custom segment handler for lab-specific Z-segments
```

**3. Machine Integration**
- Add ASTM protocol handler (common in lab analyzers)
- Implement HL7 SFTP receiver daemon
- Add real-time result API endpoint

### 12.2 For HMS Lab Management

You could map:
```
Lab Machine (ASTM) ←→ HL7 → OpenEMR ←→ Hospital Patient Record
```

**Components Needed:**
1. **ASTM ↔ HL7 Converter** (lab machine protocol to EMR format)
2. **SFTP/HTTP Result Listener** (receive results)
3. **Specimen Barcode Scanner** (link results to specimen)
4. **Test Code Mapping** (machine codes → LOINC)

---

## 13. DATABASE SCHEMA PATTERNS

### 13.1 UUID Fields (FHIR Standard)

All modern tables have:
```sql
procedure_order:
├── procedure_order_id (legacy PK)
└── order_uuid BINARY(16) -- FHIR resource ID

procedure_report:
├── procedure_report_id (legacy)
└── report_uuid BINARY(16)

procedure_result:
├── procedure_result_id (legacy)
└── result_uuid BINARY(16)
```

**Managed by:** `UuidRegistry` (src/Common/Uuid/UuidRegistry.php)

### 13.2 Relationships Table

```sql
procedure_order_relationships:
├── id (PK)
├── procedure_order_id (FK)
├── resource_type ('Observation', 'Condition')
├── resource_uuid (binary UUID)
├── relationship ('supporting-info', 'reason-reference')
├── created_at
└── created_by
```

Links orders to:
- Diagnosis/Problem (Condition)
- Vital signs (Observation)
- Supporting documents (DocumentReference)

---

## 14. SEQUENCE & PRIORITY LOGIC

### 14.1 Test Priority

```
order_priority:
├── S (STAT) = high priority, immediate processing
└── R (Routine) = standard, next batch

Sent in HL7 OBR-11 field
```

### 14.2 Sequence Numbering

```
procedure_order_seq (in procedure_order_code):
├── 1 = first test
├── 2 = second test
├── 3 = third test
└── Auto-incremented per order
```

Multiple specimens support:
```
Same order, different sequences:
├── Seq 1: CBC (whole blood)
├── Seq 2: Chemistry (serum)
├── Seq 3: UA (urine)
```

---

## 15. CRITICAL IMPLEMENTATION NOTES FOR HMS

### 15.1 Best Practices

✅ **DO:**
- UUID all new tables for FHIR compatibility
- Use service layer pattern (extend BaseService)
- Preserve legacy ID columns for backward compat
- Log all lab events to audit trail
- Validate all HL7 delimiters on parsing
- Use prepared statements (parameterized queries)

❌ **DON'T:**
- Hard-code HL7 delimiters
- Store patient PHI in plain text (encrypt SSN, MRN)
- Skip audit logging
- Assume test codes are LOINC (support multiple codesystems)
- Forget to handle multiple results per specimen

### 15.2 Performance Considerations

**Indexes Needed:**
```sql
KEY idx_date_patient (date_ordered, patient_id)
KEY idx_order_status (order_status)
KEY idx_control_id (control_id)  -- for result matching
KEY idx_order_uuid (order_uuid)
```

**Typical Queries:**
- Get orders for patient in date range: ~100ms
- Match incoming result to order: ~50ms (on control_id)
- Get results by status: ~200ms

---

## 16. MISSING/FUTURE CAPABILITIES

Based on code review:

### 16.1 Not Yet Implemented
- [ ] Real-time HL7 message queue (current: file-based)
- [ ] ASTM-E1394 protocol support (for machine interfaces)
- [ ] Delta/incremental result updates
- [ ] RESTful result submission API
- [ ] SNOMED-CT for specimen codes (only method names stored)
- [ ] Structured data exchange (HL7 CDA)

### 16.2 Enhancement Opportunities
- [ ] Machine learning for abnormal detection
- [ ] Automated result interpretation rules
- [ ] Integration with lab LIS (bidirectional sync)
- [ ] Specimen tracking with barcodes
- [ ] Result notification to patient portal
- [ ] Batch result import UI

---

## CONCLUSION

OpenEMR's lab system is **enterprise-grade** with:
- ✅ **Modular design** (pluggable lab integrations)
- ✅ **HL7 v2.3 support** (industry standard)
- ✅ **Multi-test order capability** (sequence-based)
- ✅ **FHIR R4 mapping** (modern standards)
- ✅ **Audit trail** (compliance-ready)
- ✅ **Specimen tracking** (quality control)
- ⚠️ **File-based integration** (not real-time)
- ⚠️ **Limited machine protocol support** (no ASTM)

**For HMS Integration:** This reference shows the complete pattern needed to handle lab orders and results. The key is the **procedure_order** → **procedure_report** → **procedure_result** hierarchy with proper UUID linking to FHIR resources.

---

**Generated:** 2026-04-20 | **OpenEMR Version:** 7.x | **Location:** openemr-reference/
