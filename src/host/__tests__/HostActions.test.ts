import type { ViewNode } from '../../types';
import {
  filterVisibleHostActions,
  hostActionsModelText,
  setHostActions,
  HostActionsStore,
  clearHostActions,
  canRunHostActionForNode,
} from '../HostActions';
import { find } from '../../selector/match';

function node(partial: Partial<ViewNode> & { id: string; type: string }): ViewNode {
  return {
    frame: { x: 0, y: 0, width: 100, height: 40 },
    children: [],
    visible: true,
    enabled: true,
    clickable: false,
    ...partial,
  };
}

describe('HostActions', () => {
  afterEach(() => clearHostActions());

  it('emits text hints without fake host node ids', () => {
    const text = hostActionsModelText([
      {
        id: 'onboarding.create',
        label: '创建钱包',
        kind: 'button',
        text: '创建钱包',
      },
    ]);
    expect(text).toContain('text「创建钱包」');
    expect(text).not.toMatch(/id=host:/);
  });

  it('hides catalog entries not present on current dump', () => {
    setHostActions([
      {
        id: 'onboarding.create',
        label: '创建钱包',
        text: '创建钱包',
      },
      { id: 'tab.home', label: '钱包', text: '钱包', kind: 'tab' },
    ]);
    const home: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTText',
          text: '钱包',
          clickable: true,
        }),
        node({
          id: '0/2',
          type: 'RCTText',
          text: '交易',
          clickable: true,
        }),
      ],
    });
    const visible = filterVisibleHostActions(HostActionsStore.getActions(), home);
    expect(visible.map((a) => a.id)).toEqual(['tab.home']);
  });

  it('does not treat a mounted callback as proof that its control is visible', () => {
    setHostActions([
      {
        id: 'onboarding.create',
        label: '创建钱包',
        text: '创建钱包',
        run: () => undefined,
      },
      { id: 'tab.home', label: '钱包', text: '钱包', kind: 'tab' },
    ]);
    const chromeOnly: ViewNode = node({
      id: '0',
      type: 'RCTView',
      children: [
        node({ id: '0/1', type: 'RCTText', text: '钱包', clickable: true }),
      ],
    });
    const visible = filterVisibleHostActions(
      HostActionsStore.getActions(),
      chromeOnly,
    );
    expect(visible.map((a) => a.id)).toEqual(['tab.home']);
  });

  it('hides tab host run when bottom chrome is not in dump', () => {
    setHostActions([
      {
        id: 'tab.discovery',
        label: '发现',
        text: '发现',
        kind: 'tab',
        oneshot: false,
        run: () => undefined,
      },
      {
        id: 'onboarding.create',
        label: '创建钱包',
        text: '创建钱包',
        run: () => undefined,
      },
    ]);
    const onboarding: ViewNode = node({
      id: '0',
      type: 'RCTView',
      children: [
        node({ id: '0/1', type: 'RCTText', text: 'Back', clickable: true }),
      ],
    });
    const visible = filterVisibleHostActions(
      HostActionsStore.getActions(),
      onboarding,
    );
    expect(visible.map((a) => a.id)).toEqual([]);
  });

  it('does not resolve 偏好设置 to bare 设置 host action', () => {
    setHostActions([
      {
        id: 'chrome.openSettings',
        label: '设置',
        text: '设置',
        aliases: ['Settings'],
        run: () => undefined,
      },
      {
        id: 'chrome.openPreferences',
        label: '偏好设置',
        text: '偏好设置',
        aliases: ['Preferences'],
        run: () => undefined,
      },
    ]);
    expect(HostActionsStore.findForTap({ label: '偏好设置' })?.id).toBe(
      'chrome.openPreferences',
    );
    expect(HostActionsStore.findForTap({ label: '设置' })?.id).toBe(
      'chrome.openSettings',
    );
  });

  it('keeps a visible Settings tab available to any goal', () => {
    setHostActions([{ id: 'settings', label: 'Settings', kind: 'tab', run: () => {} }]);
    expect(filterVisibleHostActions(HostActionsStore.getActions(), node({
      id: 'settings-tab', type: 'Button', text: 'Settings', clickable: true,
    }))).toHaveLength(1);
  });

  it('does not choose the first callback for repeated row labels', () => {
    setHostActions([
      { id: 'delete-a', label: 'Delete', testID: 'delete-a', run: () => {} },
      { id: 'delete-b', label: 'Delete', testID: 'delete-b', run: () => {} },
    ]);
    expect(HostActionsStore.findForTap({ text: 'Delete' })).toBeUndefined();
    expect(HostActionsStore.findForTap({ testID: 'delete-b', text: 'Delete' })?.id).toBe('delete-b');
    expect(HostActionsStore.findForTap({ testID: 'missing', text: 'Delete' })).toBeUndefined();
  });

  it('uses selector text rather than narration to choose a callback', () => {
    setHostActions([{ id: 'back', label: 'Back' }, { id: 'close', label: 'Close' }]);
    expect(HostActionsStore.findForTap({ label: 'Close', text: 'Back' })?.id).toBe('back');
    expect(HostActionsStore.findForTap({ text: 'Ba' })).toBeUndefined();
  });

});

describe('host callback binding to the selected native control', () => {
  const callback = jest.fn();
  const list = () => node({ id: 'list', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 }, children: ['A', 'B'].map((name, index) =>
    node({ id: `row-${name}`, type: 'View', frame: { x: 0, y: 100 + index * 100, width: 400, height: 80 }, children: [
      node({ id: `name-${name}`, type: 'Text', text: `Item ${name}` }),
      node({ id: `delete-${name}`, type: 'Button', text: 'Delete', testID: `delete-${name}`, clickable: true, frame: { x: 280, y: 100 + index * 100, width: 100, height: 44 } }),
    ] }),
  ) });

  afterEach(clearHostActions);

  it.each([
    { match: [{ text: 'Delete' }, { clickable: true }], index: 1 },
    { match: [{ text: 'Delete' }, { nearText: 'Item B' }, { clickable: true }] },
  ])('does not execute the only registered Delete callback for a different selected row', selector => {
    const tree = list();
    setHostActions([{ id: 'delete-A', label: 'Delete', run: callback }]);
    const action = HostActionsStore.findForTap({ text: 'Delete', label: 'Delete item A' });
    const selected = find(tree, selector);
    expect(selected?.id).toBe('delete-B');
    expect(action).toBeDefined();
    expect(canRunHostActionForNode(action!, selected, tree)).toBe(false);
  });

  it('requires a registered testID to belong to the selected control, even when labels are identical', () => {
    const tree = list();
    const action = { id: 'delete-A', label: 'Delete', testID: 'delete-A', run: callback };
    expect(canRunHostActionForNode(action, tree.children[0].children[1], tree)).toBe(true);
    expect(canRunHostActionForNode(action, tree.children[1].children[1], tree)).toBe(false);
  });

  it('does not fall back to text when the explicit identity is missing or duplicated', () => {
    const tree = list();
    const selected = tree.children[1].children[1];
    expect(canRunHostActionForNode({ id: 'missing', label: 'Delete', testID: 'missing', run: callback }, selected, tree)).toBe(false);
    tree.children[0].children[1].testID = 'delete-B';
    expect(canRunHostActionForNode({ id: 'duplicate', label: 'Delete', testID: 'delete-B', run: callback }, selected, tree)).toBe(false);
  });

  it('collapses native label wrappers of the same real control without assuming path IDs', () => {
    const leaf = node({ id: 'label', type: 'Text', text: 'Continue', testID: 'continue-label' });
    const control = node({ id: 'button', type: 'Button', text: 'Continue', clickable: true, children: [leaf] });
    const tree = node({ id: 'screen', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 }, children: [control] });
    expect(canRunHostActionForNode({ id: 'continue', label: 'Continue', run: callback }, leaf, tree)).toBe(true);
    expect(canRunHostActionForNode({ id: 'continue', label: 'Continue', testID: 'continue-label', run: callback }, control, tree)).toBe(true);
  });

  it('rejects hidden, disabled, offscreen and stale selected controls', () => {
    const action = { id: 'delete-A', label: 'Delete', testID: 'delete-A', run: callback };
    for (const mutation of [
      { visible: false }, { enabled: false }, { frame: { x: 280, y: 1200, width: 100, height: 44 } },
    ]) {
      const tree = list();
      const selected = { ...tree.children[0].children[1] };
      Object.assign(tree.children[0].children[1], mutation);
      expect(canRunHostActionForNode(action, selected, tree)).toBe(false);
    }
    const tree = list();
    expect(canRunHostActionForNode(action, { ...tree.children[0].children[1], text: 'Old label' }, tree)).toBe(false);
  });

  it('does not let narration change the selector-selected callback identity', () => {
    const tree = node({ id: 'screen', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 }, children: [
      node({ id: 'back', type: 'Button', text: 'Back', clickable: true }),
      node({ id: 'close', type: 'Button', text: 'Close', clickable: true }),
    ] });
    setHostActions([{ id: 'back', label: 'Back', run: callback }, { id: 'close', label: 'Close', run: callback }]);
    const selected = find(tree, { match: [{ text: 'Back', exact: true }] });
    const action = HostActionsStore.findForTap({ label: 'Close', text: 'Back' });
    expect(action?.id).toBe('back');
    expect(canRunHostActionForNode(action!, selected, tree)).toBe(true);
    expect(canRunHostActionForNode(HostActionsStore.getById('close')!, selected, tree)).toBe(false);
  });
});
