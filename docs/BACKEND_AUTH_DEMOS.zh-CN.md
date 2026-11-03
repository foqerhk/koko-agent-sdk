# 宿主后端鉴权与多语言 Demo

生产环境采用三端通信：宿主 App 通过自己的登录态请求宿主后端；宿主后端使用仅存于服务器的 `clientId` / `clientSecret` 向 Koko 换取 5～15 分钟的 access token；App 再把短期 token 交给 SDK。

Koko 可为每个 `clientId` 选配宿主后端出口 IP 白名单。多个精确 IPv4/IPv6 地址用逗号分隔；不配置时不限制。启用后，请把宿主后端所有稳定 NAT 出口地址提供给 Intent Computing。IP 白名单是 `clientSecret` 之外的附加约束，不能替代密钥认证。

在 Intent Computing 用户后台创建应用时，会自动生成 `clientId` / `clientSecret`。完整 Secret 仅显示一次；之后可在“应用 / 服务端凭证”中维护 IP、启停或轮换 Secret。管理员后台可调整状态、授权区域和 IP，并查看操作审计。Secret 只保存哈希。

```text
宿主 App ──宿主登录态──> 宿主后端 ──clientSecret──> Koko /v1/sdk/token
宿主 App <──短期 token── 宿主后端 <──短期 token── Koko
宿主 App ──短期 token──> Koko /v1/agent/*
```

## 安全约定

- `KOKO_CLIENT_SECRET` 只能放在宿主后端的密钥系统或环境变量中，不能进入 App、Git、日志或前端响应。
- 宿主的 `/koko/access-token` 必须验证已有登录态并限流，不能做成匿名转发接口。
- `subject` 必须由后端根据已认证用户生成稳定的匿名值；不要发送邮箱、手机号、特定业务账户标识或设备广告 ID。建议 `HMAC-SHA256(宿主用户ID, 独立盐)`。
- 国内使用 `https://sdk.intentcomputing.cn`，海外使用 `https://sdk.intentcomputing.net`；凭证和 token 不跨区域使用。
- Koko 返回字段为 `access_token`、`expires_in`、`expires_at`（Unix 秒）。宿主接口应转换为 SDK 接受的 `{ accessToken, expiresAt }`，其中 `expiresAt` 是 Unix 毫秒。
- 请求 Koko 必须设置短超时，不记录 Authorization 头或响应 token。长期凭证应定期轮换。

以下示例中的 `authenticatedUserId` 必须来自宿主已经验证的 session/JWT，不得从请求 body 或 query 直接采用。

## Node.js / TypeScript（Express）

```ts
import crypto from 'node:crypto';
import express from 'express';

const app = express();
const gateway = process.env.KOKO_REGION === 'cn'
  ? 'https://sdk.intentcomputing.cn'
  : 'https://sdk.intentcomputing.net';

app.get('/koko/access-token', requireHostLogin, async (req, res) => {
  const subject = crypto.createHmac('sha256', process.env.KOKO_SUBJECT_SALT!)
    .update(req.user.id) // 只取服务端认证结果
    .digest('hex');
  const basic = Buffer.from(
    `${process.env.KOKO_CLIENT_ID}:${process.env.KOKO_CLIENT_SECRET}`,
  ).toString('base64');
  const upstream = await fetch(`${gateway}/v1/sdk/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.KOKO_APP_ID, subject }),
    signal: AbortSignal.timeout(5000),
  });
  if (!upstream.ok) return res.status(502).json({ error: 'koko_token_unavailable' });
  const token = await upstream.json();
  res.set('Cache-Control', 'no-store').json({
    accessToken: token.access_token,
    expiresAt: token.expires_at * 1000,
  });
});
```

## Java（Spring Boot 3）

```java
record KokoToken(String access_token, long expires_at) {}
record AppToken(String accessToken, long expiresAt) {}

AppToken exchange(String authenticatedUserId) throws Exception {
  String subject = hmacSha256Hex(System.getenv("KOKO_SUBJECT_SALT"), authenticatedUserId);
  String basic = Base64.getEncoder().encodeToString(
      (System.getenv("KOKO_CLIENT_ID") + ":" + System.getenv("KOKO_CLIENT_SECRET"))
          .getBytes(StandardCharsets.UTF_8));
  String body = objectMapper.writeValueAsString(Map.of(
      "app_id", System.getenv("KOKO_APP_ID"), "subject", subject));
  HttpRequest request = HttpRequest.newBuilder(URI.create(kokoGateway + "/v1/sdk/token"))
      .timeout(Duration.ofSeconds(5)).header("Authorization", "Basic " + basic)
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(body)).build();
  HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
  if (response.statusCode() != 200) throw new IllegalStateException("Koko token unavailable");
  KokoToken token = objectMapper.readValue(response.body(), KokoToken.class);
  return new AppToken(token.access_token(), token.expires_at() * 1000L);
}
```

Spring Controller 必须从 `Principal` / SecurityContext 取得 `authenticatedUserId`，并返回 `Cache-Control: no-store`。

## Go（net/http）

```go
func exchangeKokoToken(ctx context.Context, authenticatedUserID string) (string, int64, error) {
    mac := hmac.New(sha256.New, []byte(os.Getenv("KOKO_SUBJECT_SALT")))
    mac.Write([]byte(authenticatedUserID))
    body, _ := json.Marshal(map[string]string{
        "app_id": os.Getenv("KOKO_APP_ID"), "subject": hex.EncodeToString(mac.Sum(nil)),
    })
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second); defer cancel()
    req, _ := http.NewRequestWithContext(ctx, http.MethodPost, kokoGateway+"/v1/sdk/token", bytes.NewReader(body))
    req.SetBasicAuth(os.Getenv("KOKO_CLIENT_ID"), os.Getenv("KOKO_CLIENT_SECRET"))
    req.Header.Set("Content-Type", "application/json")
    resp, err := http.DefaultClient.Do(req); if err != nil { return "", 0, err }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return "", 0, fmt.Errorf("koko token: %s", resp.Status) }
    var out struct { AccessToken string `json:"access_token"`; ExpiresAt int64 `json:"expires_at"` }
    if err := json.NewDecoder(resp.Body).Decode(&out); err != nil { return "", 0, err }
    return out.AccessToken, out.ExpiresAt * 1000, nil
}
```

## Python（FastAPI + HTTPX）

```python
import hashlib, hmac, os
import httpx
from fastapi import Depends, HTTPException, Response

@app.get('/koko/access-token')
async def koko_token(response: Response, user=Depends(require_host_user)):
    subject = hmac.new(os.environ['KOKO_SUBJECT_SALT'].encode(), str(user.id).encode(), hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(timeout=5.0) as client:
        upstream = await client.post(
            f'{KOKO_GATEWAY}/v1/sdk/token',
            auth=(os.environ['KOKO_CLIENT_ID'], os.environ['KOKO_CLIENT_SECRET']),
            json={'app_id': os.environ['KOKO_APP_ID'], 'subject': subject},
        )
    if upstream.status_code != 200:
        raise HTTPException(502, 'Koko token unavailable')
    token = upstream.json()
    response.headers['Cache-Control'] = 'no-store'
    return {'accessToken': token['access_token'], 'expiresAt': token['expires_at'] * 1000}
```

## PHP（Laravel）

```php
public function token(Request $request): JsonResponse
{
    $userId = (string) $request->user()->getAuthIdentifier(); // auth middleware 已验证
    $subject = hash_hmac('sha256', $userId, env('KOKO_SUBJECT_SALT'));
    $upstream = Http::timeout(5)
        ->withBasicAuth(env('KOKO_CLIENT_ID'), env('KOKO_CLIENT_SECRET'))
        ->post(config('services.koko.gateway').'/v1/sdk/token', [
            'app_id' => env('KOKO_APP_ID'), 'subject' => $subject,
        ]);
    abort_unless($upstream->successful(), 502, 'Koko token unavailable');
    return response()->json([
        'accessToken' => $upstream['access_token'],
        'expiresAt' => $upstream['expires_at'] * 1000,
    ])->header('Cache-Control', 'no-store');
}
```

## C#（ASP.NET Core）

```csharp
app.MapGet("/koko/access-token", async (ClaimsPrincipal user, IHttpClientFactory factory) => {
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new UnauthorizedAccessException();
    var subject = Convert.ToHexString(HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("KOKO_SUBJECT_SALT")!),
        Encoding.UTF8.GetBytes(userId))).ToLowerInvariant();
    var clientId = Environment.GetEnvironmentVariable("KOKO_CLIENT_ID")!;
    var clientSecret = Environment.GetEnvironmentVariable("KOKO_CLIENT_SECRET")!;
    var appId = Environment.GetEnvironmentVariable("KOKO_APP_ID")!;
    var request = new HttpRequestMessage(HttpMethod.Post, $"{kokoGateway}/v1/sdk/token");
    var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes(
        $"{clientId}:{clientSecret}"));
    request.Headers.Authorization = new("Basic", credentials);
    request.Content = JsonContent.Create(new { app_id = appId, subject });
    var upstream = await factory.CreateClient("koko").SendAsync(request);
    if (!upstream.IsSuccessStatusCode) return Results.Problem(statusCode: 502, title: "Koko token unavailable");
    var token = await upstream.Content.ReadFromJsonAsync<KokoToken>();
    return Results.Json(new { accessToken = token!.access_token, expiresAt = token.expires_at * 1000 },
        headers: new Dictionary<string, string> { ["Cache-Control"] = "no-store" });
}).RequireAuthorization();
```

## App 端

```tsx
const tokenProvider = React.useCallback(async () => {
  const response = await hostApi.get('/koko/access-token');
  return response.data as { accessToken: string; expiresAt: number };
}, []);

<KokoProvider config={{
  gateway: {
    baseUrl: 'https://sdk.intentcomputing.cn',
    tokenProvider,
  },
}}>{children}</KokoProvider>
```

不要把 token 写入 AsyncStorage、日志或分析事件。SDK 自己在内存中缓存，到期前刷新；如果网关返回 401，会清除缓存并强制调用一次 `tokenProvider`。
