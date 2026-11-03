jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' },
  Dimensions: { get: () => ({ width: 400, height: 800 }) }, LogBox: {},
}), { virtual: true });
jest.mock('../../ui/KokoDialogHost', () => ({ DialogBus: {} }));
jest.mock('../../native/NativeBridge', () => ({ NativeBridge: {
  dump: jest.fn(), tap: jest.fn(), swipe: jest.fn(), pinch: jest.fn(),
  typeText: jest.fn(), dismissKeyboard: jest.fn(), focusNode: jest.fn(),
  isAvailable: jest.fn(() => false), recognizeScreenText: jest.fn(), hostAppId: () => 'test.host',
} }));
jest.mock('../../cursor/controller', () => ({ CursorController: {
  moveTo: jest.fn(), hide: jest.fn(), showAt: jest.fn(), setPressing: jest.fn(),
} }));
jest.mock('../../commercial/ExecutionGuard', () => ({ ExecutionGuard: {
  assert: jest.fn(), setPermit: jest.fn(), clear: jest.fn(),
} }));
jest.mock('../../commercial/AccountStore', () => ({ AccountStore: { refresh: jest.fn() } }));
jest.mock('../../assist/OnDeviceAssist', () => ({ buildOnDeviceAssist: jest.fn(async () => ({
  modelText: '', ranked: [], ocrTokens: [], intent: 'unknown', backend: 'test',
})) }));

import { AgentSession } from '../AgentSession';
import { KokoAgent } from '../../KokoAgent';
import { NativeBridge } from '../../native/NativeBridge';
import { CursorController } from '../../cursor/controller';
import { RunCheckpoint } from '../RunCheckpoint';
import { HostActionsStore } from '../../host/HostActions';
import { TaskStore } from '../../task/TaskStore';
import { HostAppearanceStore } from '../../provider/HostAppearanceStore';
import { message, resolveText } from '../../i18n';
import { gateMessage, gateMessageValue } from '../../privacy/userGate';
import { runtimeEn } from '../../i18n/runtimeMessages';
import { ActionOutcomeUnknownError, ActionValidationError } from '../ActionOutcomeUnknownError';
import * as onDeviceAssist from '../../assist/OnDeviceAssist';
import type { ViewNode } from '../../types';

const tree: ViewNode = {
  id: 'root', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
  clickable: false, enabled: true, visible: true, children: [{
    id: 'button', type: 'Button', text: 'Continue', clickable: true, enabled: true,
    visible: true, frame: { x: 20, y: 200, width: 180, height: 50 }, children: [],
  }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function tickUntil(predicate: () => boolean) {
  for (let i = 0; i < 30 && !predicate(); i++) await jest.advanceTimersByTimeAsync(20);
  expect(predicate()).toBe(true);
}
function makeSession() {
  const agent = new KokoAgent({ confirmation: { requireUserConfirm: false } });
  const session = new AgentSession(agent, { token: 'local-test', localRetries: 3 });
  return { agent, session: session as any };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  TaskStore.clear();
  HostAppearanceStore.set({ locale: 'en' });
  (NativeBridge.dump as jest.Mock).mockResolvedValue(tree);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(false);
  (onDeviceAssist.buildOnDeviceAssist as jest.Mock).mockResolvedValue({
    modelText: '', ranked: [], ocrTokens: [], intent: 'unknown', backend: 'test',
  });
  (CursorController.moveTo as jest.Mock).mockResolvedValue(undefined);
  HostActionsStore.clear();
});
afterEach(async () => {
  await RunCheckpoint.clear();
  TaskStore.setUserGateWaiting(null);
  jest.useRealTimers();
});

it.each(['tap', 'swipe', 'pinch', 'type'])('never replays an uncertain %s after an execution error', async tool => {
  const { session } = makeSession();
  session.executeOnce = jest.fn().mockRejectedValue(new Error('native result lost after dispatch'));
  await expect(session.executeWithRetry({ tool, args: {} })).rejects.toBeInstanceOf(ActionOutcomeUnknownError);
  expect(session.executeOnce).toHaveBeenCalledTimes(1);
});

it('can retry observation failures without performing hidden keyboard or scroll actions', async () => {
  const { session } = makeSession();
  session.executeOnce = jest.fn().mockRejectedValueOnce(new Error('temporary dump failure')).mockResolvedValue('found');
  const result = session.executeWithRetry({ tool: 'find', args: { match: [] } });
  await jest.advanceTimersByTimeAsync(210);
  await expect(result).resolves.toEqual({ ok: true, result: 'found' });
  expect(session.executeOnce).toHaveBeenCalledTimes(2);
  expect(NativeBridge.dismissKeyboard).not.toHaveBeenCalled();
  expect(NativeBridge.swipe).not.toHaveBeenCalled();
});

it('ignores a late planner action after the user stops the task', async () => {
  const { agent, session } = makeSession();
  const next = deferred<any>();
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  session.gateway.next = jest.fn().mockReturnValue(next.promise);
  session.safeDump = jest.fn().mockResolvedValue(tree);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValue('none');
  const tap = jest.spyOn(agent, 'tap');
  const run = session.run('inspect current ordinary page');
  await tickUntil(() => session.gateway.next.mock.calls.length > 0);
  session.stop();
  next.resolve({ session_id: 'local', step: 1, action: { tool: 'tap', args: { nodeId: 'button' } } });
  await expect(run).resolves.toMatchObject({ success: false, summary: 'Cancelled' });
  expect(tap).not.toHaveBeenCalled();
});

it('cancels a tap waiting for cursor animation before native dispatch', async () => {
  const agent = new KokoAgent({ confirmation: { requireUserConfirm: false } });
  const animation = deferred<void>();
  (CursorController.moveTo as jest.Mock).mockReturnValue(animation.promise);
  const tap = agent.tap({ selector: { match: [{ text: 'Continue' }] } });
  const outcome = expect(tap).rejects.toThrow('cancelled');
  await tickUntil(() => (CursorController.moveTo as jest.Mock).mock.calls.length > 0);
  agent.stop();
  animation.resolve();
  await jest.advanceTimersByTimeAsync(500);
  await outcome;
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('does not consume a checkpoint while an active session owns the runtime', async () => {
  const agent = new KokoAgent();
  (agent as any).activeSession = {};
  await RunCheckpoint.begin('preserve current task');
  await expect(agent.resumeInterruptedRun()).resolves.toBeNull();
  await expect(RunCheckpoint.claimResumable()).resolves.toMatchObject({ goal: 'preserve current task' });
});

it('retains execution ownership after stop until the old run and cleanup settle', async () => {
  const agent = new KokoAgent({ gateway: { token: 'local-test' } });
  const pending = deferred<any>();
  const stop = jest.fn();
  const create = jest.spyOn(agent, 'createSession').mockReturnValue({ run: () => pending.promise, stop } as any);
  const run = agent.runGoal('ordinary goal', { userGateTimeoutMs: 1234 });
  await tickUntil(() => create.mock.calls.length > 0);
  agent.stop();
  await expect(agent.runGoal('new goal')).rejects.toThrow('already running');
  expect(stop).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0].userGateTimeoutMs).toBe(1234);
  pending.resolve({ success: false });
  await run;
  expect((agent as any).activeSession).toBeNull();
});

it('does not claim user completion or request another plan after ask_user times out', async () => {
  const { session } = makeSession();
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  session.gateway.next = jest.fn().mockResolvedValue({ session_id: 'local', step: 1,
    action: { tool: 'ask_user', args: { question: 'Complete the local step' } } });
  session.safeDump = jest.fn().mockResolvedValue(tree);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValueOnce('none').mockResolvedValueOnce('none').mockResolvedValue('timeout');
  const result = await session.run('inspect current ordinary page');
  expect(result.success).toBe(false);
  expect(result.summary).toContain('completion was not confirmed');
  expect(session.gateway.next).toHaveBeenCalledTimes(1);
  expect(session.history.at(-1)).toMatchObject({ tool: 'ask_user', ok: false });
});

it.each(['done', 'tap'] as const)('requests one read-only verdict after repeated observations (%s)', async lastTool => {
  const { agent, session } = makeSession();
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  const dump = { tool: 'dump', args: { reason: 'Checking results' } };
  const verdict = lastTool === 'done'
    ? { tool: 'done', args: { success: true, summary: 'Result is visible' } }
    : { tool: 'tap', args: { nodeId: 'button' } };
  session.gateway.next = jest.fn()
    .mockResolvedValueOnce({ session_id: 'local', step: 1, action: dump })
    .mockResolvedValueOnce({ session_id: 'local', step: 2, action: dump })
    .mockResolvedValueOnce({ session_id: 'local', step: 3, action: dump })
    .mockResolvedValueOnce({ session_id: 'local', step: 4, action: verdict });
  session.safeDump = jest.fn().mockResolvedValue(tree);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValue('none');
  jest.spyOn(agent, 'dump').mockResolvedValue(tree);
  const tap = jest.spyOn(agent, 'tap');
  const run = session.run('Find the visible result');
  await tickUntil(() => session.gateway.next.mock.calls.length === 4);
  const result = await run;
  expect(result.success).toBe(lastTool === 'done');
  expect(session.gateway.next).toHaveBeenCalledTimes(4);
  expect(tap).not.toHaveBeenCalled();
});

it('returns no observation when fresh dump fails instead of reusing an ordinary cached page', async () => {
  const { agent, session } = makeSession();
  jest.spyOn(agent, 'dump').mockRejectedValue(new Error('unreadable'));
  jest.spyOn(agent, 'getLastTree').mockReturnValue(tree);
  await expect(session.safeDump()).resolves.toBeNull();
});


it('does not perform a second coordinate tap when a host callback has an uncertain result', async () => {
  const agent = new KokoAgent({ confirmation: { requireUserConfirm: false } });
  const callback = jest.fn().mockResolvedValue(undefined);
  HostActionsStore.registerActions([{ id: 'continue', text: 'Continue', label: 'Continue', run: callback }]);
  const result = agent.tap({ selector: { match: [{ text: 'Continue' }] }, options: { silent: true } });
  const outcome = expect(result).rejects.toBeInstanceOf(ActionOutcomeUnknownError);
  await jest.advanceTimersByTimeAsync(1000);
  await outcome;
  expect(callback).toHaveBeenCalledTimes(1);
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('does not start a session or ask for confirmation if stopped while its checkpoint was being persisted', async () => {
  const { agent, session } = makeSession();
  const begin = jest.spyOn(session.gateway, 'beginSession');
  session.stop();
  await expect(session.run('ordinary goal')).resolves.toMatchObject({ success: false, summary: 'Cancelled' });
  expect(begin).not.toHaveBeenCalled();
  expect((agent as any).activeSession).toBeNull();
});

it('shares execution ownership with sessions started through the public createSession API', async () => {
  const { agent, session } = makeSession();
  const pending = deferred<any>();
  session.gateway.beginSession = jest.fn().mockReturnValue(pending.promise);
  const first = session.run('ordinary goal');
  await expect(agent.runGoal('another goal', { token: 'local-test' })).rejects.toThrow('already running');
  await expect(session.run('same session twice')).rejects.toThrow('already running');
  const second = agent.createSession({ token: 'local-test' });
  await expect(second.run('other session')).rejects.toThrow('already running');
  agent.stop();
  pending.resolve({ session_id: 'local' });
  await expect(first).resolves.toMatchObject({ success: false, summary: 'Cancelled' });
  expect((agent as any).activeSession).toBeNull();
});


it('rejects fabricated OCR coordinate ids without using the embedded point', async () => {
  const agent = new KokoAgent();
  await expect((agent as any).resolvePoint({ nodeId: 'ocr:100:200' })).rejects.toThrow('not observed locally');
  expect(NativeBridge.recognizeScreenText).not.toHaveBeenCalled();
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('returns only the requested label for a unique on-device OCR match', async () => {
  const agent = new KokoAgent();
  const blank = { ...tree, children: [] };
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  (NativeBridge.recognizeScreenText as jest.Mock).mockResolvedValue({ texts: [
    { text: 'CONNECT WALLET', confidence: 0.95, frame: { x: 100, y: 200, width: 150, height: 40 } },
    { text: 'SYNTHETIC_PRIVATE_SCREEN_CONTENT', confidence: 0.9, frame: { x: 10, y: 400, width: 150, height: 40 } },
  ] });
  const found = await agent.find({ match: [{ text: 'Connect wallet' }] }, blank);
  expect(found?.text).toBe('Connect wallet');
  expect(JSON.stringify(found)).not.toContain('SYNTHETIC_PRIVATE_SCREEN_CONTENT');
  expect(found?.id).toMatch(/^ocr:local-/);
});

it('does not claim OCR can validate additional selector conditions', async () => {
  const agent = new KokoAgent();
  const blank = { ...tree, children: [] };
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  const found = await agent.find({ match: [{ text: 'Continue' }, { nearText: 'Item B' }] }, blank);
  expect(found).toBeNull();
  expect(NativeBridge.recognizeScreenText).not.toHaveBeenCalled();
});

it('revalidates a translated web action inside the current web view before any tap', async () => {
  const agent = new KokoAgent();
  const page: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, clickable: false, frame: { x: 0, y: 100, width: 400, height: 600 }, children: [] }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(page);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  const hit = { text: '连接', confidence: 1, frame: { x: 320, y: 210, width: 30, height: 20 } };
  (NativeBridge.recognizeScreenText as jest.Mock).mockResolvedValue({ texts: [hit] });
  const found = await agent.find({ match: [{ text: 'Connect wallet' }] }, page);
  expect(found?.text).toBe('Connect wallet');
  await expect((agent as any).resolvePoint({ nodeId: found!.id })).resolves.toEqual({ x: 335, y: 220 });
  (NativeBridge.recognizeScreenText as jest.Mock).mockResolvedValue({ texts: [{ ...hit, frame: { ...hit.frame, y: 50 } }] });
  await expect((agent as any).resolvePoint({ nodeId: found!.id })).rejects.toThrow('no longer visible');
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('dispatches an observed OCR target only after revalidating it at tap time', async () => {
  const agent = new KokoAgent({ observer: false, confirmation: { requireUserConfirm: false } });
  const page: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, clickable: false, frame: { x: 0, y: 100, width: 400, height: 600 }, children: [] }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(page);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  (NativeBridge.recognizeScreenText as jest.Mock).mockResolvedValue({ texts: [
    { text: '连接', confidence: 1, frame: { x: 320, y: 210, width: 30, height: 20 } },
  ] });
  const found = await agent.find({ match: [{ text: 'Connect wallet' }] }, page);
  expect(found?.id).toMatch(/^ocr:local-/);
  const result = agent.tap({ nodeId: found!.id, label: 'Connect wallet', options: { silent: true } });
  await jest.runAllTimersAsync();
  await expect(result).resolves.toBeUndefined();
  expect(NativeBridge.recognizeScreenText).toHaveBeenCalledTimes(4);
  expect(NativeBridge.tap).toHaveBeenCalledTimes(1);
  expect(NativeBridge.tap).toHaveBeenCalledWith({ x: 335, y: 220 });
});

it('passes only goal-derived evidence to planning and resolves a web label locally', async () => {
  const { agent, session } = makeSession();
  const page: ViewNode = { ...tree, children: [{ ...tree.children[0]!, id: 'web', type: 'RNCWebView',
    text: undefined, clickable: false, frame: { x: 0, y: 100, width: 400, height: 600 }, children: [] }] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(page);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  (NativeBridge.recognizeScreenText as jest.Mock).mockResolvedValue({ texts: [
    { text: '连接', confidence: 1, frame: { x: 320, y: 210, width: 30, height: 20 } },
    { text: 'SYNTHETIC_PRIVATE_OCR_CONTENT', confidence: 1, frame: { x: 20, y: 400, width: 100, height: 20 } },
  ] });
  (onDeviceAssist.buildOnDeviceAssist as jest.Mock).mockResolvedValue({
    intent: 'tap', confidence: 1, tokens: [], ocrTokens: [], ranked: [], modelText: '', backend: 'test',
    goalOcrLabels: ['connect wallet'],
  });
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  session.gateway.next = jest.fn()
    .mockResolvedValueOnce({ session_id: 'local', step: 1, action: { tool: 'find', args: { match: [{ text: 'connect wallet' }] } } })
    .mockResolvedValueOnce({ session_id: 'local', step: 2, action: { tool: 'done', args: { success: true, summary: 'Located' } } });
  session.safeDump = jest.fn().mockResolvedValue(page);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValue('none');
  const run = session.run('Connect my wallet');
  await tickUntil(() => session.gateway.next.mock.calls.length === 2);
  await expect(run).resolves.toMatchObject({ success: true });
  const firstRequest = session.gateway.next.mock.calls[0][0];
  const secondRequest = session.gateway.next.mock.calls[1][0];
  expect(firstRequest.local_ocr_goal_labels).toEqual(['connect wallet']);
  expect(secondRequest.history[0].result).toContain('ocr:local-');
  expect(JSON.stringify(secondRequest.history)).not.toContain('SYNTHETIC_PRIVATE_OCR_CONTENT');
  expect(JSON.stringify(secondRequest.history)).not.toContain('连接');
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('rechecks an observed OCR target and uses its current frame after the text moves', async () => {
  const agent = new KokoAgent();
  const blank = { ...tree, children: [] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(blank);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  (NativeBridge.recognizeScreenText as jest.Mock)
    .mockResolvedValueOnce({ texts: [{ text: 'Continue', confidence: 1, frame: { x: 20, y: 200, width: 100, height: 40 } }] })
    .mockResolvedValueOnce({ texts: [{ text: 'Continue', confidence: 1, frame: { x: 140, y: 400, width: 100, height: 40 } }] });
  const found = await agent.find({ match: [{ text: 'Continue' }] }, blank);
  expect(found?.id).toMatch(/^ocr:local-/);
  expect(found?.id).not.toContain('200');
  await expect((agent as any).resolvePoint({ nodeId: found!.id })).resolves.toEqual({ x: 190, y: 420 });
  expect(NativeBridge.recognizeScreenText).toHaveBeenCalledTimes(2);
});

it.each(['disappeared', 'outside the window'])('rejects an OCR target that is %s on re-observation', async condition => {
  const agent = new KokoAgent();
  const blank = { ...tree, children: [] };
  (NativeBridge.dump as jest.Mock).mockResolvedValue(blank);
  (NativeBridge.isAvailable as jest.Mock).mockReturnValue(true);
  const oldHit = { text: 'Continue', confidence: 1, frame: { x: 20, y: 200, width: 100, height: 40 } };
  (NativeBridge.recognizeScreenText as jest.Mock)
    .mockResolvedValueOnce({ texts: [oldHit] })
    .mockResolvedValueOnce({ texts: condition === 'disappeared' ? [] : [{ ...oldHit, frame: { ...oldHit.frame, y: 1200 } }] });
  const found = await agent.find({ match: [{ text: 'Continue' }] }, blank);
  await expect((agent as any).resolvePoint({ nodeId: found!.id })).rejects.toThrow('no longer visible');
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it.each(['Click Back', '返回上一页，请保留当前设置'])('does not treat narration %s as an exact node label', async label => {
  const agent = new KokoAgent();
  await expect((agent as any).resolvePoint({ nodeId: 'button', label })).resolves.toEqual({ x: 110, y: 225 });
});

it('uses an explicit selector over a recycled node id and rejects disabled node-only targets', async () => {
  const agent = new KokoAgent();
  (NativeBridge.dump as jest.Mock).mockResolvedValue({ ...tree, children: [
    { ...tree.children[0], id: 'old-row', text: 'Delete', enabled: false },
    { ...tree.children[0], id: 'new-row', frame: { x: 40, y: 300, width: 180, height: 50 } },
  ] });
  await expect((agent as any).resolvePoint({ nodeId: 'old-row', selector: { match: [{ text: 'Continue' }] } }))
    .resolves.toEqual({ x: 130, y: 325 });
  await expect((agent as any).resolvePoint({ nodeId: 'old-row', label: 'Delete' })).rejects.toThrow('no longer visible or enabled');
});


it('returns an explicit pre-dispatch validation miss without replaying the action', async () => {
  const { session } = makeSession();
  session.executeOnce = jest.fn().mockRejectedValue(new ActionValidationError('target is no longer visible'));
  await expect(session.executeWithRetry({ tool: 'tap', args: {} })).resolves.toEqual({ ok: false, result: 'pre_dispatch: target is no longer visible' });
  expect(session.executeOnce).toHaveBeenCalledTimes(1);
});

it('lets the planner reconsider navigation after a missing visible target', async () => {
  const { session } = makeSession();
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  session.gateway.next = jest.fn()
    .mockResolvedValueOnce({ session_id: 'local', step: 1, action: { tool: 'tap', args: { selector: { match: [{ text: 'Missing target' }] } } } })
    .mockResolvedValueOnce({ session_id: 'local', step: 2, action: { tool: 'done', args: { success: false, summary: 'Choose a different route' } } });
  session.safeDump = jest.fn().mockResolvedValue(tree);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValue('none');
  const run = session.run('inspect ordinary controls');
  await tickUntil(() => session.gateway.next.mock.calls.length === 2);
  await expect(run).resolves.toMatchObject({ summary: 'Choose a different route' });
  expect(session.history[0]).toMatchObject({ tool: 'tap', ok: false });
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});


it('rejects a recycled node id when the current control differs from the planner observation', async () => {
  const agent = new KokoAgent();
  agent.activeGoal = 'Continue onboarding';
  agent.setPlanningTree(tree);
  (NativeBridge.dump as jest.Mock).mockResolvedValue({ ...tree, children: [
    { ...tree.children[0], text: 'Delete account' },
  ] });
  await expect((agent as any).resolvePoint({ nodeId: 'button', label: 'Click Continue' })).rejects.toBeInstanceOf(ActionValidationError);
  await expect((agent as any).resolveNode({ nodeId: 'button' })).rejects.toThrow('target changed');
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});

it('uses the current frame when the observed control moved without changing its identity', async () => {
  const agent = new KokoAgent();
  agent.activeGoal = 'Continue onboarding';
  agent.setPlanningTree(tree);
  (NativeBridge.dump as jest.Mock).mockResolvedValue({ ...tree, children: [
    { ...tree.children[0], frame: { x: 80, y: 350, width: 180, height: 50 } },
  ] });
  await expect((agent as any).resolvePoint({ nodeId: 'button', label: 'Click Continue' })).resolves.toEqual({ x: 170, y: 375 });
});


it('keeps every English local activity message free of Chinese when labels and input are English', async () => {
  const agent = new KokoAgent({ locale: 'zh', confirmation: { requireUserConfirm: false } });
  agent.startTask('Inspect ordinary controls');
  await agent.dump();
  await agent.find({ match: [{ text: 'Continue' }] });
  for (const act of [
    () => agent.tap({ selector: { match: [{ text: 'Continue' }] } }),
    () => agent.swipe({ x: 200, y: 500 }, { x: 200, y: 300 }),
    () => agent.pinch({ x: 200, y: 300 }, 1.2),
    () => agent.type('hello'),
    () => agent.requestConfirm({ action: 'tap', label: 'Continue' }),
  ]) {
    const pending = act();
    await jest.runAllTimersAsync();
    await pending;
  }
  const activity = TaskStore.snapshot().tasks[0].nodes.filter(node => node.kind !== 'user');
  expect(activity.map(node => node.kind)).toEqual(['dump', 'find', 'tap', 'swipe', 'swipe', 'type', 'confirm']);
  expect(activity.every(node => !/\p{Script=Han}/u.test(node.title))).toBe(true);
  expect(activity.some(node => node.title === 'Typed “hello”')).toBe(true);
  expect(Object.values(runtimeEn).every(copy => !/\p{Script=Han}/u.test(copy))).toBe(true);
});

it('switches active and historical SDK templates while preserving host labels and original user text', () => {
  const stop = TaskStore.subscribe(() => {});
  TaskStore.startTask('用户的原始目标');
  const local = TaskStore.appendNode({ kind: 'tap', title: message('runtime.tap', { label: '设置' }), status: 'running' });
  expect(TaskStore.snapshot().subtitle).toBe('Tapping “设置”');
  HostAppearanceStore.set({ locale: 'zh-CN' });
  expect(TaskStore.snapshot().subtitle).toBe('点击「设置」');
  TaskStore.updateNode(local.id, { title: message('runtime.tapped', { label: '设置' }), status: 'done' });
  TaskStore.finishTask('success');
  HostAppearanceStore.set({ locale: 'en-US' });
  expect(TaskStore.snapshot().tasks[0].nodes.at(-1)?.title).toBe('Tapped “设置”');
  expect(TaskStore.snapshot().tasks[0].title).toBe('用户的原始目标');
  stop();
});

it('updates a waiting private-step message when the host language changes', () => {
  const stop = TaskStore.subscribe(() => {});
  TaskStore.startTask('Local private step');
  const gate = { kind: 'password' as const, label: 'Password', nodeId: 'password' };
  TaskStore.setUserGateWaiting(gateMessageValue(gate));
  expect(TaskStore.snapshot().subtitle).toContain('Enter your password');
  HostAppearanceStore.set({ locale: 'zh' });
  expect(TaskStore.snapshot().subtitle).toContain('请在 App 内输入密码');
  expect(gateMessage(gate)).toContain('请在 App 内输入密码');
  HostAppearanceStore.set({ locale: 'en' });
  expect(TaskStore.snapshot().subtitle).toContain('Enter your password');
  stop();
});

it('localizes Chinese operation errors and generated task defaults when the host requests Chinese', async () => {
  HostAppearanceStore.set({ locale: 'zh' });
  const unknown = new ActionOutcomeUnknownError('developer diagnostic remains unchanged');
  expect(unknown.message).toContain('已停止');
  expect(unknown.detail).toBe('developer diagnostic remains unchanged');
  expect(TaskStore.ensureActiveTask()).toBeTruthy();
  expect(TaskStore.snapshot().tasks[0].title).toBe('Koko 任务');
  const agent = new KokoAgent({ locale: 'en' });
  await expect((agent as any).resolvePoint({ nodeId: 'absent' })).rejects.toThrow('未找到可见目标');
  HostAppearanceStore.set({ locale: 'en' });
  expect(resolveText(unknown.localizedMessage)).not.toMatch(/\p{Script=Han}/u);
});

it('requests the latest host language and discards a response from the previous language', async () => {
  HostAppearanceStore.set({ locale: 'zh' });
  const { session } = makeSession();
  const oldResponse = deferred<any>();
  const narration = jest.fn();
  session.opts.onNarration = narration;
  session.gateway.beginSession = jest.fn().mockResolvedValue({ session_id: 'local' });
  session.gateway.next = jest.fn().mockReturnValueOnce(oldResponse.promise).mockResolvedValue({
    session_id: 'local', step: 2, narration: 'The inspection is complete.',
    action: { tool: 'done', args: { success: true, summary: 'Inspection complete.' } },
  });
  session.safeDump = jest.fn().mockResolvedValue(tree);
  session.waitForAppUserGateIfNeeded = jest.fn().mockResolvedValue('none');
  const run = session.run('Inspect current page');
  await tickUntil(() => session.gateway.next.mock.calls.length > 0);
  expect(session.gateway.next.mock.calls[0][0].locale).toBe('zh-CN');
  HostAppearanceStore.set({ locale: 'en-US' });
  oldResponse.resolve({ session_id: 'local', step: 1, narration: '旧语言消息不应再显示',
    action: { tool: 'done', args: { success: true, summary: '旧语言结果' } },
  });
  await expect(run).resolves.toMatchObject({ success: true, summary: 'Inspection complete.' });
  expect(session.gateway.next.mock.calls[1][0].locale).toBe('en-US');
  expect(narration).toHaveBeenCalledWith('The inspection is complete.');
  expect(narration).not.toHaveBeenCalledWith('旧语言消息不应再显示');
  expect(TaskStore.snapshot().resultFlash?.message).toBe('Inspection complete.');
});
