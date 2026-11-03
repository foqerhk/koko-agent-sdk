# Host-backend authentication demos

Production authentication uses three parties: the mobile app authenticates to its existing host backend; the host backend exchanges its server-only `clientId` and `clientSecret` with Koko; the app receives a 5–15 minute access token for the SDK.

Each `clientId` may optionally be restricted to exact host-backend egress IPs. Multiple IPv4/IPv6 addresses are comma-separated; omitting the allowlist leaves IP unrestricted. This is defense in depth and does not replace the client secret.

Creating an app in the Intent Computing console issues the `clientId` and one-time `clientSecret`. The Apps / Server credentials page manages IPs, status, and secret rotation; admins can also manage regions and review the audit trail. Only a secret hash is stored.

```text
Host app --host session--> Host backend --client secret--> Koko /v1/sdk/token
Host app <--short token--- Host backend <--short token---- Koko
Host app --short token-----------------------------------> Koko /v1/agent/*
```

## Rules

- Store `KOKO_CLIENT_SECRET` only in the host backend's secret manager or environment. Never return it to the app or place it in Git or logs.
- Protect and rate-limit the host `/koko/access-token` endpoint with the host's existing authentication.
- Derive `subject` on the server from the authenticated user. Send a stable pseudonymous value such as `HMAC-SHA256(hostUserId, separateSalt)`, never an email, phone number, domain-specific account identifier, or advertising ID.
- Use `https://sdk.intentcomputing.cn` for China and `https://sdk.intentcomputing.net` globally. Credentials and access tokens are region-bound.
- Koko returns `access_token`, `expires_in`, and `expires_at` (Unix seconds). Return `{ accessToken, expiresAt }` to the SDK, with `expiresAt` expressed in Unix milliseconds.
- Use a short timeout. Do not log authorization headers or response tokens. Rotate long-lived client secrets.

Complete, copyable examples for **Node.js/TypeScript (Express), Java (Spring Boot), Go, Python (FastAPI), PHP (Laravel), and C# (ASP.NET Core)** are maintained in the [Chinese guide](BACKEND_AUTH_DEMOS.zh-CN.md); all examples use standard HTTP Basic authentication for the server-to-server exchange and derive the subject from the host-authenticated user.

## React Native

```tsx
const tokenProvider = React.useCallback(async () => {
  const response = await hostApi.get('/koko/access-token');
  return response.data as { accessToken: string; expiresAt: number };
}, []);

<KokoProvider config={{
  gateway: {
    baseUrl: 'https://sdk.intentcomputing.net',
    tokenProvider,
  },
}}>{children}</KokoProvider>
```

Do not persist the access token in AsyncStorage or send it to logs/analytics. The SDK keeps it in memory, refreshes shortly before expiry, and clears it before one forced `tokenProvider` retry after a 401.
