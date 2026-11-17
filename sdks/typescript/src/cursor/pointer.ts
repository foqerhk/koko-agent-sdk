/**
 * Geometry for the agent's on-screen pointer.
 *
 * Two overlays draw it (KokoObserver when the progress chrome is mounted,
 * CursorOverlay otherwise), so this lives in one place: a hotspot that
 * disagreed between them would put the pointer somewhere the tap did not go.
 */

/** Design grid the hand is laid out on. */
const GRID_W = 34;
const GRID_H = 44;

/** Keep the grid ratio so the drawing is not squashed. */
export const CURSOR_W = 26;
export const CURSOR_H = Math.round((CURSOR_W * GRID_H) / GRID_W);

/** Points per grid unit. */
export const HAND_UNIT = CURSOR_W / GRID_W;

/** Outline weight, in grid units. */
export const HAND_STROKE = 1.6;

/**
 * The hand as a union of rounded bars: `[x, y, width, height, radius]` in grid
 * units. Order is back to front, though within a layer it does not matter.
 */
export const HAND_SHAPES: ReadonlyArray<
  readonly [number, number, number, number, number]
> = [
  [10, 1.5, 7, 24.5, 3.5], // index finger, extended — its tip is the hotspot
  [16.5, 17, 6.5, 13, 3.2], // middle, folded
  [21.5, 19, 6.5, 12, 3.2], // ring, folded
  [26, 21.5, 5.5, 10.5, 2.7], // little, folded
  [7, 24, 24, 18, 6.5], // palm
  [2.5, 27, 9.5, 7, 3.5], // thumb, across the side of the palm
];

/** The index fingertip — this is what lands on the tap coordinate. */
export const CURSOR_TIP_X = 13.5 * HAND_UNIT;
export const CURSOR_TIP_Y = 0.6 * HAND_UNIT;
