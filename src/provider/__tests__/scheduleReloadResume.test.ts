import { scheduleReloadResume } from '../scheduleReloadResume';

describe('scheduleReloadResume', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reschedules on the replacement agent when a config change cancels the first timer', async () => {
    const attempted = { current: false };
    const first = { resumeInterruptedRun: jest.fn(async () => null) };
    const replacement = { resumeInterruptedRun: jest.fn(async () => '设置语言为英文') };

    const cancelFirst = scheduleReloadResume(first, attempted, 1500);
    cancelFirst();
    scheduleReloadResume(replacement, attempted, 1500);

    await jest.advanceTimersByTimeAsync(1500);

    expect(first.resumeInterruptedRun).not.toHaveBeenCalled();
    expect(replacement.resumeInterruptedRun).toHaveBeenCalledTimes(1);
    expect(attempted.current).toBe(true);
  });

  it('does not claim the same interrupted run twice after a timer fires', async () => {
    const attempted = { current: false };
    const agent = { resumeInterruptedRun: jest.fn(async () => null) };

    scheduleReloadResume(agent, attempted, 1);
    await jest.advanceTimersByTimeAsync(1);
    scheduleReloadResume(agent, attempted, 1);
    await jest.advanceTimersByTimeAsync(1);

    expect(agent.resumeInterruptedRun).toHaveBeenCalledTimes(1);
  });
});
