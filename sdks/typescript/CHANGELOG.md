# Changelog

## 1.2.2 — 2026-11-17

- Manual takeover: persistent top instructions with minimize/expand, a local
  completion check and stop; keep the instructions visible in chat history too.
  Notify once per handoff with vibration and a screen-reader announcement.
- Recovery import: recognize public ownership/source/risk assertion checklists
  even when Continue is disabled and checkbox traits are missing. Require the
  user to verify each statement; never check or accept these assertions for them.
- Android: isolate optional ML Kit OCR types from the RN bridge module so module
  discovery works with no OCR runtime, Latin-only or Chinese OCR installations.
  Keep the lazy OCR backend under R8 and release recognition resources.
- Privacy: intercept Chinese/English recovery phrase titles, unmasked recovery
  fields, partial word grids, keystores/API credentials, financial details and
  identity-verification pages locally before network, screenshots or OCR.
- Industry-sensitive steps: hand off actual Web3 signing/approvals, transaction
  and payment confirmations, and account/security changes. Ordinary navigation
  and education remain available; hosts can register explicit local gates.
- Local waiting: elapsed time or a status check cannot bypass an unchanged
  user-choice page or an active sensitive request. Verify a readable safe state
  before resuming, and discard capture results if the page became private.
- Protocol v1 and existing gateways remain compatible; no minimum SDK or
  emergency-update threshold change. DeviceHub iPhone 17 Pro Max acceptance
  covers Chinese host-language synchronization and real recovery-consent
  handoff, local checks, one-time vibration, resumption and cancellation.

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
