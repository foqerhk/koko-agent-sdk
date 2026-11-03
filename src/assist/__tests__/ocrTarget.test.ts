import { findOcrTextHit, findOcrTextPoint, goalOcrCandidates, verifiedGoalOcrLabels, verifiedWalletChoices } from '../ocrTarget';
import type { ViewNode } from '../../types';

describe('findOcrTextPoint', () => {
  const hits = [
    {
      text: '连接',
      confidence: 0.97,
      frame: { x: 340, y: 200, width: 50, height: 30 },
    },
    {
      text: '开始使用',
      confidence: 0.92,
      frame: { x: 100, y: 600, width: 180, height: 44 },
    },
  ];

  it('uses an exact OCR text frame', () => {
    expect(findOcrTextPoint(hits, '开始使用')).toEqual({ x: 190, y: 622 });
  });

  it('does not guess from a partial label or a phrase inside prose', () => {
    expect(findOcrTextPoint(hits, '连接钱包')).toBeNull();
    expect(findOcrTextPoint([{ text: 'Please connect wallet to continue', confidence: 0.99,
      frame: { x: 10, y: 10, width: 200, height: 20 } }], 'connect wallet')).toBeNull();
  });

  it('does not choose arbitrarily between two identical OCR labels', () => {
    const hit = { text: 'Connect wallet', confidence: 0.9, frame: { x: 10, y: 10, width: 100, height: 30 } };
    expect(findOcrTextPoint([hit, { ...hit, frame: { ...hit.frame, y: 100 } }], 'Connect wallet')).toBeNull();
  });

  it('matches a translated connect control only inside an unambiguous web view', () => {
    const hit = { text: '连接', confidence: 1, frame: { x: 320, y: 210, width: 30, height: 20 } };
    const web = { x: 0, y: 120, width: 400, height: 600 };
    expect(findOcrTextHit([hit], 'Connect wallet')).toBeNull();
    expect(findOcrTextHit([hit], 'Connect wallet', { translatedWebRegions: [web] })).toBe(hit);
    expect(findOcrTextHit([hit], 'Connect wallet', { translatedWebRegions: [{ ...web, y: 300 }] })).toBeNull();
    expect(findOcrTextHit([hit, { ...hit, frame: { ...hit.frame, y: 270 } }], 'Connect wallet', { translatedWebRegions: [web] })).toBeNull();
  });

  it('shares only goal-derived labels confirmed locally, never unrelated OCR text', () => {
    const root: ViewNode = { id: 'root', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
      visible: true, enabled: true, clickable: false, children: [{ id: 'web', type: 'RNCWebView',
        frame: { x: 0, y: 120, width: 400, height: 600 }, visible: true, enabled: true, clickable: false, children: [] }] };
    const hits = [
      { text: '连接', confidence: 1, frame: { x: 320, y: 210, width: 30, height: 20 } },
      { text: 'SYNTHETIC_PRIVATE_OCR_CONTENT', confidence: 1, frame: { x: 40, y: 400, width: 180, height: 20 } },
    ];
    const goal = 'Please open Uniswap for me and connect my wallet.';
    expect(goalOcrCandidates(goal)).toContain('connect wallet');
    const labels = verifiedGoalOcrLabels(goal, root, hits);
    expect(labels).toContain('connect wallet');
    expect(JSON.stringify(labels)).not.toContain('SYNTHETIC_PRIVATE_OCR_CONTENT');
    expect(verifiedGoalOcrLabels('show my password', root, hits)).toEqual([]);
  });

  it('shares only allowlisted public wallet choices in a visible connection chooser', () => {
    const root: ViewNode = { id: 'root', type: 'View', frame: { x: 0, y: 0, width: 400, height: 800 },
      visible: true, enabled: true, clickable: false, children: [{ id: 'web', type: 'RNCWebView',
        frame: { x: 0, y: 120, width: 400, height: 600 }, visible: true, enabled: true, clickable: false, children: [] }] };
    const hit = (text: string, y: number) => ({ text, confidence: 0.99, frame: { x: 50, y, width: 150, height: 20 } });
    const hits = [hit('连接钱包', 200), hit('WalletConnect', 300), hit('Coinbase Wallet', 350),
      hit('SYNTHETIC_PRIVATE_CONTENT', 400), hit('MetaMask', 20)];
    expect(verifiedWalletChoices('connect my wallet', root, hits)).toEqual(['WalletConnect', 'Coinbase Wallet']);
    expect(verifiedWalletChoices('connect my wallet', root, [hit('连接钱包', 200), hit('UKey Wallet', 300), hit('Solflare', 350)])).toEqual(['UKey Wallet', 'Solflare']);
    expect(verifiedWalletChoices('show my password and connect wallet', root, hits)).toEqual([]);
    expect(verifiedWalletChoices('connect my wallet', root, hits.slice(1))).toEqual([]);
    expect(verifiedWalletChoices('open a site', root, hits)).toEqual([]);
    expect(verifiedWalletChoices('open the site, do not connect a wallet', root, hits)).toEqual([]);
    expect(verifiedWalletChoices('open wallet connection options, do not select a wallet', root, hits)).toEqual([]);
  });

  it('does not invent a coordinate without a positioned text match', () => {
    expect(findOcrTextPoint(hits, '授权')).toBeNull();
    expect(
      findOcrTextPoint([{ text: '连接', confidence: 1 }], '连接钱包'),
    ).toBeNull();
  });
});
