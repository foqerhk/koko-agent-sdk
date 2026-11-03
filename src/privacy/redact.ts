import type { ViewNode } from '../types';
import { sensitiveScreenKind } from './sensitiveScreen';

/**
 * Client-side redaction before upload (defense in depth; server also redacts).
 */

export function redactViewTreeClient(node: ViewNode, maxDepth = 80): ViewNode {
  if (sensitiveScreenKind(node)) {
    return { ...nodeFields(node), text: '[private screen]', children: [] };
  }
  return walk(node, 0, maxDepth);
}

/** Applies to every outbound field, including OCR/model/history and test IDs. */
export function redactOutbound<T>(value: T, tree?: ViewNode | null | Array<ViewNode | null | undefined>): T {
  const secrets = new Set<string>();
  const collect = (n: ViewNode) => {
    if (n.secure) {
      for (const v of [n.text, n.accessibilityLabel]) {
        if (v && !/^[•●*\s]+$/.test(v)) secrets.add(v);
      }
    }
    for (const child of n.children || []) collect(child);
  };
  for (const source of Array.isArray(tree) ? tree : [tree]) {
    if (source) collect(source);
  }
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v;
      for (const secret of secrets) out = out.split(secret).join('[redacted]');
      return out
        .replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, '[redacted]')
        .replace(/\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/g, '[redacted]')
        .replace(/((?:password|passcode|密码|私钥|private\s*key)\s*[:=：]\s*)[^\s,;"}]+/gi, '$1[redacted]');
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  };
  return visit(value) as T;
}

function scrub(text?: string): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  // A feature label is not its private value. Keep public navigation copy and
  // addresses usable; value formats and assignments are scrubbed separately.
  const safe = redactOutbound(t);
  return safe.length > 80 ? `${safe.slice(0, 80)}…` : safe;
}

function walk(node: ViewNode, depth: number, maxDepth: number): ViewNode {
  return {
    ...nodeFields(node),
    text: node.secure ? '[redacted]' : scrub(node.text),
    accessibilityLabel: node.secure ? '[redacted]' : scrub(node.accessibilityLabel),
    testID: node.secure ? undefined : scrub(node.testID),
    children:
      depth >= maxDepth
        ? []
        : node.children.slice(0, 40).map((c) => walk(c, depth + 1, maxDepth)),
  };
}

/** Runtime trees cross a JS boundary: TypeScript types do not filter fields. */
function nodeFields(node: ViewNode): Omit<ViewNode, 'children'> {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const out: Omit<ViewNode, 'children'> = {
    id: typeof node.id === 'string' ? node.id : '',
    type: typeof node.type === 'string' ? node.type : 'View',
    frame: {
      x: finite(node.frame?.x) ?? 0,
      y: finite(node.frame?.y) ?? 0,
      width: finite(node.frame?.width) ?? 0,
      height: finite(node.frame?.height) ?? 0,
    },
    clickable: node.clickable === true,
    enabled: node.enabled !== false,
    visible: node.visible !== false,
  };
  for (const key of ['secure', 'selected', 'sheet', 'toggle', 'on', 'adjustable', 'scrollable', 'clipsChildren'] as const) {
    if (typeof node[key] === 'boolean') out[key] = node[key];
  }
  for (const key of ['value', 'min', 'max'] as const) {
    const value = finite(node[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function viewTreeOutline(node: ViewNode, maxLines = 120): string {
  if (sensitiveScreenKind(node)) return '[private screen — user completes locally]';
  const lines: string[] = [];
  const go = (n: ViewNode, indent: number) => {
    if (lines.length >= maxLines) return;
    const bits = [
      n.clickable ? 'tap' : null,
      n.text ? `"${n.text}"` : null,
      n.accessibilityLabel && n.accessibilityLabel !== n.text
        ? `a11y="${n.accessibilityLabel}"`
        : null,
      n.testID ? `id=${n.testID}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`${'  '.repeat(indent)}${n.id} ${n.type} ${bits}`.trimEnd());
    for (const c of n.children) go(c, indent + 1);
  };
  go(node, 0);
  if (lines.length >= maxLines) lines.push('…(truncated)');
  return lines.join('\n');
}
