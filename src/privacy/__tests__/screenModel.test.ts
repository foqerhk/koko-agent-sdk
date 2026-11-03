import { extractAffordances, screenModelText } from '../screenModel';
import type { ViewNode } from '../../types';

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

describe('screenModel', () => {
  const tree: ViewNode = node({
    id: '0',
    type: 'RCTView',
    frame: { x: 0, y: 0, width: 390, height: 800 },
    children: [
      node({
        id: '0/0',
        type: 'RCTUITextField',
        text: 'What do you need to do?',
        frame: { x: 20, y: 100, width: 240, height: 40 },
      }),
      node({
        id: '0/1',
        type: 'RCTView',
        clickable: true,
        text: 'Add',
        frame: { x: 280, y: 100, width: 80, height: 40 },
      }),
      node({
        id: '0/2',
        type: 'RCTView',
        frame: { x: 20, y: 160, width: 350, height: 56 },
        children: [
          node({
            id: '0/2/0',
            type: 'RCTText',
            text: '222',
            frame: { x: 30, y: 170, width: 40, height: 20 },
          }),
          node({
            id: '0/2/1',
            type: 'RCTView',
            clickable: true,
            accessibilityLabel: '删除 222',
            frame: { x: 320, y: 168, width: 40, height: 40 },
          }),
        ],
      }),
    ],
  });

  it('extracts fields and delete affordance with near context', () => {
    const items = extractAffordances(tree);
    expect(items.some((a) => a.kind === 'field')).toBe(true);
    expect(items.some((a) => a.label.includes('Add'))).toBe(true);
    const del = items.find((a) => a.label.includes('删除'));
    expect(del).toBeTruthy();
    expect(del?.near).toMatch(/222/);
  });

  it('uses descendant text when clickable parent has no own label', () => {
    const nested: ViewNode = node({
      id: 'r',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: 'r/0',
          type: 'RCTView',
          clickable: true,
          frame: { x: 10, y: 700, width: 70, height: 44 },
          children: [
            node({
              id: 'r/0/0',
              type: 'RCTParagraphComponentView',
              text: '钱包',
              frame: { x: 20, y: 710, width: 40, height: 20 },
            }),
          ],
        }),
      ],
    });
    const items = extractAffordances(nested);
    expect(items.some((a) => a.label.includes('钱包'))).toBe(true);
  });

  it('keeps bottom tab chrome when list would otherwise crowd them out', () => {
    const kids: ViewNode[] = [];
    for (let i = 0; i < 30; i++) {
      kids.push(
        node({
          id: `0/list/${i}`,
          type: 'RCTView',
          clickable: true,
          text: `加入购物车商品${i}`,
          frame: { x: 20, y: 80 + i * 40, width: 350, height: 36 },
        }),
      );
    }
    kids.push(
      node({
        id: '0/tab/cart',
        type: 'RCTView',
        clickable: true,
        accessibilityLabel: '购物车',
        frame: { x: 130, y: 740, width: 120, height: 48 },
      }),
      node({
        id: '0/tab/shop',
        type: 'RCTView',
        clickable: true,
        accessibilityLabel: '商城',
        frame: { x: 10, y: 740, width: 120, height: 48 },
      }),
    );
    const crowded = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: kids,
    });
    const items = extractAffordances(crowded, 24);
    expect(items.some((a) => a.label === '购物车')).toBe(true);
    expect(items.some((a) => a.label === '商城')).toBe(true);
  });

  it('exposes adjustable current value in the label', () => {
    const treeWithSlider = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/s',
          type: 'RNCSlider',
          clickable: true,
          adjustable: true,
          accessibilityLabel: '字号滑条',
          value: 1,
          min: 0.8,
          max: 1.6,
          frame: { x: 20, y: 200, width: 300, height: 40 },
        }),
      ],
    });
    const items = extractAffordances(treeWithSlider);
    const slider = items.find((a) => a.kind === 'adjustable');
    expect(slider?.label).toMatch(/字号滑条\(1,0\.8–1\.6\)/);
    expect(screenModelText(treeWithSlider)).toMatch(/tap\/swipe 调到目标值/);
  });

  it('surfaces empty-state CTA even when only the text leaf is labeled', () => {
    const emptyHome = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        node({
          id: '0/title',
          type: 'RCTText',
          text: '没有钱包',
          frame: { x: 120, y: 320, width: 150, height: 28 },
        }),
        node({
          id: '0/btn',
          type: 'RCTView',
          // Tamagui sometimes omits clickable on the wrapper in dump.
          clickable: false,
          testID: 'empty-wallet-create-button',
          frame: { x: 95, y: 420, width: 200, height: 44 },
          children: [
            node({
              id: '0/btn/0',
              type: 'RCTText',
              text: '创建钱包',
              frame: { x: 155, y: 432, width: 80, height: 20 },
            }),
          ],
        }),
        node({
          id: '0/tab',
          type: 'RCTView',
          clickable: true,
          text: '钱包',
          frame: { x: 20, y: 780, width: 60, height: 40 },
        }),
      ],
    });
    const items = extractAffordances(emptyHome, 12);
    expect(items.some((a) => a.label === '创建钱包')).toBe(true);
    // CTA should rank ahead of bottom tab in the short snapshot.
    expect(items[0]?.label).toBe('创建钱包');
  });
});

describe('screenModel row association', () => {
  /**
   * A card whose cells are laid out as flat siblings — common for any list
   * that renders name / value / delta columns rather than nested rows.
   */
  const cell = (id: string, testID: string, text: string, x: number) =>
    node({
      id,
      type: 'RCTParagraphComponentView',
      testID,
      text,
      frame: { x, y: 200, width: 80, height: 18 },
    });

  const screen: ViewNode = node({
    id: '0',
    type: 'RCTView',
    frame: { x: 0, y: 0, width: 390, height: 800 },
    children: [
      node({
        id: '0/0',
        type: 'RCTUITextField',
        text: 'Search anything',
        frame: { x: 20, y: 60, width: 350, height: 40 },
      }),
      node({
        id: '0/1',
        type: 'RCTView',
        clickable: true,
        testID: 'banner-item',
        accessibilityLabel: 'Top Movers',
        frame: { x: 16, y: 160, width: 358, height: 120 },
        children: [
          node({
            id: '0/1/0',
            type: 'RCTParagraphComponentView',
            text: 'Top Movers',
            frame: { x: 24, y: 170, width: 120, height: 20 },
          }),
          cell('0/1/1', 'banner-token-name', 'astro', 24),
          cell('0/1/2', 'banner-token-price', '$0.00352', 120),
          cell('0/1/3', 'banner-token-change', '+521.16%', 240),
          cell('0/1/4', 'banner-token-name', 'NET', 24),
          cell('0/1/5', 'banner-token-price', '$315.33', 120),
          cell('0/1/6', 'banner-token-change', '+38.73%', 240),
        ],
      }),
    ],
  });

  const items = extractAffordances(screen, 20);

  it('keeps the card cells attached to the card in reading order', () => {
    const card = items.find((a) => a.label === 'Top Movers');
    expect(card?.nodeId).toBe('0/1');
    expect(card?.near).toBe(
      'astro · $0.00352 · +521.16% · NET · $315.33 · +38.73%',
    );
  });

  it('does not emit the cells as separate affordances', () => {
    expect(items.some((a) => a.label === '$0.00352')).toBe(false);
    expect(items.some((a) => a.label === '+521.16%')).toBe(false);
  });

  it('ranks a real control above the values it displays', () => {
    expect(items[0]?.label).toBe('Search anything');
  });

  it('drops accessibility scroll descriptions from labels', () => {
    const scroller: ViewNode = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/0',
          type: 'RCTView',
          clickable: true,
          accessibilityLabel: 'BTC Bitcoin Vertical scroll bar, 3 pages',
          frame: { x: 0, y: 100, width: 390, height: 60 },
        }),
        node({
          id: '0/1',
          type: 'RCTView',
          clickable: true,
          accessibilityLabel: 'Horizontal scroll bar, 1 page Section index',
          frame: { x: 0, y: 200, width: 390, height: 60 },
        }),
      ],
    });
    const list = extractAffordances(scroller, 20);
    expect(list.map((a) => a.label)).toEqual(['BTC Bitcoin']);
  });
});
