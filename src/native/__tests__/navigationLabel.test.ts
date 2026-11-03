import { normalizeViewTree } from '../normalizeViewTree';
import { extractAffordances } from '../../privacy/screenModel';
import { findBySoftLabel } from '../../selector/match';
import type { ViewNode } from '../../types';

const button = (testID: string, extra: Partial<ViewNode> = {}): ViewNode => ({
  id: testID, testID, type: 'View', clickable: true,
  frame: { x: 18, y: 66, width: 48, height: 48 }, children: [], ...extra,
});

it.each(['nav-header-back', 'navigation_back', 'HeaderBackButton', 'toolbar-back', 'back-button'])(
  'makes an explicitly marked unnamed back control observable and selectable: %s', (id) => {
    const tree = normalizeViewTree({ ...button('root'), clickable: false,
      frame: { x: 0, y: 0, width: 400, height: 800 }, children: [button(id)],
    });
    expect(tree.children[0].accessibilityLabel).toBe('Back');
    expect(findBySoftLabel(tree, 'Back')?.id).toBe(id);
    expect(extractAffordances(tree)[0].label).toBe('Back');
  },
);

it('keeps close distinct and preserves host-supplied names', () => {
  expect(normalizeViewTree(button('nav-header-close')).accessibilityLabel).toBe('Close');
  expect(normalizeViewTree(button('nav-header-back', { accessibilityLabel: '返回列表' })).accessibilityLabel).toBe('返回列表');
});

it.each(['background', 'backup-wallet', 'back-office', 'toolbar-background'])(
  'does not invent navigation for unrelated IDs: %s', (id) => {
    expect(normalizeViewTree(button(id)).accessibilityLabel).toBeUndefined();
  },
);

it('preserves recovery navigation among many higher-positioned rows', () => {
  const tree = normalizeViewTree({ ...button('root'), clickable: false,
    frame: { x: 0, y: 0, width: 400, height: 800 }, children: [
      ...Array.from({ length: 60 }, (_, i) => button(`item-${i}`, { text: `Option ${i}` })),
      button('nav-header-back'),
    ],
  });
  expect(extractAffordances(tree, 10).some(a => a.label === 'Back')).toBe(true);
});

it('identifies native bottom navigation as tabs rather than ordinary content rows', () => {
  const tree = { ...button('root'), clickable: false,
    frame: { x: 0, y: 0, width: 400, height: 800 }, children: [
      button('tab', { type: '_UITabButton', text: 'Library', frame: { x: 300, y: 740, width: 80, height: 50 } }),
    ],
  };
  expect(extractAffordances(tree)[0]).toMatchObject({ kind: 'tab', label: 'Library' });
});
