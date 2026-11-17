import type { ViewNode } from '../types';
import { navigationLabel } from './navigationLabel';

/** NSNumber boolean expressions can arrive as 0/1 through the RN bridge. */
export function normalizeViewTree(node: ViewNode): ViewNode {
  const children = node.children.map(normalizeViewTree);
  const flags: Partial<ViewNode> = {};
  for (const key of ['scrollable', 'clipsChildren', 'visible', 'enabled', 'clickable', 'secure'] as const) {
    const value: unknown = node[key];
    if (value === 0 || value === 1) flags[key] = value === 1;
  }
  const label = navigationLabel({ ...node, ...flags });
  if (label) flags.accessibilityLabel = label;
  if (!Object.keys(flags).length && children.every((child, i) => child === node.children[i])) return node;
  return { ...node, ...flags, children };
}
