import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/** Native dump / tap / screenshot skip views whose testID starts with this. */
export const KOKO_OVERLAY_TEST_ID = 'koko-agent-overlay';
/** Cursor layer — skipped in dump, but NOT hidden during tap (must stay visible). */
export const KOKO_CURSOR_TEST_ID = 'koko-agent-cursor';

export type KokoOverlayLayerProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * `box-none` (default): children receive touches; empty area passes through.
   * `none`: entire layer ignores touches (cursor).
   * `auto`: layer blocks (modal sheet content).
   */
  pointerEvents?: 'box-none' | 'none' | 'auto' | 'box-only';
  /** Override testID / nativeID (default: koko-agent-overlay). */
  testID?: string;
};

/**
 * Host for SDK chrome (progress / cursor / sheet / dialogs).
 * Marked so native dump & agent taps can ignore / pierce this layer.
 */
export function KokoOverlayLayer({
  children,
  style,
  pointerEvents = 'box-none',
  testID = KOKO_OVERLAY_TEST_ID,
}: KokoOverlayLayerProps) {
  return (
    <View
      testID={testID}
      nativeID={testID}
      collapsable={false}
      pointerEvents={pointerEvents}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

export const overlayFill = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
});
