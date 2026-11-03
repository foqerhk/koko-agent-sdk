import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { CursorController, type CursorState } from './controller';
import { useTaskStore } from '../task/useTaskStore';
import { TaskStore } from '../task/TaskStore';
import { KOKO_CURSOR_TEST_ID } from '../ui/KokoOverlayLayer';
import { KokoHostOverlay } from '../ui/hostOverlay';
import { useOverlayOrigin } from '../ui/useOverlayOrigin';
import { PointerHand } from './PointerHand';
import { CURSOR_H, CURSOR_TIP_X, CURSOR_TIP_Y, CURSOR_W } from './pointer';

/**
 * Native-looking mouse pointer while the agent acts.
 *
 * Uses KokoHostOverlay (FullWindowOverlay on iOS when available) so the
 * cursor stays above react-native-screens Settings / stack modals.
 *
 * Only mount while the cursor is actually visible — an empty FullWindowOverlay
 * stacked under KokoObserver can steal the top presentation and hide the
 * progress pill during host.run-only assist paths.
 */
export function CursorOverlay() {
  const [state, setState] = useState<CursorState>(CursorController.getState());
  const { tasks, activeTaskId, ui } = useTaskStore();
  const running = tasks.some(
    (t) => t.id === activeTaskId && t.status === 'running',
  );
  const anim = useRef(new Animated.ValueXY({ x: state.x, y: state.y })).current;
  const press = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const chromeEpoch = ui.chromeEpoch ?? 0;
  const { ref: layerRef, origin, measure } = useOverlayOrigin();

  useEffect(() => CursorController.subscribe(setState), []);

  useEffect(() => {
    if (!running && state.visible) {
      CursorController.hide();
    }
  }, [running, state.visible]);

  useEffect(() => {
    if (running && state.visible) {
      TaskStore.liftChrome();
    }
  }, [running, state.visible, state.x, state.y]);

  useEffect(() => {
    const duration = Math.max(0, state.moveDurationMs ?? 0);
    const to = {
      x: state.x - origin.x - CURSOR_TIP_X,
      y: state.y - origin.y - CURSOR_TIP_Y,
    };
    if (duration <= 0) {
      anim.stopAnimation();
      anim.setValue(to);
      return;
    }
    Animated.timing(anim, {
      toValue: to,
      duration,
      // Reduce native animation work while Fabric registers views during navigation.
      useNativeDriver: false,
    }).start();
  }, [state.x, state.y, state.moveDurationMs, origin.x, origin.y, anim]);

  useEffect(() => {
    Animated.spring(press, {
      toValue: state.pressing ? 1 : 0,
      useNativeDriver: false,
      friction: 6,
    }).start();
  }, [state.pressing, press]);

  const show = running && state.visible;

  useEffect(() => {
    if (show) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 80,
      useNativeDriver: false,
    }).start();
  }, [show, opacity]);

  if (!show) return null;

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.88],
  });

  return (
    <KokoHostOverlay liftToken={chromeEpoch}>
      <View
        ref={layerRef}
        onLayout={measure}
        testID={KOKO_CURSOR_TEST_ID}
        nativeID={KOKO_CURSOR_TEST_ID}
        collapsable={false}
        pointerEvents="none"
        style={styles.layer}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View
          style={[
            styles.cursor,
            {
              opacity,
              transform: [...anim.getTranslateTransform(), { scale }],
            },
          ]}
        >
          <PointerHand />
        </Animated.View>
      </View>
    </KokoHostOverlay>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  cursor: {
    position: 'absolute',
    width: CURSOR_W,
    height: CURSOR_H,
    left: 0,
    top: 0,
  },
});
