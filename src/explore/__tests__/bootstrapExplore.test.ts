import { bootstrapExplore } from '../bootstrapExplore';
import { ExplorationGraph } from '../ExplorationGraph';
import { clearAppUserGate, setAppUserGate } from '../../privacy/userGate';
import type { ViewNode } from '../../types';

const node = (id: string, partial: Partial<ViewNode> = {}): ViewNode => ({
  id, type: 'View', visible: true, enabled: true, clickable: false,
  frame: { x: 0, y: 0, width: 400, height: 800 }, children: [], ...partial,
});
const screen = (children: ViewNode[], partial: Partial<ViewNode> = {}) => node('root', { children, ...partial });
const button = (label: string) => node(`button-${label}`, { text: label, type: 'Button', clickable: true, frame: { x: 20, y: 100, width: 200, height: 44 } });
const snapshot = { version: 1 as const, appKey: 'test', updatedAt: 0, nodes: [], edges: [] };

beforeEach(() => {
  jest.spyOn(ExplorationGraph, 'snapshot').mockReturnValue(snapshot);
  jest.spyOn(ExplorationGraph, 'setAppKey').mockImplementation(() => {});
  jest.spyOn(ExplorationGraph, 'ensureLoaded').mockResolvedValue();
  jest.spyOn(ExplorationGraph, 'observeScreen').mockReturnValue({ id: 'public', labels: [], fingerprint: 'public', seenAt: 0, visitCount: 1 });
  jest.spyOn(ExplorationGraph, 'persist').mockResolvedValue();
});
afterEach(() => { clearAppUserGate(); jest.restoreAllMocks(); });

const fakeAgent = (tree: ViewNode) => ({
  dump: jest.fn().mockResolvedValue(tree),
  tap: jest.fn(), swipe: jest.fn(), type: jest.fn(), log: jest.fn(),
});

it('observes only the current screen and never crawls despite legacy options', async () => {
  const agent = fakeAgent(screen([button('Settings'), button('Save'), button('Dismiss')]));
  const progress = jest.fn();
  const result = await bootstrapExplore(agent as any, { mode: 'full', maxSteps: 100, maxScreens: 40, appKey: 'example', onProgress: progress });
  expect(result).toMatchObject({ success: true, steps: 0 });
  expect(agent.dump).toHaveBeenCalledTimes(1);
  expect(agent.dump).toHaveBeenCalledWith({ silent: true });
  expect(agent.tap).not.toHaveBeenCalled();
  expect(agent.swipe).not.toHaveBeenCalled();
  expect(agent.type).not.toHaveBeenCalled();
  expect(agent.log).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
  expect(ExplorationGraph.setAppKey).toHaveBeenCalledWith('example');
  expect(ExplorationGraph.observeScreen).toHaveBeenCalledTimes(1);
});

it('does not persist field values or read-only body copy', async () => {
  const agent = fakeAgent(screen([button('Settings'), node('body', { text: 'SYNTHETIC_BODY_VALUE' }), node('field', { type: 'TextInput', text: 'SYNTHETIC_FIELD_VALUE' })]));
  await bootstrapExplore(agent as any);
  expect(ExplorationGraph.observeScreen).toHaveBeenCalledWith(['Settings']);
});

it('does not persist a full-screen Pressable wrapper aggregated with input values', async () => {
  const tree = screen([button('Settings'), node('field', { type: 'TextInput', text: 'SYNTHETIC_FIELD_VALUE' })], {
    clickable: true, text: 'Settings SYNTHETIC_FIELD_VALUE',
  });
  await bootstrapExplore(fakeAgent(tree) as any);
  expect(ExplorationGraph.observeScreen).toHaveBeenCalledWith(['Settings']);
});

it('redacts key-shaped labels before graph label truncation', async () => {
  await bootstrapExplore(fakeAgent(screen([button(`0x${'c'.repeat(64)}`)])) as any);
  expect(ExplorationGraph.observeScreen).toHaveBeenCalledWith(['[redacted]']);
});

it.each([
  screen([node('secret', { secure: true, type: 'TextInput', text: 'SYNTHETIC_SECRET' })]),
  screen([button('SYNTHETIC_SECRET')], { testID: 'privacy-sensitive-mnemonic' }),
  screen([node('title', { text: '验证码' }), node('field', { type: 'TextInput', text: 'SYNTHETIC_SECRET' })]),
])('records no graph data from private screens', async tree => {
  const agent = fakeAgent(tree);
  const result = await bootstrapExplore(agent as any, { appKey: 'private' });
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
  expect(ExplorationGraph.observeScreen).not.toHaveBeenCalled();
  expect(ExplorationGraph.persist).not.toHaveBeenCalled();
  expect(ExplorationGraph.setAppKey).not.toHaveBeenCalled();
  expect(agent.tap).not.toHaveBeenCalled();
});

it('honors explicit host gates even when native controls look ordinary', async () => {
  setAppUserGate({ kind: 'private_key', label: 'Local input' });
  const result = await bootstrapExplore(fakeAgent(screen([button('Continue')])) as any);
  expect(result.success).toBe(false);
  expect(ExplorationGraph.observeScreen).not.toHaveBeenCalled();
});

it('does not guess a dismiss gesture for empty screens', async () => {
  const agent = fakeAgent(screen([]));
  const result = await bootstrapExplore(agent as any);
  expect(result.success).toBe(false);
  expect(agent.tap).not.toHaveBeenCalled();
  expect(agent.swipe).not.toHaveBeenCalled();
  expect(ExplorationGraph.observeScreen).not.toHaveBeenCalled();
});

it('returns a sanitized failure without replacing a missing execution permit', async () => {
  const agent = fakeAgent(screen([button('Settings')]));
  agent.dump.mockRejectedValue(new Error('Permission denied SYNTHETIC_SECRET'));
  const result = await bootstrapExplore(agent as any);
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
  expect(agent.tap).not.toHaveBeenCalled();
  expect(ExplorationGraph.ensureLoaded).not.toHaveBeenCalled();
});
