import { useCallback, useRef, useState } from 'react';
import type { View } from 'react-native';

export type OverlayOrigin = { x: number; y: number };

/**
 * Where the overlay layer itself sits inside the window.
 *
 * Agent coordinates are window-absolute: that is what the native dump reports
 * and where a synthetic touch is dispatched. The cursor, though, is laid out
 * inside the host's React tree, and hosts routinely pad their root for the
 * status bar — so a fingertip drawn at the tap coordinate lands a status bar
 * lower than the touch it is meant to represent. Measuring the layer's own
 * origin and subtracting it keeps the two in the same space, and costs nothing
 * for hosts that do not pad (the origin is then zero).
 */
export function useOverlayOrigin() {
  const ref = useRef<View>(null);
  const [origin, setOrigin] = useState<OverlayOrigin>({ x: 0, y: 0 });

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      setOrigin((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
    });
  }, []);

  return { ref, origin, measure };
}
