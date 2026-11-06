# SDK 完整配置参考

> English: [CONFIGURATION.md](./CONFIGURATION.md)

本文覆盖宿主接入时可配置的公开接口：`KokoProvider`、`KokoAgentConfig`、运行时外观、单次任务参数，以及内置 UI 组件。TypeScript 类型定义仍是最终准源。

## SDK 与网关兼容

版本协商自动完成，宿主无需配置。SDK 1.2.0 会在每次网关请求中携带 SDK 版本、协议大版本和能力列表。正常迭代时，网关可以推荐新版本，同时继续允许当前 SDK 运行。

兼容窗口结束或遇到紧急安全补丁时，网关返回 HTTP 426 `sdk_upgrade_required`。SDK 会将其视为不可重试错误，不执行任何 App 操作，并直接显示“SDK 版本太旧，请联系应用开发者更新后再使用”。直接使用 `GatewayClient` 的宿主也可以捕获 `GatewayUpgradeRequiredError`。

SDK 导出 `KOKO_SDK_VERSION`、`KOKO_PROTOCOL_VERSION` 和 `KOKO_SDK_CAPABILITIES`。破坏性的线协议变化必须使用新的 `/vN`；npm 包版本不会隐式改变协议大版本。

## 完整示例

```tsx
import React from 'react';
import {
  KokoProvider,
  openKokoChat,
  setKokoAppearance,
} from '@intentcomputing/koko-agent-sdk';

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
          baseUrl: 'https://sdk.intentcomputing.cn',
          tokenProvider,
          // appId 通常无需填写，默认读取 Bundle ID / Package Name。
        },
        locale: 'zh',
        theme: 'light', // 填宿主主题；Koko 浮层会使用对比主题。
        branding: {
          name: 'My Assistant',
          tagline: '帮你操作当前 App',
          placeholder: '告诉我你想做什么…',
          primaryColor: '#6D4AFF',
          icon: require('./assistant.png'),
        },
        confirmation: {
          requireUserConfirm: true,
          mode: 'preflight',
        },
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

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `children` | `ReactNode` | 必填 | 宿主应用或最外层导航树。 |
| `config` | `KokoAgentConfig` | `{}` | Agent、网关、品牌和确认策略，详见下表。 |
| `cursor` | `boolean` | `true` | 显示可观测操作光标。 |
| `observer` | `boolean` | 继承 `config.observer` | 显示任务进度条和对话面板宿主；显式传入时优先。 |
| `dialogs` | `boolean` | `true` | 挂载 SDK 内置确认和追问弹窗。关闭后，宿主应提供对应回调。 |
| `resumeAfterReload` | `boolean` | `true` | JS 上下文因语言、主题或宿主重载而中断时，最多恢复一次最近任务。 |
| `remoteSmokePort` | `number` | `0` | 仅供开发联调的本机 smoke 驱动端口；生产包不要配置。 |
| `composerPlaceholder` | `string` | — | 已废弃；改用 `config.branding.placeholder`。 |

`KokoProvider.observer={false}` 只隐藏内置进度/对话 UI；`config.observer={false}` 还会关闭自动任务日志。两者都为 `true` 时功能完整。

## `KokoAgentConfig`

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `gateway` | `GatewayConfig` | — | 正式运行必需的网关和短 Token 配置。 |
| `locale` | `'zh' \| 'en'` | `'en'` | SDK 内置 UI 初始语言。运行时变化优先使用 `setKokoAppearance`。 |
| `theme` | `'light' \| 'dark'` | `'light'` | **宿主 App 当前主题**；Koko 浮层会使用相反主题以保持可见。 |
| `branding` | `KokoBrandingConfig` | Koko 默认品牌 | 自定义名称、图标、文案和主色；需要 `custom_branding` 权益。 |
| `confirmation` | `ConfirmationPolicy` | 需要确认、`preflight` | 高风险任务的人工确认策略。 |
| `onConfirmSensitive` | `(ctx) => Promise<boolean>` | 内置确认弹窗 | 自定义敏感操作确认。返回 `true` 才继续。 |
| `webWalletAliases` | `string[]` | `[]` | 特定 Web Provider 的兼容选项；仅填写宿主已验证的公开别名，普通 App 保持为空。 |
| `dumpMaxDepth` | `number` | `80` | 原生可访问性树最大读取深度；过小会截断 RN 导航/组件库下的页面正文。 |
| `dumpSkipInvisible` | `boolean` | `true` | 读取页面时丢弃不可见节点。 |
| `cursorDurationMs` | `number` | `480` | 默认光标移动动画时长，单位毫秒。 |
| `observer` | `boolean` | `true` | 启用任务日志；Provider 未显式设置 `observer` 时也控制内置进度/对话 UI。 |
| `debug` | `boolean` | Metro Debug 为 `true`；Release 为 `false` | 输出能力和执行步骤日志，不放宽安全策略。正式包建议显式设为 `false`。 |
| `devMode` | `boolean` | 同 `debug` | 已废弃的 `debug` 别名。 |
| `onUsageEvent` | `(event) => void` | — | 本地分析/UX 事件旁路通知，不参与计费，也不能阻塞任务。 |

### `gateway`

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `baseUrl` | `string` | `https://sdk.intentcomputing.net` | 海外/OpenAI 网关；国内/DeepSeek 使用 `https://sdk.intentcomputing.cn`。正式构建只接受官方地址。 |
| `tokenProvider` | `() => Promise<string \| { accessToken; expiresAt? }>` | — | 推荐。向**宿主后端**获取短期 Token。SDK 仅在内存中缓存，在请求时发现临近过期才刷新，401 后强制刷新并重试一次。 |
| `token` | `string` | — | 已废弃的静态 Token，仅供开发调试；正式包不得使用。 |
| `appId` | `string` | 原生 Bundle ID / Package Name | 必须与服务端登记的宿主应用一致；通常无需手填。 |

`tokenProvider` 返回对象时，`expiresAt` 使用 Unix **毫秒**。若省略，SDK 尝试读取 JWT `exp`；两者都没有时按 60 秒处理。`clientSecret`、DeepSeek/OpenAI Key 永远不得进入 App。

### `branding`

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `name` | `string` | `Koko` | 助手显示名称。 |
| `icon` | `number \| { uri: string } \| string` | 默认 K 标记 | 支持 `require()`、图片 URI/Data URI 或短文字标记。 |
| `tagline` | `string` | 本地化默认文案 | 对话页副标题。 |
| `placeholder` | `string` | 本地化默认文案 | 输入框占位文案。 |
| `primaryColor` | `string` | SDK 默认主色 | Badge、发送按钮等强调色。使用 React Native 可识别的颜色字符串。 |

没有品牌权益时，SDK 自动降级到 Koko 默认品牌，并通过 `onUsageEvent` 发出一次 `branding_downgraded`。

### `confirmation`

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `requireUserConfirm` | `boolean` | `true` | 是否要求高风险目标由用户确认。 |
| `mode` | `'preflight' \| 'inline' \| 'off'` | `'preflight'` | `preflight` 在任务开始前确认一次；`inline` 是已废弃的逐步确认模式；`off` 关闭 SDK 确认。 |
| `sensitivePatterns` | `RegExp[]` | SDK 内置规则 | 自定义高风险目标匹配规则。传入非空数组时替换内置规则。 |

关闭 SDK 确认不会绕过密码、账户恢复凭证、私密认证数据、OTP 等隐私页面的本地门禁；这些内容仍必须由用户亲自操作。

### `onUsageEvent` 事件

可能收到：`task_started`、`task_finished`、`agent_step`、`quota_exceeded`、`sheet_opened`、`sheet_closed`、`branding_downgraded`。不得把事件里的任务文本继续发送到未经授权的分析服务。

## 运行时语言和主题

```tsx
import { setKokoAppearance } from '@intentcomputing/koko-agent-sdk';

useEffect(() => {
  setKokoAppearance({ locale: hostLocale, theme: hostTheme });
}, [hostLocale, hostTheme]);
```

- `locale` 可传宿主语言字符串；以 `zh` 开头映射为中文，其余映射为英文。
- `theme` 填宿主真实主题：`'light'` 或 `'dark'`。
- 运行时外观优先级高于静态 `config.locale` / `config.theme`。

`getKokoAgent().configure(patch)` 可动态修改配置，但它执行浅合并；更新 `gateway`、`branding` 或 `confirmation` 时应传入完整子对象。语言/主题仍优先用 `setKokoAppearance`。

## 单次任务覆盖项

```tsx
await getKokoAgent().runGoal('打开设置', {
  locale: 'zh-CN',
  localRetries: 3,
  userGateTimeoutMs: 300_000,
  onAskUser: question => showHostQuestion(question),
  onNarration: text => setHint(text),
});
```

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `baseUrl` / `tokenProvider` / `token` / `appId` | 继承 `config.gateway` | 仅覆盖本次任务的网关配置。 |
| `locale` | 当前有效语言 | 本次规划请求语言。 |
| `localRetries` | `3` | 只读 `dump/find` 的本地失败重试次数，范围 `0–3`；触摸、输入等写操作不会自动重放。 |
| `userGateTimeoutMs` | `300000` | 等待用户完成密码、账户恢复、授权等本地门禁的最长时间。 |
| `onAskUser` | 内置追问弹窗 | Agent 需要用户补充信息时的宿主回调。 |
| `onNarration` | — | 接收当前任务提示/旁白。 |

`resumedFromReload` 和 `resumes` 是 SDK 恢复机制内部字段，宿主不应主动设置。

## 内置 UI 组件参数

| 组件 | 可配置项 |
|---|---|
| `KokoEntryButton` | `label`（默认 `Koko`）、`style`。生产宿主更推荐自绘入口并调用 `openKokoChat()`。 |
| `KokoComposer` | `placeholder`、`disabled`（默认 `false`）。 |
| `KokoObserver` | `cursor`（默认 `true`）、已废弃的 `composerPlaceholder`。通常由 Provider 自动挂载。 |
| `KokoOverlayLayer` | `style`、`pointerEvents`（默认 `box-none`）、`testID`。供自定义 SDK 浮层使用。 |

## 低级操作参数

这些 API 主要用于自定义集成；普通宿主不需要直接调用。

| 类型 | 可配置项及默认行为 |
|---|---|
| `DumpOptions` | `maxDepth`、`skipInvisible`、`silent`。未传时继承 Agent 配置。 |
| `TapOptions` | `revealIfNeeded`、`silent`、`cursorDurationMs`。任务规划器会自行决定何时滚动寻找目标。 |
| `SwipeOptions` | `durationMs`、`silent`。 |
| `PinchOptions` | `durationMs`（默认 `280`）、`silent`。 |
| `TypeOptions` | `clear`、`silent`。 |

完整隐私边界见[隐私说明](PRIVACY.zh-CN.md)，三端鉴权见[后端鉴权 Demo](BACKEND_AUTH_DEMOS.zh-CN.md)。

