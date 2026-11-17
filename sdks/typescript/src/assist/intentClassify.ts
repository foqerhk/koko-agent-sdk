/**
 * On-device goal intent classification (structural, host-agnostic).
 * Complements Core ML / Vision OCR — no package IDs or product copy.
 */

export type AssistIntent =
  | 'tap'
  | 'type'
  | 'scroll'
  | 'back'
  | 'search'
  | 'settings'
  | 'unknown';

export type IntentResult = {
  intent: AssistIntent;
  confidence: number;
  /** Tokens useful for node ranking (from the goal itself). */
  tokens: string[];
};

const STOP = new Set(
  [
    '打开',
    '进入',
    '点击',
    '点选',
    '按下',
    '点',
    '一下',
    '这个',
    '那个',
    '按钮',
    '去',
    '到',
    '把',
    '将',
    '请',
    '帮我',
    '我想',
    'the',
    'a',
    'an',
    'to',
    'open',
    'tap',
    'click',
    'press',
    'go',
  ].map((s) => s.toLowerCase()),
);

/** Extract short goal tokens for ranking (CJK chunks + latin words). */
export function goalTokens(goal: string): string[] {
  const raw = String(goal || '').trim();
  if (!raw) return [];
  const out: string[] = [];
  const latin = raw.match(/[A-Za-z0-9_]{2,}/g) || [];
  for (const w of latin) {
    const n = w.toLowerCase();
    if (!STOP.has(n)) out.push(n);
  }
  // CJK runs of 2–8 chars
  const cjk = raw.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  for (const w of cjk) {
    if (!STOP.has(w)) out.push(w);
  }
  return [...new Set(out)].slice(0, 12);
}

/**
 * Cheap on-device intent — runs everywhere (JS). iOS Vision OCR enriches tokens separately.
 */
export function classifyGoalIntent(goal: string): IntentResult {
  const g = String(goal || '').trim();
  const tokens = goalTokens(g);
  if (!g) return { intent: 'unknown', confidence: 0, tokens };

  if (
    /返回|后退|回去|关闭弹窗|关掉|dismiss|go\s*back|close\s*(this|dialog|sheet)?/i.test(
      g,
    )
  ) {
    return { intent: 'back', confidence: 0.85, tokens };
  }
  if (
    /搜索|查找|搜一下|search|find\s+(for|the)|query/i.test(g) &&
    !/打开搜索|进入搜索设置/i.test(g)
  ) {
    return { intent: 'search', confidence: 0.8, tokens };
  }
  if (
    /输入|填写|键入|打字|type|enter\s+text|fill\s+in|写入/i.test(g) ||
    /输入[「"'].+[」"']/.test(g)
  ) {
    return { intent: 'type', confidence: 0.82, tokens };
  }
  if (
    /设置|設定|偏好|语言|語言|主题|外观|locale|language|theme|settings|preferences/i.test(
      g,
    )
  ) {
    return { intent: 'settings', confidence: 0.78, tokens };
  }
  if (
    /滚动|下滑|上滑|滑到底|翻页|scroll|swipe\s*(up|down)|下一屏/i.test(g)
  ) {
    return { intent: 'scroll', confidence: 0.8, tokens };
  }
  if (
    /点击|点选|按下|点一下|打开|进入|切换|选择|确认|提交|tap|click|press|open|select|confirm/i.test(
      g,
    )
  ) {
    return { intent: 'tap', confidence: 0.75, tokens };
  }
  // Bare label goals → tap
  if (tokens.length >= 1 && g.length <= 24) {
    return { intent: 'tap', confidence: 0.55, tokens };
  }
  return { intent: 'unknown', confidence: 0.3, tokens };
}
