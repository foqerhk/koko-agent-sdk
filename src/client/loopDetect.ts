/**
 * Idle / dead-loop detection (mirrors SDK client + KokoAgent explore/escape).
 * Stop on no-progress loops only — not because a goal needs many steps.
 */

export type HistoryLike = {
  tool: string;
  args?: Record<string, unknown>;
  result: string;
  ok?: boolean;
};

export function actionFingerprint(item: HistoryLike): string {
  const tool = item.tool;
  const args = item.args ?? {};
  if (tool === "tap") {
    const sel = args.selector as { match?: unknown } | undefined;
    const matchKey = sel?.match != null ? JSON.stringify(sel.match).slice(0, 100) : "";
    const nodeId = String(args.nodeId || "").trim();
    const label = String(args.label || "").trim();
    return `tap:${(matchKey || nodeId || label || "target").slice(0, 100)}`;
  }
  if (tool === "type") {
    return `type:${String(args.text ?? "").slice(0, 40)}`;
  }
  if (tool === "find") {
    return `find:${JSON.stringify(args.match ?? {}).slice(0, 100)}`;
  }
  if (tool === "swipe") {
    const from = args.from as { x?: number; y?: number } | undefined;
    const to = args.to as { x?: number; y?: number } | undefined;
    return `swipe:${Math.round((from?.x ?? 0) / 40)},${Math.round((from?.y ?? 0) / 40)}→${Math.round(
      (to?.x ?? 0) / 40,
    )},${Math.round((to?.y ?? 0) / 40)}`;
  }
  if (tool === "pinch") {
    const c = args.center as { x?: number; y?: number } | undefined;
    const scale = Number(args.scale ?? 1);
    return `pinch:${Math.round((c?.x ?? 0) / 40)},${Math.round((c?.y ?? 0) / 40)}×${scale.toFixed(2)}`;
  }
  if (tool === "dump") {
    if (/empty|未识别|screen:\s*\(empty\)/i.test(item.result)) return "dump:empty";
    return `dump:${item.result.replace(/\s+/g, " ").slice(0, 48)}`;
  }
  if (tool === "ask_user") return `ask:${String(args.question ?? "").slice(0, 40)}`;
  return `${tool}:${JSON.stringify(args).slice(0, 60)}`;
}

function screenOf(item: HistoryLike): string {
  const m = item.result.match(/(?:^|\|\|\s*)screen:\s*([^\r\n]*)/i);
  return m?.[1]?.trim() ?? "";
}

/** Older hosts may return body text without a screen marker; retain all of it. */
function observationOf(item: HistoryLike): string {
  return (screenOf(item) || item.result).replace(/\s+/g, " ").trim();
}

function sameObservation(items: HistoryLike[]): boolean {
  return items.length >= 2 && items.every((h) => observationOf(h) === observationOf(items[0]!));
}

function isFail(item: HistoryLike): boolean {
  if (typeof item.ok === "boolean") return !item.ok;
  return /^(?:fail(?:ed)?|error|null|tap_failed|tap_noop|scroll_noop|no_focus|empty|未识别)(?:\b|[:：\s(]|$)/i.test(item.result.trim());
}

/** Actions whose whole point is to change something on screen. */
const MUTATING = new Set(["tap", "swipe", "pinch", "type"]);

/** The client ran it and the screen did not react. */
function hadNoEffect(item: HistoryLike): boolean {
  return item.ok === false || /^(?:tap_noop|tap_failed|scroll_noop|no_focus)\b/i.test(item.result.trim());
}

/**
 * Selector wording drifts between retries — grounded text, then the a11y
 * label, then a nodeId, then a coordinate fallback — so fingerprint equality
 * misses the most common stall: aiming at the same place through a different
 * description each time.
 *
 * Comparing whole screens across steps does not catch it either, because a
 * rotating ad or carousel changes the fingerprint while the page stays put.
 * Trust the per-step verdict instead: the client captures before and after
 * around each action, moments apart, and marks it `tap_noop` when nothing
 * moved. A window whose only attempts to change something all reported no
 * effect is stuck, however the calls were phrased and whatever else animates.
 */
function madeNoProgress(history: HistoryLike[]): boolean {
  const mutating = history.slice(-4).filter((h) => MUTATING.has(h.tool));
  const preDispatch = mutating.filter(h => /^pre_dispatch:/i.test(h.result));
  const dispatched = mutating.filter(h => !/^pre_dispatch:/i.test(h.result));
  if (preDispatch.length >= 3 && preDispatch.length === mutating.length) return true;
  const dead = dispatched.filter(hadNoEffect);
  return dead.length >= 2 && dead.length === dispatched.length;
}

/** Bound interleaved find/dump loops on one unchanged observed screen. */
function repeatedReadOnly(history: HistoryLike[]): boolean {
  const tail = history.slice(-8);
  if (tail.length < 8 || !tail.every(h => h.tool === 'find' || h.tool === 'dump')) return false;
  const finds = tail.filter(h => h.tool === 'find');
  const screens = tail.map(screenOf).filter(Boolean);
  if (finds.length < 3 || screens.length < 3 || !screens.every(s => s === screens[0])) return false;
  const fps = finds.map(actionFingerprint);
  return fps.some(fp => fps.filter(value => value === fp).length >= 3) || finds.every(isFail);
}

export function isLooping(history: HistoryLike[]): boolean {
  const recent = history.slice(-5);
  if (recent.length < 3) return false;

  if (madeNoProgress(history)) return true;
  if (repeatedReadOnly(history)) return true;

  const fps = recent.map(actionFingerprint);
  const last = fps[fps.length - 1]!;
  const sameFpCount = fps.filter((f) => f === last).length;
  const screenStagnant = recent.length >= 3 && sameObservation(recent);
  const lastThree = recent.slice(-3);
  const allFail = lastThree.every(isFail);
  const identicalResults =
    lastThree.length === 3 &&
    lastThree.every(
      (h) => h.result === lastThree[0]!.result,
    );

  // dump/find are observe — identical verify dumps must not abort mid-goal.
  if (sameFpCount >= 3) {
    const lastTool = recent[recent.length - 1]?.tool;
    if (lastTool !== "dump" && lastTool !== "find") {
      if (allFail || identicalResults || screenStagnant) return true;
    }
  }

  if (recent.length >= 4) {
    const a = fps[fps.length - 1];
    const b = fps[fps.length - 2];
    if (a && b && a !== b && fps[fps.length - 3] === a && fps[fps.length - 4] === b) {
      // Alternating actions are common in valid workflows (select/continue,
      // increment/confirm, tap/verify). Only stop when each phase also returns
      // to the same observation, rather than when actions alone form A-B-A-B.
      const cycle = recent.slice(-4);
      if (observationOf(cycle[0]!) === observationOf(cycle[2]!) &&
          observationOf(cycle[1]!) === observationOf(cycle[3]!)) return true;
    }
  }

  // Observe-only thrash: a couple dumps for verify is ok; 3+ identical scans = stuck.
  const trailing = recent.slice(-3);
  if (
    trailing.length >= 3 &&
    trailing.every((h) => h.tool === "dump") &&
    sameObservation(trailing)
  ) {
    return true;
  }

  const fails = recent.filter(isFail);
  if (fails.length >= 3) {
    const failFps = fails.map(actionFingerprint);
    const failScreens = fails.map(screenOf).filter(Boolean);
    const sameScreen = failScreens.length !== fails.length || failScreens.every(s => s === failScreens[0]);
    if (failFps.length >= 3 && sameScreen && failFps.every((f) => f === failFps[0])) return true;
  }

  // Same screen + same *mutating* tool = stuck. Pure dump/find is verification.
  if (screenStagnant) {
    const tools = recent.slice(-3).map((h) => h.tool);
    const t0 = tools[0];
    if (
      tools.every((t) => t === t0) &&
      t0 !== "type" &&
      t0 !== "dump" &&
      t0 !== "find"
    ) {
      return true;
    }
  }

  return false;
}

export function isNearLoop(history: HistoryLike[]): boolean {
  const recent = history.slice(-3);
  if (recent.length < 2) return false;

  // A bounded loading/verification wait can repeat; warn only if unchanged.
  const trailingDumps = recent.slice(-2);
  if (trailingDumps.length >= 2 && trailingDumps.every((h) => h.tool === "dump") &&
      sameObservation(trailingDumps)) {
    return true;
  }

  const fps = recent.map(actionFingerprint);
  const last = fps[fps.length - 1]!;
  if (fps.filter((f) => f === last).length < 2) return false;
  if (sameObservation(recent)) return true;
  return (
    recent.slice(-2).every(isFail) ||
    recent.slice(-2).every((h) => h.result === recent[recent.length - 1]!.result)
  );
}

export const LOOP_ESCAPE_HINT = `【恢复评估 — 近期观察或动作重复，先核验当前状态】
- 对照用户目标和最新证据：已验证全部结果才 done(true)；重复或空转本身不代表成功
- 加载、转场或已提交操作仍待结果时，可以在客户端预算内用 dump 只读核验；持续不变则如实 done(false)说明未确认，不重提请求或重走已完成流程
- tap_noop / tap_failed 后先核对当前控件与状态；只有存在有证据且安全的替代动作才调整 selector、目标或路径，不能为了逃逸而猜点
- 与当前子目标相关的标题、正文、页码或状态持续变化时，同名或交替按钮仍可能是正常进展；不要按固定点击次数或动作序列认定循环
- 下一步控件确实可见、可操作且属于当前目标时再 tap/type；已满足的选中状态不重复切换
- 仅目标属于当前列表且有滚动区域边界时才 swipe 查找；手势起终点在区域内，不能用滑动猜测导航
- 数值控件按实际类型、当前值、范围和用户精度要求调整，不预设手势方向；无效果、到边界或缺少证据时说明受阻
- find/tap 使用最新能力里的文案或 id；缺少安全下一步时允许只读观察或如实结束，不强制切换路径`;
