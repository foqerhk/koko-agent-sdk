import type { KokoUsageEvent } from '../types';

type Listener = (event: KokoUsageEvent) => void;

/**
 * Fan-out for usage / lifecycle events. Host `onUsageEvent` is wired here.
 * Never used to gate execution.
 */
class UsageBusImpl {
  private listeners = new Set<Listener>();
  private recent: KokoUsageEvent[] = [];
  private readonly maxRecent = 100;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: KokoUsageEvent) {
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) {
      this.recent.splice(0, this.recent.length - this.maxRecent);
    }
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // host callbacks must not break the agent
      }
    }
  }

  getRecent(): KokoUsageEvent[] {
    return [...this.recent];
  }

  clear() {
    this.recent = [];
  }
}

export const UsageBus = new UsageBusImpl();
