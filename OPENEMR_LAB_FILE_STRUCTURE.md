# OpenEMR Lab System - File Structure & Quick Reference

**Location:** `/openemr-reference/`

## Directory Tree

```
openemr-reference/
├── interface/
│   ├── orders/                                    # Core lab order management
│   │   ├── gen_hl7_order.inc.php                 ⭐ HL7 Order generation
│   │   ├── receive_hl7_results.inc.php          ⭐ HL7 Result parsing
│   │   ├── pending_orders.php                    # UI: Pending orders
│   │   ├── orders_results.php                    # UI: View results
│   │   ├── procedure_provider_list.php           # Lab provider management
│   │   ├── procedure_provider_edit.php
│   │   ├── types.php                             # Procedure type management
│   │   ├── types_ajax.php
│   │   ├── types_edit.php
│   │   ├── qoe.inc.php                           # Question on Entry system
│   │   └── single_order_results.php              # Individual result display
│   │
│   ├── forms/procedure_order/                    # Lab order form
│   │   ├── common.php                            ⭐ Multi-test order logic
│   │   ├── new.php                               # New order entry point
│   │   ├── view.php                              # View form
│   │   ├── report.php                            # Report generation
│   │   ├── delete.php
│   │   ├── procedure_order_save_functions.php   ⭐ Save & update handlers
│   │   ├── handle_deletions.php
│   │   ├── table.sql
│   │   └── templates/
│   │       ├── procedure_reason_row.php
│   │       └── procedure_specimen_row.php
│   │
│   ├── procedure_tools/                          # Lab-specific integrations
│   │   ├── labcorp/
│   │   │   └── gen_hl7_order.inc.php            # LabCorp HL7 format
│   │   ├── quest/
│   │   │   └── gen_hl7_order.inc.php            # Quest HL7 format
│   │   ├── gen_universal_hl7/
│   │   │   └── gen_hl7_order.inc.php            # Universal HL7 v2.3
│   │   ├── ereqs/                                # Direct/secure mail
│   │   └── libs/
│   │       └── labs_ajax.php                     # AJAX helpers
│   │
│   ├── patient_file/summary/
│   │   ├── labdata.php                           # Lab results summary
│   │   └── labdata_fragment.php                  # Fragment for dashboard
│   │
│   └── main/messages/
│       └── lab_results_messages.php              # Result notifications
│
├── src/Services/
│   ├── ProcedureService.php                      ⭐ Service layer: Orders
│   ├── ObservationLabService.php                 ⭐ Service layer: Results
│   ├── ProcedureOrderRelationshipService.php     ⭐ Linking to clinical data
│   ├── ProcedureProviderService.php              # Lab provider service
│   │
│   ├── FHIR/Observation/
│   │   └── FhirObservationLaboratoryService.php  # FHIR mapping
│   │
│   ├── FHIR/DiagnosticReport/
│   │   └── FhirDiagnosticReportLaboratoryService.php
│   │
│   └── Qdm/Services/
│       ├── LaboratoryTestOrderedService.php      # QDM mapping
│       └── LaboratoryTestService.php
│
├── src/Common/Orders/
│   ├── Hl7OrderResult.php                        # Result DTO
│   └── Hl7OrderGenerationException.php           # Exception handling
│
├── src/Events/Services/
│   ├── DornLabEvent.php                          # Lab event integration
│   └── QuestLabTransmitEvent.php
│
├── sql/
│   ├── database.sql                              # Full schema (if exists)
│   ├── 3_2_0-to-4_0_0_upgrade.sql               📋 Tables created here:
│   │   ├── procedure_order
│   │   ├── procedure_report
│   │   ├── procedure_result
│   │   ├── procedure_type
│   │   └── procedure_providers
│   │
│   ├── 4_1_1-to-4_1_2_upgrade.sql               📋 Added:
│   │   ├── procedure_order_code (multi-test)
│   │   ├── procedure_answers (QOE)
│   │   ├── procedure_questions (QOE config)
│   │   └── procedure_specimen
│   │
│   └── [other migrations]
│
└── library/
    └── [legacy procedural code, mostly superseded by src/Services/]
```

---

## Key Files Quick Reference

### 1️⃣ HL7 Message Generation & Transmission

| File | Purpose | Key Function |
|------|---------|--------------|
| `/interface/orders/gen_hl7_order.inc.php` | Core HL7 order generation | `default_gen_hl7_order($orderid)` |
| `/interface/procedure_tools/*/gen_hl7_order.inc.php` | Lab-specific formatting | `{lab}_gen_hl7_order($orderid)` |
| `/interface/orders/gen_hl7_order.inc.php` | Order transmission | `default_send_hl7_order($ppid, $hl7)` |

**Example Call:**
```php
$result = default_gen_hl7_order(101);  // Returns Hl7OrderResult with HL7 text
echo $result->getHl7Text();  // Get raw HL7 message
$error = default_send_hl7_order(5, $result->getHl7Text());  // Send to lab
```

### 2️⃣ HL7 Result Receipt & Parsing

| File | Purpose | Key Function |
|------|---------|--------------|
| `/interface/orders/receive_hl7_results.inc.php` | Parse incoming results | `rhl7LogMsg($msg)`, `rhl7InsertRow()` |
| `/interface/orders/receive_hl7_results.inc.php` | Process OBX segments | `parseZPS($segment)` |

**Data Flow:**
```
HL7 File → Parse PID/OBX → Match to procedure_order → 
Insert procedure_report + procedure_result → Audit log
```

### 3️⃣ Order Management & Multi-Test Support

| File | Purpose | Key Function |
|------|---------|--------------|
| `/interface/forms/procedure_order/common.php` | Multi-test form logic | Multi-sequence handling |
| `/interface/forms/procedure_order/procedure_order_save_functions.php` | Save handler | `saveProcedureOrderCodes()` |
| `/interface/orders/types.php` | Test type management | CRUD for procedure_type |
| `/interface/orders/types_ajax.php` | AJAX for type selection | Dynamic test lookup |

**Save Pattern:**
```php
// Multiple tests in single order
for ($i = 0; isset($postData['form_proc_type'][$i]); ++$i) {
    // Each iteration = new test (sequence)
    // Save: test code, specimen, QOE answers
}
```

### 4️⃣ Question on Entry (QOE) System

| File | Purpose | Key Function |
|------|---------|--------------|
| `/interface/orders/qoe.inc.php` | QOE rendering | Dynamic question display |
| `procedure_questions` (table) | Question config | Per-lab questions |
| `procedure_answers` (table) | Answer storage | Physician responses |

**Configuration:**
```sql
-- Example: LabCorp CBC needs fasting status
INSERT INTO procedure_questions VALUES (
  5,              -- lab_id (LabCorp)
  '85025',        -- procedure_code (CBC)
  'FASTING',      -- question_code
  1,              -- sequence
  'Patient fasting?',
  1,              -- required
  255,            -- maxsize
  'S',            -- fldtype (Select)
  'Y:Yes|N:No|U:Unknown'
);
```

### 5️⃣ Service Layer (Modern PSR-4)

| File | Purpose | Key Class/Methods |
|------|---------|-------------------|
| `/src/Services/ProcedureService.php` | Order lifecycle | `search()`, `insert()`, `update()` |
| `/src/Services/ObservationLabService.php` | Result queries | `search()`, `isValidProcedureCode()` |
| `/src/Services/ProcedureOrderRelationshipService.php` | Link to clinical data | `addRelationship()`, `getRelationshipsByOrderId()` |

**Example Usage:**
```php
$service = new ProcedureService();
$orders = $service->search([
    'patient_id' => 42,
    'date_range' => ['2025-01-01', '2025-12-31']
]);

$relService = new ProcedureOrderRelationshipService();
$relService->addRelationship(
    $orderId,           // procedure_order_id
    'Condition',        // resourceType
    $conditionUuid,     // supporting diagnosis
    'reason-reference'
);
```

### 6️⃣ Database Tables (SQL Schema)

**Core Tables in `sql/` directory:**

```sql
-- Order Management
procedure_order
├── procedure_order_id INT PRIMARY KEY
├── provider_id BIGINT (who ordered)
├── patient_id BIGINT
├── lab_id BIGINT (FK: procedure_providers)
├── date_ordered, date_collected
├── order_status (pending, routed, complete, canceled)
├── order_priority (S=STAT, R=Routine)
└── control_id (lab returns this in results)

-- Multi-Test Support
procedure_order_code
├── procedure_order_id BIGINT (FK)
├── procedure_order_seq INT (1,2,3...)
├── procedure_code VARCHAR (test code)
├── diagnoses TEXT (ICD10, semicolon-delimited)
└── PRIMARY KEY (procedure_order_id, procedure_order_seq)

-- Result Grouping
procedure_report
├── procedure_report_id INT PRIMARY KEY
├── procedure_order_id BIGINT (FK)
├── specimen_num VARCHAR (lab control ID)
├── report_status (received, complete, error)
├── review_status (pending, reviewed)
└── date_report

-- Individual Results
procedure_result
├── procedure_result_id INT PRIMARY KEY
├── procedure_report_id BIGINT (FK)
├── procedure_code VARCHAR (LOINC code)
├── result VARCHAR (the value: "13.5")
├── units VARCHAR ("g/dL")
├── range VARCHAR ("12-16")
├── abnormal VARCHAR (no, yes, high, low)
├── result_status (preliminary, final, corrected, incomplete)
└── comments TEXT

-- Lab Configuration
procedure_providers
├── ppid INT PRIMARY KEY
├── name VARCHAR (lab name)
├── protocol (DL, SFTP, FS, HTTP)
├── login, password (for SFTP)
├── orders_path, results_path
└── npi VARCHAR

-- Question Configuration
procedure_questions
├── lab_id, procedure_code, question_code (composite PK)
├── question_text
├── fldtype (T, N, S, D, G)
└── options (for select)

-- Specimen Tracking
procedure_specimen
├── id INT PRIMARY KEY
├── procedure_order_id BIGINT (FK)
├── procedure_order_seq INT (FK)
├── specimen_source (blood, urine)
├── specimen_num (lab barcode)
└── date_collected
```

---

## UI Pages (Patient Perspective)

### Patient Summary
- **File:** `/interface/patient_file/summary/labdata.php`
- **Shows:** Historical lab results with trending
- **Access:** Patient chart → "Lab Results" tab

### Physician Order Entry
- **File:** `/interface/forms/procedure_order/`
- **Workflow:**
  1. New order form
  2. Select test type(s)
  3. Select specimen(s)
  4. Answer QOE questions
  5. Link diagnoses
  6. Submit (generates HL7)

### Order Tracking
- **File:** `/interface/orders/pending_orders.php`
- **Shows:** Orders awaiting results

### Result Review
- **File:** `/interface/orders/orders_results.php`
- **Workflow:**
  1. Incoming results auto-parsed
  2. Physician reviews
  3. Sign off (updates review_status)
  4. Notification to patient

---

## Integration Points for HMS

### 1. Custom Lab Integration
```php
// Add in /interface/procedure_tools/your-lab/gen_hl7_order.inc.php
function your_lab_gen_hl7_order(int $orderid): Hl7OrderResult {
    // Custom HL7 formatting for your lab's requirements
}

function your_lab_send_hl7_order($ppid, $out) {
    // Custom transmission (SFTP, HTTP, etc.)
}
```

### 2. Machine Interface
```
Lab Machine (ASTM) ↔ Converter ↔ HL7 Parser ↔ OpenEMR
                                    ↑
                          /interface/orders/
                          receive_hl7_results.inc.php
```

### 3. Result Webhook
```php
// Add endpoint to receive results from modern lab LIS
// POST /api/v1/lab-results
// {
//   "specimen_id": "ABC123",
//   "tests": [
//     {"code": "85025", "result": "13.5", "units": "g/dL"}
//   ]
// }
```

---

## Performance Tips

### Query Optimization
```sql
-- Always include these indexes
CREATE INDEX idx_date_patient ON procedure_order (date_ordered, patient_id);
CREATE INDEX idx_control_id ON procedure_order (control_id);
CREATE INDEX idx_order_status ON procedure_order (order_status);
CREATE INDEX idx_order_uuid ON procedure_order (order_uuid);
```

### Typical Query Times
- Get patient's pending orders: **~50ms**
- Match result by control_id: **~30ms** (indexed lookup)
- Get all orders in date range: **~100ms** (composite index)
- Multi-test order save: **~200ms** (5 sequential inserts)

---

## Testing the Lab System

### Manual HL7 Testing
```bash
# 1. Create a test order via UI
# 2. Check generated HL7 file at /orders_path/
# 3. Download and inspect delimiters
# 4. Upload result file to /results_path/

# Example HL7 Order:
MSH|^~\&|OpenEMR|MyClinic|LabCorp|LabCorp|20250420150230||ORM^O01|0001|P|2.3
PID|1|12345|12345||Doe^John
ORC|NW|0001
OBR|1|0001||85025^CBC
OBX|1|NM|85025^CBC||13.5|g/dL|12-16|
```

### Automated Testing
```bash
cd /path/to/openemr-reference
composer phpunit tests/Tests/Services/ProcedureServiceTest.php
composer phpunit tests/Tests/Services/ObservationLabServiceTest.php
```

---

## Key Takeaways for HMS

1. **Multi-test orders** use `procedure_order_seq` (1,2,3...)
2. **HL7 is the standard** (not ASTM, not bespoke XML)
3. **Result matching** via control_id → procedure_order
4. **Pluggable integrations** at `/interface/procedure_tools/{lab}/`
5. **Modern service layer** handles business logic (PSR-4 in `/src/`)
6. **UUID support** for FHIR/HL7 FHIR API
7. **Audit trail** automatic via EventAuditLogger
8. **QOE system** allows lab-specific questions

---

**Last Updated:** 2026-04-20 | **OpenEMR Version:** 7.x
