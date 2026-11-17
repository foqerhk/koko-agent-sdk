import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { TaskStore } from '../task/TaskStore';
import { useTaskStore } from '../task/useTaskStore';
import { KokoOverlayLayer } from './KokoOverlayLayer';

export type KokoEntryButtonProps = {
  label?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Demo convenience button. Production hosts should draw their own entry UI
 * and call `openKokoChat()` / `agent.openChat()`.
 *
 * Marked as overlay so dump/tap skip it — otherwise the agent mistakes it for
 * an in-app control near bottom tabs (e.g. 我的).
 */
export function KokoEntryButton({
  label = 'Koko',
  style,
}: KokoEntryButtonProps) {
  const { tasks, activeTaskId } = useTaskStore();
  const running = tasks.some((t) => t.id === activeTaskId && t.status === 'running');

  return (
    <KokoOverlayLayer pointerEvents="box-none" style={styles.wrap}>
      <Pressable
        style={[styles.btn, style, running && styles.btnDim]}
        onPress={() => {
          // Never open the sheet mid-run — Modal backdrop blocks host taps.
          if (running) return;
          TaskStore.openSheet();
        }}
        accessibilityRole="button"
        accessibilityLabel="Open chat"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={styles.text}>{label}</Text>
      </Pressable>
    </KokoOverlayLayer>
  );
}

/** Imperative open for custom host buttons (preferred). */
export function openKokoChat(taskId?: string | null) {
  TaskStore.openSheet(taskId);
}

export function closeKokoChat() {
  TaskStore.closeSheet();
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
  },
  btn: {
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  btnDim: {
    opacity: 0.45,
  },
  text: {
    color: '#F9FAFB',
    fontWeight: '700',
    fontSize: 14,
  },
});
