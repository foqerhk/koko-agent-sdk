# Cross-platform Conformance Tests

This directory holds behavior contracts that every SDK must pass. Tests
should describe observable behavior rather than one platform's implementation.

Required coverage includes:

- authentication and token refresh;
- capability negotiation and unsupported-feature handling;
- screen-model normalization and privacy redaction;
- task execution, confirmation, cancellation, and error mapping;
- host reload/background recovery;
- locale and accessibility behavior.

`fixtures/compatibility-v1.json` is the portable version-policy matrix. SDK
and gateway test suites must consume equivalent scenarios before release.

`scenarios/` is reserved for portable test cases and `fixtures/` for sanitized
inputs and expected outputs.
