import type { Frame, ViewNode } from '../types';

/**
 * Drop nodes that are mounted but nowhere on screen.
 *
 * Both platforms report a node as visible from its own flags alone — Android
 * `VISIBLE && isShown()`, iOS `!hidden && alpha > 0`. Neither asks whether the
 * node is inside the window, so a navigator screen that is still mounted but
 * pushed aside keeps showing up in every dump. The agent then plans against a
 * screen the user cannot see, and the user gate can stall a run on a prompt
 * that is not there.
 *
 * Intersect against the window and every clipping/scroll ancestor. A mounted
 * list row outside its scroll viewport must not become a clickable target.
 */

/** Rounding slack, in points: a node flush with the edge must survive. */
const EPSILON = 0.5;

function intersects(a: Frame, b: Frame): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    a.x + a.width > b.x + EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    a.y + a.height > b.y + EPSILON
  );
}

function clippedFrame(a: Frame, b: Frame): Frame | null {
  if (!intersects(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y };
}

function prune(node: ViewNode, window: Frame): ViewNode | null {
  if (node.visible === false) return null;
  const clip = node.clipsChildren === true || /scrollview|recyclerview|listview/i.test(node.type);
  const childWindow = clip ? clippedFrame(node.frame, window) : window;
  const children: ViewNode[] = [];
  for (const child of childWindow ? node.children : []) {
    const kept = prune(child, childWindow!);
    if (kept) children.push(kept);
  }
  // A container can sit outside the window while laying children back inside
  // it (carousels, drawers), so keep any ancestor that still leads somewhere
  // on screen.
  if (children.length === 0 && !intersects(node.frame, window)) return null;
  const onScreen = intersects(node.frame, window);
  const centerVisible = onScreen && node.frame.x + node.frame.width / 2 >= window.x &&
    node.frame.x + node.frame.width / 2 <= window.x + window.width &&
    node.frame.y + node.frame.height / 2 >= window.y &&
    node.frame.y + node.frame.height / 2 <= window.y + window.height;
  if (!children.length && !centerVisible) return null;
  const changed = children.length !== node.children.length || children.some((c, i) => c !== node.children[i]);
  if (!changed && centerVisible) return node;
  // Native containers aggregate all descendant labels before clipping. Never
  // retain a hidden row's text on an otherwise visible ancestor.
  // A structural ancestor can be larger than the viewport while containing
  // visible children. Keep it traversable but not actionable or labelled.
  return { ...node, children, visible: centerVisible || children.length > 0,
    clickable: node.clickable && centerVisible,
    ...((!centerVisible || (changed && node.children.length)) ? {
      text: centerVisible && node.text ? children.map((c) => c.text || c.accessibilityLabel || '').filter(Boolean).join(' ').slice(0, 240) || undefined : undefined,
      accessibilityLabel: undefined,
    } : {}) };
}

export function pruneOffscreen(root: ViewNode): ViewNode {
  return prune(root, root.frame) ?? { ...root, children: [] };
}
