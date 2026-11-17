import { Dimensions, Platform, StatusBar } from 'react-native';

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Best-effort top inset when SafeAreaProvider / context is missing
 * (common inside RN Modal on a new window).
 */
function fallbackTopInset(): number {
  if (Platform.OS === 'android') {
    return StatusBar.currentHeight ?? 24;
  }
  const { height, width } = Dimensions.get('window');
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  // iPhone X+ notch / Dynamic Island
  if (long >= 852 || short >= 393) return 59;
  if (long >= 812) return 47;
  return 20;
}

function readNativeInitialInsets(): SafeAreaInsets | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-safe-area-context');
    const metrics = mod?.initialWindowMetrics;
    if (metrics?.insets) {
      return {
        top: metrics.insets.top ?? 0,
        right: metrics.insets.right ?? 0,
        bottom: metrics.insets.bottom ?? 0,
        left: metrics.insets.left ?? 0,
      };
    }
  } catch {
    // optional peer
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TurboModuleRegistry } = require('react-native');
    const native = TurboModuleRegistry?.get?.('RNCSafeAreaContext');
    const insets = native?.getConstants?.()?.initialWindowMetrics?.insets;
    if (insets) {
      return {
        top: insets.top ?? 0,
        right: insets.right ?? 0,
        bottom: insets.bottom ?? 0,
        left: insets.left ?? 0,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Optional safe-area without requiring react-native-safe-area-context as peer.
 * Prefers live context → native initial metrics → platform heuristics (Modal-safe).
 */
export function useSafeAreaInsetsOptional(): SafeAreaInsets {
  let fromHook: SafeAreaInsets | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-safe-area-context');
    if (typeof mod?.useSafeAreaInsets === 'function') {
      // Same module presence for the lifetime of the app (optional peer).
      // eslint-disable-next-line react-hooks/rules-of-hooks
      fromHook = mod.useSafeAreaInsets();
    }
  } catch {
    // peer not installed
  }

  const native = readNativeInitialInsets();
  const pick = (key: keyof SafeAreaInsets, heuristic = 0) => {
    const a = fromHook?.[key] ?? 0;
    const b = native?.[key] ?? 0;
    if (a > 0) return a;
    if (b > 0) return b;
    return heuristic;
  };

  return {
    top: pick('top', fallbackTopInset()),
    right: pick('right'),
    bottom: pick('bottom'),
    left: pick('left'),
  };
}
