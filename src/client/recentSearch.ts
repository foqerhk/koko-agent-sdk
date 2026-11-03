import type { ViewNode } from '../types';
import type { GatewayAction } from './GatewayClient';
import { find } from '../selector/match';

const norm = (s: string) => s.trim().toLocaleLowerCase();
const isInput = (n: ViewNode) => /textfield|textinput|edittext|uitextview|textarea/i.test(n.type) && !/label$/i.test(n.type);
const label = (n: ViewNode) => n.text || n.accessibilityLabel || '';
const recent = /^(recent(?: searches| search| history)?|search history|最近(?:搜索|记录)?|搜索历史|历史搜索|历史记录)$/i;

/** Only replace a search query with a uniquely identified visible recent item. */
export function recentSearchAction(action: GatewayAction, root: ViewNode | null, goal: string): GatewayAction | null {
  if (action.tool !== 'type' || !root || !action.args.text.trim()) return null;
  const query = norm(action.args.text);
  if (!norm(goal).includes(query) || !/\b(open|find|search|look up)\b|打开|搜索|查找/i.test(goal) ||
      /\b(type|enter|input|write|paste)\b|输入|键入|填写|粘贴/i.test(goal)) return null;
  const nodes: ViewNode[] = [];
  const walk = (n: ViewNode) => {
    if (n.visible === false || n.enabled === false) return;
    nodes.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  const inputNodes = nodes.filter(isInput);
  const fields = inputNodes.filter(n => !inputNodes.some(other => other.id.startsWith(n.id + '/')));
  if (fields.length !== 1 || fields[0]?.secure || !/search|搜索|查找/i.test(label(fields[0]!))) return null;
  if (action.args.nodeId && action.args.nodeId !== fields[0]!.id && !fields[0]!.id.startsWith(action.args.nodeId + '/')) return null;
  if (action.args.selector) {
    const selected = find(root, action.args.selector);
    if (!selected || (selected.id !== fields[0]!.id &&
      !fields[0]!.id.startsWith(selected.id + '/') && !selected.id.startsWith(fields[0]!.id + '/'))) return null;
  }

  const headings = nodes.filter(n => recent.test(label(n).trim()));
  const candidates = nodes.filter(n => n.clickable && norm(label(n)) === query && !isInput(n));
  if (!headings.length || !candidates.length) return null;
  // Require a local section containing a recent heading and the candidate, not
  // just two unrelated nodes somewhere on the page. Ancestors that include the
  // search input or cover most of the screen cannot establish that relation.
  const related = candidates.filter(candidate => headings.some(heading => nodes.some(section =>
    section.id !== root.id && section.id !== fields[0]!.id &&
    heading.id.startsWith(section.id + '/') && candidate.id.startsWith(section.id + '/') &&
    !fields[0]!.id.startsWith(section.id + '/') &&
    section.frame.height < root.frame.height * 0.7)));
  const leaves = related.filter(n => !related.some(other => other.id.startsWith(n.id + '/')));
  if (leaves.length !== 1) return null;
  return { tool: 'tap', args: { nodeId: leaves[0]!.id, label: label(leaves[0]!) } };
}
