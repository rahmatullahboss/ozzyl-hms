# DICOM / PACS Integration Guide

## Overview

Ozzyl HMS supports integration with imaging modalities (X-Ray, Fluoroscopy, CT, MRI, Ultrasound, etc.) through a two-part architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Hospital Network                                                       │
│  ┌─────────────────────┐        ┌──────────────────────────────────┐  │
│  │  Fluoroscopy Unit    │        │  On-Premise Server               │  │
│  │  AE: FLUORO_01       │───────►│  dicom-scp.js (Node.js)          │  │
│  │  Port: 11112        │ DICOM  │  Listens on port 11112            │  │
│  └─────────────────────┘        │  Saves DICOM locally (backup)     │  │
│                                 │  Forwards metadata → HMS Cloud     │  │
│                                 └──────────────┬───────────────────────┘ │
│                                                │  HTTPS webhook         │
│                                                │  X-Tenant-ID + API key  │
└────────────────────────────────────────────────┼───────────────────────┘
                                                 │
                                                 ▼
                                    ┌────────────────────────────┐
                                    │  HMS Cloudflare Worker     │
                                    │  POST /api/radiology/pacs/ │
                                    │  forward                   │
                                    │                             │
                                    │  PUT /api/radiology/pacs/  │
                                    │  upload/<key>  (R2)        │
                                    └────────────────────────────┘
```

## Why Standalone Node.js?

DICOM modalities use **raw TCP sockets** — they connect directly to port 11112 and send binary DICOM data. Cloudflare Workers/Durable Objects **do not expose raw TCP ports**. The on-premise `dicom-scp.js` agent is required.

## Components

### 1. HMS Backend Endpoint

**File:** `src/routes/tenant/radiology/pacs.ts`

```
POST /api/radiology/pacs/forward
```

**Authentication:**
```
X-Tenant-ID: <tenant_id>
X-API-Key: <hospital_api_key>
```

**Request Body:**
```json
{
  "studyInstanceUid": "1.2.840.113619.2.55.3.604688",
  "patientName": "John^Doe",
  "patientId": "PAT001",
  "modality": "RF",
  "studyDate": "2026-04-28",
  "studyDescription": "Fluoroscopy-Guided Procedure",
  "sopClassUid": "1.2.840.10008.5.1.4.1.1.12.2",
  "sourceAETitle": "FLUORO_01",
  "requisitionId": 123,
  "r2Key": "dicom/tenant_id/studyUid/sopUid.dcm"
}
```

**Response:**
```json
{
  "id": 456,
  "message": "Study registered from DICOM agent",
  "alreadyExists": false
}
```

### 2. R2 Upload Endpoint

```
PUT /api/radiology/pacs/upload/dicom/<tenant_id>/<studyInstanceUid>/<sopInstanceUid>.dcm
```

**Headers:** Same `X-Tenant-ID` + `X-API-Key`
**Body:** Raw DICOM file binary
**Max size:** 50MB

### 3. DICOM SCP Agent

**Location:** `tools/dicom-print-agent/src/dicom-scp.js`

**Features:**
- C-STORE SCP server (listens on port 11112)
- C-ECHO support (connectivity test from modality)
- Accepts all DICOM Storage SOP classes
- Saves DICOM locally as backup
- Forwards metadata to HMS via HTTP
- Uploads DICOM to R2
- Retry logic with exponential backoff (3 retries: 1s, 2s, 4s)
- Handles rate limits (429) and server errors (5xx)
- Events: `imageReceived`, `imageSynced`, `syncFailed`

## Configuration

Each hospital runs their own `dicom-scp.js` instance with their own `.env`:

```env
# DICOM Network
DICOM_PORT=11112
AE_TITLE=HOSPITAL_NAME_SCP

# Cloud Sync (REQUIRED for HMS integration)
CLOUD_SYNC_ENABLED=true
OZZYL_API_URL=https://hms-saas-production.rahmatullahzisan.workers.dev
OZZYL_API_KEY=<hospital_api_key>
TENANT_ID=<hospital_tenant_id>

# Local Storage
STORAGE_PATH=./received

# Logging
LOG_LEVEL=info
LOG_PATH=./logs
```

## Database Schema

The `radiology_dicom_studies` table stores:

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| tenant_id | TEXT | Hospital identifier |
| study_instance_uid | TEXT | DICOM Study Instance UID (UNIQUE per tenant) |
| patient_id | INTEGER | Link to patients table |
| patient_name | TEXT | Patient name |
| modality | TEXT | CR, CT, MR, US, RF, MG, etc. |
| study_date | TEXT | YYYY-MM-DD |
| study_description | TEXT | |
| r2_key | TEXT | Path to DICOM file in R2 |
| source_ae_title | TEXT | AE title of sending modality |
| requisition_id | INTEGER | Link to radiology_requisitions |
| is_mapped | INTEGER | 0 = not linked to order, 1 = linked |
| series_count | INTEGER | Number of series in study |
| image_count | INTEGER | Number of images in study |
| is_active | INTEGER | Soft delete flag |
| created_at | TEXT | |
| updated_at | TEXT | |

## Deployment Steps

### 1. Install on-premise server

```bash
cd tools/dicom-print-agent
npm install
```

### 2. Configure for hospital

Copy `.env.example` to `.env` and fill in hospital-specific values.

### 3. Start the agent

```bash
node src/index.js
# or with pm2
pm2 start src/index.js --name dicom-scp-hospital
```

### 4. Configure modality

In the fluoroscopy/X-ray machine configuration:
- AE Title: matches `AE_TITLE` in `.env`
- IP Address: IP of the server running `dicom-scp.js`
- Port: 11112 (or match `DICOM_PORT`)

### 5. Verify connectivity

From the modality, run a C-ECHO test. The agent should log:
```
C-ECHO received (connectivity test)
```

## Monitoring

### Agent Stats

The `DicomScp` class tracks:
- `received`: Images received from modality
- `failed`: Failed to save or forward
- `forwarded`: Successfully forwarded to HMS
- `uploaded`: Successfully uploaded to R2
- `lastReceived`: Timestamp of last received image

Access via `getStats()` method.

### HMS Dashboard

Radiology → PACS Studies tab shows all studies received from DICOM agents.

### OHIF Viewer

If `OHIF_BASE_URL` is set in HMS environment variables, study rows include a `viewer_url` link.

## Multi-Tenant Isolation

Each hospital's data is isolated by:
1. **Tenant ID** — `X-Tenant-ID` header in every request
2. **API Key** — Validated against `api_keys` table in D1
3. **R2 Path** — All files stored under `dicom/<tenant_id>/...`

Even if someone physically moves the server to another hospital, the data goes to the correct tenant because the API key and tenant ID are embedded in the agent's configuration.

## Troubleshooting

### Modality can't connect to dicom-scp.js
- Check firewall allows inbound TCP on port 11112
- Verify AE Title matches between modality and `.env`
- Check modality IP is not blocked

### Forward to HMS fails
- Verify `OZZYL_API_URL`, `OZZYL_API_KEY`, `TENANT_ID` are correct
- Check network from server can reach `hms-saas-production.rahmatullahzisan.workers.dev`
- Check HMS API key is active in hospital settings

### Upload succeeds but study not visible in HMS
- Verify `r2_key` path starts with `dicom/<tenant_id>/`
- Check HMS logs for the `/forward` endpoint calls

## References

- DICOM Standard: https://www.dicomstandard.org/
- dcmjs-dimse library: https://github.com/pantelisgeorgiadis/dcmjs-dimse
- OHIF Viewer: https://ohif.org/