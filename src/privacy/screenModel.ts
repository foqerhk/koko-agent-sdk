import type { ViewNode } from '../types';
import { sensitiveScreenKind } from './sensitiveScreen';
import { scrollViewports } from '../native/scrollViewport';
import { redactOutbound } from './redact';
import { isSdkChrome } from './screenEvidence';

export type AffordanceKind =
  | 'button'
  | 'tab'
  | 'field'
  | 'row'
  | 'link'
  | 'sheet'
  | 'toggle'
  | 'adjustable'
  | 'other';

export type Affordance = {
  kind: AffordanceKind;
  /** Primary human label (text or a11y). */
  label: string;
  nodeId: string;
  /** Nearby list/row context if any. */
  near?: string;
  clickable: boolean;
  /** Already-active tab / segment / option — re-tapping it is a no-op. */
  selected?: boolean;
};

type ExtraNode = ViewNode & {
  selected?: boolean;
  sheet?: boolean;
  toggle?: boolean;
  adjustable?: boolean;
  on?: boolean;
};

type Ranked = Affordance & { y: number; score: number; testID?: string };

/**
 * Scroll descriptions UIKit synthesizes for accessibility.
 *
 * They ride along on scroll containers and get concatenated into the label of
 * whatever sits inside, so a real list row reads "BTC Bitcoin … Vertical scr"
 * with its own content truncated away. Nothing can be aimed at them.
 */
const A11Y_SCROLL_NOISE =
  /\b(vertical|horizontal)\s+scroll\s+bar,\s*\d+\s*pages?\b|\bsection\s+index\b/gi;

function labelOf(n: ViewNode): string {
  const raw = (n.text || n.accessibilityLabel || '').replace(
    A11Y_SCROLL_NOISE,
    ' ',
  );
  const t = redactOutbound(raw).replace(/\s+/g, ' ').trim();
  return t.slice(0, 80);
}

/** Labels often sit on Fabric Paragraph children while Pressable is the parent. */
function descendantLabel(n: ViewNode, depth = 0): string {
  const own = labelOf(n);
  if (own) return own;
  if (depth >= 4) return '';
  const parts: string[] = [];
  for (const c of n.children) {
    const l = descendantLabel(c, depth + 1);
    if (l) parts.push(l);
    if (parts.join(' ').length >= 80) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isExcludedSubtree(node: ViewNode): boolean {
  return isSdkChrome(node) || /logbox/i.test(`${node.type} ${node.testID || ''}`);
}

/** Dev LogBox / framework warnings that leak into accessibility trees. */
function isNoiseLabel(label: string): boolean {
  const s = label.trim();
  if (!s) return false;
  return (
    /Dialog Animation duration/i.test(s) ||
    /estimatedContentHeight/i.test(s) ||
    /please use estimatedContentHeight/i.test(s) ||
    /Require cycle:/i.test(s) ||
    /Open debugger to view warnings/i.test(s) ||
    /^!,?\s*Open debugger/i.test(s) ||
    /^LogBox/i.test(s) ||
    /PurchasesReactNative/i.test(s) ||
    /See \d+ more components/i.test(s) ||
    /^(addLog|addConsoleLog|reactConsoleErrorHandler|anonymous|renderWithHooks),/i.test(
      s,
    ) ||
    /platform=ios&dev=true/i.test(s)
  );
}

function isIgnoredLabel(label: string): boolean {
  return isNoiseLabel(label);
}

function isField(n: ViewNode): boolean {
  const t = n.type.toLowerCase();
  return (
    /textfield|textinput|edittext|uitextfield|uitextview|textarea/.test(t) ||
    (!!n.accessibilityLabel &&
      /input|输入|placeholder|what do you/i.test(n.accessibilityLabel) &&
      !n.clickable)
  );
}

function collectNear(root: ViewNode, id: string): string | undefined {
  let parent: ViewNode | null = null;
  let found = false;
  const walk = (n: ViewNode, p: ViewNode | null) => {
    if (n.id === id) {
      parent = p;
      found = true;
      return;
    }
    for (const c of n.children) {
      walk(c, n);
      if (found) return;
    }
  };
  walk(root, null);
  if (!parent) return undefined;
  const bits: string[] = [];
  const gather = (n: ViewNode) => {
    if (n.visible === false || isExcludedSubtree(n)) return;
    const l = labelOf(n);
    if (l && n.id !== id) bits.push(l);
    for (const c of n.children) gather(c);
  };
  gather(parent);
  const joined = [...new Set(bits)]
    .filter((b) => !isIgnoredLabel(b))
    .slice(0, 4)
    .join(' · ');
  return joined || undefined;
}

/**
 * Text inside an affordance, in reading order.
 *
 * A list row or card whose own label is just a title loses the association
 * between its cells: three tokens laid out as name/price/change siblings
 * reach the planner as nine unrelated fragments, so "which one gained most"
 * is unanswerable. Reading order is the only thing that ties a price to a
 * name, so keep it — do not sort or globally de-duplicate.
 */
function descendantContext(n: ViewNode, ownLabel: string): string | undefined {
  const bits: string[] = [];
  const gather = (cur: ViewNode) => {
    if (cur.visible === false || isExcludedSubtree(cur)) return;
    if (cur !== n) {
      const l = labelOf(cur);
      if (l && l !== ownLabel && l !== bits[bits.length - 1] && !isIgnoredLabel(l)) {
        bits.push(l);
      }
    }
    for (const c of cur.children) gather(c);
  };
  gather(n);
  if (bits.length < 2) return undefined;
  return bits.join(' · ');
}

/**
 * A label carrying only a number — a price, a percentage, a count.
 *
 * This is data the screen is showing, not something to aim at. Left ranked
 * as a plain short button it outscores the controls around it and fills the
 * model with fragments like 「$0.00352」 that say nothing about what tapping
 * them would do.
 */
function isDataOnlyLabel(label: string): boolean {
  const s = label.trim();
  if (!s) return false;
  return /^[+\-$€£¥₿~≈]*[\d][\d.,\s]*(%|[KkMmBb])?$/.test(s);
}

function kindOf(n: ExtraNode, label: string, near?: string): AffordanceKind {
  if (/uitab(?:bar)?button|bottomnavigationitem|tabview$/i.test(n.type)) return 'tab';
  if (n.sheet && (n as ViewNode).clickable) return 'sheet';
  if (n.toggle) return 'toggle';
  if (n.adjustable || /picker|datepicker|uiswitch|slider|stepper|seekbar|segment|numberpicker/i.test(n.type)) {
    return 'adjustable';
  }
  if (/delete|删除|trash|remove|关闭|close|cancel|取消|好|ok|确定|允许|不允许/i.test(label)) {
    return 'button';
  }
  if (/add|添加|创建|导入|确认|submit|send|下一步|登录|保存|分享|share/i.test(label)) {
    return 'button';
  }
  if (near && near !== label) return 'row';
  return 'button';
}

function isLikelyCtaLabel(label: string): boolean {
  const s = label.trim();
  if (!s || s.length > 24) return false;
  return /^(创建|添加|新建|导入|登录|注册|开始|继续|下一步|完成|确认|提交|发送|连接|恢复)/.test(
    s,
  );
}

function scoreAffordance(a: Ranked, screenH: number): number {
  let s = 0;
  const bottomBand = screenH * 0.72;
  // Recovery navigation must survive a dense page's candidate limit.
  if (a.y < screenH * 0.25 && /^(back|go back|close|返回|返回上一级|关闭)$/i.test(a.label)) s += 500;
  if (a.kind === 'tab') s += 400;
  // Primary empty-state CTAs (center) must outrank bottom tabs in the snapshot.
  if (isLikelyCtaLabel(a.label) && a.y < bottomBand) s += 260;
  // Bottom tab / dock chrome must survive list truncation.
  if (a.y >= bottomBand) s += 200;
  if (a.kind === 'sheet') s += 180;
  if (a.kind === 'field') s += 120;
  if (a.kind === 'toggle' || a.kind === 'adjustable') s += 110;
  if (a.kind === 'button' && !a.near) s += 90;
  if (a.kind === 'button' && a.near) s += 40;
  if (a.kind === 'row') s += 20;
  // Prefer short nav labels over long product row titles.
  if (a.label.length <= 12 && !a.near) s += 30;
  if (a.testID) s += 25;
  // A bare number is short and context-free, so the bonuses above would rank
  // a price above the search box on the same screen. Fields keep their score:
  // an amount input is labelled by its current value and still needs typing.
  if (a.kind !== 'field' && isDataOnlyLabel(a.label)) s -= 140;
  return s;
}

/**
 * Semantic screen model for the planner — "what can this screen do?"
 * Collects all candidates then keeps the highest-priority ones so bottom
 * navigation is not crowded out by long product lists.
 */
export function extractAffordances(root: ViewNode, max = 40): Affordance[] {
  if (sensitiveScreenKind(root)) return [];
  const ranked: Ranked[] = [];
  const seen = new Set<string>();
  const screenH = Math.max(root.frame?.height ?? 0, 1);
  const byId = new Map(flattenForModel(root).map((n) => [n.id, n]));
  const parents = new Map<string, ViewNode>();
  const indexParents = (node: ViewNode) => {
    for (const child of node.children) { parents.set(child.id, node); indexParents(child); }
  };
  indexParents(root);

  const parentOf = (n: ViewNode): ViewNode | undefined => parents.get(n.id);
  const isAncestor = (ancestor: ViewNode, child: ViewNode): boolean => {
    for (let parent = parentOf(child); parent; parent = parentOf(parent)) {
      if (parent.id === ancestor.id) return true;
    }
    return false;
  };

  const climbInteractive = (n: ViewNode): ViewNode => {
    // A testID is a test hook, not an affordance: hosts put them on the text
    // inside a row as readily as on the row. Stopping there emits the cell and
    // hides the control, so only fall back to it when nothing above is
    // interactive.
    let testIdFallback: ViewNode | undefined;
    let cur: ViewNode | undefined = n;
    while (cur) {
      const x = cur as ExtraNode;
      if (cur.clickable || x.toggle || x.adjustable || x.sheet) return cur;
      if (cur.testID && !testIdFallback) testIdFallback = cur;
      cur = parentOf(cur);
    }
    return testIdFallback ?? n;
  };

  const hasInteractiveAncestor = (n: ViewNode): boolean => {
    for (let cur = parentOf(n); cur; cur = parentOf(cur)) {
      const x = cur as ExtraNode;
      if (cur.clickable || x.toggle || x.adjustable || x.sheet) return true;
    }
    return false;
  };

  const pushButton = (n: ViewNode, label: string, near?: string) => {
    if (!label || isIgnoredLabel(label)) return;
    const node = n as ExtraNode;
    const kind = kindOf(node, label, near);
    const key = `b:${label}:${near ?? ''}:${kind}:${n.id}`;
    if (seen.has(key)) return;
    // Only nested wrappers describe the same action. Identical sibling labels
    // belong to distinct rows (e.g. Delete beside two different products).
    const index = ranked.findIndex(a => {
      const previous = byId.get(a.nodeId);
      return a.label === label && previous &&
        (previous.id === n.id || isAncestor(previous, n) || isAncestor(n, previous));
    });
    if (index >= 0) {
      const previous = index >= 0 ? byId.get(ranked[index].nodeId) : undefined;
      if (!previous || !n.clickable || (previous.clickable &&
          previous.frame.width * previous.frame.height <= n.frame.width * n.frame.height)) return;
      ranked.splice(index, 1);
    }
    seen.add(key);
    ranked.push({
      kind,
      label,
      nodeId: n.id,
      // Wide enough for a row of cells; a 3-item card runs about 85 chars.
      near: near && near !== label ? near.slice(0, 120) : undefined,
      clickable: true,
      selected: (n as ExtraNode).selected || undefined,
      testID: n.testID,
      y: n.frame?.y ?? 0,
      score: 0,
    });
  };

  const walk = (n: ViewNode) => {
    if (n.visible === false || isExcludedSubtree(n)) return;
    const node = n as ExtraNode;
    const label = descendantLabel(n);
    const field = isField(n);
    const y = n.frame?.y ?? 0;

    if (field && label) {
      const key = `f:${n.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranked.push({
          kind: 'field',
          label,
          nodeId: n.id,
          near: collectNear(root, n.id),
          clickable: n.clickable,
          y,
          score: 0,
        });
      }
    } else if (
      (n.clickable || node.toggle || node.adjustable) &&
      (label || node.toggle || node.adjustable) &&
      !(label && isIgnoredLabel(label))
    ) {
      // Context from inside the control first, from around it second. A row's
      // own cells are what make it identifiable; its siblings are other rows.
      const near = descendantContext(n, label) ?? collectNear(root, n.id);
      let display =
        label ||
        (node.toggle
          ? `开关${node.on != null ? (node.on ? '(开)' : '(关)') : ''}`
          : '') ||
        (node.adjustable ? '可调节控件' : '') ||
        n.type.split('.').pop() ||
        '控件';
      if (node.toggle && label && node.on != null) {
        display = `${label}(${node.on ? '开' : '关'})`;
      }
      if (
        node.adjustable &&
        typeof node.value === 'number' &&
        Number.isFinite(node.value)
      ) {
        const v = Math.round(node.value * 100) / 100;
        const lo =
          typeof node.min === 'number' ? Math.round(node.min * 100) / 100 : null;
        const hi =
          typeof node.max === 'number' ? Math.round(node.max * 100) / 100 : null;
        const range = lo != null && hi != null ? `,${lo}–${hi}` : '';
        display = `${display}(${v}${range})`;
      }
      pushButton(n, display, near && near !== display ? near : undefined);
    } else if (label && isLikelyCtaLabel(label)) {
      // Tamagui Button: text often on a non-clickable Paragraph — promote CTA.
      const target = climbInteractive(n);
      const near = collectNear(root, target.id);
      pushButton(target, label, near && near !== label ? near : undefined);
    } else if (n.testID && label && !isIgnoredLabel(label)) {
      // Already covered: the clickable ancestor was pushed on the way down,
      // with this text as part of its context. Emitting the cell too would
      // duplicate it stripped of everything that made it meaningful.
      if (!hasInteractiveAncestor(n)) {
        const target = climbInteractive(n);
        pushButton(target, label, collectNear(root, target.id));
      }
    }

    for (const c of n.children) walk(c);
  };

  walk(root);

  for (const a of ranked) {
    a.score = scoreAffordance(a, screenH);
  }

  ranked.sort((a, b) => b.score - a.score || a.y - b.y);

  // Bottom tab chrome often outranks page body — reserve slots for upper content
  // so tab switches change the fingerprint and Discovery lists reach the planner.
  const bottomBand = screenH * 0.72;
  const upper = ranked.filter((a) => a.y < bottomBand);
  const bottom = ranked.filter((a) => a.y >= bottomBand);
  const upperSlots = Math.max(Math.ceil(max * 0.65), max - 5);
  const picked: Ranked[] = [];
  const seenIds = new Set<string>();
  const take = (list: Ranked[], n: number) => {
    for (const a of list) {
      if (picked.length >= n) break;
      if (seenIds.has(a.nodeId)) continue;
      seenIds.add(a.nodeId);
      picked.push(a);
    }
  };
  take(upper, upperSlots);
  take(bottom, max);
  take(ranked, max);

  return picked
    .slice(0, max)
    .map(({ kind, label, nodeId, near, clickable, selected }) => ({
      kind,
      label,
      nodeId,
      near,
      clickable,
      selected,
    }));
}

function flattenForModel(root: ViewNode): ViewNode[] {
  const out: ViewNode[] = [];
  const walk = (n: ViewNode) => {
    if (n.visible === false || isExcludedSubtree(n)) return;
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Read-only page copy is state too: wizard steps may reuse every button. */
export function readablePageContent(root: ViewNode, max = 24): string[] {
  if (sensitiveScreenKind(root)) return [];
  const controls = new Set(extractAffordances(root, 100).map(a => a.label));
  const text = new Set<string>();
  const hasCopy = (n: ViewNode): boolean => n.visible !== false && !isExcludedSubtree(n) &&
    (!!labelOf(n) || n.children.some(hasCopy));
  const walk = (n: ViewNode) => {
    if (n.visible === false || n.secure || isExcludedSubtree(n)) return;
    // Prefer leaf copy to native ancestors' aggregated (and truncated) labels.
    const hasChildCopy = n.children.some(hasCopy);
    const label = (n.text || n.accessibilityLabel || '').replace(/\s+/g, ' ').trim();
    if (!hasChildCopy && label && !controls.has(label) && !isIgnoredLabel(label) &&
        !isDataOnlyLabel(label) && !/^\d{1,2}:\d{2}$/.test(label)) text.add(redactOutbound(label, root).slice(0, 500));
    for (const c of n.children) walk(c);
  };
  walk(root);
  return redactOutbound([...text].slice(0, max), root);
}

/** Compact text for LLM context (token-friendly). */
export function screenModelText(
  root: ViewNode,
  max = 40,
  hostExtra?: string,
): string {
  if (sensitiveScreenKind(root)) return '[private screen — user completes locally]';
  const items = extractAffordances(root, max);
  const controls = items.length
    ? items
        .map((a) => {
          const near = a.near ? ` · near「${a.near}」` : '';
          const hint =
            a.kind === 'tab'
              ? ' · 一级栏目入口，目标属于该栏目时先进入'
              : a.kind === 'toggle'
              ? ' · tap 切换'
              : a.kind === 'adjustable'
                ? ' · tap/swipe 调到目标值（看括号内当前值）'
                : '';
          const state = a.selected ? ' · 当前已选中（无需再点）' : '';
          return `- [${a.kind}] 「${a.label}」 id=${a.nodeId}${near}${state}${hint}`;
        })
        .join('\n')
    : '';
  const regions = scrollViewports(root).slice(0, 6).map(({ node, frame: f }) =>
    `- [scroll-region] id=${node.id} bounds=(${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.width)},${Math.round(f.height)}) · 仅用于当前列表，优先相关可见导航；滑动起终点须在区域内`,
  ).join('\n');
  const content = readablePageContent(root).map(text => `- [content] ${text}`).join('\n');
  const dumpPart = [controls, content, regions].filter(Boolean).join('\n');
  const host = (hostExtra || '').trim();
  if (dumpPart && host) return `${dumpPart}\n${host}`;
  if (dumpPart) return dumpPart;
  if (host) return host;
  return '（未识别到可操作控件或滚动区域；等待加载后重新观察，勿盲目滑动）';
}

/** One-line snapshot for history feedback after an action. */
export function screenSnapshotLine(root: ViewNode, max = 12): string {
  if (sensitiveScreenKind(root)) return '[private screen — user completes locally]';
  const items = extractAffordances(root, max);
  const content = readablePageContent(root);
  const copy = content.length ? ` | content: ${content.join(' | ')}` : '';
  return `screen: ${items.length ? items.map(a => `${a.label}${a.selected ? ' [selected]' : ''}`).join(' | ') : '(no controls)'}${copy}`;
}
