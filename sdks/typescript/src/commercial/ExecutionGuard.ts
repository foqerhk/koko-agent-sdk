/**
 * Soft client gate: local dump/tap/swipe/type require a short-lived
 * execution_permit from the official (or local-lab) gateway session.
 * Always enforced — debug logging does not bypass this.
 */

export type GuardedAction = 'dump' | 'find' | 'tap' | 'swipe' | 'pinch' | 'type' | 'screenshot';

function peekExp(permit: string): number | null {
  try {
    const [payloadB64] = permit.split('.');
    if (!payloadB64) return null;
    const pad =
      payloadB64.length % 4 === 0
        ? ''
        : '='.repeat(4 - (payloadB64.length % 4));
    const json = globalThis.atob
      ? globalThis.atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/') + pad)
      : Buffer.from(
          payloadB64.replace(/-/g, '+').replace(/_/g, '/') + pad,
          'base64',
        ).toString('utf8');
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

class ExecutionGuardImpl {
  private permit: string | null = null;
  private sessionId: string | null = null;

  setPermit(permit: string | null, sessionId?: string | null) {
    this.permit = permit;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }

  getPermit() {
    return this.permit;
  }

  getSessionId() {
    return this.sessionId;
  }

  clear() {
    this.permit = null;
    this.sessionId = null;
  }

  assert(action: GuardedAction) {
    if (!this.permit) {
      throw new Error(
        `KokoAgent: ${action} is only available while a goal is running. Use runGoal().`,
      );
    }
    const exp = peekExp(this.permit);
    if (exp != null && exp < Math.floor(Date.now() / 1000)) {
      throw new Error(
        `KokoAgent: session timed out during ${action}. Please run the goal again.`,
      );
    }
  }
}

export const ExecutionGuard = new ExecutionGuardImpl();
