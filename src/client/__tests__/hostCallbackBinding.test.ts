jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' },
  Dimensions: { get: () => ({ width: 400, height: 800 }) }, LogBox: {},
}), { virtual: true });
jest.mock('../../ui/KokoDialogHost', () => ({ DialogBus: {} }));
jest.mock('../../ui/progressChrome', () => ({ pointsOverlapProgressChrome: () => false }));
jest.mock('../../native/NativeBridge', () => ({ NativeBridge: {
  dump: jest.fn(), tap: jest.fn(), isAvailable: jest.fn(() => false),
} }));
jest.mock('../../cursor/controller', () => ({ CursorController: {
  moveTo: jest.fn(), hide: jest.fn(), showAt: jest.fn(), setPressing: jest.fn(),
} }));
jest.mock('../../commercial/ExecutionGuard', () => ({ ExecutionGuard: { assert: jest.fn() } }));
jest.mock('../../commercial/AccountStore', () => ({ AccountStore: { refresh: jest.fn() } }));
jest.mock('../AgentSession', () => ({ AgentSession: class {} }));

import { KokoAgent } from '../../KokoAgent';
import { NativeBridge } from '../../native/NativeBridge';
import { HostActionsStore } from '../../host/HostActions';
import type { Selector, ViewNode } from '../../types';

const node = (id: string, partial: Partial<ViewNode> = {}): ViewNode => ({
  id, type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
  visible: true, enabled: true, clickable: false, children: [], ...partial,
});
const list = (): ViewNode => node('root', { children: ['A', 'B'].map((name, index) =>
  node(`row-${name}`, { frame: { x: 0, y: 100 + index * 100, width: 400, height: 80 }, children: [
    node(`name-${name}`, { type: 'Text', text: `Item ${name}`, frame: { x: 20, y: 100 + index * 100, width: 100, height: 44 } }),
    node(`delete-${name}`, { type: 'Button', text: 'Delete', testID: `delete-${name}`, clickable: true, frame: { x: 280, y: 100 + index * 100, width: 100, height: 44 } }),
  ] }),
) });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  HostActionsStore.clear();
  (NativeBridge.dump as jest.Mock).mockResolvedValue(list());
});
afterEach(() => { HostActionsStore.clear(); jest.useRealTimers(); });

const secondRowSelectors: Selector[] = [
  { match: [{ text: 'Delete' }, { clickable: true }], index: 1 },
  { match: [{ text: 'Delete' }, { nearText: 'Item B' }, { clickable: true }] },
];

it.each(secondRowSelectors)('uses the selected row geometry when only another row has a registered callback', async selector => {
  const callback = jest.fn();
  HostActionsStore.registerActions([{ id: 'delete-A', label: 'Delete', run: callback }]);
  const agent = new KokoAgent({ locale: 'en', confirmation: { requireUserConfirm: false } });
  await agent.tap({ selector, label: 'Delete Item A', options: { silent: true, revealIfNeeded: false } });
  expect(callback).not.toHaveBeenCalled();
  expect(NativeBridge.tap).toHaveBeenCalledTimes(1);
  expect(NativeBridge.tap).toHaveBeenCalledWith({ x: 330, y: 222 });
});

it('does not route a second-row selector to the first-row callback with an explicit identity', async () => {
  const callback = jest.fn();
  HostActionsStore.registerActions([{ id: 'delete-A', label: 'Delete', testID: 'delete-A', run: callback }]);
  const agent = new KokoAgent({ locale: 'en', confirmation: { requireUserConfirm: false } });
  await agent.tap({ selector: secondRowSelectors[0], options: { silent: true, revealIfNeeded: false } });
  expect(callback).not.toHaveBeenCalled();
  expect(NativeBridge.tap).toHaveBeenCalledWith({ x: 330, y: 222 });
});

it('uses an explicitly bound second-row callback without performing a coordinate fallback', async () => {
  const callback = jest.fn(() => {
    (NativeBridge.dump as jest.Mock).mockResolvedValue(node('result', { children: [node('result-copy', { type: 'Text', text: 'Item removed' })] }));
  });
  HostActionsStore.registerActions([{ id: 'delete-B', label: 'Delete', testID: 'delete-B', run: callback }]);
  const agent = new KokoAgent({ locale: 'en', confirmation: { requireUserConfirm: false } });
  const tap = agent.tap({ selector: secondRowSelectors[0], options: { silent: true, revealIfNeeded: false } });
  await jest.advanceTimersByTimeAsync(1000);
  await tap;
  expect(callback).toHaveBeenCalledTimes(1);
  expect(NativeBridge.tap).not.toHaveBeenCalled();
});
