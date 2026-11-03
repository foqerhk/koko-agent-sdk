/**
 * On-device exploration graph — screen fingerprints + labeled transitions.
 * No host feature catalog required. Persist best-effort (AsyncStorage if present).
 */

export type ExploreNode = {
  id: string;
  /** Compact affordance labels used for matching. */
  labels: string[];
  fingerprint: string;
  seenAt: number;
  visitCount: number;
};

export type ExploreEdge = {
  id: string;
  fromId: string;
  toId: string;
  /** Tap / host label that caused the transition. */
  label: string;
  count: number;
  lastAt: number;
};

export type ExplorationGraphSnapshot = {
  version: 1;
  appKey: string;
  updatedAt: number;
  nodes: ExploreNode[];
  edges: ExploreEdge[];
};

export type PathStep = {
  fromId: string;
  toId: string;
  label: string;
};

const STORAGE_KEY_PREFIX = '@koko/exploration-graph/v1/';

function stableHash(parts: string[]): string {
  // FNV-1a 32-bit — good enough for local fingerprints.
  let h = 0x811c9dc5;
  const s = parts.join('\u0001');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Normalize labels for graph identity (locale-ish noise trimmed). */
export function normalizeExploreLabel(label: string): string {
  return String(label || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * Cross-locale synonyms for explore edge labels.
 * Stale graphs often store JP「環境設定」while the live UI shows「偏好设置」.
 */
const EXPLORE_LABEL_GROUPS: string[][] = [
  ['偏好设置', '偏好設定', '環境設定', 'Preferences', '偏好'],
  ['设置', '設定', 'Settings'],
  ['语言', '語言', 'Language', '言語'],
  ['主题', 'Theme', 'テーマ', '外观'],
  ['更多', '选项', '選項', 'More', 'Options', 'オプション'],
];

/** All synonym spellings for an explore / affordance label. */
export function exploreLabelSynonyms(label: string): string[] {
  const n = normalizeExploreLabel(label);
  if (!n) return [];
  const lower = n.toLowerCase();
  for (const group of EXPLORE_LABEL_GROUPS) {
    if (
      group.some((g) => {
        const ng = normalizeExploreLabel(g);
        return ng === n || ng.toLowerCase() === lower;
      })
    ) {
      return [...new Set(group.map(normalizeExploreLabel))];
    }
  }
  return [n];
}

/**
 * Map a historical explore tap label onto a label currently on screen
 * (exact / synonym). Returns null when nothing matches.
 */
export function resolveExploreLabelOnScreen(
  desired: string,
  available: string[],
): string | null {
  if (!desired || !available.length) return null;
  const syns = exploreLabelSynonyms(desired);
  const pairs = available.map((raw) => ({
    raw,
    norm: normalizeExploreLabel(raw),
  }));
  for (const s of syns) {
    const hit = pairs.find(
      (p) => p.norm === s || p.norm.toLowerCase() === s.toLowerCase(),
    );
    if (hit) return hit.raw;
  }
  for (const s of syns) {
    if (s.length < 2) continue;
    const hit = pairs.find(
      (p) => p.norm.includes(s) || s.includes(p.norm),
    );
    if (hit) return hit.raw;
  }
  return null;
}

/**
 * Fingerprint a screen from affordance labels (order-insensitive top-N).
 */
export function fingerprintFromLabels(labels: string[], max = 16): string {
  const norm = [
    ...new Set(
      labels
        .map(normalizeExploreLabel)
        .filter((l) => l.length >= 1 && l.length <= 40),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, max);
  return stableHash(norm.length ? norm : ['(empty)']);
}

function edgeId(fromId: string, label: string, toId: string): string {
  return `${fromId}|${normalizeExploreLabel(label)}|${toId}`;
}

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function tryAsyncStorage(): AsyncStorageLike | null {
  try {
    // Optional peer — many RN hosts already ship it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const store = mod?.default ?? mod;
    if (store && typeof store.getItem === 'function') return store;
  } catch {
    // optional
  }
  return null;
}

export class ExplorationGraphStore {
  private appKey = 'default';
  private nodes = new Map<string, ExploreNode>();
  private edges = new Map<string, ExploreEdge>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  setAppKey(appKey: string) {
    const next = String(appKey || 'default').trim() || 'default';
    if (next === this.appKey && this.loaded) return;
    if (next !== this.appKey) {
      this.nodes.clear();
      this.edges.clear();
      this.loaded = false;
    }
    this.appKey = next;
  }

  getAppKey() {
    return this.appKey;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const storage = tryAsyncStorage();
    if (!storage) return;
    try {
      const raw = await storage.getItem(STORAGE_KEY_PREFIX + this.appKey);
      if (!raw) return;
      const snap = JSON.parse(raw) as ExplorationGraphSnapshot;
      if (snap?.version !== 1 || !Array.isArray(snap.nodes)) return;
      for (const n of snap.nodes) this.nodes.set(n.id, n);
      for (const e of snap.edges || []) this.edges.set(e.id, e);
    } catch {
      // corrupt — start fresh
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 400);
  }

  async persist() {
    const storage = tryAsyncStorage();
    if (!storage) return;
    try {
      const snap = this.snapshot();
      await storage.setItem(
        STORAGE_KEY_PREFIX + this.appKey,
        JSON.stringify(snap),
      );
    } catch {
      // ignore quota / unavailable
    }
  }

  snapshot(): ExplorationGraphSnapshot {
    return {
      version: 1,
      appKey: this.appKey,
      updatedAt: Date.now(),
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    // Persist immediately so a stale debounce cannot resurrect old edges.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.persist();
  }

/** Upsert a screen node; returns node id (= fingerprint). */
  observeScreen(labels: string[]): ExploreNode {
    const clean = labels
      .map(normalizeExploreLabel)
      .filter(
        (l) =>
          l &&
          !/Open debugger|view warnings|^!,/i.test(l) &&
          !/^LogBox/i.test(l),
      );
    // Empty dumps are transient overlays — still fingerprint, but don't
    // inflate visit noise by merging junk labels into an existing rich node.
    const id = fingerprintFromLabels(clean);
    const prev = this.nodes.get(id);
    const node: ExploreNode = {
      id,
      labels:
        clean.length > 0
          ? clean.slice(0, 24)
          : prev?.labels?.length
            ? prev.labels
            : [],
      fingerprint: id,
      seenAt: Date.now(),
      visitCount: (prev?.visitCount ?? 0) + 1,
    };
    this.nodes.set(id, node);
    this.scheduleSave();
    return node;
  }

  /**
   * Record a transition after a tap. No-op if screen did not change.
   */
  recordTransition(fromLabels: string[], label: string, toLabels: string[]) {
    const from = this.observeScreen(fromLabels);
    const to = this.observeScreen(toLabels);
    const action = normalizeExploreLabel(label);
    if (!action || from.id === to.id) return null;
    const id = edgeId(from.id, action, to.id);
    const prev = this.edges.get(id);
    const edge: ExploreEdge = {
      id,
      fromId: from.id,
      toId: to.id,
      label: action,
      count: (prev?.count ?? 0) + 1,
      lastAt: Date.now(),
    };
    this.edges.set(id, edge);
    this.scheduleSave();
    return edge;
  }

  /** Nodes whose labels match any of the query tokens. */
  findNodesMatching(tokens: string[]): ExploreNode[] {
    const toks = tokens
      .map((t) => normalizeExploreLabel(t).toLowerCase())
      .filter((t) => t.length >= 2);
    if (!toks.length) return [];
    const hits: ExploreNode[] = [];
    for (const n of this.nodes.values()) {
      const blob = n.labels.join('\n').toLowerCase();
      if (toks.some((t) => blob.includes(t))) hits.push(n);
    }
    return hits.sort((a, b) => b.visitCount - a.visitCount);
  }

  /**
   * BFS shortest path of tap labels from current fingerprint toward any
   * node matching goal tokens.
   */
  findPathToGoal(
    fromLabels: string[],
    goalTokens: string[],
    maxDepth = 6,
  ): PathStep[] | null {
    const fromId = fingerprintFromLabels(fromLabels);
    // Prefer nodes matching the most *specific* tokens (语言 > 偏好 > 设置).
    const tokenWeight = (t: string) => {
      if (/语言|語言|language|locale/i.test(t)) return 4;
      if (/偏好|preferences/i.test(t)) return 2;
      if (/设置|設定|settings/i.test(t)) return 1;
      return 1;
    };
    const scored = [...this.nodes.values()]
      .map((n) => {
        const blob = n.labels.join('\n').toLowerCase();
        let score = 0;
        for (const t of goalTokens) {
          if (blob.includes(t.toLowerCase())) score += tokenWeight(t);
        }
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.n.visitCount - a.n.visitCount);
    if (!scored.length) return null;
    // If the goal cares about language, prefer screens that literally show it
    // over parent menus that only mention 偏好/设置.
    const wantsLanguage = goalTokens.some((t) =>
      /语言|語言|language|locale/i.test(t),
    );
    const languageHits = wantsLanguage
      ? scored.filter((x) =>
          x.n.labels.some((l) => /语言|語言|language|locale/i.test(l)),
        )
      : [];
    // A specific goal that no explored screen actually satisfies must not fall
    // back to screens that merely scored on an incidental token: the caller
    // walks this path blindly, so a confident wrong answer costs real taps and
    // can strand the App somewhere worse than where it started. Say "no path"
    // and let the planner read the current screen instead.
    if (wantsLanguage && !languageHits.length) return null;
    const pool = languageHits.length ? languageHits : scored;
    const best = pool[0]!.score;
    const targets = new Set(
      pool.filter((x) => x.score === best).map((x) => x.n.id),
    );
    if (targets.has(fromId)) return [];

    const adj = new Map<string, ExploreEdge[]>();
    for (const e of this.edges.values()) {
      const list = adj.get(e.fromId) ?? [];
      list.push(e);
      adj.set(e.fromId, list);
    }
    for (const list of adj.values()) {
      list.sort((a, b) => b.count - a.count);
    }

    const queue: Array<{ id: string; path: PathStep[] }> = [
      { id: fromId, path: [] },
    ];
    const seen = new Set<string>([fromId]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.path.length >= maxDepth) continue;
      const outs = adj.get(cur.id) ?? [];
      // First hop must be tappable on the live screen (or a synonym of one).
      for (const e of outs) {
        if (seen.has(e.toId)) continue;
        if (
          cur.path.length === 0 &&
          !resolveExploreLabelOnScreen(e.label, fromLabels)
        ) {
          continue;
        }
        const nextPath = [
          ...cur.path,
          { fromId: e.fromId, toId: e.toId, label: e.label },
        ];
        if (targets.has(e.toId)) return nextPath;
        seen.add(e.toId);
        queue.push({ id: e.toId, path: nextPath });
      }
    }
    return null;
  }

  /**
   * Soft hints for the planner: known outgoing labels from current screen
   * that historically led toward goal-matching screens.
   */
  hintLabelsTowardGoal(fromLabels: string[], goalTokens: string[], limit = 6): string[] {
    const path = this.findPathToGoal(fromLabels, goalTokens, 6);
    if (path?.length) {
      return [...new Set(path.map((p) => p.label))].slice(0, limit);
    }
    // Fallback: any edge label that appears on a goal-matching node as well.
    const goalNodes = this.findNodesMatching(goalTokens);
    if (!goalNodes.length) return [];
    const goalIds = new Set(goalNodes.map((n) => n.id));
    const fromId = fingerprintFromLabels(fromLabels);
    const labels: string[] = [];
    for (const e of this.edges.values()) {
      if (e.fromId === fromId && goalIds.has(e.toId)) labels.push(e.label);
    }
    // Also surface labels that appear ON goal screens (what to look for).
    for (const n of goalNodes.slice(0, 3)) {
      for (const l of n.labels.slice(0, 8)) {
        if (goalTokens.some((t) => l.toLowerCase().includes(t.toLowerCase()))) {
          labels.push(l);
        }
      }
    }
    return [...new Set(labels)].slice(0, limit);
  }

  stats() {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      appKey: this.appKey,
    };
  }
}

export const ExplorationGraph = new ExplorationGraphStore();

/** Extract goal tokens for graph search (structural NL bits). */
export function goalTokensForExplore(goal: string): string[] {
  return goalExploreQuery(goal).allTokens;
}

/**
 * Split explore query into destination tokens vs broader keywords.
 * E.g. 「设置语言」targets 语言 screens, not every screen that merely says 设置.
 */
export function goalExploreQuery(goal: string): {
  targetTokens: string[];
  allTokens: string[];
} {
  const g = String(goal || '').trim();
  const all: string[] = [];
  const add = (list: string[], s: string) => {
    const t = normalizeExploreLabel(s);
    if (t.length >= 2) list.push(t);
  };
  const targetTokens: string[] = [];
  if (/语言|語言|language|locale|言語/i.test(g)) {
    add(targetTokens, '语言');
    add(targetTokens, 'Language');
    add(targetTokens, '言語');
    add(targetTokens, 'locale');
    // Preferences screens usually host the language control.
    add(targetTokens, '偏好');
    add(targetTokens, 'Preferences');
    add(targetTokens, '偏好设置');
    add(targetTokens, '環境設定');
  } else if (/主题|theme|テーマ/i.test(g)) {
    add(targetTokens, '主题');
    add(targetTokens, 'Theme');
    add(targetTokens, 'テーマ');
  } else if (/偏好|preferences|環境設定/i.test(g)) {
    add(targetTokens, '偏好');
    add(targetTokens, 'Preferences');
    add(targetTokens, '環境設定');
  } else if (/设置|設定|settings/i.test(g)) {
    add(targetTokens, '设置');
    add(targetTokens, 'Settings');
    add(targetTokens, '設定');
  }
  for (const t of targetTokens) add(all, t);
  if (/设置|設定|settings/i.test(g)) {
    add(all, '设置');
    add(all, 'Settings');
    add(all, '設定');
  }
  if (/偏好|preferences|環境設定/i.test(g)) {
    add(all, '偏好');
    add(all, 'Preferences');
    add(all, '環境設定');
  }
  if (/更多|选项|More|Options|オプション|選項/i.test(g)) {
    add(all, '更多');
    add(all, '选项');
    add(all, 'オプション');
  }
  const stripped = g
    .replace(
      /^(请|帮我|帮忙|麻烦|我想|我要|打开|进入|点击|点|切换|设置|把)/g,
      '',
    )
    .replace(/一下|这个|那个/g, '');
  for (const m of stripped.match(/[\u4e00-\u9fff]{2,8}|[A-Za-z]{3,16}/g) ?? []) {
    add(all, m);
  }
  const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 12);
  const targets = uniq(targetTokens);
  return {
    targetTokens: targets.length ? targets : uniq(all),
    allTokens: uniq(all),
  };
}

export function exploreHintsModelText(hints: string[]): string {
  if (!hints.length) return '';
  return `- [explore] 本机探索图建议优先尝试：${hints.map((h) => `「${h}」`).join(' → ')}（非强制；以当前 dump 为准）`;
}
