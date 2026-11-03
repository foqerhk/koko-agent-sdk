import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTaskStore } from '../task/useTaskStore';

/**
 * Karaoke-style subtitle for the current task action.
 * Prefer KokoObserver progress pill in the default UX; kept for custom layouts.
 */
export function KokoSubtitle() {
  const { subtitle, tasks, activeTaskId } = useTaskStore();
  const opacity = useRef(new Animated.Value(0)).current;
  const lastText = useRef<string | null>(null);
  const active = tasks.find((t) => t.id === activeTaskId);
  const show = !!subtitle && active?.status === 'running';

  useEffect(() => {
    if (!show) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
      lastText.current = null;
      return;
    }
    if (lastText.current === subtitle) return;
    lastText.current = subtitle;
    opacity.setValue(0.35);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [show, subtitle, opacity]);

  if (!subtitle || !show) return null;

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
      <View style={styles.pill}>
        <View style={styles.dot} />
        <Text style={styles.text} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,22,0.88)',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#7CFFB2',
    marginRight: 10,
  },
  text: {
    flexShrink: 1,
    color: '#F5F5F7',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
