jest.mock(
  'react-native',
  () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) } }),
  { virtual: true },
);

import {
  getChromeClearanceRect,
  pointOverlapsProgressChrome,
  setProgressChromeFrame,
} from '../progressChrome';

describe('progress chrome clearance', () => {
  afterEach(() => setProgressChromeFrame(null));

  it('falls back to the bottom-right dock before the first measurement', () => {
    const r = getChromeClearanceRect();
    expect(r.x + r.width).toBe(390);
    expect(r.y + r.height).toBe(844);
  });

  it('follows the chrome once the user drags it off the corner', () => {
    // Dragged to the top-left: the corner it came from must be tappable again,
    // otherwise dragging buys the user nothing.
    setProgressChromeFrame({ x: 16, y: 60, width: 200, height: 40 });
    expect(pointOverlapsProgressChrome({ x: 100, y: 80 })).toBe(true);
    expect(pointOverlapsProgressChrome({ x: 330, y: 800 })).toBe(false);
  });

  it('does not blanket the host tab bar it is not actually covering', () => {
    setProgressChromeFrame({ x: 170, y: 740, width: 204, height: 44 });
    // Centre of a left-hand tab, well clear of the pill.
    expect(pointOverlapsProgressChrome({ x: 49, y: 800 })).toBe(false);
  });
});
