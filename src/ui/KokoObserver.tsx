import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useKokoAgent } from '../provider/KokoProvider';
import { useKokoUi } from '../provider/KokoUiContext';
import { TaskStore } from '../task/TaskStore';
import { useTaskStore } from '../task/useTaskStore';
import type { ProgressResultFlash } from '../task/types';
import { useSafeAreaInsetsOptional } from './safeArea';
import { useOverlayOrigin } from './useOverlayOrigin';
import { KokoChatSheet } from './KokoChatSheet';
import { KokoHostOverlay } from './hostOverlay';
import { setProgressChromeFrame } from './progressChrome';
import { IconCheck, IconClose, IconDash, IconStop } from './icons';
import { signalAppUserGateCheck } from '../privacy/userGate';
import {
  CursorController,
  type CursorState,
} from '../cursor/controller';
import { KOKO_CURSOR_TEST_ID } from './KokoOverlayLayer';
import { PointerHand } from '../cursor/PointerHand';
import {
  CURSOR_H,
  CURSOR_TIP_X,
  CURSOR_TIP_Y,
  CURSOR_W,
} from '../cursor/pointer';

const RESULT_DISMISS_MS = 2600;

export type KokoObserverProps = {
  /** @deprecated Prefer config.branding.placeholder */
  composerPlaceholder?: string;
  /** Draw agent cursor in the same overlay Modal (default true). */
  cursor?: boolean;
};

/**
 * Progress pill + stop (+ optional cursor) in one host overlay Modal.
 * After a run ends, shows an animated success/fail icon then auto-dismisses.
 */
export function KokoObserver({
  composerPlaceholder,
  cursor = true,
}: KokoObserverProps) {
  const koko = useKokoAgent();
  const { branding, t, colors } = useKokoUi();
  const { subtitle, tasks, activeTaskId, ui, resultFlash, userGateWaiting } =
    useTaskStore();
  const insets = useSafeAreaInsetsOptional();
  const running = tasks.some(
    (t) => t.id === activeTaskId && t.status === 'running',
  );
  const [cursorState, setCursorState] = useState<CursorState>(() =>
    CursorController.getState(),
  );
  // Clear of the host's own bottom chrome (tab bars, CTAs) by default; the
  // user can drag it anywhere from there.
  const bottom = Math.max(insets.bottom, 8) + (userGateWaiting ? 144 : 40);
  const right = Math.max(insets.right, 8) + 14;
  const rowRef = useRef<View>(null);
  const {
    ref: cursorLayerRef,
    origin: cursorOrigin,
    measure: measureCursorLayer,
  } = useOverlayOrigin();
  const resultOpacity = useRef(new Animated.Value(1)).current;
  const cursorAnim = useRef(
    new Animated.ValueXY({ x: cursorState.x, y: cursorState.y }),
  ).current;
  const cursorPress = useRef(new Animated.Value(0)).current;
  const chromeEpoch = ui.chromeEpoch ?? 0;

  // Whatever corner we pick, some run will need the user to touch exactly what
  // the pill is sitting on. Let them shove it aside instead of making them
  // guess our layout.
  const { width: screenW, height: screenH } = useWindowDimensions();
  const dragOffset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragStart = useRef({ x: 0, y: 0 });
  const dragBounds = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Manual takeover must leave the host's bottom submit/next button usable,
  // including when the user previously dragged normal progress into that area.
  useEffect(() => {
    if (userGateWaiting) dragOffset.setValue({ x: 0, y: 0 });
  }, [!!userGateWaiting, dragOffset]);

  useEffect(() => CursorController.subscribe(setCursorState), []);

  useEffect(() => {
    if ((!running || userGateWaiting) && cursorState.visible) CursorController.hide();
  }, [running, userGateWaiting, cursorState.visible]);

  useEffect(() => {
    const duration = Math.max(0, cursorState.moveDurationMs ?? 0);
    const to = {
      x: cursorState.x - cursorOrigin.x - CURSOR_TIP_X,
      y: cursorState.y - cursorOrigin.y - CURSOR_TIP_Y,
    };
    if (duration <= 0) {
      cursorAnim.stopAnimation();
      cursorAnim.setValue(to);
      return;
    }
    Animated.timing(cursorAnim, {
      toValue: to,
      duration,
      // Cursor animation can overlap Fabric's lazy native view registration.
      useNativeDriver: false,
    }).start();
  }, [
    cursorState.x,
    cursorState.y,
    cursorState.moveDurationMs,
    cursorOrigin.x,
    cursorOrigin.y,
    cursorAnim,
  ]);

  useEffect(() => {
    Animated.spring(cursorPress, {
      toValue: cursorState.pressing ? 1 : 0,
      useNativeDriver: false,
      friction: 6,
    }).start();
  }, [cursorState.pressing, cursorPress]);

  const onStop = useCallback(() => {
    koko.stop();
    koko.finishTask('cancelled', t('runtime.cancelled'));
  }, [koko, t]);

  const measureChrome = useCallback(() => {
    rowRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        dragBounds.current = { x, y, width, height };
        setProgressChromeFrame({ x, y, width, height });
      }
    });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(measureChrome);
    return () => cancelAnimationFrame(frame);
  }, [bottom, right, measureChrome]);

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        // Capture, so a drag that starts on the stop button still moves the
        // pill. A plain press never crosses the threshold and stays with the
        // button.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          dragOffset.stopAnimation((v) => {
            dragStart.current = v as { x: number; y: number };
          });
        },
        onPanResponderMove: (_e, g) => {
          const b = dragBounds.current;
          // `b` is where the pill is right now, offset included, so take the
          // offset back out to get the room left on each side.
          const restX = b.x - dragStart.current.x;
          const restY = b.y - dragStart.current.y;
          const min = 8;
          const clamp = (v: number, lo: number, hi: number) =>
            Math.min(hi, Math.max(lo, v));
          dragOffset.setValue({
            x: clamp(
              dragStart.current.x + g.dx,
              min - restX,
              screenW - b.width - min - restX,
            ),
            y: clamp(
              dragStart.current.y + g.dy,
              min - restY,
              screenH - b.height - min - restY,
            ),
          });
        },
        // The agent hides chrome before touching anything under it, so the
        // clearance rect has to follow the pill to its new home.
        onPanResponderRelease: measureChrome,
        onPanResponderTerminate: measureChrome,
      }),
    [dragOffset, measureChrome, screenW, screenH],
  );

  useEffect(() => {
    if (!resultFlash) return;
    resultOpacity.setValue(0);
    Animated.timing(resultOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
    const hide = setTimeout(() => {
      Animated.timing(resultOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) TaskStore.clearResultFlash();
      });
    }, RESULT_DISMISS_MS);
    return () => clearTimeout(hide);
  }, [resultFlash?.at, resultOpacity]);

  useEffect(() => {
    if (!running && !resultFlash && !userGateWaiting) {
      setProgressChromeFrame(null);
    }
  }, [running, resultFlash, userGateWaiting]);

  useEffect(() => {
    if (!running) return;
    TaskStore.liftChrome();
  }, [running, subtitle]);

  const showingResult = Boolean(resultFlash) && !running;
  const showProgress =
    (running || showingResult || !!userGateWaiting) &&
    !ui.sheetOpen &&
    !ui.chromeSuppressed;
  const showCursor = Boolean(cursor && running && cursorState.visible);
  const showOverlay = showProgress || showCursor;

  const cursorScale = cursorPress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.88],
  });

  return (
    <>
      {showOverlay ? (
        <KokoHostOverlay liftToken={chromeEpoch}>
          {showCursor ? (
            <View
              ref={cursorLayerRef}
              onLayout={measureCursorLayer}
              testID={KOKO_CURSOR_TEST_ID}
              nativeID={KOKO_CURSOR_TEST_ID}
              collapsable={false}
              pointerEvents="none"
              style={StyleSheet.absoluteFillObject}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Animated.View
                style={[
                  styles.cursor,
                  {
                    transform: [
                      ...cursorAnim.getTranslateTransform(),
                      { scale: cursorScale },
                    ],
                  },
                ]}
              >
                <PointerHand />
              </Animated.View>
            </View>
          ) : null}

          {showProgress ? (
            <View
              pointerEvents="box-none"
              style={[styles.progressWrap, { bottom, right }]}
            >
              <Animated.View
                ref={rowRef}
                {...dragResponder.panHandlers}
                style={[
                  styles.progressRow,
                  { transform: dragOffset.getTranslateTransform() },
                  showingResult ? { opacity: resultOpacity } : null,
                ]}
                onLayout={measureChrome}
              >
                {showingResult && resultFlash ? (
                  <ResultIconBadge
                    flash={resultFlash}
                    onPress={() => TaskStore.openSheet(resultFlash.taskId)}
                    a11y={t('progress.openA11y')}
                  />
                ) : userGateWaiting ? (
                  <>
                    <View
                      style={[
                        styles.progress,
                        styles.gateBanner,
                        { backgroundColor: colors.progressBg },
                      ]}
                    >
                      <View
                        style={[
                          styles.logo,
                          { backgroundColor: branding.primaryColor },
                        ]}
                      >
                        {branding.iconSource ? (
                          <Image
                            source={branding.iconSource}
                            style={styles.logoImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={styles.logoMark}>{branding.mark}</Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.progressText,
                          { color: colors.progressText },
                        ]}
                        numberOfLines={4}
                        accessibilityLiveRegion="polite"
                      >
                        {userGateWaiting}
                      </Text>
                    </View>
                    <Pressable
                      style={[
                        styles.doneBtn,
                        { backgroundColor: branding.primaryColor },
                      ]}
                      onPress={() => {
                        TaskStore.setUserGateWaiting(t('gate.checking'));
                        signalAppUserGateCheck();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('gate.check')}
                      hitSlop={6}
                    >
                      <Text style={styles.doneBtnText}>{t('gate.check')}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.stopBtn}
                      onPress={onStop}
                      accessibilityRole="button"
                      accessibilityLabel={t('progress.stopA11y')}
                      hitSlop={6}
                    >
                      <IconStop size={11} color="#fff" />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View
                      style={[
                        styles.progress,
                        { backgroundColor: colors.progressBg },
                      ]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <View
                        style={[
                          styles.logo,
                          { backgroundColor: branding.primaryColor },
                        ]}
                      >
                        {branding.iconSource ? (
                          <Image
                            source={branding.iconSource}
                            style={styles.logoImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={styles.logoMark}>{branding.mark}</Text>
                        )}
                        <View style={styles.liveDot} />
                      </View>
                      <Text
                        style={[
                          styles.progressText,
                          { color: colors.progressText },
                        ]}
                        numberOfLines={1}
                      >
                        {subtitle ?? `${branding.name} ${t('progress.running')}`}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.stopBtn}
                      onPress={onStop}
                      accessibilityRole="button"
                      accessibilityLabel={t('progress.stopA11y')}
                      hitSlop={6}
                    >
                      <IconStop size={11} color="#fff" />
                    </Pressable>
                  </>
                )}
              </Animated.View>
            </View>
          ) : null}
        </KokoHostOverlay>
      ) : null}

      <KokoChatSheet placeholder={composerPlaceholder} />
    </>
  );
}

function ResultIconBadge({
  flash,
  onPress,
  a11y,
}: {
  flash: ProgressResultFlash;
  onPress: () => void;
  a11y: string;
}) {
  const { t } = useKokoUi();
  const scale = useRef(new Animated.Value(0.4)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(0.4);
    spin.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 140,
        useNativeDriver: true,
      }),
      Animated.timing(spin, {
        toValue: 1,
        duration: flash.status === 'success' ? 320 : 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [flash.at, flash.status, scale, spin]);

  const bg =
    flash.status === 'success'
      ? '#10B981'
      : flash.status === 'cancelled'
        ? '#64748B'
        : '#FF453A';
  const label = t(`progress.${flash.status}`);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange:
      flash.status === 'failed' ? ['-28deg', '0deg'] : ['12deg', '0deg'],
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${a11y}`}
      hitSlop={8}
    >
      <Animated.View
        style={[
          styles.resultBadge,
          { backgroundColor: bg, transform: [{ scale }, { rotate }] },
        ]}
      >
        {flash.status === 'success' ? (
          <IconCheck size={27} color="#fff" />
        ) : flash.status === 'cancelled' ? (
          <IconDash size={24} color="#fff" />
        ) : (
          <IconClose size={24} color="#fff" />
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  progressWrap: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'flex-end',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 172,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: 'rgba(20,20,22,0.94)',
  },
  gateBanner: {
    maxWidth: 220,
    alignItems: 'flex-start',
  },
  doneBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '600',
  },
  resultBadge: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  logo: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
    overflow: 'hidden',
  },
  logoImage: {
    width: 20,
    height: 20,
  },
  logoMark: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  liveDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
    borderWidth: 1.2,
    borderColor: 'rgba(20,20,22,0.94)',
  },
  progressText: {
    flexShrink: 1,
    color: '#F5F5F7',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
  },
  stopBtn: {
    width: 30,
    height: 30,
    borderRadius: 12,
    backgroundColor: '#FF453A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cursor: {
    position: 'absolute',
    width: CURSOR_W,
    height: CURSOR_H,
    left: 0,
    top: 0,
  },
});
