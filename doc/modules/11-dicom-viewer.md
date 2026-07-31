# DicomViewer Module — DanpheEMR Reference Documentation

## 1. Module Overview

The DicomViewer module provides **in-browser viewing, annotation, and storage of DICOM (Digital Imaging and Communications in Medicine) studies** for the radiology workflow. It is the bridge between the DanpheEMR Radiology reporting module and an external **PACS (Picture Archiving and Communication System)** server.

Core responsibilities:

- **DICOM Ingest / Storage**: A separate file-system location (`DestinationPathAPI` in `app.config`) receives DICOM objects pushed from the modality or an external PACS gateway. Each DICOM object is parsed to extract study / series / file metadata and persisted into three SQL Server tables (`DCM_PatientStudy`, `DCM_Series`, `DCM_DicomFiles`).
- **PACS-backed Relational Index**: The `DCM_*` tables live in a **separate SQL Server connection string** (`ConnectionStringPACSServer`) so that a PACS-tier database can be co-located with the modality or kept logically separate from the clinical database.
- **In-browser DICOM Viewer**: A self-contained Angular component (`dicom-viewer`) built on **Cornerstone / Cornerstone-Tools / Cornerstone-Math** and **cornerstoneWADOImageLoader** that streams the binary DICOM pixel data, displays multi-frame multi-series studies, and supports standard radiology tools (windowing, zoom, pan, length, angle, ROI, probe, magnify, rotate, invert, play-clip, stack-scroll, annotation).
- **Persistent Annotations**: Tool states (length, angle, simpleAngle, probe, ellipticalRoi, rectangleRoi, arrowAnnotate) are serialized as JSON and stored in `DCM_DicomFiles.FileToolData` per image. They are re-applied on the next viewing of that image.
- **Patient Study Mapping to Radiology Reports**: When a radiologist authors an `ImagingReport` they pick one or more `DCM_PatientStudy` rows; the chosen IDs are stored as a comma-separated string in `RAD_PatientImagingReport.PatientStudyId` and the corresponding `DCM_PatientStudy.IsMapped` flag is set to `true`. Unmapping (edit / re-assignment) flips the flag back to `false`.
- **Feature Gating**: The whole pipeline is hidden from the UI when the core parameter `Radiology / EnableDicomImages` is anything other than `true`. A second core parameter `Dicom / dicomViewerUrl` (legacy) and `DicomImageLoaderUrl` hold the wadouri prefix the viewer prepends to every `DicomFileId`.

The module is integrated with **Radiology** (PACS list mapping, report attachment, viewer launch), **Patient** (patient identification), **Core / Master** (`CORE_CFG_Parameters` for feature flags and viewer URL), and **Security** (JWT auth on `api/Dicom`; the `DicomMainModule` registers `authInterceptorProviders` so every request carries the login JWT).

Key external libraries (Angular side):

- `cornerstone-core` — DICOM image rendering on a `<canvas>` / `<div>` element
- `cornerstone-tools` — pan, zoom, windowing, length, angle, ROI, annotation, stack-scroll, play-clip
- `cornerstone-math` — angle / line math helpers
- `dicom-parser` — DICOM Part 10 file parsing
- `cornerstoneWADOImageLoader` — fetches pixel data via `wadouri:` (DICOM file URL) scheme
- `hammerjs` — touch / gesture input
- `angular-draggable-droppable` — drag-and-drop for series thumbnail reordering

## 2. Backend Files

### 2.1 `Controllers/DicomViewer/DicomController.cs` (484 lines)

Single REST controller, base route `api/Dicom`. Inherits `CommonController` so it has access to `connString`, `connStringAdmin`, and `connStringPACSServer`. Every action uses `DicomDbContext` initialised with `connStringPACSServer`.

#### Endpoints

| Verb + Route | Method | Purpose |
|--------------|--------|---------|
| `GET api/Dicom/byDicomFileId?id={id}` | `GetDicomImage(Int64 dicomFileId)` | Returns the raw DICOM Part 10 binary stream (`FileStreamResult`, MIME `plain/text`) for the requested file. Used by `cornerstoneWADOImageLoader` to fetch pixel data lazily. |
| `GET api/Dicom?reqType=getStudies` | legacy `Get(...)` | Returns all distinct patient studies with a non-null `PatientName` and `StudyInstanceUID`. |
| `GET api/Dicom?reqType=getStudiesByPatStudyId&patStudyId={csv}` | legacy `Get(...)` | Returns studies whose `PatientStudyId` is in the comma-separated list. |
| `GET api/Dicom?reqType=getSeriesImageInfo&studyInstanceUID={uid}` | legacy `Get(...)` | Returns the first patient study plus its `SeriesList` (each with `SeriesInstanceUID` and `ImageList` of `DicomFileId` + `SOPInstanceUID`). |
| `GET api/Dicom?reqType=loadImagesByDicomFileId&id={id}` | legacy `Get(...)` | Returns the binary stream of a single DICOM file (note: has a return-type bug — it builds a `FileStreamResult` and tries to call `.ToString()`). |
| `GET api/Dicom?reqType=getAllData&studyInstanceUID={uid}` | legacy `Get(...)` | Returns the full join of `PatientStudies` × `Series` × `DicomFiles` (including the raw `FileBinaryData` blob — **caution, large payload**) for the given study. |
| `GET api/Dicom?reqType=dicomFileToolData&dicomFileId={id}` | legacy `Get(...)` | Returns the saved `FileToolData` JSON string for a single file. |
| `POST api/Dicom` | `Post()` | Receive a wrapped DICOM object (study + series + file metadata + raw `FileBytes`), upsert `DCM_PatientStudy` and `DCM_Series`, write the binary file to the configured storage path, and insert `DCM_DicomFiles`. |
| `PUT api/Dicom` | `Put()` | Update `DCM_DicomFiles.FileToolData` (annotation JSON) for a given `DicomFileId`. Captures `ModifiedBy` from the session user. |
| `DELETE api/Dicom/{id}` | `Delete(int id)` | Empty stub. |

The `Post()` action performs the side effects in this order:

1. Reads `DestinationPathAPI` from `app.config` (file-system root for DICOM blobs).
2. Deserialises a `DicomWrapperVM` (study + series + file info + raw bytes).
3. Upserts `DCM_PatientStudy` if the `StudyInstanceUID` is new.
4. Upserts `DCM_Series` if the `SeriesInstanceUID` is new.
5. Creates the folder `DestinationPathAPI\{PatientName|NA}-{PatientStudyId}\{SeriesDescription|NA}-{SeriesId}` and writes the DICOM file to that folder using `SOPInstanceUID` as the file name.
6. Inserts a new `DCM_DicomFiles` row if the `SOPInstanceUID` is not already present.

Static helpers in the same file:

- `InsertPatientStudiesData(patData, dcmdbContext)` — sets `CreatedOn = DateTime.Now`, adds, saves.
- `InsertPatientSeriesData(serData, dcmdbContext)` — same pattern.
- `InsertFileInfoData(fileInfo, dcmdbContext)` — adds + saves with a `DbEntityValidationException` log handler.
- `DeserializeFromStream(MemoryStream)` — binary formatter helper (currently unused by HTTP actions).
- `InsertData(SqlCommand)` — ad-hoc `SqlConnection` insert helper (currently unused by HTTP actions; uses the protected `connString`).

## 3. Data Models

All DICOM-side models live in `Components/DanpheEMR.ServerModel/DICOMModels/`. They are simple POCOs mapped by `DicomDbContext` (see §4) to SQL Server tables in the PACS connection.

### 3.1 `PatientStudyModel.cs` (active model used by `DicomController` + `DicomDbContext`)

```csharp
public class PatientStudyModel
{
    [Key]
    public int PatientStudyId { get; set; }
    public string PatientId { get; set; }
    public string PatientName { get; set; }
    public string StudyInstanceUID { get; set; }
    public string SOPClassUID { get; set; }
    public DateTime? StudyDate { get; set; }
    public string Modality { get; set; }
    public string StudyDescription { get; set; }
    public DateTime? CreatedOn { get; set; }
    public bool? IsMapped { get; set; }
}
```

The `IsMapped` flag is the primary lifecycle bit: `null` or `false` means "available for mapping to a Radiology report", `true` means "already attached to a finalized report". A draft report (rows in `RAD_PatientImagingReport` that are still `pending` or never finalized) keeps `IsMapped` set to `true` on the linked study.

### 3.2 `DCMPatientStudyModel.cs` (legacy / alternate version)

```csharp
public class DCMPatientStudyModel
{
    [Key]
    public int PatientStudyId { get; set; }
    public string PatientId { get; set; }
    public string PatientName { get; set; }
    public string StudyInstanceUID { get; set; }
    public string SOPClassUID { get; set; }
    public string Modality { get; set; }
    public string StudyDescription { get; set; }
    public DateTime? StudyDate { get; set; }
    public DateTime? CreatedOn { get; set; }
}
```

This is an older copy without `IsMapped`; not currently wired into `DicomDbContext` but kept for reference.

### 3.3 `SeriesInfoModel.cs`

```csharp
public class SeriesInfoModel
{
    [Key]
    public int SeriesId { get; set; }
    public int PatientStudyId { get; set; }      // logical FK to DCM_PatientStudy.PatientStudyId
    public string SeriesInstanceUID { get; set; }
    public string SeriesDescription { get; set; }
    public DateTime? CreatedOn { get; set; }
}
```

### 3.4 `DicomFileInfoModel.cs`

```csharp
[Serializable]
public class DicomFileInfoModel
{
    [Key]
    public Int64 DicomFileId { get; set; }
    public string SOPInstanceUID { get; set; }
    public Guid ROWGUID { get; set; }
    public int SeriesId { get; set; }            // logical FK to DCM_Series.SeriesId
    public string FileName { get; set; }
    public string FilePath { get; set; }
    public byte[] FileBinaryData { get; set; }   // full DICOM Part 10 binary blob
    public DateTime? CreatedOn { get; set; }
    public string FileToolData { get; set; }     // serialized annotation JSON
    public DateTime? ModifiedOn { get; set; }
    public int? ModifiedBy { get; set; }
}
```

`FileBinaryData` holds the **complete DICOM Part 10 file** (header + pixel data). The viewer streams it via `api/Dicom/byDicomFileId?id=...` and the Cornerstone WADO image loader parses it on the client.

`FileToolData` is a JSON string built by the viewer's `save()` method that captures the tool state for these tool types: `length`, `angle`, `simpleAngle`, `probe`, `ellipticalRoi`, `rectangleRoi`, `arrowAnnotate`. Each entry is an array of `cornerstoneTools` tool-state objects that the `showToolData()` method later reinstates with `cornerstoneTools.addToolState`.

### 3.5 `DicomWrapperVM.cs` (used by the legacy `POST api/Dicom` action)

```csharp
[Serializable]
public class DicomWrapperVM
{
    public PatientStudyModel PatientStudy { get; set; }
    public DicomFileInfoModel FileInfo { get; set; }
    public SeriesInfoModel SeriesInfo { get; set; }
    public byte[] FileBytes { get; set; }
}
```

A single transport object used by external PACS gateways to push one DICOM object at a time.

## 4. Database Tables

The `DicomDbContext` (Components/DanpheEMR.DalLayer/DicomDbContext.cs) maps the three models to the SQL Server tables below. The PACS database is reached via a **separate connection string** (`ConnectionStringPACSServer`) configured in `MyConfiguration`; it can be a different server / database from the clinical `Connectionstring`.

| C# Model | SQL Table | Key columns | Notes |
|----------|-----------|-------------|-------|
| `PatientStudyModel` | `DCM_PatientStudy` | `PatientStudyId` (PK, int, IDENTITY), `PatientId` (string), `PatientName`, `StudyInstanceUID` (DICOM tag (0020,000D)), `SOPClassUID`, `Modality`, `StudyDescription`, `StudyDate`, `CreatedOn`, `IsMapped` (bit) | One row per DICOM study. `IsMapped` toggles between report assignments. |
| `SeriesInfoModel` | `DCM_Series` | `SeriesId` (PK, int, IDENTITY), `PatientStudyId` (FK → DCM_PatientStudy.PatientStudyId), `SeriesInstanceUID` (DICOM tag (0020,000E)), `SeriesDescription`, `CreatedOn` | One row per DICOM series. |
| `DicomFileInfoModel` | `DCM_DicomFiles` | `DicomFileId` (PK, bigint, IDENTITY), `SOPInstanceUID` (DICOM tag (0008,0018)), `ROWGUID` (uniqueidentifier), `SeriesId` (FK → DCM_Series.SeriesId), `FileName`, `FilePath` (filesystem path), `FileBinaryData` (varbinary(max), the DICOM Part 10 file), `CreatedOn`, `FileToolData` (nvarchar(max) — JSON of tool state), `ModifiedOn`, `ModifiedBy` | One row per DICOM file (image / frame). `FileBinaryData` is the canonical source for the viewer. `FilePath` is a redundant convenience copy on the storage volume rooted at `DestinationPathAPI`. |

Cross-database link: a `RAD_PatientImagingReport` (in the clinical DB) carries a comma-separated list of `DCM_PatientStudy.PatientStudyId` values in the column `PatientStudyId` (see `ImagingReportModel.PatientStudyId` in Components/DanpheEMR.ServerModel/RadiologyModels/ImagingReportModel.cs). That is the only link between the clinical side and the PACS side.

The legacy commented-out code (in the older monolith `Post()` / `Put()` actions of `DicomController`) attempts to parse the request body twice and references `ConfigurationManager.AppSettings["DestinationPathAPI"]`. The current active code path uses only the modern PACS table.

The DB scripts for the DCM_ tables are not part of the open `Database/1. Admin-Db/1. DanpheAdmin_CompleteDB.sql` file (which only contains the admin schema) — they ship inside the compressed `Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip` payload. The expected column lists above are derived from the EF model classes.

## 5. Key Workflows

### 5.1 PACS Ingest (DICOM push)

```
External PACS / modality ──► POST api/Dicom (DicomWrapperVM)
   │
   ▼
1. Upsert DCM_PatientStudy by StudyInstanceUID
2. Upsert DCM_Series by SeriesInstanceUID (parent = new study id)
3. Create folders DestinationPathAPI/{PatientName|NA}-{PatientStudyId}/{SeriesDescription|NA}-{SeriesId}
4. Write DICOM Part 10 file using SOPInstanceUID as filename
5. Insert DCM_DicomFiles row (SOPInstanceUID, FileBinaryData, FilePath, ROWGUID)
```

After ingest each new study has `IsMapped = null` (default) and is therefore visible in the **PACS Image List** (the `api/radiology/DicomImages?PatientStudyId=` response) and the `ImgingFilesFromPACS?fromDate=&toDate=` report.

### 5.2 Radiology Report Authoring (mapping a study to a requisition)

```
Radiologist opens the post-report page for a requisition
   │
   ▼
Clicks "Select Dicom Images ?"
   │
   ▼
ImagingBLService.GetDicomImageList(patientStudyIds)
   │  (loads study rows where IsMapped = false OR the study id is already in this report)
   ▼
GET /api/radiology/DicomImages?PatientStudyId={csv}
   │  → DicomImageList(...) in RadiologyController
   ▼
Radiologist ticks the rows they want to attach and clicks "Add"
   │
   ▼
report.PatientStudyId = "<comma-separated PatientStudyId list>"
POST /api/Radiology/Report (multipart with reportDetails JSON + image files)
   │
   ▼
PostReport(...) in RadiologyController
   │
   ├──> UploadReportFile (writes uploaded images to fileuploads/Radiology/{type})
   ├──> Insert RAD_PatientImagingReport row
   ├──> For every PatientStudyId in the list:
   │      UPDATE DCM_PatientStudy SET IsMapped = 1 WHERE PatientStudyId IN (...)
   │      (this happens against connStringPACSServer, not the clinical DB)
   ├──> UpdateRequisitionItemStatus to mark the requisition "final"
   └──> SP_Bill_OrderStatusUpdate_Radiology + optional SP_Update_RadiologyProvider_In_BillTransactionItem
```

If the report is later edited (`PUT /api/Radiology/ImagingReport` → `UpdateImagingReport`), the controller reverses the mapping first (`IsMapped = false` for the previously linked study ids) and then re-applies it after the save with the new `PatientStudyId` list.

### 5.3 In-browser viewing

```
View Scanned Images button (view-report.component)
   │
   ▼
this._dicomService.patientStudyId = this.report.PatientStudyId
this.showStudy = true    (renders <dicom-study-list>)
   │
   ▼
DicomLoadStudyComponent.constructor
   ├──> GetDicomDataByStudyId()  →  GET api/Dicom?reqType=getStudiesByPatStudyId&patStudyId=...
   │     populates dicomDataObjs[]
   └──> GetDicomWebUrl()          →  GET api/radiology/DicomImage
         (reads CORE_CFG_Parameters "DicomImageLoaderUrl" — the wadouri prefix)
   │
   ▼
User clicks a study row → ShowDicomViewer(i) → GetImageData(studyInstanceUID)
   │
   ▼
GET api/Dicom?reqType=getAllData&studyInstanceUID=...
   │
   ▼
Builds imageIdList = DicomImageLoaderUrl + DicomFileId for each row
   │
   ▼
viewPort.loadStudyImages(imageIdList)
   │
   ▼
cornerstone.loadAndCacheImage(wadouri:...)  for each imageId
   │  (the wadouri scheme makes the browser call GET api/Dicom/byDicomFileId?id=...)
   ▼
imageLoaded(imageData) groups images by series, sorts by InstanceNumber
   │
   ▼
showSeries(currentSeriesIndex) populates the CornerstoneDirective
   │
   ▼
Display + tools are now active
```

### 5.4 Annotation persistence

```
User draws length / angle / ROI / arrow annotations
   │
   ▼
User clicks "Save"
   │
   ▼
component.save()
   ├──> Reads tool state for [length, angle, simpleAngle, probe,
   │                          ellipticalRoi, rectangleRoi, arrowAnnotate]
   ├──> Builds a JSON blob: { length: [...], angle: [...], ... }
   ├──> Resolves the DicomFileId from the current image's wadouri URL
   └──> PUT api/Dicom  body = { FileToolData: '<json>', DicomFileId: { dicomFileId: '...' } }
        │
        ▼
DicomController.Put
   ├──> Locates DCM_DicomFiles row by DicomFileId
   ├──> Sets FileToolData = json, ModifiedOn = now, ModifiedBy = session user id
   └──> Saves
```

To re-display annotations, the radiologist clicks **"showToolData"**:

```
component.showToolData()
   ├──> Reads the current DicomFileId from the image URL
   └──> GET api/Dicom?reqType=dicomFileToolData&dicomFileId=...
        │
        ▼
component.Success
   ├──> Parses the JSON
   ├──> For every tool type, cornerstoneTools.addToolState(element, toolType, data[i])
   └──> cornerstone.updateImage(element) → annotations re-rendered
```

### 5.5 Available viewer tools

Active whenever a series has at least one image (`imageCount > 0`); the toolbar shows only when the host passes `[enableViewerTools]="true"`.

| Tool | Component method | Cornerstone tool |
|------|------------------|------------------|
| Windowing (WW/WL) | `enableWindowing` | `cornerstoneTools.wwwc` + `wwwcTouchDrag` |
| Invert | `invertImage` | direct `cornerstone.setViewport` toggle of `viewport.invert` |
| Zoom | `enableZoom` | `cornerstoneTools.zoom` + `zoomTouchDrag` |
| Pan | `enablePan` | `cornerstoneTools.pan` + `panTouchDrag` |
| Stack scroll | `enableScroll` | `cornerstoneTools.stackScroll` + `stackScrollTouchDrag` + `stackScrollKeyboard` |
| Annotation (arrow) | `enableAnotation` | `cornerstoneTools.arrowAnnotate` + `arrowAnnotateTouch` |
| Length measurement | `enableLength` | `cornerstoneTools.length` |
| Angle measurement | `enableAngle` | `cornerstoneTools.simpleAngle` |
| Pixel probe | `enableProbe` | `cornerstoneTools.probe` |
| Elliptical ROI | `enableElliptical` | `cornerstoneTools.ellipticalRoi` |
| Rectangle ROI | `enableRectangle` | `cornerstoneTools.rectangleRoi` |
| Magnify | `magnify` | `cornerstoneTools.magnify` |
| Rotate | `rotate` | `cornerstoneTools.rotate` |
| Play clip | `playClip` / `SlowMotion` / `stopClip` | `cornerstoneTools.playClip` (uses `stack.frameRate` from tool state, defaults 10 / 3 FPS) |
| Download | `downloadImagesURL` | `cornerstoneTools.saveAs` (saves current viewport as `DicomImage.jpg`) |
| Reset image | `resetImage` | clears all tool state for the element + `cornerstone.reset` |
| Previous / Next image | `previousImage` / `nextImage` | mouse-wheel + keyboard + button |
| Windowing overlay value | `CornerstoneDirective.windowingValue` | reads `viewport.voi.windowWidth / windowCenter` |
| Zoom overlay value | `CornerstoneDirective.zoomValue` | reads `viewport.scale` |

`maxImagesToLoad` is a host-supplied `@Input` (default 100) that bounds the initial fetch; the host page (`dicom-load-study.view.html`) overrides it to 500.

## 6. API Endpoints

The DicomViewer and Radiology modules together expose 20+ endpoints that the module uses. They are split between the dedicated `api/Dicom` controller and the cross-module `api/Radiology/*` endpoints.

### 6.1 `api/Dicom` (legacy reqType-style + modern REST)

| # | Verb + Route | Method | Purpose |
|---|--------------|--------|---------|
| 1 | `GET /api/Dicom/byDicomFileId?id={dicomFileId}` | `GetDicomImage` | Returns the raw DICOM Part 10 binary stream for the viewer to render. |
| 2 | `GET /api/Dicom?reqType=getStudies` | `Get` | Lists all distinct patient studies (`PatientName`, `PatientId`, `StudyDate`, `StudyInstanceUID`, `StudyDescription`). |
| 3 | `GET /api/Dicom?reqType=getStudiesByPatStudyId&patStudyId={csv}` | `Get` | Same payload as #2, filtered to a comma-separated list of `PatientStudyId` values. |
| 4 | `GET /api/Dicom?reqType=getSeriesImageInfo&studyInstanceUID={uid}` | `Get` | Returns the study with its `SeriesList` (each containing `SeriesInstanceUID`, `SeriesDescription`, and `ImageList` of `DicomFileId` + `SOPInstanceUID`). |
| 5 | `GET /api/Dicom?reqType=loadImagesByDicomFileId&id={id}` | `Get` | Legacy fetch of one binary file. |
| 6 | `GET /api/Dicom?reqType=getAllData&studyInstanceUID={uid}` | `Get` | Returns the full join of `PatientStudies` × `Series` × `DicomFiles` (with `FileBinaryData`). |
| 7 | `GET /api/Dicom?reqType=dicomFileToolData&dicomFileId={id}` | `Get` | Returns the saved annotation JSON for a single file. |
| 8 | `POST /api/Dicom` | `Post` | Ingest one DICOM object (study + series + file + raw bytes). |
| 9 | `PUT /api/Dicom` | `Put` | Persist annotation JSON for one file. |
| 10 | `DELETE /api/Dicom/{id}` | `Delete` | No-op stub. |

### 6.2 `api/Radiology` (cross-module DICOM surface)

| # | Verb + Route | Method | Purpose |
|---|--------------|--------|---------|
| 11 | `GET /api/Radiology/ImgingFilesFromPACS?fromDate=&toDate=` | `ImgingFilesFromPACS` | Lists PACS patient studies whose `CreatedOn` falls in the range, joined to the clinical view. |
| 12 | `GET /api/Radiology/DicomImage` | `DicomImage` | Returns the configured DICOM image loader URL (`CORE_CFG_Parameters.DicomImageLoaderUrl`). |
| 13 | `GET /api/Radiology/DicomImages?PatientStudyId={csv or empty}` | `DicomImages` | Returns the PACS study list for the report-mapping dialog (unmapped + studies already linked to this report). |
| 14 | `POST /api/Radiology/Report` (multipart) | `Report` | Saves the final imaging report; sets `IsMapped = true` on every linked `DCM_PatientStudy`. |
| 15 | `POST /api/Radiology/PatientStudy` | `PostPatientStudy` | Saves a draft imaging report row that simply attaches a `PatientStudyId` to a requisition. |
| 16 | `PUT /api/Radiology/ImagingReport` (multipart) | `ImagingReport` | Edits an existing report; reverses and reapplies the `IsMapped` flags. |
| 17 | `PUT /api/Radiology/PatientStudy` | `PutPatientStudy` | Updates the linked `PatientStudyId` set on an existing report. |
| 18 | `GET /api/Radiology?reqType=dicomViewerUrl&imagingReportId=&PatientStudyId=` (legacy) | `Get` | Returns the legacy `Dicom / dicomViewerUrl` parameter. |
| 19 | `GET /api/Radiology?reqType=dicomImageLoaderUrl` (legacy) | `Get` | Same as #12. |
| 20 | `GET /api/Radiology?reqType=get-dicom-image-list&PatientStudyId=` (legacy) | `Get` | Same as #13. |
| 21 | `GET /api/Radiology/ImagingReport?requisitionId=` | `GetImagingReport` | Returns the report (used to render the view-report page that hosts the viewer). |
| 22 | `PUT /api/Radiology/DeleteReportImages` | `DeleteReportImages` | Removes images from the report and updates the `ImageName` / `ImageFullPath` columns. |
| 23 | `PUT /api/Radiology/PatientScanDone` | `PatientScanDone` | Marks a requisition as scanned (pre-condition for the report dialog to show PACS images). |

### 6.3 Frontend services that wrap the DICOM surface

- `app/shared/danphe-dicom-viewer/shared/dicom.service.ts` — singleton `DicomService` holding the active `patientStudyId` between components (view-report → dicom-load-study).
- `app/radiology/shared/imaging.dl.service.ts`:
  - `GetDicomImageList(PatientStudyId)` → GET #13.
  - `PostPatientStudy(reportData)` → POST #15.
  - `PutPatientStudy(reportData)` → PUT #17.

## 7. Cross-Module Integration

### 7.1 Radiology (primary consumer)

- **Report attachment**: `ImagingReportModel.PatientStudyId` (string, comma-separated) references one or more `DCM_PatientStudy.PatientStudyId`. The Radiology module's `PostReport`, `UpdateImagingReport`, and `PostPatientStudy` all flip `IsMapped` on the linked studies inside a `TransactionScope`.
- **Viewer launch**: `view-report.component.ts.ViewScannedImages()` (line 252) writes `this.report.PatientStudyId` to `DicomService.patientStudyId` and toggles `showStudy = true` to render `<dicom-study-list>`, which boots the Cornerstone viewer.
- **Report-creation flow**: `post-report.component.ts.GetAllDicomImageList()` (line 192) → `ImagingBLService.GetDicomImageList(oldPatientStudyIds)` → `ImagingDLService.GetDicomImageList` → GET #13. The mapping dialog is only rendered when the `Radiology / EnableDicomImages` parameter is `"true"`.
- **Edit / unmap**: `view-report.component.ts.EditReport()` opens the `danphe-post-report` dialog; on submit, `UpdatePatientReport` calls `PUT /api/Radiology/ImagingReport` which detaches the old study ids (`IsMapped = false`) and re-attaches the new ones (`IsMapped = true`).

### 7.2 PACS (the upstream gateway)

- The system does not implement DICOM C-STORE / C-FIND / C-MOVE / WADO-WS directly. Instead, an external PACS gateway (or modality) **POSTs DICOM objects as JSON-wrapped byte arrays to `api/Dicom`** using the `DicomWrapperVM` contract. The controller then both writes the file to disk (`DestinationPathAPI`) and inserts the row into `DCM_DicomFiles`. The DICOM tag values (`PatientName`, `PatientId`, `StudyInstanceUID`, `SOPInstanceUID`, `Modality`, `StudyDate`, `SeriesInstanceUID`, `SeriesDescription`) must be pre-extracted by the gateway and supplied in the wrapper (the controller does not parse the binary blob).
- Reads from PACS are by `DicomFileId` only (`api/Dicom/byDicomFileId`); there is no WADO-RS style metadata endpoint, so the viewer must be told the wadouri prefix via `DicomImageLoaderUrl`.

### 7.3 Patient

- `DCM_PatientStudy.PatientId` and `PatientName` are free-text DICOM fields, **not foreign keys** to `PAT_Patient.PatientId`. The PACS ingest accepts whatever string the modality sends. Mapping a study to a clinical report is what binds it to a real patient.
- `view-report.component.ts` uses `this.report.PatientId` and `this.report.PatientName` to display the patient context while viewing studies.

### 7.4 Core / Master

- `CORE_CFG_Parameters`:
  - `Radiology / EnableDicomImages` — `"true"` / `"false"` feature flag (gates every DICOM UI in the radiology module via `RadiologyService.EnableDicomImages()`).
  - `DicomImageLoaderUrl` — the wadouri prefix that the viewer prepends to `DicomFileId` (e.g. `/api/Dicom/byDicomFileId?id=`).
  - `Dicom / dicomViewerUrl` — legacy parameter used by the older `reqType=dicomViewerUrl` endpoint.
  - `Radiology / ReportImagesFolderPath` — separate parameter for the non-DICOM image upload (used by `view-report` for the lightbox album).
- `MyConfiguration.ConnectionStringPACSServer` — the PACS database connection string (in `CommonController` constructor, line 32). All three DCM tables live behind this connection.

### 7.5 Security

- `DicomMainModule` (the parent Angular module that declares `DicomLoadStudyComponent`) registers `authInterceptorProviders` so every `HttpClient` call from the viewer automatically attaches the JWT login token.
- `DicomViewerModule` re-registers the same `authInterceptorProviders` because it does not import `SharedModule`.
- The DICOM PUT that updates annotations (`DicomController.Put`) pulls the current user id from the session (`HttpContext.Session.Get<RbacUser>("currentuser")`) and writes it to `DCM_DicomFiles.ModifiedBy`.

## 8. Business Rules

1. **DICOM ingest is idempotent on UID, not on row id.** `DicomController.Post` looks up an existing `DCM_PatientStudy` by `StudyInstanceUID` and an existing `DCM_Series` by `SeriesInstanceUID`; only the file insert is also guarded by `SOPInstanceUID`. Re-pushing the same object will be a no-op at the file level but will re-create the folder and re-write the binary to disk.
2. **PatientStudyId is the cross-DB link.** The clinical DB has no FK to `DCM_PatientStudy`; the link is a comma-separated string in `RAD_PatientImagingReport.PatientStudyId`. Splitting and `int.Parse` is done in `PostReport` and `UpdateImagingReport`.
3. **`IsMapped` is the only PACS-side lifecycle flag.** It is set to `true` when a report is finalized (or when a draft report with the same `PatientStudyId` is saved via `PostPatientStudy`), and reset to `false` when the report is updated and the link changes. The PACS image picker therefore only shows rows where `IsMapped <> true` (using `where patStudy.IsMapped != true` in `DicomImageList`).
4. **Feature gating is per-hospital.** The `Radiology / EnableDicomImages` parameter hides the entire DICOM UI (image list picker in `post-report.html`, viewer launch in `view-report.html`) when `"false"` or missing. Default in code is `false`.
5. **Binary storage has two copies.** Each ingested DICOM file is stored both as a `varbinary(max)` in `DCM_DicomFiles.FileBinaryData` **and** as a file on disk under `DestinationPathAPI\{PatientName|NA}-{PatientStudyId}\{SeriesDescription|NA}-{SeriesId}\{SOPInstanceUID}`. The viewer streams the DB copy; the file copy is for archival / external tooling.
6. **The viewer streams the binary through DanpheEMR, not the PACS directly.** `DicomImageLoaderUrl` is configured to point to DanpheEMR's own `api/Dicom/byDicomFileId` (the viewer then hits `connStringPACSServer` and reads `FileBinaryData`). This keeps DICOM access under the same JWT auth and audit trail as the rest of the EMR, at the cost of putting DanpheEMR in the DICOM pixel-data path.
7. **Annotations are per-image, not per-study.** A study with N images has N independent `FileToolData` blobs. Re-annotating image #3 does not affect images #1 or #4.
8. **Tool-state JSON shape is internal to Cornerstone-Tools.** The viewer serialises the live `cornerstoneTools.getToolState(...)` objects directly; round-tripping depends on the same Cornerstone-Tools version being loaded in the client. Major upgrades to the library may require a migration of stored `FileToolData`.
9. **The viewer's primary image-fetch URL embeds the file id.** `cornerstoneWADOImageLoader` is given `wadouri:` image ids of the form `<DicomImageLoaderUrl><DicomFileId>`. The viewer's `getDicomFileId(url)` helper parses the query string of the loaded image's `imageId` to recover the id when saving or showing tool data.
10. **Default tool is windowing.** `CornerstoneDirective.displayImage` activates `wwwc` for the left mouse button, `pan` for the middle, and `zoom` for the right. Mouse wheel and keyboard are always on. The toolbar can re-activate any specific tool.
11. **Stack-scroll keyboard / wheel / touch are all enabled by default.** Wheel is bound in `CornerstoneDirective.onMouseWheel`; arrow keys are bound via `stackScrollKeyboard`; touch is bound via `stackScrollTouchDrag`.
12. **Play-clip frame rate defaults.** If the loaded image's `frameRate` tool state is undefined, `playClip` uses 10 FPS and `SlowMotion` uses 3 FPS.
13. **Re-orientation / reset.** `resetImage()` clears all tool state and calls `cornerstone.reset` to return the viewport to the original windowing / zoom / pan. `clearImage()` is a stronger reset that empties `seriesList`, `currentSeries`, and `imageCount`.
14. **Drag-and-drop series reordering.** The thumbnail strip (`<div thumbnail [imageData]="series.imageList[0]">` in `dicom-viewer.component.html`) is `mwlDraggable`; releasing a drag calls `showSeries(i)`, switching the active series. The thumbnails themselves are rendered by `ThumbnailDirective`, which calls `cornerstone.displayImage` on its native element with a default viewport.
15. **No DICOM C-STORE / DIMSE.** DanpheEMR does not implement the DICOM upper-layer protocol; it is a pure HTTP / wadouri consumer. The "PACS" is any system that can write rows into the `DCM_*` tables (either by POSTing to `api/Dicom` or by an external ETL job that loads from a real DICOM modality).
16. **Patient identity mismatch is allowed.** Because `DCM_PatientStudy.PatientId` is a free-text field, a PACS study can be ingested for a patient that does not yet exist in `PAT_Patient`. Mapping to an imaging report at the time of reporting is the moment at which the system enforces that the report's `PatientId` matches the requisition's `PatientId`.
17. **Old / commented controller code is preserved.** `DicomController` retains a large block of commented-out legacy `reqType=` handlers (study file tool data, image byte arrays, file lists) that pre-dates the Cornerstone-based viewer. They are kept for reference but should not be invoked by current clients.
18. **Storage root is local-disk on the web server.** `DestinationPathAPI` is a path on the IIS / Kestrel host (e.g. `D:\DanpheHealthCare\DanpheEMR\R2V1\Dev\Code\Storage\API-DicomStorage`). For multi-instance deployments this would need to be a shared volume; the current implementation assumes a single-instance web tier.
19. **Authentication is the same JWT as the rest of DanpheEMR.** The `DicomMainModule` and `DicomViewerModule` re-register `authInterceptorProviders` so the DICOM endpoints (`api/Dicom/*`) and the cross-module Radiology endpoints (`api/Radiology/*`) all validate the login token. There is no separate DICOM-only auth.
20. **The DICOM viewer is opt-in per deployment.** The combination of the `EnableDicomImages` parameter, the `DicomImageLoaderUrl` parameter, and the configured `ConnectionStringPACSServer` defines whether the module is active. A hospital that does not have a PACS simply leaves these blank and the radiology module behaves as a text-only reporting system.
