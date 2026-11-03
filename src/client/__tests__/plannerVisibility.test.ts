jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'ios' },
  Dimensions: { get: () => ({ width: 400, height: 800 }) }, LogBox: {},
}), { virtual: true });
jest.mock('../../ui/KokoDialogHost', () => ({ DialogBus: {} }));

import { AgentSession } from '../AgentSession';
import { KokoAgent } from '../../KokoAgent';
import { message } from '../../i18n';
import type { ViewNode } from '../../types';

const tree: ViewNode = {
  id: 'root', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
  clickable: false, children: [],
};

it('does not start a second session while an existing task owns execution', async () => {
  const createSession = jest.fn();
  await expect(KokoAgent.prototype.runGoal.call({ activeSession: {}, createSession } as any, 'another task'))
    .rejects.toThrow('already running');
  expect(createSession).not.toHaveBeenCalled();
});

it('a planner find miss observes the current page without an implicit scroll search', async () => {
  const reveal = jest.fn();
  const runtime = {
    activeGoal: 'create a wallet', revealVisibleTarget: reveal, message,
    track: () => ({ id: '' }), done: jest.fn(), fail: jest.fn(),
  };
  const agent = { find: jest.fn((selector, current) => KokoAgent.prototype.find.call(runtime as any, selector, current)) };
  const session = { agent, safeDump: async () => tree };
  expect(await (AgentSession.prototype as any).executeOnce.call(session, {
    tool: 'find', args: { match: [{ text: '创建钱包' }] },
  })).toBe('null');
  expect(reveal).not.toHaveBeenCalled();
});

it('planner taps explicitly disable implicit scroll searches', async () => {
  const tap = jest.fn();
  await (AgentSession.prototype as any).executeOnce.call({ agent: { tap } }, {
    tool: 'tap', args: { selector: { match: [{ text: '创建钱包' }] } },
  });
  expect(tap.mock.calls[0][0].options.revealIfNeeded).toBe(false);
});

it('a missing visible-only tap fails without scrolling, while SDK callers can still request reveal', async () => {
  const reveal = jest.fn(async () => ({ ...tree, id: 'found', text: 'Settings' }));
  const runtime = { dump: async () => tree, revealVisibleTarget: reveal, message, pointWithinWindow: async (point: unknown) => point };
  const target = { selector: { match: [{ text: 'Settings' }] }, options: { revealIfNeeded: false } };
  await expect((KokoAgent.prototype as any).resolvePoint.call(runtime, target)).rejects.toThrow('No visible target');
  expect(reveal).not.toHaveBeenCalled();
  await (KokoAgent.prototype as any).resolvePoint.call(runtime, { ...target, options: {} });
  expect(reveal).toHaveBeenCalledTimes(1);
});

it('does not discard nearText context when a selector does not match', async () => {
  const row: ViewNode = { ...tree, id: 'row', type: 'Button', text: 'Example', clickable: true,
    visible: true, enabled: true, frame: { x: 30, y: 200, width: 180, height: 40 } };
  const page: ViewNode = { ...tree, children: [row] };
  const runtime = { dump: async () => page, message, pointWithinWindow: async (point: unknown) => point };
  await expect((KokoAgent.prototype as any).resolvePoint.call(runtime, {
    selector: { match: [{ text: 'Example' }, { nearText: 'Other item' }] }, options: { revealIfNeeded: false },
  })).rejects.toThrow('No visible target');
});
