import type { Frame, MatchRule, Selector, ViewNode } from '../types';

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Strip particles models often invent around a real on-screen label
 * (「创建钱包」→「创建新钱包」/「立即创建钱包」). Host-agnostic fillers only.
 */
function softKey(s: string): string {
  return norm(s)
    .replace(/[\s\-_./·•:：()（）【】[\]]+/g, '')
    .replace(
      /^(请|立即|马上|点击|轻点|去|进入|开始|打开)+|(按钮|button|btn)$/gi,
      '',
    )
    // Infix noise the model adds between shared stems (创建「新」钱包).
    .replace(
      /(创建|新建|添加|新增|开通|注册|登录|登入|提交|确认|发送|保存|删除|取消|返回|下一步|完成)(?:全新|新的|新|一个|一下)*/g,
      '$1',
    );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur =
        a[i] === b[j]
          ? row[j]!
          : 1 + Math.min(row[j]!, row[j + 1]!, prev);
      row[j] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length]!;
}

/** Scripts where one character carries a whole morpheme. */
const IDEOGRAPHIC =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function isIdeographic(s: string): boolean {
  const chars = [...s];
  if (!chars.length) return false;
  const hits = chars.filter((c) => IDEOGRAPHIC.test(c)).length;
  return hits / chars.length >= 0.5;
}

/**
 * Digit runs identify a specific thing — Account #1 vs #2, 1.2x vs 1.6x,
 * 第2个 vs 第3个. Loose matching must never cross them, or the agent acts on
 * the wrong account.
 */
function digitsConflict(a: string, b: string): boolean {
  const da = (a.match(/\d+/g) || []).join('.');
  const db = (b.match(/\d+/g) || []).join('.');
  return !!da && !!db && da !== db;
}

/**
 * Edit budget for a fuzzy label match.
 *
 * Latin typos are cheap to forgive. One substituted ideograph is a different
 * word — 发送/发现, 交换/交易, 合同/合约, 钱币/钱包 all sit at distance 1 — so
 * ideographic labels get no budget until they are long enough that a single
 * edit cannot flip the meaning. Differing digits get no budget at all.
 */
function editBudget(a: string, b: string): number {
  if (digitsConflict(a, b)) return 0;
  const len = Math.max(a.length, b.length);
  if (isIdeographic(a) || isIdeographic(b)) return len >= 6 ? 1 : 0;
  return len <= 4 ? 1 : 2;
}

/** Loose label match: substring either way, soft filler strip, small edit distance. */
export function textMatches(
  haystack: string | undefined,
  needle: string,
  exact?: boolean,
): boolean {
  if (!haystack) return false;
  const h = norm(haystack);
  const n = norm(needle);
  if (!n) return false;
  if (exact) return h === n;
  if (h === n) return true;

  const hs = softKey(haystack);
  const ns = softKey(needle);
  if (hs && ns && hs === ns) return true;

  // Short CJK labels name distinct controls: 服务设置 is a section heading,
  // not the 设置 button. Substring matching must not invent a visible target.
  if (n.length <= 2 && isIdeographic(n) && isIdeographic(h)) return false;

  // Screen text contains the full needle (safe).
  if (h.includes(n) && n.length >= 2) return true;
  if (hs && ns && hs.includes(ns) && ns.length >= 2) {
    const ratio = ns.length / hs.length;
    if (ratio >= 0.5) return true;
  }

  // Needle contains screen text only when nearly the same after softKey
  // (「创建新钱包」→「创建钱包»). Never match 「创建钱包」 onto bare 「钱包」.
  if (hs && ns && ns.includes(hs) && hs.length >= 2 && !digitsConflict(hs, ns)) {
    if (hs.length / ns.length >= 0.72) return true;
  }

  if (h.length <= 16 && n.length <= 16) {
    // Require similar length — else 「添加钱包」≈「钱包」(dist 2) false-positives.
    const maxLen = Math.max(h.length, n.length);
    const minLen = Math.min(h.length, n.length);
    const budget = editBudget(h, n);
    if (budget > 0 && minLen / maxLen >= 0.75) {
      if (levenshtein(h, n) <= budget) return true;
    }
    if (hs && ns && hs.length <= 16 && ns.length <= 16) {
      const maxL = Math.max(hs.length, ns.length);
      const minL = Math.min(hs.length, ns.length);
      const softBudget = editBudget(hs, ns);
      if (softBudget > 0 && minL / maxL >= 0.75) {
        if (levenshtein(hs, ns) <= softBudget) return true;
      }
    }
  }
  return false;
}

function regionContains(frame: Frame, region: MatchRule & { region: string }, window?: Frame): boolean {
  const ratio = 'ratio' in region && typeof region.ratio === 'number' ? region.ratio : 0.2;
  // Without window size, approximate using large canvas; callers may refine later.
  const W = window?.width ?? Math.max(frame.x + frame.width, 400);
  const H = window?.height ?? Math.max(frame.y + frame.height, 800);
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;

  switch (region.region) {
    case 'top':
      return cy <= H * ratio;
    case 'bottom':
      return cy >= H * (1 - ratio);
    case 'left':
      return cx <= W * ratio;
    case 'right':
      return cx >= W * (1 - ratio);
    case 'center': {
      const m = ratio;
      return cx >= W * m && cx <= W * (1 - m) && cy >= H * m && cy <= H * (1 - m);
    }
    default:
      return true;
  }
}

function collectTexts(node: ViewNode, depth = 0, maxDepth = 3): string[] {
  const out: string[] = [];
  if (node.text) out.push(node.text);
  if (node.accessibilityLabel) out.push(node.accessibilityLabel);
  if (depth >= maxDepth) return out;
  for (const c of node.children) out.push(...collectTexts(c, depth + 1, maxDepth));
  return out;
}

function parentTextsNear(root: ViewNode, targetId: string): string[] {
  // Walk tree; when we find target, return texts from parent and siblings.
  let parentOfTarget: ViewNode | null = null;
  let found = false;

  const walk = (n: ViewNode, parent: ViewNode | null) => {
    if (n.id === targetId) {
      parentOfTarget = parent;
      found = true;
      return;
    }
    for (const c of n.children) {
      walk(c, n);
      if (found) return;
    }
  };
  walk(root, null);
  if (!parentOfTarget) return collectTexts(root).slice(0, 20);
  return collectTexts(parentOfTarget);
}

export function flattenTree(root: ViewNode): ViewNode[] {
  const out: ViewNode[] = [];
  const walk = (n: ViewNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

export function findNodeById(root: ViewNode, id: string): ViewNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNodeById(c, id);
    if (hit) return hit;
  }
  return null;
}

function nodeHasText(node: ViewNode, needle: string, exact?: boolean): boolean {
  if (
    textMatches(node.text, needle, exact) ||
    textMatches(node.accessibilityLabel, needle, exact)
  ) {
    return true;
  }
  // Wrapper Pressable often has empty text; label sits on a child Text.
  if (exact) return false;
  return collectTexts(node).some((t) => textMatches(t, needle, false));
}

function matchesRule(node: ViewNode, rule: MatchRule, root: ViewNode): boolean {
  if ('text' in rule) {
    return nodeHasText(node, rule.text, rule.exact);
  }
  if ('nearText' in rule) {
    const nearby = parentTextsNear(root, node.id).join(' ');
    return textMatches(nearby, rule.nearText, rule.exact);
  }
  if ('clickable' in rule) {
    return node.clickable === rule.clickable;
  }
  if ('type' in rule) {
    return norm(node.type).includes(norm(rule.type));
  }
  if ('testID' in rule) {
    return !!node.testID && node.testID === rule.testID;
  }
  if ('accessibilityLabel' in rule) {
    return textMatches(node.accessibilityLabel, rule.accessibilityLabel, rule.exact);
  }
  if ('region' in rule) {
    return regionContains(node.frame, rule as MatchRule & { region: string });
  }
  return false;
}

export function nodeMatches(node: ViewNode, selector: Selector, root: ViewNode): boolean {
  if (node.visible === false || node.enabled === false) return false;
  if (!selector.match.length) return false;
  return selector.match.every((rule) => matchesRule(node, rule, root));
}

export function findAll(root: ViewNode, selector: Selector): ViewNode[] {
  return flattenTree(root).filter((n) => nodeMatches(n, selector, root));
}

/** Climb to the nearest clickable / toggle / sheet ancestor (inclusive). */
function nearestInteractive(root: ViewNode, node: ViewNode): ViewNode {
  const byId = new Map(flattenTree(root).map((n) => [n.id, n]));
  // parent id = everything before last /
  let cur: ViewNode | undefined = node;
  while (cur) {
    if (cur.visible !== false && cur.enabled !== false && (cur.clickable || cur.toggle || cur.adjustable || cur.sheet)) return cur;
    const parentId: string = cur.id.includes('/')
      ? cur.id.slice(0, cur.id.lastIndexOf('/'))
      : '';
    cur = parentId ? byId.get(parentId) : undefined;
  }
  return node;
}

function isDegenerateHit(root: ViewNode, n: ViewNode): boolean {
  // Full-window / root wrappers are never useful tap targets.
  if (!n.id || n.id === root.id || n.id === '0') return true;
  const rw = Math.max(1, root.frame.width);
  const rh = Math.max(1, root.frame.height);
  const areaRatio = (n.frame.width * n.frame.height) / (rw * rh);
  if (areaRatio >= 0.55) return true;
  return false;
}

function isInputOrInputWrapper(node: ViewNode): boolean {
  if (/textfield|textinput|edittext|uitextview|textarea|searchbar/i.test(node.type)) return true;
  return node.children.some(child => child.visible !== false && isInputOrInputWrapper(child));
}

export function find(root: ViewNode, selector: Selector, options?: { preferNonInput?: boolean }): ViewNode | null {
  let all = findAll(root, selector);
  // Common RN case: model asks clickable+text, but text is on a child Text
  // while Pressable wrapper is the only clickable node (handled by nodeHasText).
  // If still empty, drop clickable requirement, match text, then climb to wrapper.
  if (!all.length) {
    const withoutClick = {
      ...selector,
      match: selector.match.filter((r) => !('clickable' in r)),
    };
    if (withoutClick.match.length > 0 && withoutClick.match.length < selector.match.length) {
      const leaves = findAll(root, withoutClick);
      const upgraded = leaves.map((n) => nearestInteractive(root, n));
      const wantClickable = selector.match.some(
        (r) => 'clickable' in r && r.clickable === true,
      );
      all = wantClickable
        ? upgraded.filter((n) => n.clickable || n.toggle || n.sheet || n.adjustable)
        : upgraded;
      // De-dupe by id
      const seen = new Set<string>();
      all = all.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
    }
  }
  all = all.filter((n) => !isDegenerateHit(root, n));
  if (!all.length) return null;
  // A query field can contain the same text as a search result. For a tap on
  // an action, prefer matching non-input controls, including when the input is
  // wrapped in a clickable RN view. An explicit input type remains authoritative.
  const explicitlyInput = selector.match.some(rule => 'type' in rule &&
    /textfield|textinput|edittext|uitextview|textarea|searchbar/i.test(rule.type));
  if (options?.preferNonInput && !explicitlyInput) {
    const actions = all.filter(node => !isInputOrInputWrapper(node));
    if (actions.length) all = actions;
  }
  // Prefer interactive + compact controls (not giant containers).
  const ranked = selector.index !== undefined ? all : [...all].sort((a, b) =>
    rankMatch(b) + labelSpecificity(b, selector) - rankMatch(a) - labelSpecificity(a, selector) ||
    a.frame.width * a.frame.height - b.frame.width * b.frame.height,
  );
  const index = selector.index ?? 0;
  return ranked[index] ?? null;
}

/**
 * Last-resort: find best interactive node whose visible text soft-matches needle.
 * Used when the planner invents near-synonym copy not present verbatim.
 */
export function findBySoftLabel(root: ViewNode, needle: string, options?: { preferNonInput?: boolean }): ViewNode | null {
  const n = needle.trim();
  if (!n) return null;
  let best: ViewNode | null = null;
  let bestScore = -1;
  for (const node of flattenTree(root)) {
    if (node.visible === false || node.enabled === false) continue;
    if (isDegenerateHit(root, node)) continue;
    const labels = [
      node.text,
      node.accessibilityLabel,
      ...collectTexts(node, 0, 2),
    ].filter((t): t is string => !!t && t.trim().length > 0);
    if (!labels.some((t) => textMatches(t, n))) continue;
    let score = rankMatch(node) + labelSpecificity(node, { match: [{ text: n }] });
    if (options?.preferNonInput && isInputOrInputWrapper(node)) score -= 200;
    // Prefer roomy-but-not-huge tap targets (real buttons over tiny glyphs).
    const area = node.frame.width * node.frame.height;
    score += Math.min(40, area / 800);
    // Penalize oversized containers.
    score -= Math.min(60, area / 20_000);
    if (score > bestScore) {
      bestScore = score;
      best = nearestInteractive(root, node);
    }
  }
  if (best && isDegenerateHit(root, best)) return null;
  return best;
}

function rankMatch(n: ViewNode): number {
  let s = 0;
  if (n.toggle) s += 100;
  if (n.adjustable) s += 80;
  if (n.sheet && n.clickable) s += 70;
  if (n.clickable) s += 40;
  if (n.enabled) s += 5;
  if (n.visible) s += 2;
  // Prefer tighter frames among equals.
  const area = n.frame.width * n.frame.height;
  if (area > 0 && area < 120_000) s += 3;
  return s;
}

/** A control's own label is stronger evidence than an ancestor's aggregated text. */
function labelSpecificity(node: ViewNode, selector: Selector): number {
  let score = 0;
  for (const rule of selector.match) {
    const wanted = 'text' in rule ? rule.text :
      'accessibilityLabel' in rule ? rule.accessibilityLabel : undefined;
    if (!wanted) continue;
    const own = [node.text, node.accessibilityLabel].filter((x): x is string => !!x);
    if (own.some(text => norm(text) === norm(wanted))) score += 100;
    else if (own.some(text => softKey(text) === softKey(wanted))) score += 90;
    else {
      const labels = new Set(collectTexts(node, 0, 3).map(softKey).filter(Boolean));
      if (labels.size === 1 && labels.has(softKey(wanted))) score += 90;
    }
  }
  return score;
}

/** Keep a broad actionable container from centering between adjacent controls. */
export function centerOfLabel(node: ViewNode, label?: string): { x: number; y: number } {
  if (!label) return centerOf(node);
  const key = softKey(label);
  if (!key || [node.text, node.accessibilityLabel].some(text => text && softKey(text) === key)) return centerOf(node);
  const targets = flattenTree(node).filter(child => child !== node && child.visible !== false &&
    child.enabled !== false && child.frame.width > 0 && child.frame.height > 0 &&
    [child.text, child.accessibilityLabel].some(text => text && softKey(text) === key));
  targets.sort((a, b) => rankMatch(b) - rankMatch(a) ||
    a.frame.width * a.frame.height - b.frame.width * b.frame.height);
  return centerOf(targets[0] || node);
}

export function centerOf(node: ViewNode): { x: number; y: number } {
  return {
    x: node.frame.x + node.frame.width / 2,
    y: node.frame.y + node.frame.height / 2,
  };
}
