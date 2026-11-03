import { webResultCategory } from '../webResultCategory';
import type { ViewNode } from '../../types';
const node = (id: string, type: string, text: string, clickable = false, children: ViewNode[] = []): ViewNode => ({
  id, type, text, clickable, children, visible: true, enabled: true, frame: { x: 0, y: 0, width: 100, height: 40 },
});
const root = (): ViewNode => node('0', 'View', '', false, [
  node('0/0', 'UITextField', 'Example'), node('0/1', 'Button', 'Tokens', true), node('0/2', 'Button', 'dApps', true),
]);
const goal = 'Open Example and connect my wallet';
it('chooses the app category for an observed relevant wallet-connection search', () => {
  expect(webResultCategory({ tool: 'dump' }, root(), goal, [])).toMatchObject({ tool: 'tap', args: { nodeId: '0/2' } });
});
it('does not override actions, unrelated searches, selected tabs or a previous attempt', () => {
  expect(webResultCategory({ tool: 'find', args: { match: [] } }, root(), goal, [])).toBeNull();
  expect(webResultCategory({ tool: 'dump' }, root(), 'Connect my wallet to another site', [])).toBeNull();
  const selected = root(); selected.children[2]!.selected = true;
  expect(webResultCategory({ tool: 'dump' }, selected, goal, [])).toBeNull();
  expect(webResultCategory({ tool: 'dump' }, root(), goal, [{ tool: 'tap', args: { nodeId: '0/2' }, result: 'no change' }])).toBeNull();
});
