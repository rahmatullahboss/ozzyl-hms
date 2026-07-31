# Clinical Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Clinical module is the **doctor-facing electronic medical record (EMR)** layer in DanpheEMR. It captures everything the clinician does at the bedside or in the OPD room: vital signs, allergies, problem list, past and family history, medication history, home medications, structured clinical notes (SOAP-style: Subjective / Objective / Assessment / Plan), diagnosis + orders (lab, imaging, medication) and scanned clinical documents.

The module is also the canonical place where **clinical notes drive downstream transactions**: posting a History & Physical, Emergency, OPD, or Progress note simultaneously creates `CLN_Diagnosis` rows, `LAB_TestRequisition` rows, `RAD_PatientImagingRequisition` rows, `PHRM_PrescriptionItems` rows, and `BIL_BillItemRequisition` rows in a single transaction — this is the heart of the OPD workflow that links doctor → orders → billing.

Domain capabilities covered:
- **Vitals capture** per visit (height, weight, BMI, BP, pulse, temperature, SpO2, RR, pain scale) with cross-visit fallback.
- **Allergy registry** (drug / food / environmental, severity, reaction, verified flag).
- **Problem list** — Active medical, Past medical, Family history (ICD-10 tagged), Social history, Surgical history.
- **Home medications and chronic prescriptions** recorded on the patient record.
- **Input/Output monitoring** (fluid balance during IPD visits).
- **Structured clinical notes** — template-driven: Free Text, Progress Note, History & Physical, Emergency Note, Procedure Note, Prescription Note, OPD General, Consult Note, Discharge Note.
- **Diagnosis + Orders** — each diagnosis row carries its own lab / imaging / prescription orders, and posting the note generates bill items.
- **Eye EMR sub-module** — ophthalmology-specific master + per-eye data (refraction, ablation, pachymetry, wavefront, ORA, LASIK/SMILE settings, etc.) plus prescription slip and scanned images.
- **Scanned clinical documents** stored on disk (file path from `CORE_CFG_Parameters.ClinicalDocumentUploadLocation`), metadata in `CLN_PAT_Images`.
- **Consultation requests** between departments/consultants (`CLN_ConsultationRequest`).
- **Patient clinical key-value info** — flexible `CLN_KV_PatientClinical_Info` for misc fields.
- **Blood sugar monitoring** and **Diet** sub-features.
- **Intake/Output parameter master** — the configurable list of fluids/substances used in I/O charting.

Key file paths:
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Clinical/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/ClinicalModels/`
- EF DbContext: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/ClinicalDbContext.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/clinical/` and `clinical-notes/`

---

## 2. Backend Files

### 2.1 Controllers

| File | Purpose |
|------|---------|
| `Controllers/Clinical/ClinicalController.cs` | Main REST API: vitals, allergies, history, problems, notes (GET and POST), eye EMR, scanned images, consultation requests, intake/output parameters. ~4400+ lines, refactored from a single `reqType` switch into per-route attributes. |
| `Controllers/Clinical/ClinicalViewController.cs` | MVC view routes for the clinical pages (Clinical, Vitals, InputOutputList, AllergyList, HomeMedication, MedicationPrescription, ProblemsMain, ActiveMedical, PastMedical, History, FamilyHistory, SurgicalHistoryList, SocialHistoryList, Notes, DoctorNotes, Diagnosis, ScannedImages). |

### 2.2 GET routes in `ClinicalController.cs`

| Method | Route | Purpose |
|--------|-------|---------|
| `Vitals` | `GET /api/Clinical/LatestVitals?patientVisitId=` | Returns vitals for the visit. If fewer than 3 records, falls back to the previous visit's vitals (`GetVitals`). Maps to `VitalsViewModel`. |
| `ProviderLongSignature` | `GET /api/Clinical/ProviderLongSignature?providerId=` | Single employee lookup by id (for signature display). |
| `InputOutput` | `GET /api/Clinical/InputOutput?patientVisitId=&fromDate=&toDate=` | I/O entries between dates (default = today); also returns `lastBalance`. |
| `PrescriptionHistory` | `GET /api/Clinical/PrescriptionHistory?patientId=` | All `CLN_MST_PrescriptionSlip` master rows for a patient. |
| `PatientAllergies` | `GET /api/Clinical/PatientAllergies?patientId=` | Allergy list ordered by `CreatedOn DESC`. |
| `HomeMedication` | `GET /api/Clinical/HomeMedication?patientId=` | Home meds joined with `PHRM_MST_Item.ItemName` via in-memory lookups. |
| `MedicationPrescriptions` | `GET /api/Clinical/MedicationPrescriptions?patientId=` | Medication prescription rows with resolved `MedicationName` and `PerformerName`. |
| `ActivemedicalProblems` | `GET /api/Clinical/ActiveMedicalProblems?patientId=` | Active problems where `IsResolved = false`. |
| `PastMedicalProblems` | `GET /api/Clinical/PastMedicalProblems?patientId=` | All past medicals. |
| `SurgicalHistory` | `GET /api/Clinical/SurgicalHistory?patientId=` | Surgical history. |
| `FamilyHistories` | `GET /api/Clinical/FamilyHistories?patientId=` | Family history. |
| `SocialHistory` | `GET /api/Clinical/SocialHistory?patientId=` | Social history (smoking, alcohol, drugs, occupation, family support). |
| `ReferralSource` | `GET /api/Clinical/ReferralSource?patientId=` | How the patient found the hospital. |
| `PatientClinicalDetail` | `GET /api/Clinical/ClinicalDetail?patientVisitId=&patientId=` | Returns a `PatientClinicalDetailVM`: PastMedicals, SocialHistory, SurgicalHistory, FamilyHistory, Allergies, Vitals (most recent first). |
| `NoteTypes` | `GET /api/Clinical/NoteTypes` | Active `CLN_MST_NoteType` rows. |
| `NotesTemplates` | `GET /api/Clinical/NotesTemplates` | Active `CLN_Template` rows. |
| `FreeTextNoteTemplateDetail` | `GET /api/Clinical/FreeTextNoteTemplateDetail?NoteId=` | Free-text note with author, patient, primary/secondary doctor. |
| `ProcedureNoteTemplate` | `GET /api/Clinical/ProcedureNoteTemplate?NoteId=` | Procedure note. |
| `ProgressNoteTemplateDetail` | `GET /api/Clinical/ProgressNoteTemplateDetail?NoteId=` | Progress note (Subjective/Objective/AssessmentPlan/Instructions). |
| `HistoryAndPhysicalNoteDetail` | `GET /api/Clinical/HistoryAndPhysicalNoteDetail?NoteId=` | H&P note with full diagnosis + lab + imaging + prescription order projection. |
| `EmergencyNoteDetail` | `GET /api/Clinical/EmergencyNoteDetail?NoteId=` | Emergency note + disposition department name + diagnosis orders. |
| `PrescriptionNoteDetail` | `GET /api/Clinical/PrescriptionNoteDetail?NoteId=` | Prescription note joined to subjective note. |
| `PatientNotes` | `GET /api/Clinical/PatientNotes?patientId=` | If `patientId` provided → all notes for that patient. If `patientId = 0` → returns all **pending** notes (for the "doctor's inbox" workflow). |
| `OPDGeneralNote` | `GET /api/Clinical/OPDGeneralNote?NoteId=` | OPD general note full projection (subjective + objective + diagnosis orders). |
| `ScannedImages` | `GET /api/Clinical/ScannedImages?patientId=` | All active `CLN_PAT_Images` for the patient; reads file bytes from `CORE_CFG_Parameters.ClinicalDocumentUploadLocation + FileName`. |
| `EyeHistory` | `GET /api/Clinical/EyeHistory?patientId=` | All `CLN_MST_EYE` rows for the patient. |
| `EyeEMR` | `GET /api/Clinical/EyeEMR?masterId=` | Eye master + every per-eye sub-table (Refraction OD/OS, OperationNotes OD/OS, Ablation OD/OS, LaserData OD/OS, PrePachymetry OD/OS, LASIKRST OD/OS, SMILESetting OD/OS, Pachymetry OD/OS, VisuMax OD/OS, Wavefront OD/OS, ORA OD/OS, SMILE Incision OD/OS). |
| `PrescriptionDetails` | `GET /api/Clinical/PrescriptionDetails?masterId=` | Eye prescription slip master + 10 child tables (Acceptance, History, IOP, Plup, VaUnaided, Retinoscopy, Schrime, TBUT, Dilate, FinalClass, AdviceDiagnosis). |
| `PrescriptionNote` | `GET /api/Clinical/PrescriptionNote?noteId=&patientVisitId=` | Combined patient demographics + chief complaint + vitals + medications for the prescription view. |
| `Orders` | `GET /api/Clinical/Orders?NoteId=` | Per-diagnosis flat orders projection: ICD + lab orders + imaging orders + prescription orders (joined to item names). |
| `TemplateDetailsByNoteId` | `GET /api/Clinical/TemplateDetailsByNoteId?noteId=` | Switch by `TemplateName` ("Progress Note", "History & Physical", "Free Text", "Discharge Note", "Emergency Note", "Procedure Note", "Prescription Note", "Consult Note") and load the matching child table. Throws "Note template not found" if no row exists. |
| `getClinicalIntakeOutputParameter` | `GET /api/Clinical/getClinicalIntakeOutputParameter` | Active `CLN_MST_IntakeOutTakeParameter` rows. |

### 2.3 POST routes in `ClinicalController.cs`

All POST handlers read raw body via `this.ReadPostData()` (or files via `this.ReadFiles()`), pull `RbacUser` from session, then dispatch to a private `Add*` method. Multi-row inserts use `dbContextTransaction` for atomicity.

| Method | Route | Body / Behavior |
|--------|-------|-----------------|
| `Vitals` | `POST /api/Clinical/Vitals` | `VitalsModel` JSON. Validates that empty Height/Weight/Temperature also nulls the unit fields. Sets `CreatedBy/On` from session. |
| `InputOutput` | `POST /api/Clinical/InputOutput` | `InputOutputModel` JSON. |
| `ScannedEyeImages` | `POST /api/Clinical/ScannedEyeImages` | multipart: `reportDetails` form field + multiple files. Computes `FileNo = MAX(FileNo) + 1` per (patientId, fileType) and inserts an `EyeScanModel` (binary stored as `varbinary(max)` in DB). |
| `Allergy` | `POST /api/Clinical/Allergy` | `AllergyModel` JSON. |
| `HomeMedication` | `POST /api/Clinical/HomeMedication` | `HomeMedicationModel` JSON. |
| `MedicationPrescription` | `POST /api/Clinical/MedicationPrescription` | `List<MedicationPrescriptionModel>` JSON. Each row inserted individually inside a loop. |
| `ActiveMedicalProblem` | `POST /api/Clinical/ActiveMedicalProblem` | `ActiveMedicalProblem` JSON. If `ResolvedDate` is set (came from past-medical UI), nulls it; `OnSetDate = CreatedOn`. |
| `PastMedicalProblem` | `POST /api/Clinical/PastMedicalProblem` | `PastMedicalProblem` JSON. |
| `FamilyHistory` | `POST /api/Clinical/FamilyHistory` | `FamilyHistory` JSON (Relationship + ICD + Note). |
| `SurgicalHistory` | `POST /api/Clinical/SurgicalHistory` | `SurgicalHistory` JSON (SurgeryType + SurgeryDate + Note). |
| `SocialHistory` | `POST /api/Clinical/SocialHistory` | `SocialHistory` JSON. |
| `ReferralSource` | `POST /api/Clinical/ReferralSource` | `ReferralSource` JSON. |
| `OPDGeneralNote` | `POST /api/Clinical/OPDGeneralNote` | `NotesModel` JSON. Inserts `CLN_Notes`, `CLN_Notes_Subjective`, `CLN_Notes_Objective` (if present), then iterates `AllIcdAndOrders` to insert `CLN_Diagnosis` + `LAB_TestRequisition` + `RAD_PatientImagingRequisition` + `PHRM_PrescriptionItems` + `BIL_BillItemRequisition` (joined by `DiagnosisId`). All in one transaction. |
| `EyeMasterDetail` | `POST /api/Clinical/EyeMasterDetails` | `EyeModel` JSON. Inserts `CLN_MST_EYE` + 20+ child tables (refraction OD/OS, op notes OD/OS, ablation OD/OS, laser data OD/OS, pre-pachymetry OD/OS, LASIK RST OD/OS, SMILE settings OD/OS, visumax OD/OS, SMILE incision OD/OS, ORA OD/OS, wavefront OD/OS). |
| `ProcedureNoteTemplate` | `POST /api/Clinical/ProcedureNoteTemplate` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_Procedure`. |
| `ProgressNoteTemplate` | `POST /api/Clinical/ProgressNoteTemplateDetail` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_Progress` (with `Date = Now`). |
| `PostFreetextNoteTemplateDetail` | `POST /api/Clinical/FreeTextNoteTemplateDetail` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_FreeText`. |
| `HistoryAndPhysicalNote` | `POST /api/Clinical/HistoryAndPhysicalNoteDetail` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_Subjective` + `CLN_Notes_Objective` + diagnosis + orders (same shape as OPD general). |
| `EmergencyNote` | `POST /api/Clinical/EmergencyNote` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_Subjective` (optional) + `CLN_Notes_Objective` (optional) + `CLN_Notes_Emergency` + diagnosis + orders. |
| `DischargeNote` | `POST /api/Clinical/DischargeNote` | `NotesModel` JSON. Inserts `CLN_Notes` + `ADT_DischargeSummary` + a list of `ADT_DischargeSummaryMedication`. |
| `PrescriptionMasterSlip` | `POST /api/Clinical/PrescriptionMasterSlip` | `PrescriptionSlipModel` JSON. Inserts `CLN_MST_PrescriptionSlip` + 10 child tables in sequence inside a transaction. |
| `PrescriptionNote` | `POST /api/Clinical/PrescriptionNote` | `NotesModel` JSON. Inserts `CLN_Notes` + `CLN_Notes_PrescriptionNote` + `CLN_Notes_Subjective`. |
| `PostPatient` (file upload) | `POST /api/Clinical/PatientFiles` | multipart: `imgDetails` form field + files. Reads `CORE_CFG_Parameters.ClinicalDocumentUploadLocation` from `CFGParameters`, creates the directory if missing, and saves each file as `PatientId_FileName_Ticks.ext`. Inserts one `CLN_PAT_Images` row per file inside a transaction. |

### 2.4 MVC view routes in `ClinicalViewController.cs`

| Action | View | Purpose |
|--------|------|---------|
| `Clinical` | `Clinical.cshtml` | Main clinical shell. |
| `Vitals` | `Vitals.cshtml` | Vitals list/entry view. |
| `InputOutputList` | `InputOutputList.cshtml` | I/O list. |
| `AllergyList` | `AllergyList.cshtml` | Allergy list. |
| `HomeMedication` | `HomeMedicationList.cshtml` | Home medication list. |
| `MedicationPrescription` | `MedicationPrescription.cshtml` | Chronic meds prescription. |
| `ProblemsMain` | `ProblemsMain.cshtml` | Problems hub. |
| `ActiveMedical` | `MedicalProblemList.cshtml` | Active problems. |
| `PastMedical` | `PastMedical.cshtml` | Past problems. |
| `History` | `History.cshtml` | History hub. |
| `FamilyHistory` | `FamilyHistoryList.cshtml` | Family history. |
| `SurgicalHistoryList` | `SurgicalHistoryList.cshtml` | Surgical history. |
| `SocialHistoryList` | `SocialHistoryList.cshtml` | Social history. |
| `Notes` | `Notes.cshtml` | Notes hub. |
| `DoctorNotes` | `DoctorNotes.cshtml` | Doctor's notes (legacy). |
| `Diagnosis` | `Diagnosis.cshtml` | Standalone diagnosis view. |
| `ScannedImages` | `Scanned-Images.cshtml` | Scanned documents. |

`ClinicalViewController.GetView` first checks `HttpContext.Session["validRouteList"]` for RBAC, but the check is currently commented out — it returns `View(viewPath)` unconditionally pending migration to a global action filter.

### 2.5 Key private methods in `ClinicalController.cs`

| Method | Purpose |
|--------|---------|
| `GetVitals(patientVisitId)` | LINQ projection to `VitalsViewModel`; if visit has < 3 vitals, appends from last visit. |
| `GetHomeMedication(patientId)` | Joins `CLN_HomeMedications` to `PHRM_MST_Item` for `MedicationName`. |
| `GetMedicationPrescription(patientId)` | Same pattern — joins `PHRM_MST_Item` and `EMP_Employee`. |
| `GetPatientClinicalDetail(patientVisitId, patientId)` | Builds `PatientClinicalDetailVM`. |
| `GetOrders(NoteId)` | One big LINQ query: per diagnosis, joins `CLN_Diagnosis` to `MST_ICD10`, then to `LAB_TestRequisition` (excluding cancelled), `RAD_PatientImagingRequisition`, and `PHRM_PrescriptionItems`. |
| `GetPrescriptionDetails(masterId)` | Eye prescription slip master + 10 child tables. |
| `GetEyeEMR(masterId)` | Eye master + 20+ per-eye child tables. |
| `GetScannedImages(patientId)` | Reads `CORE_CFG_Parameters.ClinicalDocumentUploadLocation`, then for each image row, `File.ReadAllBytes(location + FileName)` and assigns to `FileBinaryData`. |
| `GetOPDGeneralNoteDetail(noteId)` | Loads diagnosis + lab + imaging + prescription orders, then joins `CLN_Notes` to `CLN_Notes_Subjective`/`Objective`, doctor, visit, note type. Returns a flattened `NotesModel`. |
| `GetPatientNotes(patientId)` | Branches: `patientId != 0` → notes for one patient (with doctor, note type, visit code); `patientId == 0` → all `IsPending = true` notes (doctor inbox). |
| `GetPrescriptionNoteDetailById(NoteId)` | Detailed view for prescription-note view page. |
| `GetEmergencyNoteDetail(NoteId)` | Same shape as H&P plus disposition-department name lookup. |
| `GetHistoryAndPhysicalNoteDetail(NoteId)` | H&P detail with diagnosis orders. |
| `GetProgressNoteTemplateDetail(NoteId)` | Progress note detail. |
| `GetFreeTextNoteTemplateDetail(NoteId)` | Free-text note detail. |
| `GetProcedureNoteTemplateDetail(NoteId)` | Procedure note detail. |
| `GetTemplateDetailByNoteId(noteId)` | Switch by `Notes.TemplateName` and load the correct child table. |
| `AddPatientVitals`, `AddInputOutput`, `AddAllergy`, `AddHomeMedication`, `AddMedicationPrescription`, `AddActiveMedicalProblem`, `AddPastMedicalProblem`, `AddFamilyHistory`, `AddSurgicalHistory`, `AddSocialHistory`, `AddReferralSource` | Single-table inserts with `CreatedBy/On` from session. |
| `AddOPDGeneralNote` | Multi-table insert: Notes + Subjective + Objective + (per diagnosis) CLN_Diagnosis + LAB_TestRequisition + RAD_PatientImagingRequisition + PHRM_PrescriptionItems + BIL_BillItemRequisition. Joins to `BIL_MST_ServiceItem`, `BIL_MST_ServiceDepartment`, `BIL_MAP_PriceCategoryServiceItem` to resolve prices (hardcoded `PriceCategoryId == 1` for "Normal" — Krishna 13Mar'23). All inside a single `dbContextTransaction`. |
| `AddEmergencyNote` | Same shape as OPD general, plus `CLN_Notes_Emergency`. |
| `AddHistoryAndPhysicalNote` | Same shape, with H&P-specific subjective + objective. |
| `AddProgressNoteTemplate`, `AddProcedureNoteTemplate`, `AddFreetextNoteTemplate` | One-parent + one-child inserts in a transaction. |
| `AddPrescriptionNote` | Notes + Prescription Note + Subjective. |
| `PostDischargeNote` | Notes + `ADT_DischargeSummary` + child `ADT_DischargeSummaryMedication` rows. |
| `PostPrescriptionMasterSlip` | Eye prescription master + 10 child tables, each in its own `SaveChanges` call inside one transaction. |
| `AddEyeMasterDetail` | Eye master + 20+ per-eye child tables. |
| `UploadScannedImage` | Multipart save to `ClinicalDocumentUploadLocation` + `CLN_PAT_Images` row. |
| `SaveScannedEyeImages` | Multipart save to `EyeScan` (binary in DB) with `FileNo = MAX+1` per (patient, fileType). |

---

## 3. Data Models

All models live in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/ClinicalModels/` (plus sub-folders for Eye, PrescriptionSlip, BloodSugar, Diet, ConsultationRequests, DTOs).

### 3.1 Core clinical model

| Model | Primary Key | Notable Fields | Source Table |
|-------|-------------|-----------------|--------------|
| `ClinicalModel` | (composite VM) | Vitals, Allergy, HomeMedication, ActiveMedicals | n/a (VM) |
| `PatientClinicalDetailVM` | n/a | PatientId, PatientVisitId, NotesId, PastMedicals[], SurgicalHistory[], SocialHistory[], FamilyHistory[], Allergies[], Vitals[] | n/a (VM) |
| `VitalsViewModel` | n/a | VitalsTakenOn, Height/HeightUnit, Weight/WeightUnit, BMI, Temperature/TemperatureUnit, Pulse, BPSystolic, BPDiastolic, RespiratoryRatePerMin, SpO2, OxygenDeliveryMethod, PainScale, BodyPart, Advice, FreeNotes, DiagnosisType, Diagnosis | n/a (projection) |

### 3.2 Patient-level registries (no per-visit scope)

| Model | PK | Fields | Source |
|-------|----|--------|--------|
| `AllergyModel` | `PatientAllergyId` | PatientId, AllergenAdvRecId, AllergenAdvRecName, AllergyType, Severity, Verified, Reaction, Comments, audit fields, Patient nav | `CLN_Allergies` |
| `HomeMedicationModel` | `HomeMedicationId` | PatientId, MedicationId, MedicationName (NotMapped), Dose, Route, Frequency, LastTaken, Comments, MedicationType | `CLN_HomeMedications` |
| `MedicationPrescriptionModel` | `MedicationPrescriptionId` | PatientId, MedicationId, MedicationName (NM), PerformerId, PerformerName (NM), Route, Duration, DurationType, Dose, Frequency, Refill, TypeofMedication, IsSelected (NM) | `CLN_MedicationPrescription` |
| `ActiveMedicalProblem` | `PatientProblemId` | (extends `ProblemList`) PatientId, ICD10Code, ICD10Description, CurrentStatus, Note, OnSetDate, ResolvedDate, IsResolved, PrincipleProblem | `CLN_ActiveMedicals` |
| `PastMedicalProblem` | `PatientProblemId` | (extends `ProblemList`) PatientId, ICD10Code, ICD10Description, CurrentStatus, Note, OnSetDate, ResolvedDate, PrincipleProblem | `CLN_PastMedicals` |
| `FamilyHistory` | `FamilyProblemId` | (extends `ProblemList`) PatientId, ICD10Code, ICD10Description, Relationship, Note | `CLN_FamilyHistory` |
| `SurgicalHistory` | `SurgicalHistoryId` | (extends `ProblemList`) PatientId, ICD10Code, ICD10Description, SurgeryType, Note, SurgeryDate | `CLN_SurgicalHistory` |
| `SocialHistory` | `SocialHistoryId` | PatientId, SmokingHistory, AlcoholHistory, DrugHistory, Occupation, FamilySupport, Note | `CLN_SocialHistory` |
| `ReferralSource` | `ReferralSourceId` | PatientId, Newspaper, Unknown, Doctor, Radio, WebPage, FriendAndFamily, Staff, TV, Others, Magazine, Note | `CLN_ReferralSource` |
| `ProblemList` (base) | n/a | PatientId, ICD10Code, ICD10Description, audit fields | n/a (base) |
| `MedicationFrequency` | `FrequencyId` | Type | (master, lookup) |
| `PatientClinicalInfoModel` | `InfoId` | PatientId, PatientVisitId, KeyName, Value, audit fields, IsActive | `CLN_KV_PatientClinical_Info` |
| `PatientImagesModel` | `PatImageId` | PatientId, PatientVisitId, DepartmentId, ROWGUID, FileType, Comment, FileName, Title, FileExtention, UploadedOn, UploadedBy, IsActive, FileBinaryData (NM) | `CLN_PAT_Images` |

### 3.3 Per-visit clinical data

| Model | PK | Fields | Source |
|-------|----|--------|--------|
| `VitalsModel` | `PatientVitalId` | PatientVisitId, Height/HeightUnit, Weight/WeightUnit, BMI, Temperature/TemperatureUnit, Pulse, BPSystolic, BPDiastolic, RespiratoryRatePerMin, SpO2, OxygenDeliveryMethod, PainScale, BodyPart, Visit (nav), Advice, FreeNotes, DiagnosisType, Diagnosis, audit fields, VitalsTakenOn | `CLN_PatientVitals` |
| `InputOutputModel` | `InputOutputId` | PatientVisitId, InputOutputParameterMainId, InputOutputParameterChildId, IntakeOutputValue, Unit, IntakeOutputType, Contents, Remarks, Visit nav | `CLN_InputOutput` |
| `ClinicalIntakeOutputParameterModel` | `IntakeOutputId` | ParameterType, ParameterValue, ParameterMainId, IsActive, audit | `CLN_MST_IntakeOutTakeParameter` |
| `NotesModel` | `NotesId` | PatientVisitId, PatientId, PerformerId, TemplateId, SecondaryDoctorId, NoteTypeId, TemplateName, FollowUp, FollowUpUnit, Remarks, IsPending, audit; [NotMapped] child navigation: FreeTextNote, ProcedureNote, ProgressNote, EmergencyNote, DischargeSummaryNote, SubjectiveNote, ObjectiveNote, ClinicalPrescriptionNote, AllIcdAndOrders, RemovedIcdAndOrders | `CLN_Notes` |
| `SubjectiveNoteModel` | `SubjectiveNoteId` | NotesId, PatientId, PatientVisitId, ChiefComplaint, HistoryOfPresentingIllness, ReviewOfSystems, audit, IsActive | `CLN_Notes_Subjective` |
| `ObjectiveNoteModel` | `ObjectiveNotesId` | NotesId, PatientId, PatientVisitId, HEENT, Chest, CVS, Abdomen, Extremity, Skin, Neurological, audit, IsActive | `CLN_Notes_Objective` |
| `ProgressNoteModel` | `ProgressNoteId` | NotesId, PatientId, PatientVisitId, SubjectiveNotes, ObjectiveNotes, AssessmentPlan, Instructions, Date, audit, IsActive | `CLN_Notes_Progress` |
| `FreeTextNoteModel` | `FreeTextId` | NotesId, PatientId, PatientVisitId, FreeText, audit, IsActive | `CLN_Notes_FreeText` |
| `ProcedureNoteModel` | `ProcedureNoteId` | NotesId, PatientId, PatientVisitId, Date, LinesProse, Site, Remarks, FreeText, audit, IsActive | `CLN_Notes_Procedure` |
| `EmergencyNoteModel` | `EmergencyNoteId` | NotesId, PatientId, PatientVisitId, BroughtIn, BroughtBy, Relationship, PhoneNumber, ModeOfArrival, ReferralDoctorOrHospital, TriageTime, TriagedBy, Trauma, Disposition, DispositionDepartmentId, ErCourseDescription, audit, IsActive | `CLN_Notes_Emergency` |
| `PrescriptionNotesModel` | `PrescriptionNoteId` | NotesId, PatientId, PatientVisitId, PrescriptionNoteText, OldMedicationStopped, NewMedicationStarted, ICDRemarks, ICDSelected, OrdersSelected, audit, IsActive | `CLN_Notes_PrescriptionNote` |
| `NoteTypeModel` | `NoteTypeId` | NoteType, CreatedBy, CreatedOn, IsActive | `CLN_MST_NoteType` |
| `TemplateNoteModel` | `TemplateId` | TemplateName, CreatedBy, CreatedOn, IsActive | `CLN_Template` |
| `ClinicalDiagnosisModel` | `DiagnosisId` | NotesId, PatientId, PatientVisitId, ICD10ID, ICD10Description, ICD10Code, audit, IsActive; [NotMapped] AllIcdLabOrders, AllIcdImagingOrders, AllIcdPrescriptionOrders | `CLN_Diagnosis` |

### 3.4 Eye EMR sub-module

`ClinicalEye/EyeModel` (`CLN_MST_EYE`) — Id, PatientId, VisitId, VisitDate, PerformerId, CreatedBy/On, ModifiedBy/On, plus [NotMapped] per-eye child tables:

- `Refration` (note: typo in Danphe) → `CLN_EYE_Refraction` — MasterId, IsOD, Refraction fields.
- `AblationProfile` → `CLN_EYE_Ablation_Profile` — MasterId, IsOD.
- `LaserData` → `CLN_EYE_Laser_DataEntry` — MasterId, IsOD.
- `PreOpPachymetry` → `CLN_EYE_PreOP_Pachymetry` — MasterId, IsOD.
- `LasikRST` → `CLN_EYE_LasikRST` — MasterId, IsOD.
- `SmileSetting` → `CLN_EYE_Smile_Setting` — MasterId, IsOD.
- `Pachymetry` → `CLN_EYE_Pachymetry` — MasterId, IsOD.
- `Wavefront` → `CLN_EYE_Wavefront` — MasterId, IsOD.
- `ORA` → `CLN_EYE_ORA` — MasterId, IsOD.
- `SmileIncision` → `CLN_EYE_Smile_Incisions` — MasterId, IsOD.
- `VisuMax` → `CLN_EYE_VisuMax` — MasterId, IsOD.
- `OperationNotes` → `CLN_EYE_OperationNotes` — MasterId, IsOD.
- `EyeScanModel` → `CLN_EyeScanImages` — PatImageId, PatientId, FileType, Description, FileName, FileNo, ROWGUID, Title, FileExtention, UploadedBy, UploadedOn, FileBinaryData.

### 3.5 Eye prescription slip sub-module

`PrescriptionSlipModel` (`CLN_MST_PrescriptionSlip`) — Id, VisitId, PerformerId, PatientId, VisitDate, audit; [NotMapped] child tables:

- `Acceptance` → `CLN_PrescriptionSlip_Acceptance`
- `History` → `CLN_PrescriptionSlip_History`
- `Dilate` → `CLN_PrescriptionSlip_Dilate`
- `IOP` → `CLN_PrescriptionSlip_IOP`
- `Plup` → `CLN_PrescriptionSlip_Plup`
- `Retinoscopy` → `CLN_PrescriptionSlip_Retinoscopy`
- `Schrime` → `CLN_PrescriptionSlip_Schrime`
- `TBUT` → `CLN_PrescriptionSlip_TBUT`
- `VaUnaided` → `CLN_PrescriptionSlip_VaUnaided`
- `FinalClass` → `CLN_PrescriptionSlip_FinalClass`
- `AdviceDiagnosis` → `CLN_PrescriptionSlip_AdviceDiagnosis`

### 3.6 Consultation requests

`ConsultationRequestModel` (`CLN_ConsultationRequest`) — ConsultationRequestId, PatientId, PatientVisitId, WardId, BedId, RequestedOn, RequestingConsultantId, RequestingDepartmentId, PurposeOfConsultation, ConsultingDoctorId, ConsultingDepartmentId, ConsultantResponse, ConsultedOn, Status, audit, IsActive.

DTOs: `ConsultationRequestDTO` and `ConsultationRequestForGetDTO` (in `DTOs/`) — flat shape for API consumption.

### 3.7 Blood sugar monitoring

`BloodSugarModel` (`CLN_BloodSugarMonitoring`) — Id, PatientId, PatientVisitId, ReadingType (Fasting/Postprandial/Random/HbA1c), ReadingValue, ReadingUnit, ReadingDate, RecordedBy, Remarks, audit.

### 3.8 Diet

`DietTypeModel` (`CLN_MST_DietType`) — DietTypeId, DietType, Description, audit.
`PatientDietModel` (`CLN_TXN_PatientDiet`) — PatientDietId, PatientId, PatientVisitId, DietTypeId, StartDate, EndDate, Remarks, audit.
`PatientDietDTO` — flat shape for the diet screen.

---

## 4. Database Tables

All clinical tables share the `CLN_` prefix except the cross-module ones already documented in Patient (`PAT_`), Lab (`LAB_`), Radiology (`RAD_`), Pharmacy (`PHRM_`), Billing (`BIL_`), ADT (`ADT_`), Master (`MST_`), and Employee (`EMP_`) modules. List assembled from `DanpheEMR reference/Database/CleanUpScript.sql` and `ClinicalDbContext.OnModelCreating`.

| Table | Owner | Purpose |
|-------|-------|---------|
| `CLN_Notes` | Clinical | Master row for every note (H&P, Progress, Free Text, Emergency, Procedure, Prescription, Consult, Discharge). Carries PatientVisitId, PerformerId, TemplateName, FollowUp, IsPending, etc. |
| `CLN_Notes_Subjective` | Clinical | SOAP-S: ChiefComplaint, HistoryOfPresentingIllness, ReviewOfSystems. |
| `CLN_Notes_Objective` | Clinical | SOAP-O: HEENT, Chest, CVS, Abdomen, Extremity, Skin, Neurological. |
| `CLN_Notes_Progress` | Clinical | Progress note body — Subjective, Objective, AssessmentPlan, Instructions. |
| `CLN_Notes_FreeText` | Clinical | Free-form clinical text. |
| `CLN_Notes_Procedure` | Clinical | Procedure note — Date, LinesProse, Site, Remarks, FreeText. |
| `CLN_Notes_Emergency` | Clinical | ER note — BroughtIn, ModeOfArrival, TriageTime, Trauma, Disposition, DispositionDepartmentId. |
| `CLN_Notes_PrescriptionNote` | Clinical | Prescription note body — PrescriptionNoteText, OldMedicationStopped, NewMedicationStarted, ICDRemarks, ICDSelected, OrdersSelected. |
| `CLN_Diagnosis` | Clinical | ICD-tagged diagnoses per note. Each row can carry lab/imaging/prescription orders by `DiagnosisId`. |
| `CLN_PatientVitals` | Clinical | Per-visit vitals. |
| `CLN_InputOutput` | Clinical | Per-visit fluid I/O records. |
| `CLN_MST_IntakeOutTakeParameter` | Clinical | Lookup: configured fluid/substance parameters. |
| `CLN_Allergies` | Clinical | Patient allergy registry. |
| `CLN_HomeMedications` | Clinical | Home meds the patient is on. |
| `CLN_MedicationPrescription` | Clinical | Long-form medication prescription by doctor. |
| `CLN_ActiveMedicals` | Clinical | Active problem list. `IsResolved` flag controls visibility. |
| `CLN_PastMedicals` | Clinical | Past problem list. |
| `CLN_FamilyHistory` | Clinical | Family medical history. |
| `CLN_SurgicalHistory` | Clinical | Surgical history. |
| `CLN_SocialHistory` | Clinical | Smoking / alcohol / drugs / occupation / family support. |
| `CLN_ReferralSource` | Clinical | How the patient found the hospital. |
| `CLN_PAT_Images` | Clinical | Scanned clinical documents — file path, GUID, uploader, IsActive. |
| `CLN_EyeScanImages` | Clinical | Eye-specific scanned images, includes binary data and FileNo. |
| `CLN_MST_EYE` | Clinical | Eye EMR master row. |
| `CLN_EYE_Refraction` | Clinical | Per-eye refraction entries. |
| `CLN_EYE_Ablation_Profile` | Clinical | LASIK ablation profile (OD/OS). |
| `CLN_EYE_Laser_DataEntry` | Clinical | Laser data per eye. |
| `CLN_EYE_PreOP_Pachymetry` | Clinical | Pre-op pachymetry (corneal thickness). |
| `CLN_EYE_LasikRST` | Clinical | LASIK RST settings. |
| `CLN_EYE_Smile_Setting` | Clinical | SMILE settings. |
| `CLN_EYE_Pachymetry` | Clinical | Pachymetry readings. |
| `CLN_EYE_Wavefront` | Clinical | Wavefront analysis. |
| `CLN_EYE_ORA` | Clinical | ORA (ocular response analyzer) readings. |
| `CLN_EYE_Smile_Incisions` | Clinical | SMILE incision parameters. |
| `CLN_EYE_VisuMax` | Clinical | VisuMax laser settings. |
| `CLN_EYE_OperationNotes` | Clinical | Operation notes per eye. |
| `CLN_MST_PrescriptionSlip` | Clinical | Eye prescription slip master. |
| `CLN_PrescriptionSlip_Acceptance` | Clinical | Acceptance test results. |
| `CLN_PrescriptionSlip_History` | Clinical | Eye prescription history. |
| `CLN_PrescriptionSlip_Dilate` | Clinical | Dilation data. |
| `CLN_PrescriptionSlip_IOP` | Clinical | Intra-ocular pressure. |
| `CLN_PrescriptionSlip_Plup` | Clinical | PLUP test data. |
| `CLN_PrescriptionSlip_Retinoscopy` | Clinical | Retinoscopy results. |
| `CLN_PrescriptionSlip_Schrime` | Clinical | Schrimer test (tear production). |
| `CLN_PrescriptionSlip_TBUT` | Clinical | Tear break-up time. |
| `CLN_PrescriptionSlip_VaUnaided` | Clinical | Unaided visual acuity. |
| `CLN_PrescriptionSlip_FinalClass` | Clinical | Final classification. |
| `CLN_PrescriptionSlip_AdviceDiagnosis` | Clinical | Advice / diagnosis text. |
| `CLN_ConsultationRequest` | Clinical | Cross-department consultation requests. |
| `CLN_KV_PatientClinical_Info` | Clinical | Flexible key-value clinical info per patient. |
| `CLN_MST_NoteType` | Clinical | Note type master (e.g., "Progress", "History & Physical"). |
| `CLN_Template` | Clinical | Note template master. |
| `CLN_BloodSugarMonitoring` | Clinical | Blood sugar readings. |
| `CLN_MST_DietType` | Clinical | Diet type master. |
| `CLN_TXN_PatientDiet` | Clinical | Per-patient diet orders. |
| `CLN_PatientVisit_Notes` | Clinical | Legacy join table (seen in cleanup script). |
| `CLN_PatientVisitProcedure` | Clinical | Legacy procedure-per-visit table. |
| `CLN_MST_PrescriptionSlip` | Clinical | (already listed above) |

The `ClinicalDbContext.OnModelCreating` (lines 118-216) maps each model class to its physical table via `modelBuilder.Entity<T>().ToTable(...)`. Foreign-key relationships are declared for `Visit.Vitals`, `Visit.InputOutput`, `Patient.Allergies`, `Patient.MedicationPrescriptions`, `Patient.HomeMedication`, `Patient.Problems`, `Patient.PastMedicals`, `Patient.FamilyHistory`, `Patient.SurgicalHistory`, `Patient.SocialHistory`.

The SQL schema itself is in `DanpheEMR reference/Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip` (a binary `.bak` file, not unpacked in this repo). The authoritative column inventory for parity work is the `ClinicalDbContext.OnModelCreating` mapping plus the `CleanUpScript.sql` table list.

---

## 5. Key Workflows

### 5.1 Vitals capture (per visit)

1. Front-end calls `GET /api/Clinical/LatestVitals?patientVisitId=N`.
2. Controller returns all `VitalsModel` rows for the visit, sorted by `CreatedOn` desc.
3. If fewer than 3 vitals exist for the visit, it falls back to the **most recent previous visit** for the same patient so the UI always has at least 3 readings to show a trend.
4. Front-end posts a new vital via `POST /api/Clinical/Vitals` with the full `VitalsModel` JSON.
5. Controller nulls the unit fields if the corresponding numeric field is null, then inserts with `CreatedBy`/`CreatedOn` from session.

Key business rules:
- One row per "vital capture event" — historical values are never updated, only new rows are appended.
- `VitalsTakenOn` is the time the vitals were actually measured; `CreatedOn` is the time they were entered into the system. They are usually the same but can differ.

### 5.2 Allergy entry

1. Front-end loads the current allergy list via `GET /api/Clinical/PatientAllergies?patientId=N`.
2. New allergy posted via `POST /api/Clinical/Allergy` with `AllergyModel` JSON.
3. Single-table insert; no transaction wrapper (allergy is independent).

Key business rules:
- `AllergenAdvRecId` references `PHRM_MST_Item` (a drug) or a free-text "Other".
- `AllergyType` is a free-text category (Drug / Food / Environmental / Other).
- `Severity` is a free-text severity (Mild / Moderate / Severe).
- `Verified` flag indicates the allergy has been clinically verified.

### 5.3 Problem list (Active / Past / Family / Surgical)

These all share the same ICD-10-tagged shape inherited from `ProblemList`.

1. Front-end loads problems via the per-list endpoints (`ActiveMedicalProblems`, `PastMedicalProblems`, `FamilyHistories`, `SurgicalHistory`).
2. New entries posted via the per-list POST endpoints.
3. `ActiveMedicalProblem` is special: if `ResolvedDate` is set on the incoming payload (the UI may pre-fill it when promoting from past-medical), it is nulled out. `OnSetDate` is auto-set to `CreatedOn`.

Key business rules:
- `IsResolved = false` is the default visibility filter for active problems.
- All problem types carry `ICD10Code` + `ICD10Description` for reporting.
- Family history additionally carries `Relationship` (Mother / Father / Sibling / etc.).
- Surgical history carries `SurgeryType` and `SurgeryDate`.

### 5.4 Home medication & chronic prescriptions

1. Front-end loads `HomeMedication` and `MedicationPrescription` separately.
2. `HomeMedication` is a single-row insert; `MedicationPrescription` accepts a `List<MedicationPrescriptionModel>`.
3. The controller resolves `MedicationName` (from `PHRM_MST_Item.ItemName`) and `PerformerName` (from `EMP_Employee.FullName`) on GET, server-side.

### 5.5 Clinical note entry (the big workflow)

The single most important workflow: **a doctor writes a note → diagnoses + lab + imaging + medication orders + bill items are created in one transaction.**

Sub-flows by template:

#### 5.5.1 OPD General Note
1. Front-end calls `GET /api/Clinical/OPDGeneralNote?NoteId=N` to load an existing note (or to compose a new one with empty children).
2. Front-end calls `GET /api/Clinical/NotesTemplates` and `GET /api/Clinical/NoteTypes` to populate the template dropdown.
3. User fills in subjective (`ChiefComplaint`, `HistoryOfPresentingIllness`, `ReviewOfSystems`), objective (HEENT, Chest, CVS, Abdomen, etc.), and one or more diagnoses.
4. For each diagnosis, the user attaches lab orders (`AllIcdLabOrders`), imaging orders (`AllIcdImagingOrders`), and prescription orders (`AllIcdPrescriptionOrders`).
5. Front-end POSTs the whole `NotesModel` to `POST /api/Clinical/OPDGeneralNote`.
6. Backend transaction:
   - Insert `CLN_Notes` → get `NotesId`.
   - Insert `CLN_Notes_Subjective` if present.
   - Insert `CLN_Notes_Objective` if present.
   - For each `ClinicalDiagnosisModel` in `AllIcdAndOrders`:
     - Insert `CLN_Diagnosis` → get `DiagnosisId`.
     - For each `LabRequisitionModel` in `AllIcdLabOrders`: set `DiagnosisId`, insert `LAB_TestRequisition`.
     - For each `ImagingRequisitionModel` in `AllIcdImagingOrders`: set `DiagnosisId`, insert `RAD_PatientImagingRequisition`.
     - For each `PHRMPrescriptionItemModel` in `AllIcdPrescriptionOrders`: set `DiagnosisId`, insert `PHRM_PrescriptionItems`.
   - For each lab/imaging requisition, look up the price from `BIL_MST_ServiceItem` + `BIL_MST_ServiceDepartment` + `BIL_MAP_PriceCategoryServiceItem` (hardcoded `PriceCategoryId == 1`, "Normal") and insert a `BIL_BillItemRequisition` row.
7. All in a single `dbContextTransaction`. On any exception, full rollback.

The same shape applies to:
- **History & Physical** → `POST /api/Clinical/HistoryAndPhysicalNoteDetail`
- **Emergency** → `POST /api/Clinical/EmergencyNote` (also inserts `CLN_Notes_Emergency` with disposition fields)
- **Progress** → `POST /api/Clinical/ProgressNoteTemplateDetail` (only Notes + Progress Note, no orders)
- **Free Text** → `POST /api/Clinical/FreeTextNoteTemplateDetail`
- **Procedure Note** → `POST /api/Clinical/ProcedureNoteTemplate`
- **Prescription Note** → `POST /api/Clinical/PrescriptionNote` (Notes + Prescription Note + Subjective)
- **Consult Note** → no dedicated POST; reuses Get template by name
- **Discharge Note** → `POST /api/Clinical/DischargeNote` (Notes + `ADT_DischargeSummary` + `ADT_DischargeSummaryMedication`)

#### 5.5.2 Template dispatch (view)
`GET /api/Clinical/TemplateDetailsByNoteId?noteId=N` switches by `Notes.TemplateName` to load the correct child table. This is the canonical "open existing note" call.

#### 5.5.3 Doctor inbox (pending notes)
`GET /api/Clinical/PatientNotes?patientId=0` returns all notes where `IsPending = true`, used by the doctor's inbox to find notes that have not been finalized.

### 5.6 Eye EMR (ophthalmology sub-module)

1. Front-end calls `GET /api/Clinical/EyeHistory?patientId=N` to list all past EMR masters.
2. For a specific master, `GET /api/Clinical/EyeEMR?masterId=N` returns the master + every per-eye sub-table (20+ tables).
3. New EMR posted via `POST /api/Clinical/EyeMasterDetails` with `EyeModel` JSON. The controller inserts the master, then iterates each child collection (Refraction OD, Refraction OS, OperationNotes OD, OperationNotes OS, Ablation OD, Ablation OS, LaserData OD, LaserData OS, PrePachymetry OD, PrePachymetry OS, LASIKRST OD, LASIKRST OS, SMILE Setting OD, SMILE Setting OS, VisuMax OD, VisuMax OS, SMILE Incision OD, SMILE Incision OS, ORA OD, ORA OS, Wavefront OD, Wavefront OS, Pachymetry OD, Pachymetry OS) inside one transaction.
4. Eye prescription slip is a parallel workflow: `GET /api/Clinical/PrescriptionDetails?masterId=N` for the slip + 10 child tables; `POST /api/Clinical/PrescriptionMasterSlip` to save.
5. Eye scanned images: `POST /api/Clinical/ScannedEyeImages` (multipart). `FileNo` is computed as `MAX(FileNo) + 1` per `(patientId, fileType)`. File binary is stored directly in the database (`varbinary`).

### 5.7 Scanned clinical documents

1. Front-end calls `GET /api/Clinical/ScannedImages?patientId=N` to list active uploads; the controller reads file bytes from `CORE_CFG_Parameters.ClinicalDocumentUploadLocation + FileName` and returns the image as a base64-ish byte array on each `PatientImagesModel.FileBinaryData`.
2. New upload via `POST /api/Clinical/PatientFiles` (multipart). The file is named `PatientId_FileName_Ticks.ext`, written to disk, and a `CLN_PAT_Images` row is inserted with the relative file path in `FileName`.

### 5.8 Consultation requests

(`CLN_ConsultationRequest` — table only; no controller surface in `ClinicalController.cs`; UI in clinical-notes/treatments-and-consultation.) Workflow: requesting consultant creates a row with `RequestingConsultantId`, `RequestingDepartmentId`, `ConsultingDoctorId`, `ConsultingDepartmentId`, `PurposeOfConsultation`, `Status = 'pending'`. Consulting doctor adds `ConsultantResponse`, `ConsultedOn`, sets `Status = 'completed'`. Ward/Bed are optional and used when consulting an admitted patient.

---

## 6. API Endpoints (consolidated)

All routes are namespaced under `/api/Clinical/` (no `[Route("api/[controller]")]` prefix in the controller; routes are specified per-action).

### 6.1 GET (30+)

```
GET /api/Clinical/LatestVitals?patientVisitId=
GET /api/Clinical/ProviderLongSignature?providerId=
GET /api/Clinical/InputOutput?patientVisitId=&fromDate=&toDate=
GET /api/Clinical/PrescriptionHistory?patientId=
GET /api/Clinical/PatientAllergies?patientId=
GET /api/Clinical/HomeMedication?patientId=
GET /api/Clinical/MedicationPrescriptions?patientId=
GET /api/Clinical/ActiveMedicalProblems?patientId=
GET /api/Clinical/PastMedicalProblems?patientId=
GET /api/Clinical/SurgicalHistory?patientId=
GET /api/Clinical/FamilyHistories?patientId=
GET /api/Clinical/SocialHistory?patientId=
GET /api/Clinical/ReferralSource?patientId=
GET /api/Clinical/ClinicalDetail?patientVisitId=&patientId=
GET /api/Clinical/NoteTypes
GET /api/Clinical/NotesTemplates
GET /api/Clinical/FreeTextNoteTemplateDetail?NoteId=
GET /api/Clinical/ProcedureNoteTemplate?NoteId=
GET /api/Clinical/ProgressNoteTemplateDetail?NoteId=
GET /api/Clinical/HistoryAndPhysicalNoteDetail?NoteId=
GET /api/Clinical/EmergencyNoteDetail?NoteId=
GET /api/Clinical/PrescriptionNoteDetail?NoteId=
GET /api/Clinical/PatientNotes?patientId=
GET /api/Clinical/OPDGeneralNote?NoteId=
GET /api/Clinical/ScannedImages?patientId=
GET /api/Clinical/EyeHistory?patientId=
GET /api/Clinical/EyeEMR?masterId=
GET /api/Clinical/PrescriptionDetails?masterId=
GET /api/Clinical/PrescriptionNote?noteId=&patientVisitId=
GET /api/Clinical/Orders?NoteId=
GET /api/Clinical/TemplateDetailsByNoteId?noteId=
GET /api/Clinical/getClinicalIntakeOutputParameter
```

### 6.2 POST (20+)

```
POST /api/Clinical/Vitals                       (VitalsModel JSON)
POST /api/Clinical/InputOutput                  (InputOutputModel JSON)
POST /api/Clinical/ScannedEyeImages             (multipart: reportDetails + files)
POST /api/Clinical/Allergy                      (AllergyModel JSON)
POST /api/Clinical/HomeMedication               (HomeMedicationModel JSON)
POST /api/Clinical/MedicationPrescription       (List<MedicationPrescriptionModel> JSON)
POST /api/Clinical/ActiveMedicalProblem         (ActiveMedicalProblem JSON)
POST /api/Clinical/PastMedicalProblem           (PastMedicalProblem JSON)
POST /api/Clinical/FamilyHistory                (FamilyHistory JSON)
POST /api/Clinical/SurgicalHistory              (SurgicalHistory JSON)
POST /api/Clinical/SocialHistory                (SocialHistory JSON)
POST /api/Clinical/ReferralSource               (ReferralSource JSON)
POST /api/Clinical/OPDGeneralNote               (NotesModel JSON with AllIcdAndOrders)
POST /api/Clinical/EyeMasterDetails             (EyeModel JSON)
POST /api/Clinical/ProcedureNoteTemplate        (NotesModel JSON)
POST /api/Clinical/ProgressNoteTemplateDetail   (NotesModel JSON)
POST /api/Clinical/FreeTextNoteTemplateDetail   (NotesModel JSON)
POST /api/Clinical/HistoryAndPhysicalNoteDetail (NotesModel JSON with AllIcdAndOrders)
POST /api/Clinical/EmergencyNote                (NotesModel JSON with AllIcdAndOrders + EmergencyNote)
POST /api/Clinical/DischargeNote                (NotesModel JSON with DischargeSummaryNote + DischargeSummaryMedications)
POST /api/Clinical/PrescriptionMasterSlip       (PrescriptionSlipModel JSON)
POST /api/Clinical/PrescriptionNote             (NotesModel JSON)
POST /api/Clinical/PatientFiles                 (multipart: imgDetails + files)
```

There are no PUT or DELETE endpoints in the reference `ClinicalController`; updates and deletes are not supported in the reference backend (clinical records are append-only by design — auditable, immutable).

---

## 7. Cross-Module Interactions

The Clinical module is one of the **highest-fan-out** modules in DanpheEMR. It owns no master data but consumes and creates data across nearly every other module.

| Module | Tables read | Tables written | Workflow |
|--------|-------------|----------------|----------|
| **Patient** | `PAT_Patient`, `PAT_PatientVisits` | — | Every clinical entity carries `PatientId` + `PatientVisitId`. |
| **Visit** | `PAT_PatientVisits.VisitCode`, `VisitDate`, `VisitTime`, `PerformerName`, `VisitType` | — | Clinical note page header shows visit info. |
| **Employee (Doctor)** | `EMP_Employee.FullName`, `LongSignature` | — | Primary/secondary doctor display, signature in reports. |
| **Master / ICD-10** | `MST_ICD10` | — | All diagnosis lists and problem lists pull ICD-10 codes from here. |
| **Lab** | `LAB_TestRequisition` (existing) | `LAB_TestRequisition` (new) | Per-diagnosis lab orders generated when posting OPD/H&P/Emergency notes. |
| **Radiology** | `RAD_PatientImagingRequisition` (existing) | `RAD_PatientImagingRequisition` (new) | Per-diagnosis imaging orders. |
| **Pharmacy** | `PHRM_MST_Item.ItemName`, `PHRM_PrescriptionItems` (existing) | `PHRM_PrescriptionItems` (new) | Medication prescriptions are written per-diagnosis; also reads item names to resolve `MedicationName` for home/chronic meds. |
| **Billing** | `BIL_MST_ServiceItem`, `BIL_MST_ServiceDepartment`, `BIL_MAP_PriceCategoryServiceItem` | `BIL_BillItemRequisition` | Lab and imaging orders auto-create `BIL_BillItemRequisition` rows so the bill is generated as soon as the doctor signs the note. Price category is hardcoded to `1` (Normal) — see code comment "Krishna 13thMarch'23". |
| **ADT (Admission)** | — | `ADT_DischargeSummary`, `ADT_DischargeSummaryMedication` | Discharge note is posted from the Clinical module and writes to the ADT tables. |
| **Core (Config)** | `CORE_CFG_Parameters` (where `ParameterGroupName = 'clinical'`) | — | Reads `ClinicalDocumentUploadLocation` for scanned files; reads `EyePrescriptionSlipUploadLocation` (and similar) for eye module. |
| **Appointment** | `PAT_Appointment` | — | Inbox of pending notes often shows appointment context. |
| **Ward / Bed** | `ADT_MST_Ward`, `ADT_Bed`, `ADT_PatientAdmission`, `ADT_TXN_PatientBedInfo` | — | Consultation requests accept optional `WardId`/`BedId` for in-patient consults. |
| **Medical Records** | `MR_TXN_Outpatient_FinalDiagnosis` | — | Final diagnosis is published downstream into the medical-records module. |
| **Billing Scheme** | `PAT_MAP_PatientSchemes`, `BIL_CFG_Scheme` | — | Patient's current scheme is read for price category on bill item requisitions. |

The single most important cross-module behavior is the **clinical-note → orders → bill** pipeline:
```
Doctor posts note
   └─ CLN_Notes inserted
       └─ per CLN_Diagnosis:
           ├─ LAB_TestRequisition (Lab)
           ├─ RAD_PatientImagingRequisition (Radiology)
           └─ PHRM_PrescriptionItems (Pharmacy)
   └─ per Lab/Imaging requisition:
       └─ BIL_BillItemRequisition (Billing, auto-priced)
```

---

## 8. Key Business Rules

### 8.1 ICD-10 coding
- **Every diagnosis is ICD-10 tagged.** Problem lists (Active/Past/Family/Surgical) and per-note diagnoses all carry `ICD10Code` + `ICD10Description` (denormalized from `MST_ICD10`).
- `CLN_Diagnosis.IsActive` allows soft-deleting a diagnosis without losing history.
- `MST_ICD10.ValidForCoding` is a flag that distinguishes billable codes from header / chapter codes.

### 8.2 SOAP-format clinical notes
The structured notes (H&P, OPD General, Emergency, Consult) follow the **SOAP** convention:
- **S**ubjective — `ChiefComplaint`, `HistoryOfPresentingIllness`, `ReviewOfSystems` → `CLN_Notes_Subjective`.
- **O**bjective — `HEENT`, `Chest`, `CVS`, `Abdomen`, `Extremity`, `Skin`, `Neurological` → `CLN_Notes_Objective`.
- **A**ssessment — captured via `CLN_Diagnosis` rows (ICD-coded problems identified this visit).
- **P**lan — captured via the order lists on each diagnosis (`AllIcdLabOrders`, `AllIcdImagingOrders`, `AllIcdPrescriptionOrders`).

Progress notes collapse SOAP into a single record with `SubjectiveNotes`, `ObjectiveNotes`, `AssessmentPlan`, `Instructions`. Free Text is unstructured. Procedure Note has its own shape (Date, Site, LinesProse, Remarks, FreeText). Emergency adds `BroughtIn`, `ModeOfArrival`, `TriageTime`, `Disposition`, `DispositionDepartmentId`. Discharge moves the SOAP to `ADT_DischargeSummary` and adds discharge medications.

### 8.3 Allergy alerts
The reference backend does **not** enforce hard allergy-drug interaction checks at write time. The `Allergy` table is loaded fresh per visit and exposed in the UI; the clinical screen is responsible for warning the doctor. Each allergy row carries:
- `AllergenAdvRecId` (drug) or `AllergyType = 'Others'` (food / environmental / free text).
- `Severity` (free text).
- `Reaction` (free text).
- `Verified` boolean — clinical confirmation that the allergy is real.

For our HMS parity work: implement a simple drug-allergy join table (drug id ↔ allergen id) and surface a warning modal when an `AllIcdPrescriptionOrders` row matches an existing allergy on the same patient.

### 8.4 Vitals
- One row per capture event. Historical values are immutable.
- `VitalsTakenOn` (measured) and `CreatedOn` (entered) can differ.
- Unit fields are auto-nulled if the numeric value is null.
- If a visit has < 3 vitals, the controller falls back to the previous visit's vitals so the chart always has enough data points.

### 8.5 Per-diagnosis orders
Each `ClinicalDiagnosisModel` carries its own `AllIcdLabOrders` (List<`LabRequisitionModel`>), `AllIcdImagingOrders` (List<`ImagingRequisitionModel`>), and `AllIcdPrescriptionOrders` (List<`PHRMPrescriptionItemModel`>). On POST, the diagnosis id is stamped on each order so the orders can be re-aggregated per diagnosis for view (`GET /api/Clinical/Orders?NoteId=`).

### 8.6 Atomic order + bill generation
All lab/imaging/prescription orders and their corresponding `BIL_BillItemRequisition` rows are created inside a single `dbContextTransaction`. If any step throws, the entire note + orders + bills are rolled back. This guarantees that a patient is never billed for orders that did not make it to the requisition tables, and conversely that the requisition tables never get orders that did not get billed (when the price is found).

### 8.7 Price category hardcoded
Lab and imaging price lookups use `PriceCategoryId == 1` ("Normal"). This is a known limitation — Krishna, 13 March 2023. Different schemes (e.g., insurance, corporate) do not currently flow through the clinical POST.

### 8.8 Templates and pending notes
- `CLN_MST_NoteType` is a simple lookup (Progress Note, History & Physical, Emergency Note, Procedure Note, etc.).
- `CLN_Template` is a separate master that defines the available templates.
- `CLN_Notes.IsPending` marks notes that have not been finalized. `GET /api/Clinical/PatientNotes?patientId=0` returns the doctor's pending inbox.

### 8.9 Eye sub-module invariants
- Per-eye data is stored as `IsOD = true / false` (right / left). Always insert both rows in a single `EyeMasterDetail` POST.
- `EyeScanImages.FileNo` is per `(PatientId, FileType)` monotonic. Computed as `MAX(FileNo) + 1`.
- The 20+ per-eye child tables are written in a single transaction; partial eye EMR inserts are not possible.

### 8.10 Scanned documents file location
- Path comes from `CORE_CFG_Parameters` where `ParameterGroupName = 'clinical'` and `ParameterName = 'ClinicalDocumentUploadLocation'`. The directory is created on first upload if missing.
- File naming convention: `PatientId_FileName_Ticks.ext` to avoid collisions.
- File binary is **not** duplicated into the DB for `CLN_PAT_Images` (only the path is stored). The `GetScannedImages` GET reads bytes from disk and returns them inline.

---

## 9. Frontend (Angular) reference

Frontend code lives in two module trees:
- `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/clinical/` — vitals, allergies, home medication, I/O, problems, eye EMR, scanned images, blood sugar, prescription slip.
- `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/clinical-notes/` — note templates (FreeText, Progress, Procedure, Emergency, History & Physical, OPD General, OPD Ortho, Prescription Note, Assessment-Plan, notes list, notes main).

Key frontend files:
- `clinical/clinical.module.ts`, `clinical-routing.module.ts`, `clinical-shared-module.ts`, `clinical.component.ts`
- `clinical/clinical.dl.service.ts` — Data-Layer service (HTTP wrappers).
- `clinical/io-allergy-vitals.bl.service.ts`, `medication.bl.service.ts`, `history.bl.service.ts`, `problems.bl.service.ts`, `eye-examination.bl.service.ts` — Business-Layer services.
- `clinical/shared/{vitals, allergy, icd10, input-output, home-medication, medication-prescription, social-history, surgical-history, family-history, past-medical, active-medical, patient-clinical-info, patient-uploaded-images, order-list, all-icd-with-orders, intake-output-parameterlist, blood-sugar-monitoring, patient-info}.model.ts` — Frontend view models.
- `clinical-notes/notes.module.ts`, `notes-routing.constant.ts`, `notes-main.component.ts`, `notes-list/notes-list.component.ts`
- `clinical-notes/shared/note-template.bl.service.ts` — Business-Layer service for note templates.
- `clinical-notes/{subjective, objective, opd-general, opd-ortho, freenotes, prescription-note, assessment-plan, templates/freetext, templates/emergency-note, templates/progress-note, templates/history-and-physical-note}` — per-template components.

Routes (from `clinical-routing.module.ts`):
- `''` → `ClinicalComponent`, with children: `Vitals` (default), `Allergy`, `HomeMedication`, `InputOutput`, `DoctorsNotes`, `EyeExamination` (with children `NewEMR`, `EMRHistory`, `Prescriptionslip`, `ScanUpload`, `PrescriptionslipHistory`), `BloodSugarMonitoring`.

`ClinicalController` consumes these services via standard `HttpClient.get/post` calls, with the response payload pattern `{ Status, Results, ErrorMessage }` from the legacy `DanpheHTTPResponse<T>` wrapper (now superseded by `IActionResult` returning JSON).

---

## 10. Parity Checklist for our HMS (Hono + D1)

When porting this module to Hono + Cloudflare D1, ensure:

- [ ] **All 30 CLN_ tables** exist in D1 with the same column names and types (or Hono-mapped equivalents). The `ClinicalDbContext.OnModelCreating` mapping is the source of truth for column → property names.
- [ ] **30+ GET routes** mapped 1:1 from `ClinicalController` to Hono `app.get` handlers under `/api/Clinical/`.
- [ ] **20+ POST routes** mapped 1:1 to Hono `app.post` handlers.
- [ ] **Transactional note + orders + bill** insert replicated. D1 `db.batch()` is the natural fit — group all inserts for a single note into one batch.
- [ ] **File-based scan storage** swapped from local disk to **Cloudflare R2** (or keep local if running in the hospital LAN deployment). File path is just a metadata column in `CLN_PAT_Images`; bytes go to R2.
- [ ] **Eye scan images** — keep binary in D1 only if size allows; otherwise move to R2. The reference stores `varbinary` inline.
- [ ] **RBAC** — `ClinicalViewController.GetView` route-validation code is currently commented out. The Hono rewrite should re-implement this via a `verifyRoute` middleware.
- [ ] **ICD-10 codes** — the master `MST_ICD10` table is read-heavy across this module; cache it in Workers KV if it is large.
- [ ] **Allergy-drug interaction** — implement the missing hard check at order time (server-side) and surface a warning modal in the Angular UI.
- [ ] **Price category** — replace the hardcoded `PriceCategoryId = 1` with the patient's actual scheme lookup.
- [ ] **Soft-delete on notes** — `CLN_Diagnosis.IsActive` is supported; for note-level soft-delete, the reference does not implement one, but a `Notes.IsActive` flag would be a safe parity addition.
- [ ] **Multi-tenant scoping** — every CLN_ table must include `tenant_id` in our HMS version (the reference is single-tenant).
- [ ] **Audit fields** — `CreatedBy/On`, `ModifiedBy/On` are mandatory on every write; preserve them in Hono.
- [ ] **Time zone** — all `DateTime` values are server-local; when we move to Cloudflare Workers, normalize to UTC and let the front-end localize.
