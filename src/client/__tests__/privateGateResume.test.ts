jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' }, LogBox: {},
}), { virtual: true });
import { AgentSession } from '../AgentSession';
import { message } from '../../i18n';
import { AppUserGateStore, setAppUserGate, clearAppUserGate } from '../../privacy/userGate';
import { TaskStore } from '../../task/TaskStore';
import type { ViewNode } from '../../types';
import { OperationReplayGuard } from '../OperationReplayGuard';

const privatePage: ViewNode = {
  id: '0', type: 'View', clickable: false, testID: 'privacy-sensitive-mnemonic',
  frame: { x: 0, y: 0, width: 400, height: 800 }, children: [],
};
const ordinaryPage: ViewNode = { ...privatePage, testID: undefined };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1000);
  setAppUserGate({ kind: 'recovery_phrase', label: 'Local private step' });
  TaskStore.startTask('Local gate test');
});
afterEach(() => {
  clearAppUserGate();
  TaskStore.setUserGateWaiting(null);
  jest.useRealTimers();
});

it('gives feedback instead of resuming on a still-private page, then resumes after leaving it', async () => {
  clearAppUserGate();
  const safeDump = jest.fn().mockResolvedValue(privatePage);
  const session = {
    safeDump, message, stopped: false, history: [], operationReplayGuard: new OperationReplayGuard(),
    agent: { log: jest.fn(), getConfig: () => ({ locale: 'en' }) },
    opts: { userGateTimeoutMs: 5000 },
  };
  let settled = false;
  const run = (AgentSession.prototype as any).waitForAppUserGateIfNeeded.call(session);
  run.then(() => { settled = true; });
  await jest.advanceTimersByTimeAsync(10);
  AppUserGateStore.requestCheck();
  await jest.advanceTimersByTimeAsync(710);
  expect(settled).toBe(false);
  expect(TaskStore.snapshot().userGateWaiting).toContain('Still on a private screen');
  safeDump.mockResolvedValue(ordinaryPage);
  await jest.advanceTimersByTimeAsync(710);
  await expect(run).resolves.toBe('cleared');
});

it('does not treat an unreadable page as proof that private input is complete', async () => {
  const session = {
    safeDump: jest.fn().mockResolvedValue(null), message, stopped: false, history: [], operationReplayGuard: new OperationReplayGuard(),
    agent: { log: jest.fn(), getConfig: () => ({ locale: 'en' }) },
    opts: { userGateTimeoutMs: 5000 },
  };
  const run = (AgentSession.prototype as any).waitForAppUserGateIfNeeded.call(session);
  await jest.advanceTimersByTimeAsync(10);
  AppUserGateStore.requestCheck();
  await jest.advanceTimersByTimeAsync(710);
  expect(TaskStore.snapshot().userGateWaiting).toContain('Unable to confirm');
  session.stopped = true;
  await jest.advanceTimersByTimeAsync(710);
  await expect(run).resolves.toBe('stopped');
});

it('a status check preserves the host gate even when native controls are opaque', async () => {
  const session = {
    safeDump: jest.fn().mockResolvedValue(ordinaryPage), message, stopped: false, history: [], operationReplayGuard: new OperationReplayGuard(),
    agent: { log: jest.fn(), getConfig: () => ({ locale: 'en' }) },
    opts: { userGateTimeoutMs: 5000 },
  };
  const run = (AgentSession.prototype as any).waitForAppUserGateIfNeeded.call(session);
  await jest.advanceTimersByTimeAsync(10);
  AppUserGateStore.requestCheck();
  await jest.advanceTimersByTimeAsync(710);
  expect(AppUserGateStore.getHostGate()?.kind).toBe('recovery_phrase');
  expect(TaskStore.snapshot().userGateWaiting).toContain('Still on a private screen');
  clearAppUserGate();
  await jest.advanceTimersByTimeAsync(710);
  await expect(run).resolves.toBe('cleared');
});
