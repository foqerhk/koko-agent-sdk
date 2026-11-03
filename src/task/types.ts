export type TaskStatus = 'running' | 'success' | 'failed' | 'cancelled';

export type TaskNodeKind =
  | 'user'
  | 'plan'
  | 'dump'
  | 'find'
  | 'tap'
  | 'swipe'
  | 'type'
  | 'confirm'
  | 'info'
  | 'error';

export type TaskNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** One step / log line inside a task session. */
export type TaskNode = {
  id: string;
  kind: TaskNodeKind;
  /** Subtitle / human-readable line. */
  title: string;
  detail?: string;
  status: TaskNodeStatus;
  createdAt: number;
  finishedAt?: number;
};

/** One user intent / agent run. */
export type Task = {
  id: string;
  /** User utterance or short goal. */
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  nodes: TaskNode[];
};

export type ObserverUiState = {
  /**
   * Chat sheet open: session history + NL input.
   * Closed by default; opened via progress pill or host entry button.
   */
  sheetOpen: boolean;
  /** Selected task for session detail; null → latest / active. */
  selectedTaskId: string | null;
  /**
   * Temporarily hide progress pill + stop while an agent tap/swipe
   * would hit the same screen region (e.g. bottom tab / cart).
   */
  chromeSuppressed: boolean;
  /**
   * Bumped to remount progress Modal above a newly presented host modal
   * (e.g. Settings). Latest RN Modal wins the window stack.
   */
  chromeEpoch: number;
};

/** Brief success/failure line shown on the progress pill after a run ends. */
export type ProgressResultFlash = {
  status: Exclude<TaskStatus, 'running'>;
  message: string;
  taskId: string;
  at: number;
};

export type TaskStoreSnapshot = {
  tasks: Task[];
  activeTaskId: string | null;
  /** Current progress line while a task is running. */
  subtitle: string | null;
  /** Post-run result pill; cleared by UI after auto-dismiss. */
  resultFlash: ProgressResultFlash | null;
  /**
   * Secure-input wait: non-null while agent paused for password/PIN/OTP.
   * UI shows banner +「我已完成」.
   */
  userGateWaiting: string | null;
  ui: ObserverUiState;
};
