import { Dimensions } from 'react-native';
import type { Point } from '../types';

export type ChromeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Last measured progress pill + stop button bounds (window coords). */
let measured: ChromeRect | null = null;

export function setProgressChromeFrame(rect: ChromeRect | null) {
  measured = rect;
}

export function getProgressChromeFrame(): ChromeRect | null {
  return measured;
}

/**
 * Bottom-right dock: where the chrome rests before the user moves it.
 * Only a stand-in for when we have no real measurement yet.
 */
function bottomRightDock(): ChromeRect {
  const { width, height } = Dimensions.get('window');
  const dockH = 120;
  const dockW = Math.min(340, Math.max(200, width * 0.55));
  return {
    x: width - dockW,
    y: height - dockH,
    width: dockW,
    height: dockH,
  };
}

/**
 * Clearance rect = where the chrome actually is, padded for hitSlop.
 *
 * Follows the chrome once the user drags it; the fixed bottom-right band is
 * only a guess for before the first measurement lands. Blanketing the corner
 * regardless would both hide host controls the chrome has been moved off of
 * and keep swallowing tab-bar centres that were never covered.
 */
export function getChromeClearanceRect(): ChromeRect {
  if (!measured || measured.width <= 0 || measured.height <= 0) {
    return bottomRightDock();
  }
  return {
    x: measured.x - 12,
    y: measured.y - 12,
    width: measured.width + 24,
    height: measured.height + 24,
  };
}

export function pointOverlapsProgressChrome(point: Point, pad = 16): boolean {
  const r = getChromeClearanceRect();
  return (
    point.x >= r.x - pad &&
    point.x <= r.x + r.width + pad &&
    point.y >= r.y - pad &&
    point.y <= r.y + r.height + pad
  );
}

export function pointsOverlapProgressChrome(
  points: Point[],
  pad = 16,
): boolean {
  return points.some((p) => pointOverlapsProgressChrome(p, pad));
}
