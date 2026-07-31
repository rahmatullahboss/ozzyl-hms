# Cloud-only Browser Offline Mode Plan

Scope: hospitals that use the cloud app directly and do not run the LAN local-server stack.

Do not change the LAN local-server or server-to-server sync system.

Goal: keep the browser or PWA usable during internet loss by storing selected critical work locally in encrypted IndexedDB, then replaying it safely when the internet returns.

## Best-practice summary

- Service worker caches only the app shell and static files.
- Authenticated API responses are not cached in Cache Storage because shared hospital computers make that unsafe.
- Transactional writes are stored in encrypted IndexedDB.
- Every queued write has an idempotency key.
- Replay uses the tenant, user, workstation, and session context captured when the work was queued.
- UI must show pending, syncing, failed, review-needed, and synced states.

## Architecture

React mutation calls the normal cloud API when online. If the request fails because the browser is offline and the flow explicitly allows offline mode, the app saves an encrypted outbox row in IndexedDB and marks the local draft as pending sync. When the browser becomes online again, the sync engine replays rows in FIFO order with the original context and idempotency key.

## First-phase supported flows

Enable only flows that can safely produce a local draft and can wait for final cloud IDs: registration draft, OPD or diagnostic draft, receipt draft tied to a local reference, lab order draft tied to a local reference, and basic cash drawer transaction draft.

Do not enable offline mode yet for final settlement, cancellation, return, stock decrement, payout finalization, bank deposit, user settings, permission settings, or any flow requiring a real-time global sequence.

## Offline reference numbers

Offline work should use a temporary local reference made from tenant, workstation, date, and a local sequence. The cloud API assigns the final number after successful sync. Printed offline copies must clearly show that cloud sync is pending.

## Browser outbox payload

Each encrypted queue payload should include method, URL, body, module name, local reference, idempotency key, original tenant id, original user id, original workstation id, original session id when available, and created timestamp.

## Sync behavior

- Process FIFO while online and authenticated.
- Remove the exact IndexedDB row on success.
- Increment the exact row attempt counter on failure.
- Stop the current cycle on network loss.
- Mark conflict or validation responses for manual review instead of endless retry.
- Mark repeated failures as requiring admin review after a capped number of attempts.

## Security and operations

- Encrypt offline rows with the secure-store AES-GCM envelope.
- Tenant guard must reject rows from another tenant.
- Warn on logout when unsynced rows exist.
- Hospital onboarding must instruct staff not to clear browser data while pending sync exists.
- Private or incognito mode is unsupported for offline billing.

## Rollout plan

1. Fix the browser sync foundation and tests.
2. Add a read-only sync status bar and admin pending-sync view.
3. Enable registration drafts.
4. Enable draft receipts with temporary offline references.
5. Add manual review and admin retry UI.
6. Harden cloud endpoints with per-tenant idempotency uniqueness for every offline-enabled flow.
