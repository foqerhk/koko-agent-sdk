import type { ViewNode } from '../types';
import type { GatewayAction, AgentHistoryItem } from './GatewayClient';

/** Select a visible app-results category only when the user's query is on this page. */
export function webResultCategory(action: GatewayAction, root: ViewNode | null, goal: string, history: AgentHistoryItem[]): GatewayAction | null {
  if (action.tool !== 'dump' || !root || !/(connect|连接|連接)/i.test(goal) || !/(wallet|钱包|錢包)/i.test(goal)) return null;
  const nodes: ViewNode[] = [];
  const visit = (node: ViewNode) => {
    if (node.visible === false || node.enabled === false) return;
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const fields = nodes.filter(n => /textfield|textinput|edittext/i.test(n.type) && !/label$/i.test(n.type));
  if (!fields.some(n => {
    const value = norm(n.text || n.accessibilityLabel || '');
    return value.length >= 3 && norm(goal).includes(value);
  })) return null;
  const names = new Set(nodes.map(n => norm(n.text || n.accessibilityLabel || '')));
  if (![...names].some(name => /^(tokens|代币|代幣)$/.test(name))) return null;
  const candidates = nodes.filter(n => n.clickable && /^(dapps|dapp|应用|應用)$/.test(norm(n.text || n.accessibilityLabel || '')) && !n.selected);
  const leaves = candidates.filter(n => !candidates.some(other => other.id.startsWith(n.id + '/')));
  if (leaves.length !== 1) return null;
  const node = leaves[0]!;
  if (history.some(h => h.tool === 'tap' && h.args?.nodeId === node.id)) return null;
  return { tool: 'tap', args: { nodeId: node.id, label: node.text || node.accessibilityLabel } };
}
