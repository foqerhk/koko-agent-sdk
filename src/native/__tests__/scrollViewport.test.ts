import { boundedScrollGesture, scrollViewports, scrollPosition } from '../scrollViewport';
import type { ViewNode } from '../../types';

const node = (id: string, frame: ViewNode['frame'], extra: Partial<ViewNode> = {}): ViewNode => ({
  id, frame, type: 'View', clickable: false, children: [], ...extra,
});

it('clips oversized nested scroll views to the actual visible ancestor and window', () => {
  const list = node('list', { x: -20, y: -100, width: 440, height: 1800 }, { scrollable: true });
  const root = node('window', { x: 0, y: 0, width: 400, height: 800 }, {
    children: [node('clip', { x: 10, y: 100, width: 380, height: 600 }, {
      clipsChildren: true, children: [list],
    })],
  });
  expect(scrollViewports(root).map(v => v.frame)).toEqual([{ x: 10, y: 100, width: 380, height: 600 }]);
});

it('does not advertise hidden, offscreen or non-scrollable content as a scroll region', () => {
  const root = node('window', { x: 0, y: 0, width: 400, height: 800 }, { children: [
    node('hidden', { x: 0, y: 0, width: 400, height: 800 }, { scrollable: true, visible: false }),
    node('outside', { x: 500, y: 0, width: 400, height: 800 }, { scrollable: true }),
    node('static', { x: 0, y: 0, width: 400, height: 800 }),
  ] });
  expect(scrollViewports(root)).toEqual([]);
});

it('keeps both cursor endpoints inside a scroll viewport, away from fixed chrome', () => {
  expect(boundedScrollGesture({ x: 0, y: 100, width: 400, height: 600 },
    { x: 200, y: 650 }, { x: 200, y: -900 })).toEqual({
    from: { x: 200, y: 650 }, to: { x: 200, y: 112 },
  });
});

it('preserves ordinary in-bounds gestures', () => {
  expect(boundedScrollGesture({ x: 0, y: 100, width: 400, height: 600 },
    { x: 200, y: 550 }, { x: 200, y: 250 })).toEqual({
    from: { x: 200, y: 550 }, to: { x: 200, y: 250 },
  });
});

it('detects actual content movement even when all visible labels stay the same', () => {
  const screen = (y: number, text = 'Value') => node('root', { x: 0, y: 0, width: 400, height: 800 }, {
    scrollable: true, children: [node('row', { x: 0, y, width: 400, height: 80 }, { text })],
  });
  const from = { x: 200, y: 600 };
  expect(scrollPosition(screen(200), from)).not.toBe(scrollPosition(screen(100), from));
  expect(scrollPosition(screen(100, '100'), from)).toBe(scrollPosition(screen(100, '200'), from));
  expect(scrollPosition(screen(100), from)).toBe(scrollPosition(screen(100), from));
});
