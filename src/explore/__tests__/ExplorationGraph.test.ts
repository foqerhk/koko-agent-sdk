import {
  ExplorationGraphStore,
  goalExploreQuery,
  goalTokensForExplore,
  fingerprintFromLabels,
  resolveExploreLabelOnScreen,
} from '../ExplorationGraph';

describe('ExplorationGraph', () => {
  it('fingerprints are order-insensitive', () => {
    expect(fingerprintFromLabels(['设置', '语言', '钱包'])).toBe(
      fingerprintFromLabels(['钱包', '语言', '设置']),
    );
  });

  it('records transitions and finds a path toward goal tokens', () => {
    const g = new ExplorationGraphStore();
    g.setAppKey('test');
    const home = ['钱包', '交易', '发现', '选项'];
    const more = ['设置', '扫描二维码', '偏好设置'];
    const prefs = ['语言', '主题', '默认货币'];
    g.recordTransition(home, '选项', more);
    g.recordTransition(more, '偏好设置', prefs);

    const { targetTokens } = goalExploreQuery('设置语言');
    expect(targetTokens.some((t) => /语言|偏好/i.test(t))).toBe(true);
    const path = g.findPathToGoal(home, targetTokens, 5);
    expect(path).not.toBeNull();
    expect(path!.map((p) => p.label)).toEqual(['选项', '偏好设置']);

    const hints = g.hintLabelsTowardGoal(home, targetTokens, 6);
    expect(hints[0]).toBe('选项');
  });

  it('goalTokensForExplore extracts language/settings nouns', () => {
    const t = goalTokensForExplore('把语言改成英文');
    expect(t.some((x) => /语言|Language/i.test(x))).toBe(true);
  });

  it('resolves JP explore labels onto CN screen copy', () => {
    expect(
      resolveExploreLabelOnScreen('環境設定', ['设置', '偏好设置', '钱包']),
    ).toBe('偏好设置');
  });

  it('skips first hops whose labels are absent from the live screen', () => {
    const g = new ExplorationGraphStore();
    g.setAppKey('test-locale');
    const jpMore = ['設定', '環境設定', 'スキャン'];
    const jpPrefs = ['言語', 'テーマ'];
    const cnMore = ['设置', '偏好设置', '扫描二维码'];
    g.recordTransition(jpMore, '環境設定', jpPrefs);
    // Live CN more-screen must not follow the stale JP edge.
    const path = g.findPathToGoal(cnMore, ['语言', '偏好设置', '環境設定'], 5);
    expect(path).toBeNull();
  });
});
