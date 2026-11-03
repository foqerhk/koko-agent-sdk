import { centerOf, find, findAll, flattenTree } from '../match';
import type { Selector, ViewNode } from '../../types';

describe('a search query and search result share the same label', () => {
  const frame = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const n = (id: string, extra: Partial<ViewNode> = {}): ViewNode => ({
    id, type: 'View', frame: frame(0, 0, 400, 800), visible: true, enabled: true,
    clickable: false, children: [], ...extra,
  });
  const root = n('0', { text: 'Search Example dApps Example', children: [
    n('0/0', { text: 'Example', clickable: true, frame: frame(10, 100, 380, 40), children: [
      n('0/0/0', { type: 'UITextField', text: 'Example', clickable: true, frame: frame(40, 100, 300, 40) }),
    ] }),
    n('0/1', { text: 'dApps Example', children: [
      n('0/1/0', { type: 'Text', text: 'dApps', frame: frame(20, 200, 100, 20) }),
      n('0/1/1', { text: 'Example', clickable: true, frame: frame(10, 240, 380, 60) }),
    ] }),
  ] });

  it('selects the result for a tap without changing ordinary find semantics', () => {
    const selector: Selector = { match: [{ text: 'Example' }, { clickable: true }], index: 0 };
    expect(find(root, selector, { preferNonInput: true })?.id).toBe('0/1/1');
    expect(find(root, selector)?.id).toBe('0/0');
  });

  it('keeps explicitly requested fields and does not lose the sole input', () => {
    expect(find(root, { match: [{ type: 'UITextField' }, { text: 'Example' }] }, { preferNonInput: true })?.id).toBe('0/0/0');
    const onlyInput = { ...root, children: [root.children[0]!] };
    expect(find(onlyInput, { match: [{ text: 'Example' }, { clickable: true }] }, { preferNonInput: true })).not.toBeNull();
  });
});

function node(
  partial: Partial<ViewNode> & Pick<ViewNode, 'id' | 'type' | 'frame'>,
): ViewNode {
  return {
    clickable: false,
    enabled: true,
    visible: true,
    children: [],
    ...partial,
  };
}

const tree: ViewNode = node({
  id: '0',
  type: 'RCTView',
  frame: { x: 0, y: 0, width: 390, height: 844 },
  children: [
    node({
      id: '0/0',
      type: 'RCTText',
      text: '到账金额 10 USDC',
      frame: { x: 20, y: 100, width: 200, height: 24 },
    }),
    node({
      id: '0/1',
      type: 'RCTView',
      clickable: true,
      text: '确认转账',
      frame: { x: 40, y: 700, width: 310, height: 48 },
      children: [
        node({
          id: '0/1/0',
          type: 'RCTText',
          text: '确认转账',
          frame: { x: 140, y: 712, width: 80, height: 20 },
        }),
      ],
    }),
    node({
      id: '0/2',
      type: 'RCTView',
      clickable: true,
      text: '取消',
      frame: { x: 40, y: 760, width: 310, height: 40 },
    }),
  ],
});

describe('selector match', () => {
  it('finds by text + clickable + nearText', () => {
    const selector: Selector = {
      match: [
        { text: '确认转账' },
        { clickable: true },
        { nearText: '到账金额' },
      ],
      index: 0,
    };
    const hit = find(tree, selector);
    expect(hit?.id).toBe('0/1');
    expect(centerOf(hit!).x).toBe(195);
  });

  it('findAll + index picks N-th', () => {
    const selector: Selector = {
      match: [{ clickable: true }],
      index: 1,
    };
    const all = findAll(tree, { match: [{ clickable: true }] });
    expect(all).toHaveLength(2);
    expect(find(tree, selector)?.text).toBe('取消');
  });

  it('flattens tree', () => {
    expect(flattenTree(tree).length).toBeGreaterThan(3);
  });

  it('matches icon-only button via text against accessibilityLabel', () => {
    const deleteTree: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 200 },
      children: [
        node({
          id: '0/0',
          type: 'RCTView',
          frame: { x: 0, y: 40, width: 390, height: 56 },
          children: [
            node({
              id: '0/0/0',
              type: 'RCTText',
              text: '222',
              frame: { x: 20, y: 50, width: 40, height: 20 },
            }),
            node({
              id: '0/0/1',
              type: 'RCTView',
              clickable: true,
              accessibilityLabel: '删除 222',
              frame: { x: 340, y: 48, width: 40, height: 40 },
            }),
          ],
        }),
      ],
    });
    const hit = find(deleteTree, {
      match: [{ text: '删除' }, { nearText: '222' }, { clickable: true }],
    });
    expect(hit?.id).toBe('0/0/1');
  });

  it('matches near-synonym labels (创建新钱包 → 创建钱包)', () => {
    const walletTree: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTView',
          clickable: true,
          text: '创建钱包',
          frame: { x: 40, y: 600, width: 310, height: 48 },
        }),
      ],
    });
    const hit = find(walletTree, {
      match: [{ text: '创建新钱包' }, { clickable: true }],
    });
    expect(hit?.id).toBe('0/1');
  });

  it('matches text on child when clickable is on parent wrapper', () => {
    const walletTree: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTView',
          clickable: true,
          frame: { x: 40, y: 600, width: 310, height: 48 },
          children: [
            node({
              id: '0/1/0',
              type: 'RCTText',
              text: '创建钱包',
              frame: { x: 140, y: 612, width: 80, height: 20 },
            }),
          ],
        }),
      ],
    });
    const hit = find(walletTree, {
      match: [{ text: '创建新钱包' }, { clickable: true }],
    });
    expect(hit?.id).toBe('0/1');
  });

  it('findBySoftLabel recovers near-synonym on large tap target', () => {
    const { findBySoftLabel } = require('../match') as typeof import('../match');
    const walletTree: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTView',
          clickable: true,
          text: '创建钱包',
          frame: { x: 40, y: 600, width: 310, height: 48 },
        }),
      ],
    });
    expect(findBySoftLabel(walletTree, '创建一个全新钱包')?.id).toBe('0/1');
  });

  it('does not return root when invented label soft-matches tab text', () => {
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
          frame: { x: 20, y: 750, width: 60, height: 40 },
        }),
        node({
          id: '0/2',
          type: 'RCTText',
          text: '交易',
          clickable: true,
          frame: { x: 100, y: 750, width: 60, height: 40 },
        }),
      ],
    });
    expect(
      find(home, { match: [{ text: '添加钱包' }, { clickable: true }] }),
    ).toBeNull();
    const { findBySoftLabel } = require('../match') as typeof import('../match');
    expect(findBySoftLabel(home, '添加钱包')).toBeNull();
  });
});
