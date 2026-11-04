# Changelog

## 1.1.2 — Reliable reload recovery

- Resume interrupted goals when a host locale, theme, or navigator rebuild replaces the SDK agent during React Native startup.
- Defer the single resume-attempt claim until its startup timer actually runs, allowing a replacement agent to reschedule safely without claiming the same checkpoint twice.
- Add regression coverage for configuration changes that cancel the first recovery timer.

## 1.1.1 — First official release

- React Native SDK with iOS and Android native modules, visible task progress, host appearance synchronization, privacy gates, and in-app WebView assistance.
- Production `tokenProvider` authentication with memory-only, expiry-aware caching and one forced refresh after a 401.
- Regional official gateways for China/DeepSeek and global/OpenAI deployments.
- Complete English and Chinese integration, configuration, privacy, publishing, and host-backend authentication documentation.
- Host-backend token exchange examples for Node.js, Java, Go, Python, PHP, and C#.
