import { webVisualChanged, webVisualLabels } from '../webVisualChange';
import type { ViewNode } from '../../types';

const root: ViewNode = { id: '0', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
  clickable: false, enabled: true, visible: true, children: [{ id: '0/0', type: 'WKWebView',
    frame: { x: 0, y: 100, width: 400, height: 600 }, clickable: false, enabled: true, visible: true, children: [] }] };
const hit = (text: string, y = 200) => ({ text, confidence: 0.9, frame: { x: 10, y, width: 100, height: 20 } });

it('detects new on-page labels without treating changing prices as page transitions', () => {
  const before = webVisualLabels(root, [hit('Swap'), hit('$123'), hit('Outside', 20)]);
  const unchanged = webVisualLabels(root, [hit('Swap'), hit('$456'), hit('Outside', 20)]);
  const after = webVisualLabels(root, [hit('Swap'), hit('Choose wallet'), hit('Wallet option')]);
  expect(webVisualChanged(before, unchanged)).toBe(false);
  expect(webVisualChanged(before, after)).toBe(true);
});
it('does not claim a change without two observable nonnumeric additions', () => {
  expect(webVisualChanged(null, new Set(['one', 'two']))).toBe(false);
  expect(webVisualChanged(new Set(['old']), new Set(['old', 'one']))).toBe(false);
  expect(webVisualLabels(root, [hit('off page', 20)])).toBeNull();
});
