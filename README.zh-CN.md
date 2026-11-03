# Koko Agent SDK

面向 React Native 的应用内助手 SDK。用户描述任务后，SDK 观察宿主当前页面，通过网关规划下一步，并在宿主内执行支持的操作，过程对用户可见。

[npm 包](https://www.npmjs.com/package/@intentcomputing/koko-agent-sdk) · [English](README.md) · [接入指南](docs/INTEGRATION.zh-CN.md) · [后端鉴权 Demo](docs/BACKEND_AUTH_DEMOS.zh-CN.md) · [隐私保护](docs/PRIVACY.zh-CN.md)

## 前置条件

- React Native ≥ 0.73、React ≥ 18；iOS ≥ 15，或支持原生自动链接的 Android 宿主。
- Expo 使用开发构建或原生构建，不支持 Expo Go。
- 生产环境需要宿主后端：长期 `clientSecret` 只保存在后端，App 仅取得短期 access token。它们都不是模型 API 密钥。

## 安装

```sh
npm install @intentcomputing/koko-agent-sdk
cd ios && pod install && cd .. # iOS
```

首次安装或升级包含原生改动的 SDK 后，需重新构建并安装宿主。在 Yarn 工作区中请将依赖添加到移动端 workspace。

## 接入

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
    return response.json(); // { accessToken, expiresAt }；expiresAt 为 Unix 毫秒
  }, []);
  return (
    <KokoProvider config={{
      gateway: { tokenProvider: getKokoToken, baseUrl: 'https://sdk.intentcomputing.cn' },
      locale: 'zh',
    }}>
      <View style={{ flex: 1 }}>
        {/* 在此放置宿主页面和导航。 */}
        <Button title="打开助手" onPress={() => openKokoChat()} />
      </View>
    </KokoProvider>
  );
}
```

默认网关为海外的 `https://sdk.intentcomputing.net`（OpenAI）；国内请显式选择 `https://sdk.intentcomputing.cn`（DeepSeek）。SDK 仅在内存缓存短期 token；当一次请求发生且 token 临近过期时才按需刷新，401 后强制刷新并重试一次。长期 `clientSecret` 和模型 API 密钥都不得进入 App。完整三端流程及 Node.js、Java、Go、Python、PHP、C# Demo 见[后端鉴权 Demo](docs/BACKEND_AUTH_DEMOS.zh-CN.md)。

Provider、Agent、网关、品牌、运行时和单次任务的全部选项见 [SDK 完整配置参考](docs/CONFIGURATION.zh-CN.md)。

宿主必须在展示密码、私密认证数据、账户恢复凭证及其验证页面前设置隐私标记和用户操作门禁，由用户亲自完成敏感步骤。脱敏的页面信息和任务上下文会发送到所选网关进行规划，接入方应使用虚构数据验证隐私边界。详见[隐私说明](docs/PRIVACY.zh-CN.md)。

SDK 对带语义标签的可见控件更可靠。iOS 内嵌网页支持本地文字识别和基于 JavaScript 的点击，但要求真实手势、跨框架或缺少标签的页面仍可能需要宿主支持。多步骤网页授权和解除授权流程需要结合具体宿主完成端到端验收。

SDK 采用 [MIT 许可](LICENSE)。后端网关是独立运营的服务，不包含在公开 SDK 仓库中。
