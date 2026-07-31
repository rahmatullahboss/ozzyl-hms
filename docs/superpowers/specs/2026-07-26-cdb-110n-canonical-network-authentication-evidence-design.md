# CDB-110N Canonical Network Authentication Evidence Contract Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-26

**Scope:** credential-free, algorithm-neutral authentication evidence around the CDB-110M canonical network exchange, verified offline with injected signer, verifier, timestamp/nonce provider, and replay-evidence store

## Context

CDB-110M proves a strict digest-bound request/response wire contract, but request digests provide integrity only after transport receipt. They do not establish which node created the request or prevent an unauthorized caller from constructing a valid protocol body.

A production network connection will eventually need:

- sender identity by key ID;
- signature verification;
- explicit freshness policy;
- nonce replay protection;
- exact replay support for response-loss recovery;
- key rotation and credential provisioning outside canonical business logic.

CDB-110N defines and verifies that contract without reading, creating, persisting, or using any real credential.

## Goal

Wrap the existing `CanonicalSyncNetworkExchangePort` with authentication evidence that:

1. binds method, endpoint, protocol version, key ID, signed timestamp, nonce, request digest, and event identity into one canonical signing message;
2. obtains evidence values from an injected provider;
3. obtains a signature from an injected signer;
4. verifies signatures through an injected verifier before target delivery;
5. reserves nonce evidence through an injected replay store;
6. allows exact same-key/nonce/digest replay;
7. rejects same-key/nonce collisions with different request identity;
8. performs no secret, environment, clock, random, filesystem, network, route, or runtime access itself.

## Non-goals

- no HMAC, Ed25519, RSA, WebCrypto, or Node crypto implementation;
- no secret/key material in function arguments, source, tests, configuration, or docs;
- no environment-variable or secret-store lookup;
- no key generation, provisioning, rotation, revocation, or distribution;
- no persistent replay table or migration;
- no Hono route, middleware, Worker, scheduler, startup hook, shell worker, timer, or loop;
- no real network request;
- no runtime registration or synchronization activation;
- no production access or mutation;
- no readiness promotion to connected/ready;
- no legacy-write retirement.

## Selected architecture

Add `src/lib/canonical/local-sync-network-auth.ts` with:

1. `CanonicalSyncAuthenticationEvidenceProvider` — supplies deterministic public evidence only;
2. `CanonicalSyncAuthenticationSignerPort` — signs canonical material without exposing credentials;
3. `CanonicalSyncAuthenticationVerifierPort` — verifies canonical material without exposing credentials;
4. `CanonicalSyncAuthenticationReplayStore` — reserves key/nonce/request identity and classifies exact replay vs conflict;
5. `createCanonicalSyncAuthenticatedNetworkExchangePort()` — sender wrapper around an existing exchange port;
6. `handleCanonicalSyncAuthenticatedNetworkExchange()` — receiver verification wrapper around the CDB-110M receiver handler or any injected authenticated target handler.

The authentication module performs no I/O. Offline tests use deterministic fake ports and an in-memory replay store.

## Authentication headers

The authenticated wrapper adds exactly:

```text
x-canonical-sync-auth-version: 1
x-canonical-sync-key-id: <stable public key ID>
x-canonical-sync-signed-at: <ISO-8601 UTC>
x-canonical-sync-nonce: <stable public nonce ID>
x-canonical-sync-signature: <base64url signature>
```

CDB-110M headers remain unchanged:

```text
content-type
x-canonical-sync-protocol
x-canonical-sync-request-sha256
```

The receiver rejects missing, duplicate/ambiguous, unexpected, malformed, or extra headers.

## Evidence provider

```ts
interface CanonicalSyncAuthenticationEvidenceProvider {
  provide(input: {
    endpoint: string;
    requestSha256: string;
    eventPublicId: string;
  }): Promise<{
    keyId: string;
    signedAtUtc: string;
    noncePublicId: string;
  }>;
}
```

The provider owns clock and nonce generation. The authentication module only validates returned public evidence.

## Signer and verifier ports

```ts
interface CanonicalSyncAuthenticationSignerPort {
  sign(input: {
    keyId: string;
    canonicalMessage: string;
  }): Promise<string>;
}

interface CanonicalSyncAuthenticationVerifierPort {
  verify(input: {
    keyId: string;
    canonicalMessage: string;
    signature: string;
  }): Promise<boolean>;
}
```

No key or secret value crosses the canonical contract.

## Canonical signing message

The exact newline-delimited message is:

```text
CANONICAL-SYNC-AUTH-V1
POST
<exact HTTPS endpoint>
1
<key ID>
<signed-at UTC>
<nonce public ID>
<request SHA-256>
<event public ID>
```

Every component is validated before signing or verification. The endpoint is the exact endpoint already validated by CDB-110M and contains no credentials, query, or fragment.

## Signature format

The signature is opaque base64url without padding:

```text
[A-Za-z0-9_-]{43,684}
```

The authentication layer does not infer an algorithm from signature length. Algorithm selection and key lookup remain inside signer/verifier implementations.

## Receiver input and freshness

The receiver accepts explicit policy input:

```ts
acceptedAtUtc: string
maxClockSkewSeconds: number
```

It performs no wall-clock lookup.

The signed timestamp must be within the inclusive range:

```text
acceptedAtUtc - maxClockSkewSeconds
through
acceptedAtUtc + maxClockSkewSeconds
```

The skew must be a safe integer from 1 through 900 seconds.

## Replay evidence store

```ts
interface CanonicalSyncAuthenticationReplayStore {
  reserve(input: {
    keyId: string;
    noncePublicId: string;
    requestSha256: string;
    eventPublicId: string;
    signedAtUtc: string;
    acceptedAtUtc: string;
  }): Promise<'reserved' | 'exact_replay' | 'conflict'>;
}
```

Receiver order:

1. validate wire/auth headers and canonical message;
2. validate freshness;
3. verify signature;
4. reserve replay evidence;
5. reject `conflict`;
6. allow `reserved` or `exact_replay` to invoke the idempotent target handler exactly once for the current request.

The replay store is called only after successful signature verification. A future persistent store must atomically enforce unique `(key_id, nonce_public_id)` with exact request identity evidence.

## Authentication result evidence

The receiver returns the normal CDB-110M response plus exact authentication response headers:

```text
x-canonical-sync-auth-version: 1
x-canonical-sync-key-id: <verified key ID>
x-canonical-sync-nonce: <verified nonce>
x-canonical-sync-auth-replay: reserved|exact_replay
```

The sender validates these response headers against its request evidence. This is receipt evidence, not a response signature. Response authentication/attestation remains a separate optional scope if required.

## Errors

A dedicated error class exposes stable codes:

```text
CANONICAL_SYNC_AUTH_CONFIG
CANONICAL_SYNC_AUTH_EVIDENCE
CANONICAL_SYNC_AUTH_FRESHNESS
CANONICAL_SYNC_AUTH_SIGNATURE
CANONICAL_SYNC_AUTH_REPLAY
CANONICAL_SYNC_AUTH_RESPONSE
```

Thrown authentication errors are converted by the existing orchestrator into source transport retry/dead-letter evidence according to existing attempt policy.

## Runtime isolation

Static tests must prove:

- no route, middleware, Worker/startup module, scheduler, local-server loop, or shell script imports the auth module;
- the module contains no crypto implementation, key/secret value, `fetch`, Hono, process/environment access, filesystem access, network import, timer, wall clock, random ID, or loop primitive;
- existing LIS and schema-sync authentication implementations are not imported or modified;
- existing legacy sync route and shell worker remain unchanged.

## Readiness model

Extend protocol foundation metadata with:

```json
{
  "networkAuthenticationEvidenceContractStatus": "verified_offline",
  "networkAuthenticationEvidenceModule": "src/lib/canonical/local-sync-network-auth.ts",
  "networkAuthenticationEvidenceTest": "test/canonical/canonical-sync-network-auth.test.ts",
  "networkAuthenticationEvidenceRuntimeIsolationTest": "test/canonical/canonical-sync-network-auth-runtime-isolation.test.ts"
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

A verified credential-free contract is not provisioned authentication or an active transport.

## Testing

Focused tests cover:

- evidence provider/signer/verifier/replay-store dependency validation;
- canonical message determinism;
- exact authenticated header construction;
- key ID, timestamp, nonce, digest, event, and signature tampering;
- stale and future timestamp rejection;
- invalid signature rejection before replay reservation and target invocation;
- replay `reserved`, `exact_replay`, and `conflict` behavior;
- authenticated response header validation;
- full local consumer → network sender → auth sender wrapper → in-memory auth receiver → network receiver → target DB convergence;
- exact authenticated replay after simulated response loss;
- runtime isolation;
- readiness metadata while 0/8 ready remains unchanged.

## Acceptance criteria

CDB-110N is complete when:

1. the credential-free authentication module is TypeScript-clean;
2. no secret, crypto implementation, runtime, or network primitive exists in the module;
3. signature/freshness/replay/tamper tests pass;
4. authenticated in-memory source-to-target convergence and exact replay pass;
5. runtime-isolation evidence passes;
6. readiness records `verified_offline` while runtime connection remains false;
7. full canonical, governance, retirement, migration, and build gates pass;
8. tracker and verification receipts identify credential provisioning/runtime registration as authorization-gated work.

## Safety

No push, deployment, production access, production mutation, secret access, key generation, credential provisioning, crypto key use, network request, route/middleware registration, Worker/scheduler/startup registration, local-server enablement, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration is authorized by this design.
