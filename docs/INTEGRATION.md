# Integration guide · `@intentcomputing/koko-agent-sdk`

For React Native host apps. After installing the package you must link native code and rebuild once — the same flow as other RN libraries with native modules.

> 中文版：[INTEGRATION.zh-CN.md](./INTEGRATION.zh-CN.md)

## Prerequisites

- React Native ≥ 0.73 (or Expo Dev Client / `expo prebuild` — **not Expo Go**)
- iOS deployment target ≥ 15; ability to run `pod install`
- An Intent Computing console app with its one-time `clientId` and `clientSecret`; keep the secret on the host backend only

## Checklist

1. Install the npm package
2. iOS: `pod install` (Android usually autolinks)
3. **Rebuild native** (Debug or Release)
4. Exchange credentials on the host backend and provide short-lived tokens to `KokoProvider`
5. Launch and send a natural-language goal

JS-only config changes can hot-reload via Metro. **First integration or any native SDK change requires a native rebuild.**

---

## 1. Install

```bash
npm install @intentcomputing/koko-agent-sdk
# or
yarn add @intentcomputing/koko-agent-sdk
```

Yarn workspaces example:

```bash
yarn workspace @your/mobile add @intentcomputing/koko-agent-sdk
```

## 2. Link native code

**iOS**

```bash
cd ios && pod install && cd ..
```

**Android**
React Native autolinking picks up `android/`. No manual Package registration unless autolinking is disabled.

## 3. Rebuild the host app

```bash
npx react-native run-ios
npx react-native run-android
# or Xcode / Android Studio / expo run:ios|android
```

Without a rebuild, `dump` / `tap` will fail because the native module is missing.

## 4. Root provider

Wrap at the app root (or outermost navigation shell):

```tsx
import { KokoProvider } from '@intentcomputing/koko-agent-sdk';

export default function App() {
  const tokenProvider = React.useCallback(async () => {
    const response = await hostApi.get('/koko/access-token');
    return response.data as { accessToken: string; expiresAt: number };
  }, []);
  return (
    <KokoProvider
      config={{
        gateway: {
          tokenProvider,
          // Default: https://sdk.intentcomputing.net
          // China: https://sdk.intentcomputing.cn
          // baseUrl: 'https://sdk.intentcomputing.cn',
        },
        // locale: 'en', // default
        // locale: 'zh',
        // branding: { name, tagline, placeholder, primaryColor, icon },
      }}
    >
      <Home />
    </KokoProvider>
  );
}
```

`tokenProvider` calls your backend, never Koko's exchange endpoint directly: the `clientSecret` must not enter the app. The SDK caches credentials using `expiresAt` or JWT `exp` and refreshes once after a 401. See the [backend demos](BACKEND_AUTH_DEMOS.md) for complete examples. Deprecated `gateway.token` is development-only and must not be shipped in production.

`KokoProvider` will:

- Initialize the agent with `gateway.tokenProvider`
- Mount cursor, progress, and chat sheet (optional — see below)

Open chat from host UI:

```tsx
import { getKokoAgent } from '@intentcomputing/koko-agent-sdk';

getKokoAgent().openChat();
// or getKokoAgent().runGoal('Open settings');
```

### Optional props / config

The table below is only the common subset. See the [complete configuration reference](CONFIGURATION.md) for every Provider, Agent, gateway, branding, runtime, per-run, and built-in component option.

| Key | Purpose | Default |
|--|--|--|
| `cursor` | Action cursor overlay | `true` |
| `observer` | Progress + chat host | `true` |
| `dialogs` | Confirm / ask-user dialogs | `true` |
| `config.locale` | `en` \| `zh` | **`en`** |
| `config.branding` | Name, placeholder, accent | SDK defaults |
| `config.webWalletAliases` | Specialized compatibility option for verified host-supplied web-provider labels; ordinary apps should leave it empty | None |
| `config.debug` | Verbose logs | On in Metro development builds unless explicitly `false`; off in release builds |

## 5. Contract for React Native hosts

The SDK observes the current native view tree and verifies actions against the live screen. It does not assume a business-specific layout, fixed tab names, header coordinates, or a particular navigation library. Provide the following semantics so navigation and private boundaries remain reliable across custom components and locales.

- **Appearance:** initialize `config.locale`, `config.theme` and `config.branding` at the SDK entry. When host preferences change, call `setKokoAppearance({ locale: hostLocale, theme: hostTheme })`; report the host's actual `light`/`dark` theme. SDK chrome currently uses the opposite theme for contrast. Built-in UI supports English and Chinese; branding remains subject to the app's entitlement.
- **Controls:** use meaningful `accessibilityLabel`, button/tab roles and stable, unique `testID` values, including icon-only Back/Close controls. Keep disabled and selected state accurate. A menu offering “Export sensitive data” is ordinary navigation; its label alone is not proof that a private value is displayed. Offscreen targets require revealing the actual scrollable region before a tap.
- **Private surfaces:** set `secureTextEntry` on credential fields. Before displaying passwords, PIN/OTP/CVV, account-recovery data, private authentication material, or their verification choices, declare a host gate with `setAppUserGate`. Also mark the containing private surface with an explicit ID such as `privacy-sensitive-recovery` or `privacy-sensitive-secret`. Clear the gate only after all private surfaces have been left. Never put secret values in gate labels, test IDs, accessibility labels, task text, or logs. The user completes these steps locally; ordinary navigation copy may be sent to the gateway. Text heuristics are a fallback and cannot establish privacy boundaries in every language or custom widget.
- **Host callbacks:** `registerHostActions` is optional. Register callbacks only for controls that are currently mounted and visible, give each control a unique identity, and unregister on blur, unmount or loss of visibility. Match the same user-visible action; do not use callbacks as hidden routes around scrolling, disabled controls or private gates. A callback resolving is not evidence that the requested task succeeded.
- **Loading and completion:** expose loading/error copy and meaningful selected/value state in the native tree. Keep the user on an observable loading state until a result is known, then expose a stable result or destination. Tasks wait and re-observe changes; repeated labels, an invoked callback or a matching page title do not by themselves prove completion.
- **Exploration:** `bootstrapExplore` observes only the current public screen and records public control labels as local hints. It performs no taps, swipes, typing, host callbacks, LogBox changes or task replacement, and requires existing dump permission. Private/gated and unreadable screens return failure without recording a new node. The result always has `steps: 0`; deprecated crawl options (`mode`, step/screen limits, priority/skip patterns and action-progress callbacks) are ignored. Normal tasks never automatically replay an exploration route.

Runtime appearance example:

```tsx
import { setKokoAppearance } from '@intentcomputing/koko-agent-sdk';

useEffect(() => {
  setKokoAppearance({ locale: hostLocale, theme: hostTheme });
}, [hostLocale, hostTheme]);
```

For custom private UIs, declare the gate before navigation or reveal and keep it active through verification. Use `clearAppUserGate()` once the host confirms a public destination. Secure fields, explicit private markers and host gates protect the upload boundary; do not rely on a screen's title or number of buttons as the integration contract.

## 6. Verify

1. Launch the app and use your host button wired to `openKokoChat()`. The provider does not create a host entry button.
2. Send a verifiable goal; you should see dump → tap with a visible cursor.
3. Check that requests use the selected official gateway and a short-lived token bound to this app. Do not bundle a client secret, long-lived token or LLM API key. Validate privacy gates and outbound payloads using synthetic data.

---

## FAQ

**npm + config only, no native rebuild?**
No. This SDK ships iOS/Android native modules (same class as Reanimated, Sentry RN, Keychain, etc.).

**Must it wrap the root?**
Recommended. It is the init + UI mount point. You may use `initKokoAgent` and custom UI instead.

**Expo Go?**
Not supported. Use a Dev Client, bare RN, or a production host binary.

**Linking an unpublished local checkout?**
Use `portal:` / `file:`. If the package lives **outside** the monorepo, Metro may need `watchFolders` + `extraNodeModules` (usually unnecessary after npm publish).

**Where does the token come from?**
Your backend exchanges its server-only Intent Computing client credentials for a short-lived token. It is not a model-vendor API key.

---

## Related

- Package overview: [../README.md](../README.md)
- npm publish: [PUBLISH.md](./PUBLISH.md)
- 中文接入指南: [INTEGRATION.zh-CN.md](./INTEGRATION.zh-CN.md)
- Backend authentication demos: [BACKEND_AUTH_DEMOS.md](./BACKEND_AUTH_DEMOS.md)
