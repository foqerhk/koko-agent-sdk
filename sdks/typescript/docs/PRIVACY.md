# Privacy and sensitive screens

## Industry-sensitive steps in 1.2.2

Recovery import security checklists require personal review: security headings,
ownership/source/risk assertions and confirmation controls establish a consent
gate even with Continue disabled or missing native button/checkbox traits.
Missing traits require all three ownership/source/exposure-risk assertions and
an exact confirmation label. Users must
check only truthful statements. Enabling Continue does not clear the gate;
leaving the page and observing a safe state does. Ordinary articles and import
menus do not establish this checklist gate.

A handoff displays persistent instructions above the host and vibrates once.
The notice can minimize/expand without a full-screen touch barrier; chat also
shows the instructions and a return-to-app action. Polling and repeated checks
do not repeat the vibration. Haptics follow device settings; a simulator cannot
verify their physical feel. Android native builds merge VIBRATE from the SDK;
older native packages without that normal permission skip vibration safely.
The completion button only requests a local recheck; it never clears a host gate
or bypasses an active sensitive page.

Recovery/seed phrases are secrets at the same level as private keys. Recovery
display/input/verification, keystores, API credentials, recovery codes, payment
details and identity-verification pages stay local: no planning upload, OCR or
screenshot is returned. Host markers and explicit local gates remain required
for opaque/custom surfaces; never put secret values in labels, IDs or task text.

Actual Web3 signing, token/Permit/NFT approvals, transfer/swap/bridge/staking and
payment confirmations, recurring charges and account recovery/deletion require
the user to act. Public menus and educational copy remain navigable. A preflight
confirmation or `confirmation.mode: 'off'` does not bypass a detected local gate.
Use host gates such as `web3_signature`, `web3_authorization`,
`financial_transaction`, `account_change`, `account_secret`, `financial_data` and
`identity_data` before the actual request appears; clear them after it disappears.
The SDK does not intercept arbitrary dApp RPC or guarantee classification of
every custom/WebView surface. Bind gates to the real host request lifecycle.

A generic `ask_user` choice does not resume after a fixed 1.5-second delay. The
user must complete the choice, leave its page and request continuation. A check
cannot bypass a live private/approval request; blank transitions do not establish
completion.

The host is responsible for protecting credentials and other sensitive user data. Before a password, private authentication material, account-recovery data, import, backup, or verification screen is displayed, mark the containing surface with a stable `testID` such as `privacy-sensitive-recovery` or `privacy-sensitive-secret`. Use `secureTextEntry` for password fields. Never put secret values in labels, IDs, task text, screenshots, or logs.

For a sensitive flow, call `setAppUserGate` before content appears and `clearAppUserGate` only after the sensitive surface has been removed. Use a generic prompt that contains no secret. The user completes the step in the host app. See the [integration guide](INTEGRATION.md) for the API.

The SDK uses screen heuristics and client/server redaction as additional defenses, not as substitutes for host markers and gates. For ordinary planning, the SDK can send a redacted screen model, task text, and operation history to the configured gateway and its model provider. Do not assume that unmarked custom surfaces, WebViews, or an accessibility tree are automatically safe. Validate outgoing requests and logs using synthetic data before shipping.

Local OCR helps locate visible text; only selected goal-derived labels and explicitly allowlisted public provider names are eligible as planner hints. Provider capability checks stay local. A user must personally handle credentials, security authorizations, signatures, and other sensitive approvals. Never use production recovery data or private authentication material as test data.

Report suspected vulnerabilities privately as described in [SECURITY.md](https://github.com/foqerhk/koko-agent-sdk/blob/main/SECURITY.md).
