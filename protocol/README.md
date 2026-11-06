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
