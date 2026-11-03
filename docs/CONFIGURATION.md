# Complete SDK configuration reference

> 中文版：[CONFIGURATION.zh-CN.md](./CONFIGURATION.zh-CN.md)

This reference covers the public host configuration surfaces: `KokoProvider`, `KokoAgentConfig`, runtime appearance, per-run overrides, and built-in UI components. The exported TypeScript types remain the source of truth.

## Complete example

```tsx
import React from 'react';
import { KokoProvider } from '@intentcomputing/koko-agent-sdk';

export function App() {
  const tokenProvider = React.useCallback(async () => {
    const response = await hostApi.get('/koko/access-token');
    return response.data as { accessToken: string; expiresAt: number };
  }, []);

  return (
    <KokoProvider
      cursor
      observer
      dialogs
      resumeAfterReload
      config={{
        gateway: {
          baseUrl: 'https://sdk.intentcomputing.net',
          tokenProvider,
          // appId normally comes from the native Bundle ID / Package Name.
        },
        locale: 'en',
        theme: 'light', // The host theme; Koko chrome uses the contrasting theme.
        branding: {
          name: 'My Assistant',
          tagline: 'Control this app with natural language',
          placeholder: 'Tell me what you want to do…',
          primaryColor: '#6D4AFF',
          icon: require('./assistant.png'),
        },
        confirmation: { requireUserConfirm: true, mode: 'preflight' },
        webWalletAliases: ['My Provider'],
        dumpMaxDepth: 80,
        dumpSkipInvisible: true,
        cursorDurationMs: 480,
        observer: true,
        debug: false,
        onUsageEvent: event => analytics.track('koko_usage', event),
      }}
    >
      <HostNavigation />
    </KokoProvider>
  );
}
```

## `KokoProvider` props

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `children` | `ReactNode` | Required | Host app or outer navigation tree. |
| `config` | `KokoAgentConfig` | `{}` | Agent, gateway, branding, and confirmation configuration. |
| `cursor` | `boolean` | `true` | Show the observable action cursor. |
| `observer` | `boolean` | Inherits `config.observer` | Mount progress and chat UI; an explicit prop wins. |
| `dialogs` | `boolean` | `true` | Mount built-in confirm and ask-user dialogs. Provide host callbacks if disabled. |
| `resumeAfterReload` | `boolean` | `true` | Resume one recent goal after a JS-context reload caused by host locale/theme changes. |
| `remoteSmokePort` | `number` | `0` | Local development smoke-driver port. Never enable in production. |
| `composerPlaceholder` | `string` | — | Deprecated; use `config.branding.placeholder`. |

`KokoProvider observer={false}` hides built-in progress/chat UI only. `config.observer={false}` also disables automatic task logging. Keep both enabled for the complete built-in experience.

## `KokoAgentConfig`

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `gateway` | `GatewayConfig` | — | Gateway and short-token configuration required for production runs. |
| `locale` | `'zh' \| 'en'` | `'en'` | Initial built-in UI language. Prefer `setKokoAppearance` for runtime changes. |
| `theme` | `'light' \| 'dark'` | `'light'` | The **host app's** current theme; Koko chrome uses the opposite theme for contrast. |
| `branding` | `KokoBrandingConfig` | Koko defaults | Custom name, icon, copy, and accent; requires the `custom_branding` entitlement. |
| `confirmation` | `ConfirmationPolicy` | Confirm, `preflight` | Human confirmation policy for high-risk goals. |
| `onConfirmSensitive` | `(ctx) => Promise<boolean>` | Built-in dialog | Custom sensitive-action confirmation. Return `true` to proceed. |
| `webWalletAliases` | `string[]` | `[]` | Specialized compatibility option for verified host-supplied web-provider labels; ordinary apps should leave it empty. |
| `dumpMaxDepth` | `number` | `80` | Maximum native accessibility-tree depth. Small values can truncate RN navigation wrappers. |
| `dumpSkipInvisible` | `boolean` | `true` | Drop invisible nodes from observations. |
| `cursorDurationMs` | `number` | `480` | Default cursor animation duration in milliseconds. |
| `observer` | `boolean` | `true` | Enable task logs and, unless overridden by the Provider prop, built-in progress/chat UI. |
| `debug` | `boolean` | `true` in Metro Debug; `false` in Release | Capability and execution logs only; it never relaxes security. Set `false` explicitly in production. |
| `devMode` | `boolean` | Same as `debug` | Deprecated alias for `debug`. |
| `onUsageEvent` | `(event) => void` | — | Non-blocking local analytics/UX notifications; not authoritative for billing. |

### `gateway`

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `baseUrl` | `string` | `https://sdk.intentcomputing.net` | Global/OpenAI gateway. Use `https://sdk.intentcomputing.cn` for China/DeepSeek. Release builds accept official hosts only. |
| `tokenProvider` | `() => Promise<string \| { accessToken; expiresAt? }>` | — | Recommended. Fetches a short token from the **host backend**. The SDK caches it in memory, refreshes lazily on a request near expiry, and refreshes/retries once after a 401. |
| `token` | `string` | — | Deprecated static token for development only. Never ship it in production. |
| `appId` | `string` | Native Bundle ID / Package Name | Must match the registered host app; normally no explicit value is needed. |

`expiresAt` is Unix time in **milliseconds**. If omitted, the SDK reads JWT `exp`; if neither exists, it assumes 60 seconds. Never place `clientSecret` or DeepSeek/OpenAI keys in the app.

### `branding`

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `name` | `string` | `Koko` | Assistant display name. |
| `icon` | `number \| { uri: string } \| string` | K mark | Accepts `require()`, an image/Data URI, or a short text mark. |
| `tagline` | `string` | Localized default | Chat header subtitle. |
| `placeholder` | `string` | Localized default | Composer placeholder. |
| `primaryColor` | `string` | SDK accent | Badge and send-button accent using a React Native color string. |

Without the entitlement, the SDK falls back to Koko defaults and emits one `branding_downgraded` usage event.

### `confirmation`

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `requireUserConfirm` | `boolean` | `true` | Require confirmation for high-risk goals. |
| `mode` | `'preflight' \| 'inline' \| 'off'` | `'preflight'` | Confirm once before a run, use deprecated inline checks, or disable SDK confirmation. |
| `sensitivePatterns` | `RegExp[]` | Built-in patterns | Custom high-risk goal rules. A non-empty array replaces the defaults. |

Disabling confirmation does not bypass local password, account-recovery, private-authentication-material, or OTP gates. The user must still complete those surfaces personally.

### `onUsageEvent` events

Events are `task_started`, `task_finished`, `agent_step`, `quota_exceeded`, `sheet_opened`, `sheet_closed`, and `branding_downgraded`. Do not forward goal text to an analytics provider without user authorization.

## Runtime locale and theme

```tsx
import { setKokoAppearance } from '@intentcomputing/koko-agent-sdk';

useEffect(() => {
  setKokoAppearance({ locale: hostLocale, theme: hostTheme });
}, [hostLocale, hostTheme]);
```

- Locale strings beginning with `zh` map to Chinese; all others currently map to English.
- Theme is the host's actual `'light'` or `'dark'` theme.
- Runtime appearance takes precedence over static `config.locale` and `config.theme`.

`getKokoAgent().configure(patch)` updates configuration at runtime, but performs a shallow merge. Pass complete `gateway`, `branding`, or `confirmation` sub-objects when changing them. Prefer `setKokoAppearance` for locale/theme.

## Per-run overrides

```tsx
await getKokoAgent().runGoal('Open settings', {
  locale: 'en-US',
  localRetries: 3,
  userGateTimeoutMs: 300_000,
  onAskUser: question => showHostQuestion(question),
  onNarration: text => setHint(text),
});
```

| Option | Default | Purpose |
|---|---:|---|
| `baseUrl` / `tokenProvider` / `token` / `appId` | Inherit `config.gateway` | Override the gateway for this run only. |
| `locale` | Effective current locale | Planner request locale for this run. |
| `localRetries` | `3` | Retry count `0–3` for read-only `dump/find` failures. Touches and typing are never automatically replayed. |
| `userGateTimeoutMs` | `300000` | Maximum wait for the user to finish a password/recovery/authorization gate. |
| `onAskUser` | Built-in ask dialog | Host callback when the agent needs more information. |
| `onNarration` | — | Receives current task narration. |

`resumedFromReload` and `resumes` are SDK-internal recovery fields; hosts should not set them.

## Built-in UI component props

| Component | Options |
|---|---|
| `KokoEntryButton` | `label` (default `Koko`) and `style`. Production hosts should normally draw their own entry and call `openKokoChat()`. |
| `KokoComposer` | `placeholder` and `disabled` (default `false`). |
| `KokoObserver` | `cursor` (default `true`) and deprecated `composerPlaceholder`. Normally mounted by the Provider. |
| `KokoOverlayLayer` | `style`, `pointerEvents` (default `box-none`), and `testID` for custom SDK chrome. |

## Low-level action options

Most hosts do not call these directly.

| Type | Options and defaults |
|---|---|
| `DumpOptions` | `maxDepth`, `skipInvisible`, `silent`; absent values inherit Agent configuration. |
| `TapOptions` | `revealIfNeeded`, `silent`, `cursorDurationMs`; the planner normally decides when to reveal an offscreen control. |
| `SwipeOptions` | `durationMs`, `silent`. |
| `PinchOptions` | `durationMs` (default `280`), `silent`. |
| `TypeOptions` | `clear`, `silent`. |

See [Privacy](PRIVACY.md) for data boundaries and [backend authentication demos](BACKEND_AUTH_DEMOS.md) for the three-party token flow.

