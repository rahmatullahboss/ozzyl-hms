# Ozzyl HMS HL7 Middleware Agent

Cloudflare Workers (which host the Ozzyl HMS backend) only accept HTTP/HTTPS traffic. However, traditional Lab Auto-Analyzers (like Sysmex, Roche, Abbott) send results using TCP/MLLP connections (HL7v2 messages).

This lightweight Node.js agent solves that problem. It runs on a computer inside the hospital's local network, listens for TCP HL7 messages from the machines, parses them into JSON, and securely pushes them to the Ozzyl HMS Cloudflare backend over HTTPS.

## Prerequisites
- Node.js (v16+)
- A static IP on the computer running this agent if the lab machine requires destination IP routing.

## Installation

```bash
cd tools/hl7-agent
npm install
```

## Configuration

Create a `.env` file in this directory based on the `.env.example` (or just set the following environment variables):

```ini
TCP_PORT=2575
OZZYL_API_URL=https://api.hms.ozzyl.com/v1/tenant/lab/machine/receive
OZZYL_API_KEY=your_secret_api_key
```

## Running the Agent

```bash
npm start
```

## Note: New Middleware Available

A more comprehensive middleware is available at `tools/lab-middleware/` which supports both **ASTM** (Mindray, Beckman) and **HL7 MLLP** (Sysmex, Roche) protocols with machine-code-based routing to the new `/api/lab-machines/hl7/receive` and `/api/lab-machines/astm/receive` endpoints. Consider migrating to that for production use.

This legacy agent still works and POSTs to `/api/lab/machine/receive` (the original endpoint).

## How it works
1. **Lab Machine** completes a test.
2. Machine sends an **ORU_R01** HL7 message to `192.168.1.100:2575` (address of this script).
3. The script acknowledges (ACK) the packet so the machine knows it was received.
4. The script extracts `patientId`, `orderNo`, `barcode`, and specific test codes (e.g. `WBC`, `RBC`).
5. A JSON payload is POSTed to the Cloudflare Worker which securely updates the database.
