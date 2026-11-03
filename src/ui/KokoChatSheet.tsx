import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StatusBarProps,
  type StatusBarStyle,
} from 'react-native';
import { useKokoAgent } from '../provider/KokoProvider';
import { useKokoUi } from '../provider/KokoUiContext';
import { TaskStore } from '../task/TaskStore';
import type { Task, TaskNode } from '../task/types';
import { useTaskStore } from '../task/useTaskStore';
import type { MessageKey } from '../i18n';
import { useSafeAreaInsetsOptional } from './safeArea';
import { IconClose, IconStop } from './icons';

const SHEET_BG_FALLBACK = '#121316';
const DEFAULT_SHEET_HEIGHT_RATIO = 0.6;
/** Auto-growing composer: default 1 line, cap at 3. */
const INPUT_FONT_SIZE = 15;
const INPUT_LINE_HEIGHT = 22;
const INPUT_MAX_LINES = 3;
const INPUT_TEXT_MIN = INPUT_LINE_HEIGHT;
const INPUT_TEXT_MAX = INPUT_LINE_HEIGHT * INPUT_MAX_LINES;

/**
 * Estimate height from text + box width.
 * iOS often reports a stuck contentSize when `height` is controlled, so we
 * must not rely on contentSize alone (paste / wrap would never grow).
 */
function estimateComposerHeight(value: string, widthPt: number): number {
  if (!value) return INPUT_TEXT_MIN;
  const paragraphs = value.split('\n');
  if (widthPt <= 0) {
    return Math.min(
      INPUT_TEXT_MAX,
      Math.max(INPUT_TEXT_MIN, paragraphs.length * INPUT_LINE_HEIGHT),
    );
  }
  // Slightly narrow so we grow a bit early rather than clip.
  const charsPerLine = Math.max(4, Math.floor(widthPt / (INPUT_FONT_SIZE * 0.95)));
  let lines = 0;
  for (const para of paragraphs) {
    const len = Math.max(1, Array.from(para).length);
    lines += Math.ceil(len / charsPerLine);
  }
  lines = Math.min(INPUT_MAX_LINES, Math.max(1, lines));
  return lines * INPUT_LINE_HEIGHT;
}


type HostStatusBarSnapshot = {
  barStyle: StatusBarStyle;
  backgroundColor?: string;
};

/** Read the host app's current StatusBar appearance before we override it. */
function snapshotHostStatusBar(): HostStatusBarSnapshot {
  const sb = StatusBar as unknown as {
    _currentValues?: {
      barStyle?: { value?: StatusBarStyle };
      backgroundColor?: { value?: unknown };
    };
    _defaultProps?: {
      barStyle?: { value?: StatusBarStyle };
      backgroundColor?: { value?: unknown };
    };
  };
  const cur = sb._currentValues ?? sb._defaultProps;
  return {
    barStyle: cur?.barStyle?.value ?? 'default',
    backgroundColor:
      cur?.backgroundColor?.value != null
        ? String(cur.backgroundColor.value)
        : undefined,
  };
}

const KIND_KEYS: Record<TaskNode['kind'], MessageKey> = {
  user: 'kind.user',
  plan: 'kind.plan',
  dump: 'kind.dump',
  find: 'kind.find',
  tap: 'kind.tap',
  swipe: 'kind.swipe',
  type: 'kind.type',
  confirm: 'kind.confirm',
  info: 'kind.info',
  error: 'kind.error',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Chat sheet: backdrop fades in first, then sheet slides down from the top.
 */
export function KokoChatSheet({ placeholder }: { placeholder?: string }) {
  const koko = useKokoAgent();
  const { branding, t, colors } = useKokoUi();
  const { tasks, ui, activeTaskId } = useTaskStore();
  const insets = useSafeAreaInsetsOptional();
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_TEXT_MIN);
  const [inputWidth, setInputWidth] = useState(0);
  const textRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Negative Y = off-screen above; sheet slides down from the top.
  const sheetY = useRef(new Animated.Value(-Dimensions.get('window').height)).current;
  const statusBarEntryRef = useRef<StatusBarProps | null>(null);
  const hostStatusBarRef = useRef<HostStatusBarSnapshot | null>(null);

  const primaryColor = branding.primaryColor;
  const inputPlaceholder = placeholder ?? branding.placeholder;

  const statusMeta = useCallback(
    (status: Task['status']): { color: string; label: string } => {
      switch (status) {
        case 'running':
          return { color: '#34D399', label: t('status.running') };
        case 'success':
          return { color: '#60A5FA', label: t('status.success') };
        case 'failed':
          return { color: '#F87171', label: t('status.failed') };
        case 'cancelled':
          return { color: '#A1A1AA', label: t('status.cancelled') };
        default:
          return { color: '#A1A1AA', label: status };
      }
    },
    [t],
  );

  const applySheetStatusBar = useCallback(() => {
    if (statusBarEntryRef.current) return;
    // Record host app status bar before overriding (for restore / debugging).
    hostStatusBarRef.current = snapshotHostStatusBar();
    statusBarEntryRef.current = StatusBar.pushStackEntry({
      animated: true,
      barStyle: colors.statusBar,
      // Colour only. On Android `translucent` is a window flag on the host
      // activity, not something we paint: flipping it relayouts the whole app
      // out from under the status bar and back again, which reads as the host
      // flinching every time the sheet opens. The Modal already draws under
      // the status bar on its own.
      ...(Platform.OS === 'android' ? { backgroundColor: colors.sheetBg } : null),
    });
  }, [colors.sheetBg, colors.statusBar]);

  const restoreHostStatusBar = useCallback(() => {
    if (statusBarEntryRef.current) {
      StatusBar.popStackEntry(statusBarEntryRef.current);
      statusBarEntryRef.current = null;
    } else if (hostStatusBarRef.current) {
      // Fallback if stack entry was lost — re-apply recorded host values.
      const prev = hostStatusBarRef.current;
      StatusBar.setBarStyle(prev.barStyle, true);
      if (Platform.OS === 'android' && prev.backgroundColor != null) {
        StatusBar.setBackgroundColor(prev.backgroundColor, true);
      }
    }
    hostStatusBarRef.current = null;
  }, []);

  // This sheet hangs from the top, so a keyboard never pushes it anywhere —
  // it just eats the bottom of the screen where the composer lives. The only
  // thing that keeps the input reachable is capping how tall the sheet may
  // grow. KeyboardAvoidingView cannot express that: it assumes bottom-anchored
  // content, and on Android the Modal gets its own window that the system
  // never resizes for the IME, so it is a no-op there anyway.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [rootHeight, setRootHeight] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(
      ios ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const selected: Task | null = useMemo(() => {
    const id = ui.selectedTaskId ?? activeTaskId ?? tasks[0]?.id;
    return tasks.find((t) => t.id === id) ?? null;
  }, [tasks, ui.selectedTaskId, activeTaskId]);

  const running =
    busy || tasks.some((t) => t.id === activeTaskId && t.status === 'running');

  useEffect(() => {
    if (ui.sheetOpen && !ui.selectedTaskId && tasks[0]) {
      TaskStore.setUi({ selectedTaskId: activeTaskId ?? tasks[0].id });
    }
  }, [ui.sheetOpen, ui.selectedTaskId, tasks, activeTaskId]);

  const closeAnimated = useCallback(() => {
    const off = -Dimensions.get('window').height;
    Animated.parallel([
      Animated.timing(sheetY, {
        toValue: off,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 220,
        delay: 80,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Always clear sheetOpen — if we only close on finished=true,
      // an interrupted animation leaves sheetOpen stuck true and the
      // sheet can slide back open on remount / Fast Refresh.
      restoreHostStatusBar();
      setMounted(false);
      TaskStore.closeSheet();
    });
  }, [backdropOpacity, sheetY, restoreHostStatusBar]);

  useEffect(() => {
    if (ui.sheetOpen) {
      setMounted(true);
      applySheetStatusBar();
      sheetY.setValue(-Dimensions.get('window').height);
      backdropOpacity.setValue(0);
      // 1) backdrop fade  2) sheet slides down from top
      Animated.sequence([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sheetY, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      restoreHostStatusBar();
      setMounted(false);
      backdropOpacity.setValue(0);
      sheetY.setValue(-Dimensions.get('window').height);
    }
  }, [ui.sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => restoreHostStatusBar(), [restoreHostStatusBar]);

  const onSend = useCallback(async () => {
    const goal = text.trim();
    if (!goal || running) return;
    setBusy(true);
    setText('');
    textRef.current = '';
    setInputHeight(INPUT_TEXT_MIN);
    // Drop sheet state immediately so a mid-run remount cannot reopen it.
    restoreHostStatusBar();
    setMounted(false);
    TaskStore.closeSheet();
    sheetY.setValue(-Dimensions.get('window').height);
    backdropOpacity.setValue(0);
    // Let host unfreeze + EmptyWallet remount before the first dump.
    await new Promise((r) => setTimeout(r, 500));
    try {
      await koko.runGoal(goal);
    } catch {
      // surfaced in task log
    } finally {
      setBusy(false);
    }
  }, [
    text,
    running,
    koko,
    restoreHostStatusBar,
    sheetY,
    backdropOpacity,
  ]);

  const onStop = useCallback(() => {
    koko.stop();
    koko.finishTask('cancelled', t('runtime.cancelled'));
    setBusy(false);
  }, [koko, t]);

  const confirmDeleteTask = useCallback(
    (task: Task) => {
      const title =
        task.title.length > 36 ? `${task.title.slice(0, 36)}…` : task.title;
      Alert.alert(
        t('sheet.deleteTaskTitle'),
        t('sheet.deleteTaskBody', { title }),
        [
          { text: t('dialog.cancel'), style: 'cancel' },
          {
            text: t('sheet.deleteTask'),
            style: 'destructive',
            onPress: () => {
              if (task.status === 'running' && task.id === activeTaskId) {
                koko.stop();
              }
              TaskStore.removeTask(task.id);
            },
          },
        ],
      );
    },
    [t, koko, activeTaskId],
  );

  if (!mounted && !ui.sheetOpen) return null;

  const topPad = Math.max(insets.top, Platform.OS === 'ios' ? 44 : 24) + 8;

  // A host whose activity runs in adjustPan never gets a keyboard frame out of
  // Android, and neither does anything drawn inside a Modal's own window. Both
  // are the host's call, not ours, so when the composer has focus and no frame
  // arrived, assume a keyboard of typical size rather than let it swallow the
  // input.
  const screenH = rootHeight || Dimensions.get('window').height;
  const occluded =
    keyboardHeight > 0
      ? keyboardHeight
      : composerFocused
        ? screenH * 0.45
        : 0;
  // Keep entry, empty and selected-task states at the same default height.
  // Content scrolls inside the sheet; the keyboard may shrink, never grow it.
  const defaultHeight = Math.round(screenH * DEFAULT_SHEET_HEIGHT_RATIO);
  const sheetSize = {
    height: occluded > 0
      ? Math.min(defaultHeight, Math.max(screenH * 0.3, screenH - occluded - 8))
      : defaultHeight,
  };

  return (
    <Modal
      visible={mounted || ui.sheetOpen}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={closeAnimated}
      statusBarTranslucent
    >
      <View
        testID="koko-agent-overlay"
        nativeID="koko-agent-overlay"
        collapsable={false}
        style={styles.root}
        onLayout={(e) => setRootHeight(e.nativeEvent.layout.height)}
      >
        {/* Full-screen dim — must stay behind the sheet; tap closes. */}
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.backdrop,
            { opacity: backdropOpacity, backgroundColor: colors.overlay },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeAnimated}
            accessibilityRole="button"
            accessibilityLabel={t('sheet.closeA11y')}
          />
        </Animated.View>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              sheetSize,
              {
                paddingTop: topPad,
                transform: [{ translateY: sheetY }],
                backgroundColor: colors.sheetBg,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.brandBlock}>
                <View style={[styles.brandMark, { backgroundColor: primaryColor }]}>
                  {branding.iconSource ? (
                    <Image
                      source={branding.iconSource}
                      style={styles.brandMarkImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={styles.brandMarkText}>{branding.mark}</Text>
                  )}
                </View>
                <View>
                  <Text style={[styles.title, { color: colors.text }]}>
                    {branding.name}
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                    {branding.tagline}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={closeAnimated}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel={t('sheet.closeA11y')}
              >
                <IconClose size={13} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={[styles.section, { color: colors.textMuted }]}>
              {t('sheet.recentTasks')}
            </Text>
            <FlatList
              horizontal
              data={tasks}
              keyExtractor={(t) => t.id}
              style={styles.taskStrip}
              contentContainerStyle={styles.taskStripContent}
              showsHorizontalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={[styles.emptyInline, { color: colors.textMuted }]}>
                  {t('sheet.emptyTasks')}
                </Text>
              }
              renderItem={({ item }) => {
                const selectedRow = item.id === selected?.id;
                const meta = statusMeta(item.status);
                return (
                  <Pressable
                    style={[
                      styles.taskChip,
                      { backgroundColor: colors.chipBg, borderColor: colors.border },
                      selectedRow && styles.taskChipOn,
                    ]}
                    onPress={() => TaskStore.selectTask(item.id)}
                    onLongPress={() => confirmDeleteTask(item)}
                    delayLongPress={380}
                    accessibilityRole="button"
                    accessibilityHint={t('sheet.deleteTask')}
                  >
                    <View style={[styles.dot, { backgroundColor: meta.color }]} />
                    <View style={styles.taskChipBody}>
                      <Text
                        style={[styles.taskChipText, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text style={[styles.taskChipMeta, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />

            <View style={styles.sessionHead}>
              <Text style={[styles.sectionTight, { color: colors.textMuted }]}>
                {t('sheet.timeline')}
              </Text>
              {selected ? (
                <Text
                  style={[styles.sessionHint, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {selected.title}
                </Text>
              ) : null}
            </View>

            <FlatList
              style={styles.nodeList}
              data={selected?.nodes ?? []}
              keyExtractor={(n) => n.id}
              contentContainerStyle={
                (selected?.nodes.length ?? 0) === 0 ? styles.nodeListEmpty : undefined
              }
              ListEmptyComponent={
                <View style={styles.emptyBlock}>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    {t('sheet.emptyNodesTitle')}
                  </Text>
                  <Text style={[styles.emptyHint, { color: colors.textMuted }]}>
                    {t('sheet.emptyNodesHint')}
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => (
                <View style={styles.nodeRow}>
                  <View style={styles.timeline}>
                    <View
                      style={[styles.timelineDot, { backgroundColor: colors.textMuted }]}
                    />
                    {index < (selected?.nodes.length ?? 1) - 1 ? (
                      <View
                        style={[styles.timelineLine, { backgroundColor: colors.border }]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.nodeBody}>
                    <View style={styles.nodeTop}>
                      <Text style={[styles.nodeKind, { color: colors.textMuted }]}>
                        {t(KIND_KEYS[item.kind])}
                      </Text>
                      <Text style={[styles.nodeTime, { color: colors.textMuted }]}>
                        {formatTime(item.createdAt)}
                      </Text>
                    </View>
                    <Text style={[styles.nodeTitle, { color: colors.text }]}>
                      {item.title}
                    </Text>
                  </View>
                </View>
              )}
            />

            <View style={styles.composer}>
              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: colors.inputBg, borderColor: colors.border },
                ]}
                onLayout={(e) => {
                  const w = Math.round(e.nativeEvent.layout.width);
                  if (w > 0 && w !== inputWidth) {
                    setInputWidth(w);
                    setInputHeight(estimateComposerHeight(textRef.current, w));
                  }
                }}
              >
                <TextInput
                  style={[
                    styles.input,
                    {
                      minHeight: INPUT_TEXT_MIN,
                      height: inputHeight,
                      maxHeight: INPUT_TEXT_MAX,
                      color: colors.text,
                    },
                  ]}
                  value={text}
                  onChangeText={(v) => {
                    textRef.current = v;
                    setText(v);
                    setInputHeight(estimateComposerHeight(v, inputWidth));
                  }}
                  onContentSizeChange={(e) => {
                    const v = textRef.current;
                    if (!v) {
                      setInputHeight(INPUT_TEXT_MIN);
                      return;
                    }
                    const estimated = estimateComposerHeight(v, inputWidth);
                    const raw = e.nativeEvent.contentSize.height;
                    const fromSize =
                      raw > INPUT_LINE_HEIGHT + 8
                        ? Math.min(INPUT_TEXT_MAX, Math.max(INPUT_TEXT_MIN, Math.ceil(raw)))
                        : INPUT_TEXT_MIN;
                    const next = Math.max(estimated, fromSize);
                    setInputHeight((prev) => (prev === next ? prev : next));
                  }}
                  placeholder={inputPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  editable={!running}
                  multiline
                  scrollEnabled={inputHeight >= INPUT_TEXT_MAX - 1}
                  textAlignVertical="top"
                  blurOnSubmit={false}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  accessibilityLabel={t('sheet.inputA11y')}
                />
              </View>
              {running ? (
                <Pressable
                  style={[styles.btn, styles.btnStop, styles.btnIcon]}
                  onPress={onStop}
                  accessibilityRole="button"
                  accessibilityLabel={t('sheet.stopA11y')}
                >
                  <IconStop size={12} color="#fff" />
                </Pressable>
              ) : (
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnSend,
                    { backgroundColor: primaryColor },
                    !text.trim() && styles.btnDisabled,
                  ]}
                  onPress={onSend}
                  disabled={!text.trim()}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>{t('sheet.send')}</Text>
                  )}
                </Pressable>
              )}
            </View>

            <View style={[styles.handle, { backgroundColor: colors.handle }]} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-start',
    zIndex: 1,
  },
  sheet: {
    // Definite height above bounds the flexible, scrolling step list.
    backgroundColor: SHEET_BG_FALLBACK,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 0,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandMarkImage: {
    width: 36,
    height: 36,
  },
  brandMarkText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  title: {
    color: '#F4F4F5',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionTight: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  taskStrip: {
    maxHeight: 64,
    // The sheet shrinks to fit above the keyboard; without this the strip
    // gives way first and clips its chips instead of the step list scrolling.
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 16,
  },
  taskStripContent: {
    alignItems: 'center',
    paddingRight: 8,
  },
  taskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 8,
    maxWidth: 200,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  taskChipOn: {
    backgroundColor: 'rgba(10,132,255,0.18)',
    borderColor: 'rgba(10,132,255,0.35)',
  },
  taskChipBody: {
    flexShrink: 1,
  },
  taskChipText: {
    color: '#F4F4F5',
    fontSize: 13,
    fontWeight: '600',
  },
  taskChipMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyInline: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    paddingVertical: 12,
  },
  sessionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  sessionHint: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
  },
  nodeList: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    maxHeight: Math.round(Dimensions.get('window').height * 0.42),
    marginBottom: 14,
  },
  nodeListEmpty: {
    minHeight: 120,
    justifyContent: 'center',
  },
  emptyBlock: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  nodeRow: {
    flexDirection: 'row',
    paddingBottom: 4,
  },
  timeline: {
    width: 16,
    alignItems: 'center',
    marginRight: 10,
  },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#0A84FF',
    marginTop: 5,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 4,
    marginBottom: 2,
  },
  nodeBody: {
    flex: 1,
    paddingBottom: 14,
  },
  nodeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  nodeKind: {
    color: '#7DD3FC',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  nodeTime: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  nodeTitle: {
    color: '#ECECF0',
    fontSize: 14,
    lineHeight: 20,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
  },
  composer: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  inputWrap: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  input: {
    width: '100%',
    color: '#F4F4F5',
    fontSize: INPUT_FONT_SIZE,
    lineHeight: INPUT_LINE_HEIGHT,
    paddingHorizontal: 2,
    paddingVertical: 0,
    margin: 0,
  },
  btn: {
    minWidth: 68,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  btnIcon: {
    minWidth: 44,
    paddingHorizontal: 12,
  },
  btnSend: { backgroundColor: '#0A84FF' },
  btnStop: { backgroundColor: '#FF453A' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
