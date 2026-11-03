# Privacy and sensitive screens

The host is responsible for protecting credentials and other sensitive user data. Before a password, private authentication material, account-recovery data, import, backup, or verification screen is displayed, mark the containing surface with a stable `testID` such as `privacy-sensitive-recovery` or `privacy-sensitive-secret`. Use `secureTextEntry` for password fields. Never put secret values in labels, IDs, task text, screenshots, or logs.

For a sensitive flow, call `setAppUserGate` before content appears and `clearAppUserGate` only after the sensitive surface has been removed. Use a generic prompt that contains no secret. The user completes the step in the host app. See the [integration guide](INTEGRATION.md) for the API.

The SDK uses screen heuristics and client/server redaction as additional defenses, not as substitutes for host markers and gates. For ordinary planning, the SDK can send a redacted screen model, task text, and operation history to the configured gateway and its model provider. Do not assume that unmarked custom surfaces, WebViews, or an accessibility tree are automatically safe. Validate outgoing requests and logs using synthetic data before shipping.

Local OCR helps locate visible text; only selected goal-derived labels and explicitly allowlisted public provider names are eligible as planner hints. Provider capability checks stay local. A user must personally handle credentials, security authorizations, signatures, and other sensitive approvals. Never use production recovery data or private authentication material as test data.

Report suspected vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).
