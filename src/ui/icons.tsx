import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/** Minimal vector-less icons for SDK UI (no icon font dependency). */

export function IconClose({
  color = 'rgba(255,255,255,0.72)',
  size = 14,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = Math.max(1.5, size * 0.12);
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: color,
            width: size,
            height: t,
            top: (size - t) / 2,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.bar,
          {
            backgroundColor: color,
            width: size,
            height: t,
            top: (size - t) / 2,
            transform: [{ rotate: '-45deg' }],
          },
        ]}
      />
    </View>
  );
}

export function IconStop({
  color = '#fff',
  size = 12,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const r = Math.max(2, size * 0.18);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: r,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Checkmark (two bars) for success result. */
export function IconCheck({
  color = '#fff',
  size = 16,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = Math.max(2, size * 0.14);
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          position: 'absolute',
          backgroundColor: color,
          width: size * 0.38,
          height: t,
          borderRadius: t,
          left: size * 0.08,
          top: size * 0.52,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          backgroundColor: color,
          width: size * 0.62,
          height: t,
          borderRadius: t,
          left: size * 0.28,
          top: size * 0.42,
          transform: [{ rotate: '-48deg' }],
        }}
      />
    </View>
  );
}

/** Horizontal dash for cancelled. */
export function IconDash({
  color = '#fff',
  size = 14,
  style,
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = Math.max(2, size * 0.16);
  return (
    <View
      style={[
        {
          width: size * 0.7,
          height: t,
          borderRadius: t,
          backgroundColor: color,
          alignSelf: 'center',
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    borderRadius: 1,
  },
});
