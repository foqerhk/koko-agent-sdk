import type { ViewNode } from '../types';

/** Explicit semantic navigation IDs, never inferred from icon position alone. */
export function navigationLabel(node: ViewNode): string | undefined {
  if ((node.text || '').trim() || (node.accessibilityLabel || '').trim()) return undefined;
  if (!node.clickable || node.visible === false || node.enabled === false) return undefined;
  const id = (node.testID || '').replace(/[^a-z]/gi, '').toLowerCase();
  if (/^(?:nav(?:igation)?(?:header)?|header|toolbar)?(?:go)?back(?:button)?$|^buttonback$/.test(id)) return 'Back';
  if (/^(?:nav(?:igation)?(?:header)?|header|toolbar)?close(?:button)?$|^buttonclose$/.test(id)) return 'Close';
  return undefined;
}
