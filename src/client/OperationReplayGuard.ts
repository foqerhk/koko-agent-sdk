import type { GatewayAction } from './GatewayClient';
import type { ViewNode } from '../types';
import { find, findNodeById } from '../selector/match';
import { sensitiveScreenKind } from '../privacy/sensitiveScreen';

// Operation entries, not ordinary Next/Continue controls reused by wizards.
const OPERATION = /创建|新建|添加|导入|备份|导出|提交|支付|转账|购买|删除|注销|\b(create|add|import|backup|back\s+up|export|submit|pay|transfer|buy|delete)\b/i;

function hash(text: string): string {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}

/** Keep only hashes of prior public operation entries across privacy purges. */
export class OperationReplayGuard {
  private attempts = new Set<string>();
  hasHandoff = false;

  reset() { this.attempts.clear(); this.hasHandoff = false; }
  markHandoff() { this.hasHandoff = true; }

  private key(action: GatewayAction, tree: ViewNode | null): string | null {
    if (action.tool !== 'tap' || !tree || sensitiveScreenKind(tree)) return null;
    const node = action.args.nodeId ? findNodeById(tree, action.args.nodeId) :
      action.args.selector ? find(tree, action.args.selector) : null;
    const selectorText = action.args.selector?.match.map(rule =>
      'text' in rule ? rule.text : 'accessibilityLabel' in rule ? rule.accessibilityLabel : '',
    ).filter(Boolean).join(' ');
    const label = (node?.text || node?.accessibilityLabel || selectorText ||
      action.args.label?.match(/[「“"]([^」”"]+)[」”"]/)?.[1] || action.args.label || '').trim();
    if (!OPERATION.test(label)) return null;
    // Public banners, prices and loading copy can change while the operation
    // remains the same. Only an explicit host identity separates operations;
    // native path IDs are snapshot-local and must not reset replay protection.
    let identity = node?.testID || '';
    if (node && !identity) {
      const locate = (parent: ViewNode): boolean => {
        for (const child of parent.children) {
          if (child.id === node.id || locate(child)) {
            if (!identity && parent.testID) identity = parent.testID;
            return true;
          }
        }
        return false;
      };
      locate(tree);
    }
    return hash(`${label.replace(/\s+/g, ' ').toLocaleLowerCase()}\n${identity}`);
  }

  record(action: GatewayAction, tree: ViewNode | null) {
    const key = this.key(action, tree);
    if (key) this.attempts.add(key);
  }

  blocks(action: GatewayAction, tree: ViewNode | null): boolean {
    const key = this.key(action, tree);
    return this.hasHandoff && !!key && this.attempts.has(key);
  }
}
