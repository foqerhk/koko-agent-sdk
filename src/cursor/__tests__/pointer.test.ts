import {
  CURSOR_H,
  CURSOR_TIP_X,
  CURSOR_TIP_Y,
  CURSOR_W,
  HAND_SHAPES,
  HAND_UNIT,
} from '../pointer';

describe('pointer geometry', () => {
  const [indexX, indexY, indexW] = HAND_SHAPES[0];

  it('puts the hotspot on the extended fingertip', () => {
    // Off the finger and the pointer visibly aims somewhere the tap did not go.
    expect(CURSOR_TIP_X / HAND_UNIT).toBeGreaterThan(indexX);
    expect(CURSOR_TIP_X / HAND_UNIT).toBeLessThan(indexX + indexW);
    expect(CURSOR_TIP_Y / HAND_UNIT).toBeLessThanOrEqual(indexY);
  });

  it('draws the hand within its box', () => {
    for (const [x, y, w, h] of HAND_SHAPES) {
      expect(x * HAND_UNIT).toBeGreaterThanOrEqual(0);
      expect((x + w) * HAND_UNIT).toBeLessThanOrEqual(CURSOR_W);
      expect((y + h) * HAND_UNIT).toBeLessThanOrEqual(CURSOR_H);
    }
  });

  it('keeps the index finger clear of the folded ones', () => {
    const [, , , indexH] = HAND_SHAPES[0];
    const foldTops = HAND_SHAPES.slice(1, 4).map(([, y]) => y);
    // The silhouette only reads as "pointing" while the finger stands above
    // the knuckles.
    expect(Math.min(...foldTops)).toBeGreaterThan(indexY + indexH / 2);
  });
});
