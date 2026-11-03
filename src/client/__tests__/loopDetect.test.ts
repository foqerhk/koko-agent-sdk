import * as client from '../loopDetect';
describe('client loop evidence', () => {
  const engine = client;
  it('allows alternating mutating actions whose page states keep advancing', () => {
    const history = [
      { tool: 'tap', args: { label: '选择' }, result: 'ok || screen:item 1 selected' },
      { tool: 'tap', args: { label: '继续' }, result: 'ok || screen:item 2 options' },
      { tool: 'tap', args: { label: '选择' }, result: 'ok || screen:item 2 selected' },
      { tool: 'tap', args: { label: '继续' }, result: 'ok || screen:item 3 options' },
    ];
    expect(engine.isLooping(history)).toBe(false);
    expect(engine.isNearLoop(history)).toBe(false);
  });

  it('stops an actual navigation cycle with the same two page states', () => {
    const history = [
      { tool: 'tap', args: { label: '打开' }, result: 'ok || screen:details' },
      { tool: 'tap', args: { label: '返回' }, result: 'ok || screen:list' },
      { tool: 'tap', args: { label: '打开' }, result: 'ok || screen:details' },
      { tool: 'tap', args: { label: '返回' }, result: 'ok || screen:list' },
    ];
    expect(engine.isLooping(history)).toBe(true);
  });

  it('compares complete body content when observations have no screen marker', () => {
    const prefix = 'Shared header and controls. '.repeat(12);
    const history = ['First instruction', 'Second instruction', 'Third instruction'].map(copy => ({
      tool: 'dump', result: `${prefix}\nBody: ${copy}`,
    }));
    expect(engine.isLooping(history)).toBe(false);
    expect(engine.isNearLoop(history)).toBe(false);
  });

  it('allows unmarked alternating actions whose full result bodies advance', () => {
    const prefix = 'Shared header and controls. '.repeat(12);
    const history = ['one', 'two', 'three', 'four'].map((page, index) => ({
      tool: 'tap', args: { label: index % 2 ? '继续' : '选择' },
      result: `${prefix}\nBody: ${page}`,
    }));
    expect(engine.isLooping(history)).toBe(false);
    expect(engine.isNearLoop(history)).toBe(false);
  });

  it('bounds unchanged loading observations without marking them successful', () => {
    const history = Array.from({ length: 3 }, () => ({ tool: 'dump', result: '正在处理，请稍候' }));
    expect(engine.isLooping(history)).toBe(true);
    expect(engine.isNearLoop(history)).toBe(true);
  });

  it('stops ineffective target retries even if unrelated page content changes', () => {
    const history = [
      { tool: 'tap', args: { nodeId: 'button' }, ok: false, result: 'tap_noop || screen:ad one' },
      { tool: 'dump', result: 'dumped || screen:ad two' },
      { tool: 'tap', args: { label: '替代说法' }, ok: false, result: 'tap_noop || screen:ad three' },
      { tool: 'dump', result: 'dumped || screen:ad four' },
    ];
    expect(engine.isLooping(history)).toBe(true);
  });

  it('allows replanning after two rejected pre-dispatch targets, but bounds further misses', () => {
    const miss = (id: string) => ({ tool: 'tap', args: { nodeId: id }, ok: false,
      result: 'pre_dispatch: target changed || screen:search' });
    const history = [miss('old'), miss('other'), { tool: 'dump', ok: true, result: 'dumped || screen:search' }];
    expect(engine.isLooping(history)).toBe(false);
    expect(engine.isLooping([...history, miss('third')])).toBe(true);
  });

  it('does not mistake ordinary content containing failure words for failed actions', () => {
    const history = ['Null Island', 'Empty streets', 'Failed experiments'].map((title, index) => ({
      tool: 'tap', args: { label: '下一篇' }, ok: true,
      result: `${title} || screen:article ${index + 1}`,
    }));
    expect(engine.isLooping(history)).toBe(false);
    expect(engine.isNearLoop(history)).toBe(false);
  });

  it('bounds repeated interleaved lookups on the same screen but allows changing screens', () => {
    const history = Array.from({ length: 8 }, (_, i) => i % 2
      ? { tool: 'find', args: { match: [{ text: 'Wallet' }] }, result: 'null || screen:chooser' }
      : { tool: 'dump', result: 'dumped || screen:chooser' });
    expect(engine.isLooping(history)).toBe(true);
    const changing = history.map((item, i) => ({ ...item, result: item.result.replace('chooser', `chooser ${i}`) }));
    expect(engine.isLooping(changing)).toBe(false);
  });
});
