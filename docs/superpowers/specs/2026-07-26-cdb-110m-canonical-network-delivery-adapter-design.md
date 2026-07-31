# CDB-110M Canonical Network Delivery Adapter Contract Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-26

**Scope:** framework-neutral, digest-bound canonical network delivery sender/receiver contract verified through an injected in-memory exchange, without credentials, network requests, route registration, runtime registration, or activation

## Context

CDB-110L provides an application-facing local outbox consumer connection, but its delivery dependency is still an abstract `CanonicalSyncDeliveryPort`. The database delivery port proves same-process target convergence. A future local-to-cloud runtime needs a transport adapter that preserves the same delivery request/result contract across a network boundary.

The repository's existing `/api/sync/outbox/flush`, `/api/sync/ingest`, and shell sync worker use legacy generic entity IDs and snapshot-era payloads. They are not compatible with canonical public-ID envelopes and must not be reused or modified.

## Goal

Create a typed sender/receiver wire contract around `CanonicalSyncDeliveryPort` that:

- serializes one exact canonical delivery request;
- binds the body to a lowercase SHA-256 request digest;
- delegates transport execution to an injected exchange port;
- validates the exact response digest and delivery result;
- provides a framework-neutral receiver handler that delegates to an existing target delivery port;
- can be proven end-to-end with an in-memory exchange and real source/target databases.

## Non-goals

- no built-in `fetch` or other network client;
- no Hono route or middleware;
- no Worker, scheduler, startup hook, shell worker, timer, or loop;
- no authorization header, token, secret, certificate, or credential lookup;
- no environment-variable or process access;
- no retry policy beyond the existing orchestrator/source lifecycle;
- no compression, streaming, batching, or multi-event request;
- no production access, request, mutation, deployment, or activation;
- no readiness promotion to runtime-connected;
- no legacy-write retirement.

## Selected architecture

Add `src/lib/canonical/local-sync-network-delivery.ts` with three boundaries:

1. `CanonicalSyncNetworkExchangePort` — injected transport executor;
2. `createCanonicalSyncNetworkDeliveryPort()` — sender-side `CanonicalSyncDeliveryPort` adapter;
3. `handleCanonicalSyncNetworkDeliveryExchange()` — framework-neutral receiver handler.

The module itself performs no I/O. Tests connect sender and receiver with an in-memory exchange function.

## Protocol version

```text
canonical network delivery protocol: 1
```

Required request headers:

```text
content-type: application/json
x-canonical-sync-protocol: 1
x-canonical-sync-request-sha256: <64 lowercase hex>
```

Required response headers are identical and echo the request digest.

## Sender exchange request

```ts
interface CanonicalSyncNetworkExchangeRequest {
  method: 'POST';
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}
```

The body is stable canonical JSON:

```json
{
  "protocolVersion": 1,
  "requestSha256": "<digest of deliveryRequest>",
  "deliveryRequest": { "...": "CanonicalSyncDeliveryRequest" }
}
```

The digest is calculated over the delivery request object, not over the wrapper, avoiding a circular digest.

## Exchange response

```ts
interface CanonicalSyncNetworkExchangeResponse {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}
```

A successful protocol exchange uses status `200` and stable canonical JSON:

```json
{
  "protocolVersion": 1,
  "requestSha256": "<echoed request digest>",
  "result": { "...": "CanonicalSyncDeliveryResult" }
}
```

Target business outcomes such as `retry`, `dead_letter`, and `busy` remain delivery results inside a successful protocol response. Non-200 responses are transport/protocol failures and are handled by the existing source orchestrator failure policy.

## Endpoint policy

The sender factory accepts one exact endpoint and rejects configuration unless:

- it is an absolute URL;
- the scheme is `https:`;
- username and password are absent;
- query and fragment are absent;
- host and non-root pathname are present;
- surrounding whitespace is absent.

This design intentionally does not add a localhost or insecure HTTP exception. Test exchanges do not open the endpoint.

## Request validation

Export the existing database-delivery request validator as:

```ts
validateCanonicalSyncDeliveryRequest(request)
```

Both sender and receiver validate:

- canonical envelope validity;
- target claim identities and timestamps;
- deterministic timeline ordering;
- positive target maximum attempts.

The receiver additionally validates exact wrapper keys, request header/body digest equality, protocol version, body size, and stable request digest before calling the target delivery port.

## Result validation

The sender and receiver validate the delivery-result discriminated union:

- `applied` requires exact event ID, positive attempt count, and boolean replay flag;
- `retry` and `busy` require exact event ID, positive attempt count, UTC retry time, stable error code, and lowercase digest;
- `dead_letter` requires exact event ID, positive attempt count, stable error code, and lowercase digest;
- `busy` requires `CANONICAL_SYNC_TARGET_BUSY`;
- response event ID must equal the request envelope event ID;
- unknown or extra result fields fail closed.

## Body limits

Request and response bodies are bounded at 2 MiB UTF-8 length. Empty, oversized, malformed, non-object, or extra-key wrappers fail before target delivery or sender result acceptance.

## Error contract

Protocol errors expose stable uppercase codes through a dedicated error class:

```text
CANONICAL_SYNC_NETWORK_CONFIG
CANONICAL_SYNC_NETWORK_REQUEST
CANONICAL_SYNC_NETWORK_HTTP_STATUS
CANONICAL_SYNC_NETWORK_RESPONSE
CANONICAL_SYNC_NETWORK_PROTOCOL
```

The existing orchestrator converts thrown adapter errors into source retry/dead-letter evidence under its transport-failure boundary.

## Receiver handler

`handleCanonicalSyncNetworkDeliveryExchange(targetPort, exchangeRequest)`:

1. validates the exchange request and body;
2. verifies request digest and canonical delivery request;
3. calls `targetPort.deliver()` exactly once;
4. validates the result against the event identity;
5. returns a status-200 digest-bound response.

The handler has no framework types and does not read headers from a real request object. A future route adapter must be a separate authorization-gated scope.

## Runtime isolation

Static tests must prove:

- no application route, Worker entry point, startup module, scheduler, local-server loop, or shell script imports the network module;
- the module contains no `fetch`, Hono, process/environment access, filesystem access, HTTP/TLS/socket import, timer, wall-clock, random ID, or loop primitive;
- existing legacy sync route and shell worker remain unchanged and contain no canonical network adapter reference.

## Readiness model

Extend protocol foundation metadata with:

```json
{
  "networkDeliveryAdapterContractStatus": "verified_offline",
  "networkDeliveryAdapterModule": "src/lib/canonical/local-sync-network-delivery.ts",
  "networkDeliveryAdapterTest": "test/canonical/canonical-sync-network-delivery.test.ts",
  "networkDeliveryAdapterRuntimeIsolationTest": "test/canonical/canonical-sync-network-delivery-runtime-isolation.test.ts"
}
```

Do not change:

```text
runtimeConsumptionConnected: false
businessApplyConnected: false
localCanonicalOutboxConsumption: false
ready entity count: 0
blocked entity count: 8
```

A verified wire contract is not an active network transport.

## Testing

Focused tests cover:

- endpoint and exchange dependency validation;
- deterministic sender request serialization and headers;
- receiver request/digest validation before target invocation;
- exact delivery-result round trip for applied/retry/dead-letter/busy;
- non-200 and malformed/tampered response rejection;
- request tampering and oversized body rejection;
- event-identity mismatch rejection;
- real source consumer → sender adapter → in-memory exchange → receiver handler → target database convergence;
- source publication and target replay behavior;
- runtime isolation;
- readiness metadata while 0/8 ready remains unchanged.

## Acceptance criteria

CDB-110M is complete when:

1. sender/receiver network contract is TypeScript-clean;
2. no built-in network or credential primitive exists;
3. strict protocol/tamper tests pass;
4. real two-node in-memory exchange convergence passes;
5. runtime-isolation evidence passes;
6. readiness records `verified_offline` while runtime connection remains false;
7. full canonical, governance, retirement, migration, and build gates pass;
8. tracker and verification receipts identify the next authorization-gated authentication/runtime scope.

## Safety

No push, deployment, production access, production mutation, credential use, network request, route registration, Worker/scheduler/startup registration, local-server enablement, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration is authorized by this design.
