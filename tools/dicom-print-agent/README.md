# DICOM Print Agent

On-premise DICOM C-STORE SCP server for Ozzyl HMS. Receives images from X-ray, fluoroscopy, and other DICOM modalities, saves locally, and forwards to HMS Cloudflare Worker.

## Quick Start

```bash
cd tools/dicom-print-agent
npm install
cp .env.example .env
# Edit .env with your hospital's tenant_id and API key
node src/index.js
```

## Configuration

Edit `.env`:

```env
# DICOM Network
DICOM_PORT=11112
AE_TITLE=HOSPITAL_SCP

# Cloud Sync (REQUIRED)
CLOUD_SYNC_ENABLED=true
OZZYL_API_URL=https://hms-saas-production.rahmatullahzisan.workers.dev
OZZYL_API_KEY=your_hospital_api_key
TENANT_ID=your_tenant_id

# Local Storage
STORAGE_PATH=./received
LOG_LEVEL=info
LOG_PATH=./logs
```

## Architecture

```
Modality (DICOM C-STORE) ──► :11112 ──► dicom-scp.js
                                          │
                                          ├── Save locally (./received)
                                          │
                                          └── HTTPS POST ──► HMS /forward
                                                           │
                                                           └── HTTPS PUT ──► R2 (DICOM file)
```

## Modality Setup

In your X-ray/fluoroscopy machine configuration:
- **AE Title**: Match `AE_TITLE` in `.env`
- **IP Address**: IP of server running this agent
- **Port**: Match `DICOM_PORT` (default 11112)
- **Transfer Syntax**: Implicit VR Little Endian or Explicit VR Little Endian

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/radiology/pacs/forward` | Register study metadata with HMS |
| PUT | `/api/radiology/pacs/upload/:key` | Upload DICOM file to R2 |

## Stats

Run with `DEBUG=stats node src/index.js` to see:
- `received`: Images from modality
- `failed`: Save or forward failures
- `forwarded`: Successfully forwarded to HMS
- `uploaded`: Uploaded to R2
- `lastReceived`: Last image timestamp

## Troubleshooting

**Modality can't connect?**
- Check firewall allows inbound TCP on port 11112
- Verify AE Title matches exactly

**HMS forward fails?**
- Verify API key and tenant ID are correct
- Test: `curl -X POST https://your-hms-url/api/radiology/pacs/forward \
  -H "X-Tenant-ID: your-tenant" \
  -H "X-API-Key: your-key" \
  -d '{"studyInstanceUid":"test-123"}'`

## Production Deployment

Use PM2 for process management:

```bash
npm install -g pm2
pm2 start src/index.js --name dicom-agent \
  --env OZZYL_API_URL=https://hms-saas-production.rahmatullahzisan.workers.dev \
  --env TENANT_ID=your_tenant \
  --env API_KEY=your_key
pm2 save
pm2 startup
```

## Files

```
src/
  index.js          # Entry point, starts SCP server
  dicom-scp.js      # DICOM C-STORE SCP with HMS forwarding
  config.js         # Configuration loader
  logger.js         # Winston logger
```

## License

Internal - Ozzyl HMS