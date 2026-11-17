# Koko Agent Protocol

This directory is the platform-neutral contract shared by every Koko Agent
SDK. Protocol version 1 is stable and independent from npm and gateway release
versions.

Layout:

- `openapi/koko-gateway-v1.yaml`: HTTP contract and compatibility headers.
- `schemas/compatibility-v1.schema.json`: capability and forced-upgrade payloads.

## Versioning rules

- `/v1` accepts additive optional request fields and may add response fields.
  Existing required fields cannot change meaning or type.
- A breaking request, response, authentication, or action change requires a
  new `/vN` namespace and a dual-service migration window.
- SDK package versions and gateway release versions use SemVer independently;
  `X-Koko-Protocol-Version` is the wire-contract major.
- New behavior is deployed server-first, advertised as a capability, and used
  by the SDK only after negotiation.
- Ordinary retirement uses the advertised minimum plus a measured adoption
  window. Emergency security retirement uses `force_update_below` and HTTP
  426; it also blocks unversioned legacy clients.
- A 426 response is terminal. SDKs must not retry it and must tell the user to
  contact the app developer.

The React Native SDK is the reference implementation. Other platform SDKs must
depend on this protocol rather than npm package internals.

## Release verification

Candidate SDK 1.2.2 changes optional Android OCR loading and local privacy/manual
handoff without changing the `/v1` wire contract, required fields,
authentication flow or action meanings. Its N/N-1/N-2 release
matrix uses actual SDK 1.2.2, 1.2.1 and 1.2.0 clients over loopback HTTP against
the existing v1 endpoint set and the protocol-aware v1 middleware/handler set.

The protocol-aware profile verifies additive discovery metadata and terminal
426 handling; the legacy profile confirms that optional discovery is not a
new prerequisite for session execution. This matrix does not require enabling
minimum-version enforcement or emergency force-update switches in production.
Do not raise those thresholds for this compatibility patch.

The persistent takeover notice, one-time vibration and recovery-security
assertion detection are local behavior. A disabled confirmation button still
requires personal review; checking status never counts as accepting assertions.
These changes add no required gateway fields or new `/v1` action semantics.

## 2026-11-17 gateway hotfix

The continuation/privacy hotfix uses existing protocol-1 `ask_user` responses,
session IDs and execution permits. Private-page observations hand off before
provider inference or billing, with an observation-only permit. No required
request/response fields, SDK source or version thresholds change. This preserves
the transport contract; client-side upload prevention and reliable local waiting
remain SDK responsibilities.
