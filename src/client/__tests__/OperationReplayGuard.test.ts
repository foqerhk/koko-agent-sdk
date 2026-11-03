import { OperationReplayGuard } from '../OperationReplayGuard';
import type { ViewNode } from '../../types';
import type { GatewayAction } from '../GatewayClient';

function screen(label: string, copy = 'Choose an operation', id = '0/1'): ViewNode {
  return { id: '0', type: 'View', clickable: false, enabled: true, visible: true,
    frame: { x: 0, y: 0, width: 400, height: 800 }, children: [
      { id: '0/0', type: 'Text', text: copy, clickable: false, enabled: true, visible: true,
        frame: { x: 20, y: 100, width: 360, height: 100 }, children: [] },
      { id, type: 'Button', text: label, clickable: true, enabled: true, visible: true,
        frame: { x: 20, y: 700, width: 360, height: 44 }, children: [] },
    ] };
}
const tap = (id = '0/1'): GatewayAction => ({ tool: 'tap', args: { nodeId: id } });

it('blocks replay of a public create entry after a private handoff, even with a new node ID', () => {
  const guard = new OperationReplayGuard();
  guard.record(tap(), screen('创建新钱包'));
  expect(guard.blocks(tap(), screen('创建新钱包'))).toBe(false);
  guard.markHandoff();
  expect(guard.blocks(tap('0/9'), screen('创建新钱包', undefined, '0/9'))).toBe(true);
});

it('also prevents re-opening the same backup/reveal entry after a handoff', () => {
  const guard = new OperationReplayGuard();
  guard.record(tap(), screen('立即备份'));
  guard.markHandoff();
  expect(guard.blocks(tap(), screen('立即备份'))).toBe(true);
});

it('does not block ordinary repeated Next buttons or back navigation', () => {
  const guard = new OperationReplayGuard();
  for (const label of ['我已知晓', 'Next', 'Back']) guard.record(tap(), screen(label));
  guard.markHandoff();
  for (const label of ['我已知晓', 'Next', 'Back']) expect(guard.blocks(tap(), screen(label))).toBe(false);
});

it('keeps explicit host operation identities and requested new goals separate', () => {
  const guard = new OperationReplayGuard();
  const first = screen('Add', 'First operation');
  first.children[1].testID = 'add-address';
  guard.record(tap(), first);
  guard.markHandoff();
  const next = screen('Add', 'Next operation');
  next.children[1].testID = 'add-contact';
  expect(guard.blocks(tap(), next)).toBe(false);
  guard.reset();
  expect(guard.blocks(tap(), screen('Add', 'First operation'))).toBe(false);
});

it('does not let unrelated public copy reset a previously attempted operation', () => {
  const guard = new OperationReplayGuard();
  guard.record(tap(), screen('Create', 'Welcome to our app'));
  guard.markHandoff();
  expect(guard.blocks(tap('0/9'), screen('Create', 'Discover new features', '0/9'))).toBe(true);
});

it('uses the nearest explicit host container identity without using native paths', () => {
  const guard = new OperationReplayGuard();
  guard.record(tap(), { ...screen('Create'), testID: 'account-form' });
  guard.markHandoff();
  expect(guard.blocks(tap('0/9'), { ...screen('Create', undefined, '0/9'), testID: 'account-form' })).toBe(true);
  expect(guard.blocks(tap(), { ...screen('Create'), testID: 'project-form' })).toBe(false);
});

it('never records private page material as a replay key', () => {
  const guard = new OperationReplayGuard();
  const tree = { ...screen('Create', 'SYNTHETIC_PRIVATE_CONTENT'), testID: 'privacy-sensitive-mnemonic' };
  guard.record(tap(), tree);
  guard.markHandoff();
  expect(guard.blocks(tap(), tree)).toBe(false);
  expect((guard as any).attempts.size).toBe(0);
});

it('stores only public operation hashes rather than original text', () => {
  const guard = new OperationReplayGuard();
  guard.record(tap(), screen('Create', 'Public instructions'));
  expect([...((guard as any).attempts as Set<string>)]).toHaveLength(1);
  expect([...((guard as any).attempts as Set<string>)][0]).toMatch(/^[a-f0-9]+$/);
});
