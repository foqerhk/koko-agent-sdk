/**
 * Optional host-declared actions — the low-friction way for complex Apps
 * (OneKey / Tamagui) when native dump cannot see icons without a11y/testID.
 *
 * Hosts register controls only while mounted and visible. Callbacks supplement
 * native controls; registration does not establish visibility or identity.
 *
 * IMPORTANT: host ids are NOT dump nodeIds. Never emit `id=host:…` in the
 * screen model — planners will tap them and fail with "nodeId not found".
 *
 * Optional `run`: after a unique current native control is bound, a callback
 * may execute its behavior instead of dispatching a geometric touch.
 */

import { flattenTree, textMatches } from '../selector/match';
import type { ViewNode } from '../types';

export type HostActionKind =
  | 'button'
  | 'tab'
  | 'nav'
  | 'field'
  | 'sheet'
  | 'other';

/**
 * Host action matching: also consider optional aliases (e.g. prior-locale tab copy).
 */
export type HostAction = {
  /** Stable id, e.g. "tab.home" / "header.settings". */
  id: string;
  /** Human label shown to the planner (prefer host locale). */
  label: string;
  kind?: HostActionKind;
  /** Prefer testID when the host already has one. */
  testID?: string;
  /** Free-text / a11y match fallback. */
  text?: string;
  /** Extra NL match strings (other locales / synonyms). */
  aliases?: string[];
  /** Optional deep-link or route hint for narration only. */
  route?: string;
  /**
   * Host-provided invoke. Used only after unique native target binding.
   * Register only while the CTA is mounted and visible; unregister on blur.
   */
  run?: () => void | Promise<void>;
  /**
   * When true (default for one-shot CTAs), unregister after a successful host run.
   * Tabs / persistent chrome should set `oneshot: false`.
   */
  oneshot?: boolean;
};

type Listener = (actions: HostAction[]) => void;

class HostActionsStoreImpl {
  private actions: HostAction[] = [];
  private listeners = new Set<Listener>();

  /** Replace the whole catalog (typical: once at app start). */
  setActions(actions: HostAction[]) {
    this.actions = sanitize(actions);
    this.emit();
  }

  /** Append / upsert by id. */
  registerActions(actions: HostAction[]) {
    const map = new Map(this.actions.map((a) => [a.id, a]));
    for (const a of sanitize(actions)) map.set(a.id, a);
    this.actions = [...map.values()];
    this.emit();
  }

  /** Drop a previously registered action (e.g. EmptyWallet unmount). */
  unregisterAction(id: string) {
    const key = String(id ?? '').replace(/^host:/, '').trim();
    if (!key) return;
    const next = this.actions.filter((a) => a.id !== key);
    if (next.length === this.actions.length) return;
    this.actions = next;
    this.emit();
  }

  clear() {
    this.actions = [];
    this.emit();
  }

  getActions(): HostAction[] {
    return this.actions.slice();
  }

  getById(id: string): HostAction | undefined {
    const key = id.replace(/^host:/, '').trim();
    return this.actions.find((a) => a.id === key);
  }

  /** Match by label / text / testID (planner taps by copy, not host id). */
  findForTap(needle: {
    label?: string;
    text?: string;
    testID?: string;
  }): HostAction | undefined {
    const testID = (needle.testID || '').trim();
    if (testID) {
      const matches = this.actions.filter((a) => a.testID === testID);
      // An explicit native identity must not fall back to a different callback.
      return matches.length === 1 ? matches[0] : undefined;
    }
    const raw = (needle.text || needle.label || '').trim();
    if (!raw) return undefined;
    // Also match 「发现」 inside narration like「打开「发现」标签页」.
    const quoted = raw.match(/「([^」]+)」/)?.[1]?.trim();
    const needles = quoted && quoted !== raw ? [raw, quoted] : [raw];

    const hits = this.actions.filter(a => {
      const candidates = [a.label, a.text, ...(a.aliases ?? [])].filter(
        Boolean,
      ) as string[];
      return needles.some(label => candidates.some(c => textMatches(c, label, true)));
    });
    // Repeated row labels need the native selector/geometry or a unique testID.
    // Picking the first callback silently targets a different item.
    return hits.length === 1 ? hits[0] : undefined;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getActions());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const snap = this.getActions();
    for (const l of this.listeners) l(snap);
  }
}

function sanitize(actions: HostAction[]): HostAction[] {
  const out: HostAction[] = [];
  for (const a of actions) {
    const id = String(a?.id ?? '').trim();
    const label = String(a?.label ?? '').trim();
    if (!id || !label) continue;
    const kind = a.kind ?? 'button';
    const hasRun = typeof a.run === 'function';
    // Tabs stay registered; button CTAs with run are one-shot by default.
    const oneshot =
      typeof a.oneshot === 'boolean'
        ? a.oneshot
        : hasRun && kind !== 'tab';
    out.push({
      id: id.slice(0, 80),
      label: label.slice(0, 80),
      kind,
      testID: a.testID?.trim().slice(0, 120) || undefined,
      text: a.text?.trim().slice(0, 80) || undefined,
      aliases: Array.isArray(a.aliases)
        ? a.aliases
            .map((s) => String(s ?? '').trim().slice(0, 80))
            .filter(Boolean)
            .slice(0, 8)
        : undefined,
      route: a.route?.trim().slice(0, 120) || undefined,
      // Keep host callback by reference — not serializable, intentional.
      run: hasRun ? a.run : undefined,
      oneshot,
    });
  }
  return out.slice(0, 80);
}

function hostNeedle(a: HostAction): string {
  return (a.text || a.label || '').trim();
}

/**
 * A unique callback catalog entry is not a unique native control. Bind it to
 * the node already chosen by the full selector (including index/nearText),
 * otherwise the caller must preserve that selector and use a native touch.
 */
export function canRunHostActionForNode(
  action: HostAction,
  selected: ViewNode | null | undefined,
  root: ViewNode | null | undefined,
): boolean {
  if (!selected || !root || typeof action.run !== 'function') return false;
  const nodes = new Map<string, ViewNode>();
  const parents = new Map<string, ViewNode>();
  const collect = (node: ViewNode, parent?: ViewNode) => {
    if (node.visible === false || node.enabled === false) return;
    nodes.set(node.id, node);
    if (parent) parents.set(node.id, parent);
    for (const child of node.children) collect(child, node);
  };
  collect(root);
  const current = nodes.get(selected.id);
  if (!current || current.type !== selected.type || current.text !== selected.text ||
      current.accessibilityLabel !== selected.accessibilityLabel || current.testID !== selected.testID) return false;
  const usable = (node: ViewNode) => {
    const frame = node.frame;
    const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
    return node.id !== root.id && frame.width > 0 && frame.height > 0 &&
      frame.width * frame.height < root.frame.width * root.frame.height * 0.55 &&
      cx >= root.frame.x && cx <= root.frame.x + root.frame.width &&
      cy >= root.frame.y && cy <= root.frame.y + root.frame.height;
  };
  const owner = (node: ViewNode): ViewNode | undefined => {
    for (let current: ViewNode | undefined = node; current; current = parents.get(current.id)) {
      if (usable(current) && (current.clickable || current.toggle || current.adjustable ||
          /button|tabbaritem|bottomnavigationitem/i.test(current.type))) return current;
    }
    return undefined;
  };
  const targetOwner = owner(current);
  if (action.testID) {
    const matches = [...nodes.values()].filter(node => node.testID === action.testID && usable(node));
    if (matches.length !== 1) return false;
    const anchor = matches[0];
    // A unique explicit testID may identify a non-clickable text leaf, which
    // Fabric commonly nests inside the actual Pressable selected by geometry.
    return anchor.id === current.id || (!!targetOwner && owner(anchor)?.id === targetOwner.id);
  }
  if (!targetOwner) return false;
  const needles = [action.text || action.label, ...(action.aliases || [])].filter(Boolean);
  const owners = new Set<string>();
  for (const node of nodes.values()) {
    if (!needles.some(label => textMatches(node.text, label, true) || textMatches(node.accessibilityLabel, label, true))) continue;
    const control = owner(node);
    if (control) owners.add(control.id);
  }
  return owners.size === 1 && owners.has(targetOwner.id);
}

/**
 * Callbacks declare behavior, not visibility. Only current visible native
 * evidence enters the model; missing native content can use fresh local OCR.
 */
export function filterVisibleHostActions(
  actions: HostAction[],
  root: ViewNode | null | undefined,
): HostAction[] {
  if (!actions.length) return [];
  if (!root) return [];
  const nodes = flattenTree(root).filter(n => n.visible !== false && n.enabled !== false);
  const inDump = (a: HostAction, exact = false): boolean => {
    if (a.testID && nodes.some((n) => n.testID === a.testID)) return true;
    const needles = [hostNeedle(a), ...(a.aliases ?? [])]
      .map((s) => s.trim())
      .filter(Boolean);
    if (!needles.length) return false;
    for (const needle of needles) {
      const hit = nodes.some((n) => {
        if (exact) {
          return (
            textMatches(n.text, needle, true) ||
            textMatches(n.accessibilityLabel, needle, true)
          );
        }
        return (
          textMatches(n.text, needle) ||
          textMatches(n.accessibilityLabel, needle)
        );
      });
      if (hit) return true;
    }
    return false;
  };
  return actions.filter((a) => {
    // Exact: avoid a short navigation label matching longer onboarding copy.
    if (a.kind === 'tab') return inDump(a, true);
    return inDump(a, true);
  });
}

/**
 * Compact lines merged into ui_screen_model.
 * No fake node ids — tap must use text「…」 / testID, never id=host:….
 */
export function hostActionsModelText(actions: HostAction[]): string {
  if (!actions.length) return '';
  return actions
    .map((a) => {
      const kind = a.kind ?? 'button';
      const tip = a.testID
        ? ` testID=${a.testID}`
        : a.text
          ? ` text「${a.text}」`
          : ` text「${a.label}」`;
      const via = typeof a.run === 'function' ? '（host run）' : '（按文案 tap，禁止用 host id）';
      return `- [host:${kind}] 「${a.label}」${tip}${via}`;
    })
    .join('\n');
}

export const HostActionsStore = new HostActionsStoreImpl();

export function setHostActions(actions: HostAction[]) {
  HostActionsStore.setActions(actions);
}

export function registerHostActions(actions: HostAction[]) {
  HostActionsStore.registerActions(actions);
}

export function unregisterHostAction(id: string) {
  HostActionsStore.unregisterAction(id);
}

export function clearHostActions() {
  HostActionsStore.clear();
}

/**
 * Upper bound on a single host action. These callbacks are app code we do not
 * control: one that never settles wedges the whole goal with no step, no log
 * line and no timeout above it. Observed as a goal sitting for minutes without
 * ever reaching the planner.
 */
export const HOST_ACTION_TIMEOUT_MS = 8000;

/**
 * Await a host callback without letting it hang the agent. Resolves false when
 * it throws or outruns its budget. False means the outcome is unknown: the
 * callback may already have committed work, so callers must not replay a tap.
 */
export async function runHostAction(
  run: () => void | Promise<void>,
  timeoutMs: number = HOST_ACTION_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(run()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`host action exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
