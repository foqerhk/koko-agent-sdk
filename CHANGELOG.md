# Changelog

## 1.2.1 — 2026-11-16

- Restore overlay positioning on newer React Native versions that remove
  `StyleSheet.absoluteFillObject`, while retaining RN 0.76 compatibility.
- Support RN 0.88 native View ref and StatusBar stack types, and guard the
  removed Android status-bar background setter.
- Verify the candidate against SDK 1.2.0 and 1.1.3 over the existing v1 HTTP
  contracts; keep protocol version 1 and deployed minimum-version policies.

## 1.2.0 — First protocol-stable release

- Add explicit SDK version, protocol version, and capability headers.
- Add gateway compatibility discovery and typed HTTP 426 handling.
- Show a localized terminal “SDK too old; contact the app developer” message
  for normal retirement and emergency forced updates.
- Publish protocol v1 OpenAPI, compatibility schemas, rollout rules, and
  cross-version conformance scenarios.
