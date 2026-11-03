import { pruneOffscreen } from '../pruneOffscreen';
import type { Frame, ViewNode } from '../../types';
import { screenModelText } from '../../privacy/screenModel';
import { redactViewTreeClient } from '../../privacy/redact';

const WINDOW: Frame = { x: 0, y: 0, width: 374, height: 827 };

function node(
  id: string,
  frame: Frame,
  extra: Partial<ViewNode> = {},
): ViewNode {
  return {
    id,
    type: 'android.view.ViewGroup',
    frame,
    clickable: false,
    enabled: true,
    visible: true,
    children: [],
    ...extra,
  };
}

function texts(root: ViewNode): string[] {
  const out: string[] = [];
  const walk = (n: ViewNode) => {
    if (n.text) out.push(n.text);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe('pruneOffscreen', () => {
  it('keeps what is inside the window', () => {
    const root = node('0', WINDOW, {
      children: [
        node('0/0', { x: 0, y: 0, width: 374, height: 64 }, { text: 'Header' }),
        node(
          '0/1',
          { x: 20, y: 700, width: 334, height: 56 },
          { text: 'Create wallet' },
        ),
      ],
    });
    expect(texts(pruneOffscreen(root))).toEqual(['Header', 'Create wallet']);
  });

  it('drops a screen parked beside the window', () => {
    // A stack screen that is still mounted one window-width to the right is
    // what put "Enter PIN on device" into dumps of unrelated screens.
    const root = node('0', WINDOW, {
      children: [
        node('0/0', WINDOW, { text: 'Discover' }),
        node('0/1', { x: 374, y: 0, width: 374, height: 827 }, {
          children: [
            node(
              '0/1/0',
              { x: 394, y: 300, width: 334, height: 24 },
              { text: '在设备上输入 PIN 码' },
            ),
          ],
        }),
      ],
    });
    expect(texts(pruneOffscreen(root))).toEqual(['Discover']);
  });

  it('drops a screen parked above the window', () => {
    const root = node('0', WINDOW, {
      children: [
        node('0/0', { x: 0, y: -827, width: 374, height: 827 }, {
          text: 'Connecting…',
        }),
      ],
    });
    expect(texts(pruneOffscreen(root))).toEqual([]);
  });

  it('keeps an offscreen container that lays children back on screen', () => {
    const root = node('0', WINDOW, {
      children: [
        node('0/0', { x: -2000, y: 0, width: 100, height: 827 }, {
          children: [
            node(
              '0/0/0',
              { x: 40, y: 100, width: 200, height: 40 },
              { text: 'Visible row' },
            ),
          ],
        }),
      ],
    });
    expect(texts(pruneOffscreen(root))).toEqual(['Visible row']);
  });

  it('exposes visible actions inside tall scroll content without exposing hidden descendants', () => {
    const root = node('0', WINDOW, { children: [
      node('0/0', { x: 0, y: 100, width: 374, height: 600 }, { type: 'ScrollView', clipsChildren: true, children: [
        node('0/0/0', { x: 0, y: 100, width: 374, height: 2400 }, { text: 'Entry A HIDDEN_OFFSCREEN', children: [
          node('0/0/0/0', { x: 20, y: 160, width: 120, height: 40 }, { text: 'Entry A', clickable: true }),
          node('0/0/0/1', { x: 20, y: 900, width: 120, height: 40 }, { text: 'HIDDEN_OFFSCREEN', clickable: true }),
          node('0/0/0/2', { x: 20, y: 210, width: 120, height: 40 }, { visible: false, children: [
            node('0/0/0/2/0', { x: 20, y: 210, width: 120, height: 40 }, { text: 'HIDDEN_PARENT', clickable: true }),
          ] }),
        ] }),
      ] }),
    ] });
    const safe = redactViewTreeClient(pruneOffscreen(root));
    const model = screenModelText(safe);
    expect(model).toContain('「Entry A」');
    expect(model).not.toContain('HIDDEN_OFFSCREEN');
    expect(model).not.toContain('HIDDEN_PARENT');
  });

  it('keeps a node flush with the bottom edge', () => {
    const root = node('0', WINDOW, {
      children: [
        node(
          '0/0',
          { x: 0, y: 783, width: 374, height: 44 },
          { text: 'Tab bar' },
        ),
      ],
    });
    expect(texts(pruneOffscreen(root))).toEqual(['Tab bar']);
  });

  it('returns the same object when nothing is offscreen', () => {
    const root = node('0', WINDOW, {
      children: [node('0/0', WINDOW, { text: 'Home' })],
    });
    expect(pruneOffscreen(root)).toBe(root);
  });
});
