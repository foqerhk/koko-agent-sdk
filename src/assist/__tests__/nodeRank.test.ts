import type { ViewNode } from '../../types';
import { classifyGoalIntent } from '../intentClassify';
import { assistHintsModelText, rankNodesForGoal } from '../nodeRank';

function node(partial: Partial<ViewNode> & { id: string; type: string }): ViewNode {
  return {
    frame: { x: 0, y: 100, width: 100, height: 40 },
    children: [],
    visible: true,
    enabled: true,
    clickable: false,
    ...partial,
  };
}

describe('rankNodesForGoal', () => {
  const tree: ViewNode = node({
    id: '0',
    type: 'RCTView',
    frame: { x: 0, y: 0, width: 390, height: 800 },
    children: [
      node({
        id: '0/1',
        type: 'RCTText',
        text: '创建钱包',
        clickable: true,
      }),
      node({
        id: '0/2',
        type: 'RCTText',
        text: '导入钱包',
        clickable: true,
      }),
      node({
        id: '0/3',
        type: 'RCTTextInput',
        text: '',
        accessibilityLabel: '搜索',
        clickable: true,
      }),
      node({
        id: '0/4',
        type: 'RCTText',
        text: '无关条目',
        clickable: true,
      }),
    ],
  });

  it('ranks goal-matching clickable nodes highest', () => {
    const ranked = rankNodesForGoal(tree, {
      intent: 'tap',
      tokens: ['创建钱包'],
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].label).toContain('创建');
    expect(ranked[0].clickable).toBe(true);
  });

  it('boosts text fields for type/search intent', () => {
    const ranked = rankNodesForGoal(tree, {
      intent: 'search',
      tokens: ['搜索'],
    });
    const field = ranked.find((r) => r.kindHint === 'field');
    expect(field).toBeTruthy();
  });

  it('merges OCR tokens into ranking', () => {
    const ranked = rankNodesForGoal(tree, {
      intent: 'tap',
      tokens: [],
      ocrTokens: ['导入钱包'],
    });
    expect(ranked[0].label).toContain('导入');
  });

  it('emits planner model text with intent and candidates', () => {
    const goal = '打开语言设置';
    const classified = classifyGoalIntent(goal);
    const langTree: ViewNode = node({
      id: '0',
      type: 'RCTView',
      children: [
        node({
          id: '0/1',
          type: 'RCTText',
          text: '语言',
          clickable: true,
        }),
      ],
    });
    const ranked = rankNodesForGoal(langTree, {
      intent: classified.intent,
      tokens: classified.tokens,
      ocrTokens: ['Language'],
    });
    const model = assistHintsModelText(
      classified.intent,
      classified.confidence,
      ranked,
      ['Language'],
      'js',
    );
    expect(classified.intent).toBe('settings');
    expect(model).toContain('On-device assist');
    expect(model).toContain('intent=settings');
    expect(model).toContain('top_candidates');
    expect(model).toContain('ocr_tokens: Language');
  });

  it('gives the planner evidence-backed tap points for OCR-only WebView controls', () => {
    const model = assistHintsModelText(
      'tap',
      0.9,
      [],
      ['Connect'],
      'js+mlkit',
      [
        {
          text: 'Connect',
          confidence: 0.98,
          frame: { x: 320, y: 96, width: 64, height: 32 },
        },
      ],
    );
    expect(model).toContain('ocr_targets');
    expect(model).toContain('text="Connect" point=(352,112)');
    expect(model).toContain('tap(point)');
  });
});
