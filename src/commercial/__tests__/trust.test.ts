import {
  isAllowedGatewayUrl,
  isTrustedEntitlementHost,
} from '../trust';

describe('gateway trust', () => {
  it('trusts official hosts for entitlements', () => {
    expect(isTrustedEntitlementHost('https://sdk.intentcomputing.cn')).toBe(true);
    expect(isTrustedEntitlementHost('https://sdk.intentcomputing.net')).toBe(true);
  });

  it('trusts localhost for entitlements', () => {
    expect(isTrustedEntitlementHost('http://127.0.0.1:8790')).toBe(true);
  });

  it('rejects arbitrary entitlement hosts', () => {
    expect(isTrustedEntitlementHost('https://evil.example.com')).toBe(false);
  });

  it('allows official gateway without local-lab flag', () => {
    expect(isAllowedGatewayUrl('https://sdk.intentcomputing.cn', false).ok).toBe(true);
  });

  it('blocks localhost without local-lab flag', () => {
    expect(isAllowedGatewayUrl('http://127.0.0.1:8790', false).ok).toBe(false);
  });

  it('allows localhost with local-lab flag (Metro debug)', () => {
    expect(isAllowedGatewayUrl('http://127.0.0.1:8790', true).ok).toBe(true);
  });
});
