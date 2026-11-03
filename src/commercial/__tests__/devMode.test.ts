import {
  resolveDebugLogging,
  allowLocalGatewayForDebugClient,
} from '../devMode';

describe('debug logging', () => {
  const original = (global as { __DEV__?: boolean }).__DEV__;

  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = original;
  });

  it('follows Metro __DEV__ by default', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    expect(resolveDebugLogging({})).toBe(true);
    (global as { __DEV__?: boolean }).__DEV__ = false;
    expect(resolveDebugLogging({})).toBe(false);
  });

  it('can force on/off via config.debug', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    expect(resolveDebugLogging({ debug: true })).toBe(true);
    (global as { __DEV__?: boolean }).__DEV__ = true;
    expect(resolveDebugLogging({ debug: false })).toBe(false);
  });

  it('only allows local gateway in Metro debug clients', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    expect(allowLocalGatewayForDebugClient()).toBe(true);
    (global as { __DEV__?: boolean }).__DEV__ = false;
    expect(allowLocalGatewayForDebugClient()).toBe(false);
  });
});
