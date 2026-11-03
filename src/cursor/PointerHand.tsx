import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CURSOR_H, CURSOR_W, HAND_SHAPES, HAND_UNIT, HAND_STROKE } from './pointer';

/**
 * The agent's pointer: a hand with the index finger extended.
 *
 * Drawn from views rather than an image. The SDK's assets sit outside the
 * host's Metro project root, and a host that rewrites asset paths (monorepos
 * commonly do) can leave the request unresolvable — the pointer then silently
 * does not render, which is the one thing the user watches to know the agent
 * is acting. Views cannot fail that way, and they stay sharp at any density.
 *
 * Two passes: dark shapes inflated to form the outline, then the white fill
 * over them. Overlaps within a pass are invisible, so the union reads as one
 * silhouette with no internal seams.
 */
export function PointerHand() {
  return (
    <View style={styles.hand} pointerEvents="none">
      {renderLayer(HAND_STROKE, '#131313')}
      {renderLayer(0, '#FFFFFF')}
    </View>
  );
}

function renderLayer(inflate: number, color: string) {
  return HAND_SHAPES.map(([x, y, w, h, r], i) => (
    <View
      key={`${color}-${i}`}
      style={{
        position: 'absolute',
        left: (x - inflate) * HAND_UNIT,
        top: (y - inflate) * HAND_UNIT,
        width: (w + inflate * 2) * HAND_UNIT,
        height: (h + inflate * 2) * HAND_UNIT,
        borderRadius: (r + inflate) * HAND_UNIT,
        backgroundColor: color,
      }}
    />
  ));
}

const styles = StyleSheet.create({
  hand: {
    width: CURSOR_W,
    height: CURSOR_H,
  },
});
