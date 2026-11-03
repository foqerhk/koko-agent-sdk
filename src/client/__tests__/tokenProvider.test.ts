jest.mock('../../native/NativeBridge', () => ({
  NativeBridge: { hostAppId: () => 'com.example.host', isAvailable: () => false },
}));

import { GatewayClient } from '../GatewayClient';

function jwt(expSeconds: number, marker: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expSeconds, marker })}.signature`;
}

describe('GatewayClient tokenProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('caches a short-lived token and sends the native app id', async () => {
    const provider = jest.fn(async () => jwt(Math.floor(Date.now() / 1000) + 600, 'one'));
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, plan: 'free', entitlements: {}, quota: {} }),
    } as Response);
    const client = new GatewayClient({ tokenProvider: provider });
    await client.me();
    await client.me();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toContain('Bearer ');
    expect(headers['X-Koko-App-Id']).toBe('com.example.host');
  });

  it('refreshes once after a 401', async () => {
    const provider = jest
      .fn()
      .mockResolvedValueOnce(jwt(Math.floor(Date.now() / 1000) + 600, 'old'))
      .mockResolvedValueOnce(jwt(Math.floor(Date.now() / 1000) + 600, 'new'));
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'expired' }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, plan: 'free', entitlements: {}, quota: {} }) } as Response);
    await new GatewayClient({ tokenProvider: provider }).me();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
