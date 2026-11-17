import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useKokoAgent } from '../provider/KokoProvider';
import { TaskStore } from '../task/TaskStore';
import { useTaskStore } from '../task/useTaskStore';
import { useKokoUi } from '../provider/KokoUiContext';
import { message, type LocalizedText } from '../i18n';

export type KokoComposerProps = {
  /** Placeholder for the natural-language input. */
  placeholder?: string;
  /** Disable while true (in addition to running task). */
  disabled?: boolean;
};

/**
 * Natural-language dialog (需求 §1.1 / §3.5):
 * 用户自由输入一句话 → 云端 Agent → 本 App 内 dump/find/tap，字幕与任务可观测。
 */
export function KokoComposer({
  placeholder,
  disabled = false,
}: KokoComposerProps) {
  const koko = useKokoAgent();
  const { branding, t } = useKokoUi();
  const { tasks, activeTaskId } = useTaskStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<LocalizedText | null>(null);

  const running =
    busy || tasks.some((t) => t.id === activeTaskId && t.status === 'running');

  const onSend = useCallback(async () => {
    const goal = text.trim();
    if (!goal || running || disabled) return;

    setBusy(true);
    setHint(null);
    setText('');
    TaskStore.openSheet();

    try {
      const out = await koko.runGoal(goal, {
        onNarration: (line) => setHint(line),
      });
      setHint(out.success ? out.summary : message('composer.incomplete', { summary: out.summary }));
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [text, running, disabled, koko]);

  const onStop = useCallback(() => {
    koko.stop();
    koko.finishTask('cancelled', t('runtime.cancelled'));
    setBusy(false);
    setHint(message('composer.stopped'));
  }, [koko, t]);

  return (
    <View style={styles.wrap}>
      {hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {typeof hint === 'string' ? hint : t(hint.key, hint.vars)}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? branding.placeholder}
          placeholderTextColor="rgba(255,255,255,0.35)"
          editable={!running && !disabled}
          returnKeyType="send"
          onSubmitEditing={onSend}
          blurOnSubmit={false}
          accessibilityLabel={t('sheet.inputA11y')}
        />
        {running ? (
          <Pressable
            style={[styles.btn, styles.btnStop]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel={t('sheet.stopA11y')}
          >
            <Text style={styles.btnText}>{t('composer.stop')}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.btn,
              styles.btnSend,
              (!text.trim() || disabled) && styles.btnDisabled,
            ]}
            onPress={onSend}
            disabled={!text.trim() || disabled}
            accessibilityRole="button"
            accessibilityLabel={t('sheet.send')}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>{t('sheet.send')}</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginBottom: 8,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  input: {
    flex: 1,
    color: '#F5F5F7',
    fontSize: 15,
    paddingVertical: 10,
    maxHeight: 88,
  },
  btn: {
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSend: {
    backgroundColor: '#0A84FF',
  },
  btnStop: {
    backgroundColor: '#FF453A',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
