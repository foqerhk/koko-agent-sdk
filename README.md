# Koko Agent SDK

React Native SDK for an observable in-app assistant. The host supplies a short-lived access token and presents a user goal; the SDK observes the screen, asks the hosted gateway for a next step, and performs supported actions inside the app.

[npm package](https://www.npmjs.com/package/@intentcomputing/koko-agent-sdk) · [中文](README.zh-CN.md) · [Integration guide](docs/INTEGRATION.md) · [Privacy](docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

## Requirements

- React Native 0.73 or later and React 18 or later; iOS 15 or later or an Android host supporting React Native autolinking.
- Expo development build or a native build; Expo Go cannot load this native module.
- A host backend that exchanges its server-only client secret for short-lived mobile access tokens. Neither credential is an OpenAI or DeepSeek API key.

## Install

```sh
npm install @intentcomputing/koko-agent-sdk
cd ios && pod install && cd .. # iOS
```

Rebuild and reinstall the native app after installation or a native SDK upgrade. In a Yarn workspace, add the package to the mobile workspace with `yarn workspace <workspace-name> add @intentcomputing/koko-agent-sdk`.

## Quick start

Mount the provider around the host navigation tree and connect `openKokoChat()` to a host button. Supply short-lived credentials through `tokenProvider`.

```tsx
import React from 'react';
import { Button, View } from 'react-native';
import { KokoProvider, openKokoChat } from '@intentcomputing/koko-agent-sdk';

export default function App() {
  const getKokoToken = React.useCallback(async () => {
    const response = await fetch('https://api.your-app.example/koko/access-token', {
      headers: { Authorization: `Bearer ${await getHostSessionToken()}` },
    });
    if (!response.ok) throw new Error(`Koko token ${response.status}`);
    return response.json(); // { accessToken, expiresAt } (Unix milliseconds)
  }, []);
  return (
    <KokoProvider config={{ gateway: { tokenProvider: getKokoToken }, locale: 'en' }}>
      <View style={{ flex: 1 }}>
        {/* Your app and navigation go here. */}
        <Button title="Open assistant" onPress={() => openKokoChat()} />
      </View>
    </KokoProvider>
  );
}
```

The default gateway is `https://sdk.intentcomputing.net` (OpenAI). For China, set `gateway.baseUrl` to `https://sdk.intentcomputing.cn` (DeepSeek). The SDK caches short-lived tokens in memory, refreshes lazily when a request occurs near expiry, and retries once after a 401. Long-lived client secrets and model-provider keys must never be bundled into the app. See the [backend authentication demos](docs/BACKEND_AUTH_DEMOS.md) for Node.js, Java, Go, Python, PHP and C#.

Call `setKokoAppearance({ locale, theme })` when host preferences change. Configure branding through `config.branding`; custom branding is subject to the app's entitlement. See the [complete configuration reference](docs/CONFIGURATION.md) for every Provider, Agent, gateway, runtime, and per-run option, and the [integration guide](docs/INTEGRATION.md) for host actions, privacy gates, and lifecycle details.

## Privacy and limits

Host apps must mark and gate password, authentication-secret, account-recovery and verification screens before displaying sensitive content. Users complete those steps themselves. The SDK sends redacted screen information and task context to the configured gateway for planning; integration authors must validate these boundaries with synthetic data. See [Privacy](docs/PRIVACY.md).

The SDK works best with labelled, visible React Native controls. iOS WebView support includes local text recognition and JavaScript-based clicks; websites that require trusted gestures, nested frames, or unlabelled icons may need host support. Multi-step web authorization and disconnection flows require host-specific end-to-end acceptance. Do not treat a click or authorization prompt alone as proof of task completion.

## Development

```sh
npm ci
npm test -- --runInBand --watchman=false
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). The gateway is a separately operated service and its source is not part of this public SDK repository.

## License

[MIT](LICENSE).
