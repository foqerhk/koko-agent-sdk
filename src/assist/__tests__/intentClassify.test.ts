import { classifyGoalIntent, goalTokens } from '../intentClassify';

describe('goalTokens', () => {
  it('extracts latin and CJK tokens without stop words', () => {
    const t = goalTokens('打开 Settings 语言');
    expect(t).toContain('settings');
    expect(t).toContain('语言');
    expect(t).not.toContain('打开');
  });
});

describe('classifyGoalIntent', () => {
  it('classifies search / type / scroll / back / settings / tap', () => {
    expect(classifyGoalIntent('搜索钱包').intent).toBe('search');
    expect(classifyGoalIntent('输入 hello').intent).toBe('type');
    expect(classifyGoalIntent('向下滚动').intent).toBe('scroll');
    expect(classifyGoalIntent('返回上一页').intent).toBe('back');
    expect(classifyGoalIntent('打开语言设置').intent).toBe('settings');
    expect(classifyGoalIntent('点击确认').intent).toBe('tap');
  });

  it('treats short label goals as tap', () => {
    const r = classifyGoalIntent('创建钱包');
    expect(r.intent).toBe('tap');
    expect(r.tokens.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0.4);
  });
});
