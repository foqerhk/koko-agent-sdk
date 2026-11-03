import type {
  ObserverUiState,
  ProgressResultFlash,
  Task,
  TaskNode,
  TaskNodeKind,
  TaskNodeStatus,
  TaskStatus,
  TaskStoreSnapshot,
} from './types';
import { UsageBus } from '../commercial/UsageBus';
import { HostAppearanceStore } from '../provider/HostAppearanceStore';
import { message, resolveText, runtimeText, type LocalizedText, type LocalizedMessage } from '../i18n';

type Listener = (snap: TaskStoreSnapshot) => void;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_TASKS = 40;

/**
 * In-memory task + node history for the observer UI.
 */
export class TaskStoreImpl {
  private tasks: Task[] = [];
  private activeTaskId: string | null = null;
  private resultFlash: ProgressResultFlash | null = null;
  private userGateWaiting: LocalizedText | null = null;
  private localizedTitles = new Map<string, LocalizedMessage>();
  private localizedTaskTitles = new Map<string, LocalizedMessage>();
  private localizedResult: LocalizedMessage | null = null;
  private unsubscribeAppearance: (() => void) | null = null;
  private appearanceChanged = false;
  private lastChromeLiftAt = 0;
  private ui: ObserverUiState = {
    sheetOpen: false,
    selectedTaskId: null,
    chromeSuppressed: false,
    chromeEpoch: 0,
  };
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.unsubscribeAppearance) {
      let locale = HostAppearanceStore.get().locale;
      this.unsubscribeAppearance = HostAppearanceStore.subscribe(() => {
        const next = HostAppearanceStore.get().locale;
        if (next !== locale && this.activeTaskId) this.appearanceChanged = true;
        locale = next;
        this.emit();
      });
    }
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribeAppearance?.();
        this.unsubscribeAppearance = null;
      }
    };
  }

  snapshot(): TaskStoreSnapshot {
    const tasks = this.tasks.map(task => ({
      ...task,
      title: this.localizedTaskTitles.has(task.id) ? resolveText(this.localizedTaskTitles.get(task.id)!) : task.title,
      nodes: task.nodes.map(node => {
        const copy = this.localizedTitles.get(node.id);
        return copy ? { ...node, title: resolveText(copy) } : node;
      }),
    }));
    return {
      tasks,
      activeTaskId: this.activeTaskId,
      subtitle: this.computeSubtitle(tasks),
      resultFlash: this.resultFlash && this.localizedResult
        ? { ...this.resultFlash, message: resolveText(this.localizedResult).slice(0, 80) }
        : this.resultFlash,
      userGateWaiting: this.userGateWaiting ? resolveText(this.userGateWaiting) : null,
      ui: { ...this.ui },
    };
  }

  private emit() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  private computeSubtitle(tasks: Task[]): string | null {
    if (this.userGateWaiting) return resolveText(this.userGateWaiting);
    const active = tasks.find((t) => t.id === this.activeTaskId);
    if (!active || active.status !== 'running') return null;
    const running = [...active.nodes]
      .reverse()
      .find((n) => n.status === 'running' && n.kind !== 'dump');
    if (running) return this.appearanceChanged && !this.localizedTitles.has(running.id)
      ? runtimeText('progress.running') : running.title;
    const last = [...active.nodes]
      .reverse()
      .find((n) => n.kind !== 'dump');
    if (last) return this.appearanceChanged && !this.localizedTitles.has(last.id)
      ? runtimeText('progress.running') : last.title;
    return active.title;
  }

  /** Pause chrome copy while waiting for App password/PIN/OTP. */
  setUserGateWaiting(message: LocalizedText | null) {
    this.userGateWaiting = message;
    this.appearanceChanged = false;
    this.emit();
  }

  setUi(patch: Partial<ObserverUiState>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  /** Open chat sheet (history + input). */
  openSheet(taskId?: string | null) {
    const selected =
      taskId !== undefined
        ? taskId
        : this.activeTaskId ?? this.tasks[0]?.id ?? null;
    const wasOpen = this.ui.sheetOpen;
    this.setUi({ sheetOpen: true, selectedTaskId: selected });
    if (!wasOpen) {
      UsageBus.emit({ type: 'sheet_opened', at: Date.now() });
    }
  }

  closeSheet() {
    const wasOpen = this.ui.sheetOpen;
    this.setUi({ sheetOpen: false });
    if (wasOpen) {
      UsageBus.emit({ type: 'sheet_closed', at: Date.now() });
    }
  }

  toggleSheet() {
    if (this.ui.sheetOpen) this.closeSheet();
    else this.openSheet();
  }

  /** Hide progress chrome for one agent gesture that would hit it. */
  suppressChrome() {
    if (this.ui.chromeSuppressed) return;
    this.setUi({ chromeSuppressed: true });
  }

  restoreChrome() {
    if (!this.ui.chromeSuppressed) return;
    this.setUi({ chromeSuppressed: false });
  }

  /**
   * Remount progress Modal so it stacks above a host Settings/sheet Modal.
   * Throttled to avoid flicker during rapid taps.
   */
  liftChrome() {
    const now = Date.now();
    if (now - this.lastChromeLiftAt < 450) return;
    this.lastChromeLiftAt = now;
    this.setUi({ chromeEpoch: (this.ui.chromeEpoch ?? 0) + 1 });
  }

  /** @deprecated use closeSheet */
  hide() {
    this.closeSheet();
  }

  /** @deprecated use openSheet */
  show() {
    this.openSheet();
  }

  selectTask(taskId: string | null) {
    this.setUi({
      selectedTaskId: taskId,
      sheetOpen: true,
    });
  }

  /** Remove a task from recent history (and clear selection if needed). */
  removeTask(taskId: string) {
    const existed = this.tasks.some((t) => t.id === taskId);
    if (!existed) return;
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    if (this.activeTaskId === taskId) {
      this.activeTaskId = this.tasks[0]?.id ?? null;
    }
    if (this.ui.selectedTaskId === taskId) {
      this.ui = {
        ...this.ui,
        selectedTaskId: this.activeTaskId ?? this.tasks[0]?.id ?? null,
      };
    }
    if (this.resultFlash?.taskId === taskId) {
      this.resultFlash = null;
    }
    this.emit();
  }

  startTask(title: string): Task {
    this.appearanceChanged = false;
    const task: Task = {
      id: uid('task'),
      title,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: uid('node'),
          kind: 'user',
          title,
          status: 'done',
          createdAt: Date.now(),
          finishedAt: Date.now(),
        },
      ],
    };
    this.tasks = [task, ...this.tasks].slice(0, MAX_TASKS);
    this.activeTaskId = task.id;
    this.resultFlash = null;
    this.localizedResult = null;
    // Progress pill only — do not auto-open sheet
    this.ui = {
      ...this.ui,
      selectedTaskId: task.id,
    };
    this.emit();
    return task;
  }

  ensureActiveTask(fallbackTitle?: string): string {
    if (
      this.activeTaskId &&
      this.tasks.some((t) => t.id === this.activeTaskId && t.status === 'running')
    ) {
      return this.activeTaskId;
    }
    const task = this.startTask(fallbackTitle ?? runtimeText('runtime.defaultTask'));
    if (fallbackTitle === undefined) {
      const copy = message('runtime.defaultTask');
      this.localizedTaskTitles.set(task.id, copy);
      this.localizedTitles.set(task.nodes[0].id, copy);
    }
    return task.id;
  }

  appendNode(input: {
    kind: TaskNodeKind;
    title: LocalizedText;
    detail?: string;
    status?: TaskNodeStatus;
    taskId?: string;
  }): TaskNode {
    this.appearanceChanged = false;
    const taskId = input.taskId ?? this.ensureActiveTask(resolveText(input.title));
    const node: TaskNode = {
      id: uid('node'),
      kind: input.kind,
      title: resolveText(input.title),
      detail: input.detail,
      status: input.status ?? 'running',
      createdAt: Date.now(),
      finishedAt:
        input.status === 'done' || input.status === 'failed' ? Date.now() : undefined,
    };

    if (typeof input.title !== 'string') this.localizedTitles.set(node.id, input.title);
    this.tasks = this.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        updatedAt: Date.now(),
        nodes: [...t.nodes, node],
      };
    });
    this.activeTaskId = taskId;
    this.emit();
    return node;
  }

  updateNode(nodeId: string, patch: Partial<Pick<TaskNode, 'detail' | 'status'>> & { title?: LocalizedText }) {
    if (patch.title !== undefined) {
      this.appearanceChanged = false;
      if (typeof patch.title === 'string') this.localizedTitles.delete(nodeId);
      else this.localizedTitles.set(nodeId, patch.title);
    }
    const resolvedPatch = { ...patch, ...(patch.title !== undefined ? { title: resolveText(patch.title) } : {}) } as Partial<TaskNode>;
    this.tasks = this.tasks.map((t) => ({
      ...t,
      nodes: t.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const status = patch.status ?? n.status;
        return {
          ...n,
          ...resolvedPatch,
          status,
          finishedAt:
            status === 'done' || status === 'failed' || status === 'skipped'
              ? Date.now()
              : n.finishedAt,
        };
      }),
      updatedAt: Date.now(),
    }));
    this.emit();
  }

  finishTask(
    status: Exclude<TaskStatus, 'running'>,
    taskId?: string,
    summary?: LocalizedText,
  ) {
    const id = taskId ?? this.activeTaskId;
    if (!id) return;
    const task = this.tasks.find((t) => t.id === id);
    this.tasks = this.tasks.map((t) => {
      if (t.id !== id) return t;
      return {
        ...t,
        status,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        nodes: t.nodes.map((n) =>
          n.status === 'running'
            ? {
                ...n,
                status: status === 'success' ? 'done' : 'failed',
                finishedAt: Date.now(),
              }
            : n,
        ),
      };
    });
    const message =
      (summary && resolveText(summary).trim()) ||
      task?.title ||
      runtimeText(`status.${status}`);
    this.localizedResult = summary && typeof summary !== 'string' ? summary : null;
    this.resultFlash = {
      status,
      message: message.slice(0, 80),
      taskId: id,
      at: Date.now(),
    };
    this.userGateWaiting = null;
    // Show result pill even if chrome was suppressed for a gesture.
    if (this.ui.chromeSuppressed) {
      this.ui = { ...this.ui, chromeSuppressed: false };
    }
    if (this.activeTaskId === id) this.activeTaskId = null;
    this.emit();
  }

  /** Clear the post-run result pill (after auto-dismiss). */
  clearResultFlash() {
    if (!this.resultFlash) return;
    this.resultFlash = null;
    this.emit();
  }

  clear() {
    this.tasks = [];
    this.activeTaskId = null;
    this.resultFlash = null;
    this.userGateWaiting = null;
    this.localizedTitles.clear();
    this.localizedTaskTitles.clear();
    this.localizedResult = null;
    this.appearanceChanged = false;
    this.ui = {
      sheetOpen: false,
      selectedTaskId: null,
      chromeSuppressed: false,
      chromeEpoch: 0,
    };
    this.emit();
  }
}

export const TaskStore = new TaskStoreImpl();
