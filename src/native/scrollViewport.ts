import type { Frame, Point, ViewNode } from '../types';

function intersect(a: Frame, b: Frame): Frame | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Visible scroll regions, clipped by the window and every clipping ancestor. */
export function scrollViewports(root: ViewNode): Array<{ node: ViewNode; frame: Frame }> {
  const out: Array<{ node: ViewNode; frame: Frame }> = [];
  const walk = (node: ViewNode, clip: Frame) => {
    const frame = intersect(node.frame, clip);
    if (node.scrollable === true && node.visible !== false && frame) out.push({ node, frame });
    const clips = node.clipsChildren || /scrollview|recyclerview|listview/i.test(node.type);
    const childClip = clips ? frame : clip;
    if (childClip) for (const child of node.children) walk(child, childClip);
  };
  walk(root, root.frame);
  return out;
}

export function boundedScrollGesture(frame: Frame, from: Point, to: Point): { from: Point; to: Point } {
  const insetX = Math.min(12, frame.width / 4), insetY = Math.min(12, frame.height / 4);
  const clamp = (p: Point): Point => ({
    x: Math.max(frame.x + insetX, Math.min(frame.x + frame.width - insetX, p.x)),
    y: Math.max(frame.y + insetY, Math.min(frame.y + frame.height - insetY, p.y)),
  });
  return { from: clamp(from), to: clamp(to) };
}

/** Position-only evidence: changing prices must not masquerade as scrolling. */
export function scrollPosition(root: ViewNode, from: Point): string | null {
  const viewport = scrollViewports(root)
    .filter(({ frame: f }) => from.x >= f.x && from.x <= f.x + f.width &&
      from.y >= f.y && from.y <= f.y + f.height)
    .sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
  if (!viewport) return null;
  const positions: string[] = [];
  const walk = (n: ViewNode) => {
    if (n.visible === false) return;
    if (!n.children.length || n.clickable) positions.push(`${n.id}:${Math.round(n.frame.x)},${Math.round(n.frame.y)}`);
    for (const child of n.children) walk(child);
  };
  walk(viewport.node);
  // Only the hash leaves this local comparison; labels/values are never used.
  let hash = 2166136261;
  for (const c of positions.join('|')) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
