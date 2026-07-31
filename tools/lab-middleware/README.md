# Ozzyl Lab Middleware

Local bridge for hospital analyzers. It receives ASTM LIS2-A2 and HL7 MLLP messages inside the hospital LAN, durably queues retryable deliveries, and forwards signed requests to Ozzyl HMS.

## Production setup checklist

1. Copy the example config.

   ```bash
   cp config.example.json config.json
   ```

2. Configure signed bridge authentication.

   - `api.baseUrl`: hospital HMS URL.
   - `api.keyId`: the server-configured bridge key identifier.
   - `api.signingSecret`: the HMAC secret for that key. Prefer `LIS_BRIDGE_SIGNING_SECRET` so it is not stored in `config.json`.
   - The server uses `LIS_BRIDGE_KEYS_JSON` to define tenant, audit user, expiry/revocation, and optional machine scope.
   - Each request includes a timestamp, nonce, stable delivery ID, exact body SHA-256, and HMAC-SHA256 signature.

3. Configure the encrypted retry queue.

   - Set `LIS_BRIDGE_QUEUE_ENCRYPTION_KEY` or `queue.encryptionKey`.
   - Queue files use AES-256-GCM and atomic fsync/rename writes.
   - ASTM frames are encrypted and fsync-journaled before the bridge sends a positive frame ACK.
   - Completed ASTM journals are removed only after API acceptance or durable queueing; permanent rejections remain for reconciliation.
   - Retry preserves the delivery ID but signs each attempt with a fresh nonce and timestamp.
   - Corrupted queue files are quarantined with a `.corrupt.*.json` suffix and are never retried as clinical data.

4. Configure analyzer protocols.

   - ASTM default port: `9100`.
   - HL7 MLLP default port: `2575`.
   - Add analyzer IP addresses and matching `machineCode` values from HMS Lab Machine Settings.

5. Configure heartbeat and monitoring.

   The bridge posts to `/api/lab-machines/bridge-agents/heartbeat` on startup and every `agent.heartbeatIntervalMs`. Queue depth above zero reports a degraded status. Terminal queue failures and corrupt files require operator review.

6. Choose HL7 acknowledgement policy.

   - `always_ack_after_queue` acknowledges only after the API accepts the message or the encrypted local queue has durably stored it.
   - `ack_only_after_api_success` returns an error acknowledgement for queued transient failures so the analyzer may resend.
   - Permanent client/auth/config errors return rejection acknowledgement.

7. Keep raw clinical message logging disabled.

   `logging.rawMessages` and `LIS_BRIDGE_RAW_MESSAGE_LOGGING` default to `false`. Enable only for a time-bounded investigation with approved access, encrypted storage, and a retention plan.

## Required server-side settings

Store the per-key JSON map as a Worker secret:

```bash
wrangler secret put LIS_BRIDGE_KEYS_JSON
```

Example shape:

```json
{
  "main-lab-bridge": {
    "secret": "[REDACTED_SECRET]",
    "tenantId": "hospital-tenant-id",
    "userId": "42",
    "allowedMachineIds": [7, 8],
    "revoked": false
  }
}
```

Disable the legacy shared-key path after bridge rollout:

```text
LIS_BRIDGE_ALLOW_LEGACY_KEY=false
```

The old `LIS_BRIDGE_API_KEY` path remains only as a temporary compatibility option. Do not use it for new installations.

## Useful environment variables

```bash
API_BASE_URL=https://hospital.example.com
LIS_BRIDGE_KEY_ID=main-lab-bridge
LIS_BRIDGE_SIGNING_SECRET=<set-outside-git>
LIS_BRIDGE_QUEUE_ENCRYPTION_KEY=<set-outside-git>
LIS_HL7_ACK_MODE=always_ack_after_queue
LIS_BRIDGE_QUEUE_DIR=./queue
LIS_BRIDGE_JOURNAL_DIR=./journal
LIS_BRIDGE_RETRY_INTERVAL_MS=30000
LIS_BRIDGE_HEARTBEAT_INTERVAL_MS=60000
LIS_BRIDGE_RAW_MESSAGE_LOGGING=false
LIS_BRIDGE_AGENT_CODE=local-lis-bridge-main
LIS_BRIDGE_AGENT_NAME="Main Lab Bridge"
LIS_BRIDGE_SITE_NAME="Hospital Main Lab"
LIS_BRIDGE_VERSION=1.1.0
```

## Operational notes

- Put the queue directory on persistent encrypted local storage, not a temporary folder.
- Restrict the bridge service account and queue/log directories to the bridge process and authorized administrators.
- Monitor queue depth, terminal failures, corrupt queue files, analyzer heartbeat, QC blocks, unmatched/ambiguous results, and overdue critical acknowledgements.
- Restart the bridge after key rotation, machine scope, analyzer IP, or machine-code changes.
- Do not enable automatic result publication. Analyzer results must pass exact matching, QC, validation, and authorized acceptance.
