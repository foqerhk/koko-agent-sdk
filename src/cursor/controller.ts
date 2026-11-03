type CursorListener = (state: CursorState) => void;

export type CursorState = {
  visible: boolean;
  x: number;
  y: number;
  pressing: boolean;
  /** How long the overlay should animate to (x, y). 0 = snap. */
  moveDurationMs: number;
};

const DEFAULT: CursorState = {
  visible: false,
  x: 0,
  y: 0,
  pressing: false,
  moveDurationMs: 0,
};

/**
 * Imperative cursor controller used by KokoAgent; CursorOverlay subscribes.
 */
class CursorControllerImpl {
  private state: CursorState = { ...DEFAULT };
  private listeners = new Set<CursorListener>();

  subscribe(listener: CursorListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): CursorState {
    return this.state;
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }

  showAt(x: number, y: number, moveDurationMs = 0) {
    this.state = {
      ...this.state,
      visible: true,
      x,
      y,
      moveDurationMs,
    };
    this.emit();
  }

  hide() {
    this.state = { ...DEFAULT };
    this.emit();
  }

  setPressing(pressing: boolean) {
    this.state = { ...this.state, pressing };
    this.emit();
  }

  /**
   * Start moving toward the target immediately, then resolve when the
   * visual move should have finished — so tap happens after the cursor arrives.
   */
  async moveTo(x: number, y: number, durationMs: number): Promise<void> {
    const ms = Math.max(0, Math.floor(durationMs));

    // First appearance: snap near target so we don't fly in from (0,0).
    // Wait long enough for CursorOverlay's transparent Modal to present
    // (hosts with native-stack often need >100ms; 32ms left it invisible).
    if (!this.state.visible) {
      this.showAt(x, y, 0);
      await sleep(140);
      return;
    }

    const dx = x - this.state.x;
    const dy = y - this.state.y;
    const dist = Math.hypot(dx, dy);
    // Tiny hops: snap; longer moves: animate, then wait for arrival.
    if (dist < 8 || ms === 0) {
      this.showAt(x, y, 0);
      await sleep(24);
      return;
    }

    this.showAt(x, y, ms);
    // Allow React to start Animated.timing, then wait for arrival.
    await sleep(ms + 24);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const CursorController = new CursorControllerImpl();
