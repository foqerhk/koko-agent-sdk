import { ocrHitInFrames, visibleWebViewFrames, type PositionedOcrText } from './ocrTarget';
import type { ViewNode } from '../types';

/** Local-only text sets: callers may report only whether content changed. */
export function webVisualLabels(root: ViewNode | null, hits: PositionedOcrText[]): Set<string> | null {
  if (!root) return null;
  const frames = visibleWebViewFrames(root);
  if (!frames.length) return null;
  const labels = new Set<string>();
  for (const hit of hits) {
    if (hit.confidence < 0.7 || !ocrHitInFrames(hit, frames)) continue;
    const text = hit.text.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    // Ignore prices, counts and other rapidly changing numeric-only strings.
    if (text.length >= 2 && /[\p{L}]/u.test(text)) labels.add(text);
  }
  return labels.size ? labels : null;
}

export function webVisualChanged(before: Set<string> | null, after: Set<string> | null): boolean {
  if (!before || !after) return false;
  let additions = 0;
  for (const text of after) if (!before.has(text)) additions++;
  return additions >= 2;
}
