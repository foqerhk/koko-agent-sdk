jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  };
}, { virtual: true });
const storage = require('@react-native-async-storage/async-storage');

import {
  RESUME_MAX_AGE_MS,
  RunCheckpoint,
  RESUME_MAX_ATTEMPTS,
} from '../RunCheckpoint';

describe('RunCheckpoint', () => {
  beforeEach(async () => {
    await RunCheckpoint.clear();
  });

  it('claims a run interrupted moments ago', async () => {
    await RunCheckpoint.begin('把 App 的语言改为简体中文');
    const claimed = await RunCheckpoint.claimResumable();
    expect(claimed?.goal).toBe('把 App 的语言改为简体中文');
  });

  it('claims only once, so a resume that dies the same way stops there', async () => {
    await RunCheckpoint.begin('change language');
    expect(await RunCheckpoint.claimResumable()).not.toBeNull();
    expect(await RunCheckpoint.claimResumable()).toBeNull();
  });

  it('stops resuming once attempts are spent', async () => {
    await RunCheckpoint.begin('change language', RESUME_MAX_ATTEMPTS);
    expect(await RunCheckpoint.claimResumable()).toBeNull();
  });

  it('ignores a stale checkpoint: a reload is seconds, not minutes', async () => {
    await RunCheckpoint.begin('change language');
    const claimed = await RunCheckpoint.claimResumable({
      now: Date.now() + RESUME_MAX_AGE_MS + 1,
    });
    expect(claimed).toBeNull();
  });

  it('counts age from the last step, not from the start', async () => {
    const t0 = Date.now();
    await RunCheckpoint.begin('long multi step goal');
    await RunCheckpoint.touch();
    // A run that stepped recently is resumable however long it has been going.
    const claimed = await RunCheckpoint.claimResumable({
      now: t0 + RESUME_MAX_AGE_MS / 2,
    });
    expect(claimed).not.toBeNull();
  });

  it('clears on a normal finish, leaving nothing to resume', async () => {
    await RunCheckpoint.begin('change language');
    await RunCheckpoint.clear();
    expect(await RunCheckpoint.claimResumable()).toBeNull();
  });

  it('carries the resume count so attempts accumulate across launches', async () => {
    await RunCheckpoint.begin('change language');
    const first = await RunCheckpoint.claimResumable();
    expect(first?.resumes).toBe(0);
    // KokoAgent re-begins with resumes + 1 when it resumes.
    await RunCheckpoint.begin('change language', (first?.resumes ?? 0) + 1);
    expect(await RunCheckpoint.claimResumable()).toBeNull();
  });
});


it('serializes delayed writes so an old finish cannot erase a newer goal', async () => {
  await RunCheckpoint.clear();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const write = storage.setItem.getMockImplementation();
  storage.setItem.mockImplementationOnce(async (key: string, value: string) => {
    await blocked;
    await write(key, value);
  });
  const old = RunCheckpoint.begin('old task');
  const clear = RunCheckpoint.clear();
  const current = RunCheckpoint.begin('new task');
  const touch = RunCheckpoint.touch();
  await Promise.resolve();
  release();
  await Promise.all([old, clear, current, touch]);
  await expect(RunCheckpoint.claimResumable()).resolves.toMatchObject({ goal: 'new task' });
});

it('allows only one concurrent claimant of the same checkpoint', async () => {
  await RunCheckpoint.begin('interrupted task');
  const results = await Promise.all([RunCheckpoint.claimResumable(), RunCheckpoint.claimResumable()]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

it('rejects future-dated checkpoints instead of resuming after a clock change', async () => {
  await RunCheckpoint.begin('interrupted task');
  await expect(RunCheckpoint.claimResumable({ now: Date.now() - 1000 })).resolves.toBeNull();
});
