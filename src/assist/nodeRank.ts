import type { ViewNode } from '../types';
import { flattenTree } from '../selector/match';
import type { AssistIntent } from './intentClassify';

export type RankedNode = {
  id: string;
  label: string;
  score: number;
  clickable: boolean;
  kindHint: 'button' | 'field' | 'scroll' | 'other';
};

export type OcrTextHit = {
  text: string;
  confidence: number;
  frame?: { x: number; y: number; width: number; height: number };
};

function nodeLabel(n: ViewNode): string {
  return (n.text || n.accessibilityLabel || n.testID || '').trim();
}

function kindHint(n: ViewNode, intent: AssistIntent): RankedNode['kindHint'] {
  const t = `${n.type || ''} ${nodeLabel(n)}`.toLowerCase();
  if (
    /textinput|textfield|edittext|searchbar|uitextfield|rcttextfield/i.test(t) ||
    intent === 'type' ||
    intent === 'search'
  ) {
    if (/textinput|textfield|edittext|search/i.test(t)) return 'field';
  }
  if (/scroll|list|flatlist|collection|table/i.test(t)) return 'scroll';
  if (n.clickable || /button|touchable|pressable/i.test(t)) return 'button';
  return 'other';
}

function tokenHit(label: string, tokens: string[]): number {
  if (!label || !tokens.length) return 0;
  const soft = label.toLowerCase().replace(/\s+/g, '');
  let best = 0;
  for (const tok of tokens) {
    const t = tok.toLowerCase().replace(/\s+/g, '');
    if (!t) continue;
    if (soft === t) best = Math.max(best, 1);
    else if (soft.includes(t) && t.length >= 2) {
      best = Math.max(best, 0.55 + 0.35 * (t.length / Math.max(soft.length, 1)));
    } else if (t.includes(soft) && soft.length >= 2) {
      best = Math.max(best, 0.4 + 0.3 * (soft.length / t.length));
    }
  }
  return Math.min(1, best);
}

/**
 * Rank dump nodes for an on-device assist pass (goal tokens + OCR tokens + intent).
 */
export function rankNodesForGoal(
  tree: ViewNode,
  opts: {
    intent: AssistIntent;
    tokens: string[];
    /** Extra tokens from Vision OCR (iOS). */
    ocrTokens?: string[];
    limit?: number;
  },
): RankedNode[] {
  const limit = opts.limit ?? 8;
  const goalTok = [...new Set((opts.tokens || []).filter(Boolean))];
  // OCR is supportive only — do not let whole-screen OCR drown the goal.
  const ocrTok = [...new Set((opts.ocrTokens || []).filter(Boolean))].filter(
    (t) => !goalTok.some((g) => g.toLowerCase() === t.toLowerCase()),
  );
  const flat = flattenTree(tree);
  const scored: RankedNode[] = [];

  for (const n of flat) {
    if (!n.visible) continue;
    const label = nodeLabel(n);
    if (!label && !n.clickable) continue;
    const goalHit = tokenHit(label || n.testID || '', goalTok);
    const ocrHit = tokenHit(label || n.testID || '', ocrTok);
    // Goal match dominates; OCR contributes at most ~0.35.
    const hit = Math.max(goalHit, ocrHit * 0.35);
    if (hit <= 0 && !(opts.intent === 'scroll' && /scroll|list/i.test(n.type))) {
      continue;
    }
    let score = hit;
    const kind = kindHint(n, opts.intent);
    if (goalHit > 0) score += 0.08; // explicit goal evidence
    if (n.clickable) score += 0.18;
    else score -= 0.12; // non-clickable text nodes rarely the action target
    if (n.enabled === false) score -= 0.25;
    if (opts.intent === 'tap' || opts.intent === 'search' || opts.intent === 'settings') {
      if (kind === 'button') score += 0.08;
    }
    if (opts.intent === 'type' || opts.intent === 'search') {
      if (kind === 'field') score += 0.15;
    }
    if (opts.intent === 'scroll' && kind === 'scroll') score += 0.2;
    // Prefer mid-screen affordances slightly (not status-bar chrome).
    const cy = n.frame.y + n.frame.height / 2;
    if (cy > 40 && cy < 900) score += 0.03;
    scored.push({
      id: n.id,
      label: label || n.testID || n.type,
      score: Math.min(1, score),
      clickable: !!n.clickable,
      kindHint: kind,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  // Dedupe by label keeping best score
  const seen = new Set<string>();
  const out: RankedNode[] = [];
  for (const r of scored) {
    const key = r.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** Compact block for the cloud planner screen model. */
export function assistHintsModelText(
  intent: AssistIntent,
  confidence: number,
  ranked: RankedNode[],
  ocrTokens: string[],
  backend: string,
  ocrTexts: OcrTextHit[] = [],
): string {
  if (!ranked.length && !ocrTokens.length && intent === 'unknown') return '';
  const lines: string[] = [
    `On-device assist (${backend}): intent=${intent} conf=${confidence.toFixed(2)}`,
  ];
  if (ranked.length) {
    lines.push('top_candidates:');
    for (const r of ranked.slice(0, 6)) {
      lines.push(
        `- score=${r.score.toFixed(2)} id=${r.id} label="${r.label.replace(/"/g, '')}" clickable=${r.clickable} kind=${r.kindHint}`,
      );
    }
  }
  if (ocrTokens.length) {
    lines.push(`ocr_tokens: ${ocrTokens.slice(0, 16).join(', ')}`);
  }
  const positioned = ocrTexts.filter(
    (hit) => hit.text.trim() && hit.frame && hit.frame.width > 0 && hit.frame.height > 0,
  );
  if (positioned.length) {
    lines.push(
      'ocr_targets (visible text; point is window-absolute evidence for tap(point)):',
    );
    for (const hit of positioned.slice(0, 16)) {
      const f = hit.frame!;
      const x = Math.round(f.x + f.width / 2);
      const y = Math.round(f.y + f.height / 2);
      lines.push(
        `- text="${hit.text.replace(/"/g, '')}" point=(${x},${y}) confidence=${hit.confidence.toFixed(2)}`,
      );
    }
  }
  return lines.join('\n');
}
