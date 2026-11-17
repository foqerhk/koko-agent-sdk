import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TaskStore } from '../task/TaskStore';
import type { Task, TaskNode, TaskStatus } from '../task/types';
import { useTaskStore } from '../task/useTaskStore';
import { useKokoUi } from '../provider/KokoUiContext';

function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'running':
      return '#7CFFB2';
    case 'success':
      return '#6EC8FF';
    case 'failed':
      return '#FF7A7A';
    case 'cancelled':
      return '#A0A0A5';
    default:
      return '#A0A0A5';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function TaskRow({
  task,
  selected,
  onPress,
}: {
  task: Task;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useKokoUi();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.taskRow, selected && styles.taskRowSelected]}
    >
      <View style={[styles.statusDot, { backgroundColor: statusColor(task.status) }]} />
      <View style={styles.taskMeta}>
        <Text style={styles.taskTitle} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.taskSub}>
          {t(`status.${task.status}`)} · {t(task.nodes.length === 1 ? 'panel.stepOne' : 'panel.stepMany', { count: task.nodes.length })} · {formatTime(task.createdAt)}
        </Text>
      </View>
      <Text style={styles.chevron}>{selected ? '▾' : '›'}</Text>
    </Pressable>
  );
}

function NodeRow({ node }: { node: TaskNode }) {
  const { t } = useKokoUi();
  return (
    <View style={styles.nodeRow}>
      <Text style={styles.nodeTime}>{formatTime(node.createdAt)}</Text>
      <View style={styles.nodeBody}>
        <Text style={styles.nodeKind}>{t(`kind.${node.kind}`)}</Text>
        <Text style={styles.nodeTitle}>{node.title}</Text>
        {node.detail ? (
          <Text style={styles.nodeDetail} numberOfLines={3}>
            {node.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * @deprecated Prefer KokoChatSheet via KokoObserver / KokoEntryButton.
 * Legacy inline task list; maps to sheetOpen for expand/collapse.
 */
export function KokoTaskPanel() {
  const { branding, t } = useKokoUi();
  const { tasks, ui } = useTaskStore();
  const selected = useMemo(
    () => tasks.find((t) => t.id === ui.selectedTaskId) ?? null,
    [tasks, ui.selectedTaskId],
  );

  if (!ui.sheetOpen) return null;

  return (
    <View style={styles.shell} pointerEvents="box-none">
      <View style={styles.handleBar}>
        <Pressable
          style={styles.handleMain}
          onPress={() => TaskStore.toggleSheet()}
          accessibilityRole="button"
          accessibilityLabel={t('panel.collapseA11y', { name: branding.name })}
        >
          <View style={styles.handleGrip} />
          <Text style={styles.handleTitle}>
            {branding.name}{tasks.length ? ` · ${tasks.length}` : ''}
          </Text>
        </Pressable>
        <Pressable
          hitSlop={12}
          onPress={() => TaskStore.closeSheet()}
          style={styles.hideBtn}
          accessibilityLabel={t('panel.closeA11y', { name: branding.name })}
        >
          <Text style={styles.hideText}>{t('panel.close')}</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
          <Text style={styles.sectionLabel}>{t('panel.tasks')}</Text>
          <ScrollView style={styles.taskList} nestedScrollEnabled>
            {tasks.length === 0 ? (
              <Text style={styles.empty}>{t('panel.emptyTasks')}</Text>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === ui.selectedTaskId}
                  onPress={() => TaskStore.selectTask(task.id)}
                />
              ))
            )}
          </ScrollView>

          {selected ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>{t('panel.session', { title: selected.title })}</Text>
              <ScrollView style={styles.nodeList} nestedScrollEnabled>
                {selected.nodes.map((node) => (
                  <NodeRow key={node.id} node={node} />
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
  },
  handleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 180,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(28,28,30,0.92)',
  },
  handleMain: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 4,
  },
  handleGrip: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignSelf: 'center',
    marginBottom: 6,
  },
  handleTitle: {
    color: '#F2F2F7',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  hideBtn: {
    paddingLeft: 8,
    paddingVertical: 8,
  },
  hideText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
  panel: {
    marginTop: 8,
    maxHeight: 360,
    borderRadius: 16,
    backgroundColor: 'rgba(22,22,24,0.96)',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  taskList: {
    maxHeight: 140,
  },
  nodeList: {
    maxHeight: 180,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    paddingVertical: 12,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  taskRowSelected: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  taskMeta: {
    flex: 1,
  },
  taskTitle: {
    color: '#F5F5F7',
    fontSize: 14,
    fontWeight: '600',
  },
  taskSub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
  },
  chevron: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    marginLeft: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 8,
  },
  nodeRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  nodeTime: {
    width: 58,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  nodeBody: {
    flex: 1,
  },
  nodeKind: {
    color: '#8AE0FF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  nodeTitle: {
    color: '#F5F5F7',
    fontSize: 13,
    lineHeight: 18,
  },
  nodeDetail: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
});
