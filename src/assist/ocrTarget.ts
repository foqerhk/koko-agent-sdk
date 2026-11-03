import type { Point, Frame, ViewNode } from '../types';

export type PositionedOcrText = {
  text: string;
  confidence: number;
  frame?: Frame;
};

function normalized(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Visible web regions let a short translated action stay scoped to the page. */
export function visibleWebViewFrames(root: ViewNode): Frame[] {
  const frames: Frame[] = [];
  const walk = (node: ViewNode) => {
    if (node.visible === false) return;
    if (/webview/i.test(node.type) && node.frame.width > 0 && node.frame.height > 0) {
      const left = Math.max(root.frame.x, node.frame.x);
      const top = Math.max(root.frame.y, node.frame.y);
      const right = Math.min(root.frame.x + root.frame.width, node.frame.x + node.frame.width);
      const bottom = Math.min(root.frame.y + root.frame.height, node.frame.y + node.frame.height);
      if (right > left && bottom > top) frames.push({ x: left, y: top, width: right - left, height: bottom - top });
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return frames;
}

export function ocrHitInFrames(hit: PositionedOcrText, frames: Frame[]): boolean {
  if (!hit.frame) return false;
  const x = hit.frame.x + hit.frame.width / 2, y = hit.frame.y + hit.frame.height / 2;
  return frames.some(f => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height);
}

/** Candidate labels are derived only from the user's goal, never screen text. */
export function goalOcrCandidates(goal: string): string[] {
  if (/password|passcode|private\s*key|mnemonic|recovery\s*phrase|seed\s*phrase|密码|账户恢复凭证|私密认证数据|私钥|验证码/i.test(goal)) return [];
  const stop = new Set(['please', 'for', 'me', 'my', 'the', 'a', 'an', 'to', 'and', 'then', 'of', 'in', 'on', 'from', 'with']);
  const words = (goal.match(/[A-Za-z][A-Za-z0-9'-]*|[\u3400-\u9fff]{2,16}/g) || [])
    .filter(word => !stop.has(word.toLowerCase())).slice(0, 20);
  const out: string[] = [];
  for (const size of [3, 2, 1]) {
    for (let i = 0; i + size <= words.length; i++) {
      const label = words.slice(i, i + size).join(' ');
      if (label.length >= 3 && label.length <= 60 && !out.includes(label)) out.push(label);
    }
  }
  // Chinese goals often have no spaces between verbs and objects.
  for (const word of words.filter(w => /[\u3400-\u9fff]/.test(w))) {
    for (let length = Math.min(6, word.length); length >= 2; length--) {
      for (let i = 0; i + length <= word.length; i++) {
        const label = word.slice(i, i + length);
        if (!out.includes(label)) out.push(label);
      }
    }
  }
  return out.slice(0, 100);
}

export function verifiedGoalOcrLabels(goal: string, root: ViewNode | null | undefined, texts: PositionedOcrText[]): string[] {
  if (!root) return [];
  const regions = visibleWebViewFrames(root);
  if (!regions.length) return [];
  const onPage = texts.filter(hit => ocrHitInFrames(hit, regions));
  return goalOcrCandidates(goal).filter(label =>
    !!findOcrTextHit(onPage, label, { translatedWebRegions: regions }),
  ).slice(0, 6);
}

// These are public product names, never account names, addresses or page text.
export const PUBLIC_WALLET_CHOICES = [
  'WalletConnect', 'MetaMask', 'Coinbase Wallet', 'Uniswap Mobile', 'Uniswap Wallet',
  'Binance Wallet', 'Trust Wallet', 'Phantom', 'OKX Wallet', 'Rabby Wallet', 'OneKey', 'UKey', 'UKey Wallet', 'Solflare',
] as const;

export function walletConnectionAllowed(goal: string): boolean {
  return /(connect|连接|連接)/i.test(goal) && /(wallet|钱包|錢包)/i.test(goal) &&
    !/\b(?:do not|don't|never|without)\s+(?:connect|link|select|choose)\b|(?:不要|禁止|不|无需|無需)(?:连接|連接|选择|選擇)/i.test(goal) &&
    !/password|passcode|private\s*key|mnemonic|recovery\s*phrase|seed\s*phrase|密码|账户恢复凭证|私密认证数据|私钥|验证码/i.test(goal);
}

export function verifiedWalletChoices(goal: string, root: ViewNode | null | undefined, texts: PositionedOcrText[]): string[] {
  if (!root || !walletConnectionAllowed(goal)) return [];
  const regions = visibleWebViewFrames(root);
  if (!regions.length) return [];
  const page = texts.filter(hit => ocrHitInFrames(hit, regions));
  // Require a visible chooser heading as well as multiple known product names.
  if (!['connect wallet', '连接钱包', '連接錢包'].some(label => !!findOcrTextHit(page, label))) return [];
  const choices = PUBLIC_WALLET_CHOICES.filter(label => !!findOcrTextHit(page, label));
  return choices.length >= 2 ? choices.slice(0, 8) : [];
}

/**
 * Resolve text that is visible in a WebView/Canvas but absent from the native
 * accessibility tree. The frame comes from native OCR and is already in the
 * same window-absolute logical coordinate space used by dispatchTap.
 */
export function findOcrTextPoint(
  texts: PositionedOcrText[],
  wanted: string,
): Point | null {
  const hit = findOcrTextHit(texts, wanted);
  const frame = hit?.frame;
  return frame
    ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
    : null;
}

export function findOcrTextHit(
  texts: PositionedOcrText[],
  wanted: string,
  options: { translatedWebRegions?: Frame[] } = {},
): PositionedOcrText | null {
  const target = normalized(wanted);
  if (target.length < 2) return null;

  const matches: PositionedOcrText[] = [];
  for (const hit of texts) {
    const frame = hit.frame;
    if (!frame || ![frame.x, frame.y, frame.width, frame.height, hit.confidence].every(Number.isFinite) ||
        frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0 || hit.confidence < 0.6) continue;
    const text = normalized(hit.text);
    if (text === target) matches.push(hit);
  }
  // A fragment in prose or two equal labels gives no reliable target.
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return null;

  // Common translated connect controls. A shortened action word is considered
  // only inside a visible web view, with strong OCR and a single match.
  const connectLabels = new Set(['connect', 'connectwallet', '连接', '连接钱包', '連接', '連接錢包']);
  const regions = options.translatedWebRegions || [];
  if (!connectLabels.has(target) || !regions.length) return null;
  const translated = texts.filter(hit => {
    const f = hit.frame;
    return connectLabels.has(normalized(hit.text)) && f &&
      [f.x, f.y, f.width, f.height, hit.confidence].every(Number.isFinite) &&
      f.x >= 0 && f.y >= 0 && f.width > 0 && f.height > 0 && hit.confidence >= 0.8 &&
      ocrHitInFrames(hit, regions);
  });
  return translated.length === 1 ? translated[0]! : null;
}
