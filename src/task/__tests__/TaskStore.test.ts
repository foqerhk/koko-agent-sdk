import { TaskStore } from '../TaskStore';

describe('TaskStore', () => {
  beforeEach(() => {
    TaskStore.clear();
  });

  it('starts with sheet closed', () => {
    expect(TaskStore.snapshot().ui.sheetOpen).toBe(false);
  });

  it('tracks task nodes and subtitle only while running', () => {
    const task = TaskStore.startTask('转 10 USDC 给某某');
    expect(TaskStore.snapshot().activeTaskId).toBe(task.id);
    expect(TaskStore.snapshot().subtitle).toBe('转 10 USDC 给某某');
    expect(TaskStore.snapshot().ui.sheetOpen).toBe(false);

    const node = TaskStore.appendNode({
      kind: 'tap',
      title: '点击「确认转账」',
      status: 'running',
    });
    expect(TaskStore.snapshot().subtitle).toBe('点击「确认转账」');

    TaskStore.updateNode(node.id, { status: 'done', title: '已点击「确认转账」' });
    expect(TaskStore.snapshot().subtitle).toBe('已点击「确认转账」');

    TaskStore.finishTask('success');
    expect(TaskStore.snapshot().subtitle).toBe(null);
    expect(TaskStore.snapshot().tasks[0].status).toBe('success');
    expect(TaskStore.snapshot().resultFlash?.status).toBe('success');
    TaskStore.clearResultFlash();
    expect(TaskStore.snapshot().resultFlash).toBe(null);
  });

  it('shows failed result flash with summary', () => {
    TaskStore.startTask('清空购物车');
    TaskStore.finishTask('failed', undefined, '检测到空转/死循环，已停止');
    const flash = TaskStore.snapshot().resultFlash;
    expect(flash?.status).toBe('failed');
    expect(flash?.message).toContain('空转');
  });

  it('openSheet shows chat', () => {
    const task = TaskStore.startTask('demo');
    TaskStore.openSheet(task.id);
    const ui = TaskStore.snapshot().ui;
    expect(ui.sheetOpen).toBe(true);
    expect(ui.selectedTaskId).toBe(task.id);
  });

  it('removeTask drops history and reselects', () => {
    const a = TaskStore.startTask('任务 A');
    TaskStore.finishTask('success');
    const b = TaskStore.startTask('任务 B');
    TaskStore.finishTask('success');
    TaskStore.openSheet(b.id);
    TaskStore.removeTask(b.id);
    const snap = TaskStore.snapshot();
    expect(snap.tasks.map((t) => t.id)).toEqual([a.id]);
    expect(snap.ui.selectedTaskId).toBe(a.id);
  });
});
