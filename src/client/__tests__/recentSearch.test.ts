import { recentSearchAction } from '../recentSearch';
import type { ViewNode } from '../../types';
import type { GatewayAction } from '../GatewayClient';

const node = (id: string, type: string, text: string, children: ViewNode[] = [], clickable = false): ViewNode => ({
  id, type, text, children, clickable, visible: true, enabled: true,
  frame: { x: 0, y: 0, width: 200, height: 100 },
});
const tree = () => ({ ...node('0', 'View', '', [
  node('0/0', 'UITextField', 'Search accounts, tokens, dApps...'),
  node('0/1', 'View', '', [node('0/1/0', 'Text', 'Recent'),
    node('0/1/1', 'Button', 'Example', [], true)]),
]), frame: { x: 0, y: 0, width: 400, height: 800 } });
const action: GatewayAction = { tool: 'type', args: { text: 'Example' } };
const goal = 'Open Example dApp';

it('uses the unique visible recent match for a navigation search', () => {
  expect(recentSearchAction(action, tree(), goal)).toMatchObject({ tool: 'tap', args: { nodeId: '0/1/1' } });
});
it('treats nested RN input wrappers as one field', () => {
  const t = tree();
  t.children[0] = node('0/0', 'RCTTextInputComponentView', 'Search', [
    node('0/0/0', 'RCTUITextField', 'Search', [node('0/0/0/0', 'UITextFieldLabel', 'Search')]),
  ]);
  expect(recentSearchAction(action, t, goal)).toMatchObject({ tool: 'tap', args: { nodeId: '0/1/1' } });
});
it('does not replace an explicitly requested input or an unrelated query', () => {
  expect(recentSearchAction(action, tree(), 'Type Example into search')).toBeNull();
  expect(recentSearchAction(action, tree(), 'Open another dApp')).toBeNull();
});
it('does not choose ambiguous, hidden or unrelated history entries', () => {
  const duplicate = tree();
  duplicate.children[1]!.children.push(node('0/1/2', 'Button', 'Example', [], true));
  expect(recentSearchAction(action, duplicate, goal)).toBeNull();
  const hidden = tree(); hidden.children[1]!.children[1]!.visible = false;
  expect(recentSearchAction(action, hidden, goal)).toBeNull();
  const unrelated = tree(); unrelated.children[1]!.children[0]!.text = 'Popular';
  expect(recentSearchAction(action, unrelated, goal)).toBeNull();
});
it('requires a search field and refuses explicit non-search selectors', () => {
  const t = tree(); t.children[0]!.text = 'Name';
  expect(recentSearchAction(action, t, goal)).toBeNull();
  expect(recentSearchAction({ tool: 'type', args: { text: 'Example', selector: { match: [{ testID: 'other' }] } } }, tree(), goal)).toBeNull();
  const labelled = tree(); labelled.children[0]!.testID = 'search-box';
  expect(recentSearchAction({ tool: 'type', args: { text: 'Example', selector: { match: [{ testID: 'search-box' }] } } }, labelled, goal)).toMatchObject({ tool: 'tap' });
});
