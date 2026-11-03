# 接入指南 · @intentcomputing/koko-agent-sdk

> Canonical English guide: [INTEGRATION.md](./INTEGRATION.md)

面向 React Native 宿主 App。装完依赖后需链原生并重编一次，与常见带 native 模块的 RN 库相同。

## 前置条件

- React Native ≥ 0.73（或 Expo Dev Client / `expo prebuild`，**不支持 Expo Go**）
- iOS 部署目标 ≥ 15；需本机可 `pod install`
- 在 Intent Computing 用户后台创建应用并取得一次性显示的 `clientId` / `clientSecret`；`clientSecret` 只放宿主后端

## 步骤一览

1. 安装 npm 包
2. iOS `pod install`（Android 一般靠 autolinking）
3. **重新编译原生**（Debug / Release 均可）
4. 宿主后端换取短期 token，App 用 `tokenProvider` 提供给 `KokoProvider`
5. 将 `openKokoChat()` 对接宿主入口，再发自然语言任务

之后若只改 JS 配置或升级包的纯 JS 部分，Metro 热更新即可；**SDK 含原生改动或首次接入，必须再编原生。**

---

## 1. 安装

```bash
npm install @intentcomputing/koko-agent-sdk
# 或
yarn add @intentcomputing/koko-agent-sdk
```

Yarn monorepo 示例：

```bash
yarn workspace @your/mobile add @intentcomputing/koko-agent-sdk
```

## 2. 链接原生

**iOS**

```bash
cd ios && pod install && cd ..
```

**Android**
RN autolinking 会拉取 `android/`；除非关闭了 autolinking，否则无需手写 Package。

## 3. 编译宿主 App

```bash
npx react-native run-ios
npx react-native run-android
# 或 Xcode / Android Studio / expo run:ios|android
```

未编进原生模块时，`dump` / `tap` 会失败。

## 4. 根组件接入

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
          // 默认 https://sdk.intentcomputing.net（OpenAI）
          // 国内：https://sdk.intentcomputing.cn（DeepSeek）
          baseUrl: 'https://sdk.intentcomputing.cn',
        },
        locale: 'zh', // SDK UI 默认英文；中文请显式设置
        // branding: { name, tagline, placeholder, primaryColor, icon },
      }}
    >
      <Home />
    </KokoProvider>
  );
}
```

`tokenProvider` 应调用宿主后端，不能直接调用 Koko 换 token 接口，因为 `clientSecret` 绝不能进入 App。SDK 会按 `expiresAt` 或 JWT `exp` 缓存凭证，并在 401 后刷新一次。宿主后端完整实现见[六种主流语言 Demo](BACKEND_AUTH_DEMOS.zh-CN.md)。已废弃的 `gateway.token` 仅供开发调试，正式包不得使用。

宿主也可主动打开会话：

```tsx
import { getKokoAgent } from '@intentcomputing/koko-agent-sdk';

getKokoAgent().openChat();
```

### 可选开关

下表仅列常用项。Provider、Agent、网关、品牌、运行时、单次任务及内置组件的所有选项见 [SDK 完整配置参考](CONFIGURATION.zh-CN.md)。

| prop / config | 含义 | 默认 |
|--|--|--|
| `cursor` | 操作光标 | `true` |
| `observer` | 进度条 + 对话宿主 | `true` |
| `dialogs` | 确认 / 追问弹窗 | `true` |
| `config.locale` | `en` / `zh` | **`en`** |
| `config.branding` | 名称、占位文案、主色等 | SDK 默认 |
| `config.webWalletAliases` | 特定 Web Provider 的兼容选项；仅填写宿主已验证的公开别名 | 无 |
| `config.debug` | 调试日志 | Metro 开发构建默认开启，正式构建默认关闭 |

### 宿主接入约定

- 语言或主题改变时调用 `setKokoAppearance({ locale, theme })`；品牌配置需应用具备对应权益。
- 为按钮（包括纯图标按钮）提供有意义的无障碍名称、角色及稳定标识，保证禁用、选中和滚动状态真实可见。
- 在密码、账户恢复凭证、私密认证数据及验证页面出现前调用 `setAppUserGate` 并标记敏感页面，用户完成操作并离开后再调用 `clearAppUserGate`。使用虚构数据验证日志与上行请求；详见[隐私说明](PRIVACY.zh-CN.md)。
- iOS 内嵌网页可使用本地 OCR 和 JS 点击，但真实手势、跨框架内容及无标签控件存在限制；多步骤网页授权和解除授权流程需要结合具体宿主完成端到端验收。

## 5. 验收

1. 启动 App，通过接有 `openKokoChat()` 的宿主按钮打开助手；Provider 不会自动创建宿主入口。
2. 输入可核验目标，应看到 dump → tap 与光标。
3. 请求打到官网网关（或 `baseUrl`），App 内无 `clientSecret`、长期 token 或任何 LLM API Key。

---

## 常见问题

**只用 npm + 配置、不重编原生？**
不行。本 SDK 含 iOS/Android 原生模块。

**必须包在根组件？**
推荐。也可自行 `initKokoAgent` 并自建 UI。

**Expo Go？**
不支持。

**本地未发布源码？**
可用 `portal:` / `file:`；包在 monorepo 外时可能需 Metro `watchFolders`（npm 发布后通常不需要）。

---

## 相关

- 英文总览：[../README.md](../README.md)
- 中文总览：[../README.zh-CN.md](../README.zh-CN.md)
- 发布：[PUBLISH.zh-CN.md](./PUBLISH.zh-CN.md)
- 后端鉴权 Demo：[BACKEND_AUTH_DEMOS.zh-CN.md](./BACKEND_AUTH_DEMOS.zh-CN.md)
