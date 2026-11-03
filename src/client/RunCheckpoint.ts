/**
 * Survive a JS-context restart mid-run.
 *
 * Some actions destroy the runtime that is performing them: changing locale or
 * theme, toggling RTL, flipping a feature flag, anything the host answers with
 * a root remount or `reloadAsync`. The tap succeeds, the App comes back — but
 * the `runGoal` promise, its session and the whole TaskStore died with the old
 * context, so the caller can never learn the outcome.
 *
 * So checkpoint the goal to disk while it runs. On the next SDK init a fresh
 * checkpoint means "we were interrupted", and the run can be picked up again
 * from whatever screen the App came back on.
 *
 * Storage is best-effort: without AsyncStorage this degrades to memory, which
 * cannot survive a reload. That is the same tradeoff ExplorationGraph makes —
 * a missing optional peer must not break a run, only reduce it.
 */

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function tryAsyncStorage(): AsyncStorageLike | null {
  try {
    // Optional peer — many RN hosts already ship it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const store = mod?.default ?? mod;
    if (store && typeof store.getItem === 'function') return store;
  } catch {
    // optional
  }
  return null;
}

const KEY = 'koko.run.checkpoint.v1';

/**
 * A reload takes a second or two. Anything older than this was not an
 * interruption — it is a run that died for some other reason (force quit,
 * crash, the user walking away), and silently driving the UI on next launch
 * would be surprising rather than helpful.
 */
export const RESUME_MAX_AGE_MS = 90_000;

/**
 * One resume per goal. If the goal itself is what reloads the App, resuming it
 * reloads again; without a cap that is an infinite loop across launches.
 */
export const RESUME_MAX_ATTEMPTS = 1;

export type RunCheckpointData = {
  goal: string;
  startedAt: number;
  /** Bumped per step, so age reflects liveness rather than run length. */
  updatedAt: number;
  /** Resumes already spent on this goal. */
  resumes: number;
};

let memory: RunCheckpointData | null = null;
// Storage implementations need not complete writes in invocation order. Keep
// read/claim/write in one queue so an older clear cannot erase a newer run.
let storageQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.catch(() => {});
  return result;
}

async function write(data: RunCheckpointData | null) {
  memory = data;
  const storage = tryAsyncStorage();
  if (!storage) return;
  try {
    if (data) await storage.setItem(KEY, JSON.stringify(data));
    else await storage.removeItem(KEY);
  } catch {
    // best-effort
  }
}

async function read(): Promise<RunCheckpointData | null> {
  const storage = tryAsyncStorage();
  if (!storage) return memory;
  try {
    const raw = await storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunCheckpointData;
    if (!parsed || typeof parsed.goal !== 'string' || !parsed.goal) return null;
    return {
      goal: parsed.goal,
      startedAt: Number(parsed.startedAt) || 0,
      updatedAt: Number(parsed.updatedAt) || Number(parsed.startedAt) || 0,
      resumes: Number(parsed.resumes) || 0,
    };
  } catch {
    return null;
  }
}

export const RunCheckpoint = {
  /** Mark a goal as in flight. `resumes` carries over when resuming. */
  begin(goal: string, resumes = 0) {
    return serialized(async () => {
      const now = Date.now();
      await write({ goal, startedAt: now, updatedAt: now, resumes });
    });
  },

  /** Keep the checkpoint fresh while the loop makes progress. */
  touch() {
    return serialized(async () => {
      if (!memory) return;
      await write({ ...memory, updatedAt: Date.now() });
    });
  },

  /** The run reached a verdict — nothing left to resume. */
  clear() {
    return serialized(async () => {
      if (!memory && !tryAsyncStorage()) return;
      await write(null);
    });
  },

  /**
   * Claim an interrupted run, if there is one worth resuming.
   *
   * Clears before returning: a resume that dies the same way must not be
   * claimed again on the next launch.
   */
  async claimResumable(opts?: {
    maxAgeMs?: number;
    maxAttempts?: number;
    now?: number;
  }): Promise<RunCheckpointData | null> {
    return serialized(async () => {
      const maxAgeMs = opts?.maxAgeMs ?? RESUME_MAX_AGE_MS;
      const maxAttempts = opts?.maxAttempts ?? RESUME_MAX_ATTEMPTS;
      const now = opts?.now ?? Date.now();
      const found = await read();
      await write(null);
      if (!found) return null;
      if (found.resumes >= maxAttempts) return null;
      if (!Number.isFinite(found.updatedAt) || !found.updatedAt ||
          now < found.updatedAt || now - found.updatedAt > maxAgeMs ||
          !Number.isFinite(found.resumes) || found.resumes < 0) return null;
      return found;
    });
  },
};
