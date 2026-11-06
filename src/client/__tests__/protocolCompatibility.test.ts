jest.mock('../../native/NativeBridge', () => ({
  NativeBridge: { hostAppId: () => 'com.example.host', isAvailable: () => false },
}));

import {
  GatewayClient,
  GatewayUpgradeRequiredError,
} from '../GatewayClient';
import {
  KOKO_PROTOCOL_VERSION,
  KOKO_SDK_CAPABILITIES,
  KOKO_SDK_VERSION,
} from '../../protocol';
import { runtimeText } from '../../i18n';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageVersion = require('../../../package.json').version as string;

describe('SDK/gateway protocol compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the wire-reported SDK version aligned with package.json', () => {
    expect(KOKO_SDK_VERSION).toBe(packageVersion);
  });

  it('sends SDK, protocol and capability headers on authenticated requests', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, plan: 'free', entitlements: {}, quota: {} }),
    } as Response);
    await new GatewayClient({ token: 'test-token' }).me();
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Koko-SDK-Version']).toBe(KOKO_SDK_VERSION);
    expect(headers['X-Koko-Protocol-Version']).toBe(String(KOKO_PROTOCOL_VERSION));
    expect(headers['X-Koko-Capabilities']).toBe(KOKO_SDK_CAPABILITIES.join(','));
  });

  it('maps HTTP 426 to a typed forced-upgrade error without retrying token auth', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 426,
      json: async () => ({
        ok: false,
        error: 'sdk_upgrade_required',
        reason: 'emergency_patch',
        minimum_sdk_version: '1.2.1',
        recommended_sdk_version: '1.2.2',
        supported_protocols: [1],
        contact_developer: true,
      }),
    } as Response);
    const provider = jest.fn(async () => 'header.payload.signature');
    await expect(new GatewayClient({ tokenProvider: provider }).me()).rejects.toMatchObject({
      name: 'GatewayUpgradeRequiredError',
      code: 'sdk_upgrade_required',
      status: 426,
      reason: 'emergency_patch',
      minimumSdkVersion: '1.2.1',
      recommendedSdkVersion: '1.2.2',
      supportedProtocols: [1],
      contactDeveloper: true,
    } satisfies Partial<GatewayUpgradeRequiredError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('has an explicit localized developer-contact message', () => {
    expect(runtimeText('runtime.sdkTooOld', undefined, 'zh-CN')).toContain('联系应用开发者');
    expect(runtimeText('runtime.sdkTooOld', undefined, 'en-US')).toContain('app developer');
  });
});
