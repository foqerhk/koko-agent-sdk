import type { KokoAgent } from '../KokoAgent';

type AttemptRef = { current: boolean };
type ReloadResumableAgent = Pick<KokoAgent, 'resumeInterruptedRun'>;

/**
 * Wait until the host has finished rebuilding its navigator, then claim a
 * checkpoint left by a JS-context reload.
 *
 * Hosts often discover their real locale/theme immediately after mount and
 * rebuild the Koko config once. That changes the agent dependency and cancels
 * the first timer. Do not consume the single resume attempt until the timer
 * actually fires, otherwise the replacement agent can never reschedule it.
 */
export function scheduleReloadResume(
  agent: ReloadResumableAgent,
  attempted: AttemptRef,
  delayMs = 1500,
): () => void {
  if (attempted.current) return () => {};
  const timer = setTimeout(() => {
    if (attempted.current) return;
    attempted.current = true;
    void agent.resumeInterruptedRun().catch(() => {});
  }, delayMs);
  return () => clearTimeout(timer);
}
