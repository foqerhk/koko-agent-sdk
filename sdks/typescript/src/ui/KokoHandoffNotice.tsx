import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useKokoUi } from '../provider/KokoUiContext';

/** Persistent instructions, with no backdrop intercepting host interactions. */
export function KokoHandoffNotice({
  message,
  feedback,
  onCheck,
  onStop,
  returnToApp = false,
}: {
  message: string;
  feedback?: string;
  onCheck: () => void;
  onStop: () => void;
  returnToApp?: boolean;
}) {
  const { t, colors, branding } = useKokoUi();
  const [collapsed, setCollapsed] = useState(false);
  if (collapsed && !returnToApp) {
    return (
      <Pressable style={[styles.compact, { backgroundColor: colors.progressBg }]}
        onPress={() => setCollapsed(false)} accessibilityRole="button"
        accessibilityLabel={t('gate.expand')}>
        <Text style={[styles.title, { color: colors.progressText }]}>{t('gate.title')} ▾</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.progressBg }]} testID="koko-agent-overlay-handoff">
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.progressText }]} accessibilityRole="header">{t('gate.title')}</Text>
        {!returnToApp ? <Pressable onPress={() => setCollapsed(true)} hitSlop={8}
          accessibilityRole="button" accessibilityLabel={t('gate.collapse')}>
          <Text style={[styles.secondary, { color: colors.progressText }]}>{t('gate.collapse')}</Text>
        </Pressable> : null}
      </View>
      <ScrollView style={styles.instructions} nestedScrollEnabled>
        <Text style={[styles.message, { color: colors.progressText }]} accessibilityLiveRegion="polite">{message}</Text>
        <Text style={[styles.hint, { color: colors.progressText }]}>{t('gate.inAppHint')}</Text>
      </ScrollView>
      {feedback ? <Text style={styles.feedback} accessibilityLiveRegion="polite">{feedback}</Text> : null}
      <View style={styles.actions}>
        <Pressable onPress={onCheck} accessibilityRole="button"
          style={[styles.primary, { backgroundColor: branding.primaryColor }]}>
          <Text style={styles.primaryText}>{t(returnToApp ? 'gate.returnToApp' : 'gate.check')}</Text>
        </Pressable>
        <Pressable onPress={onStop} accessibilityRole="button" style={styles.stop}>
          <Text style={[styles.secondary, { color: colors.progressText }]}>{t('gate.stop')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: '#F5B942', elevation: 12,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  secondary: { fontSize: 13, fontWeight: '600' },
  instructions: { marginTop: 8, maxHeight: 140 },
  message: { fontSize: 14, lineHeight: 20 },
  hint: { marginTop: 6, fontSize: 12, lineHeight: 17, opacity: 0.8 },
  feedback: { color: '#F5B942', fontSize: 12, lineHeight: 17, marginTop: 8 },
  actions: { marginTop: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  primary: { flex: 1, minHeight: 44, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 10,
    alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  stop: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  compact: { alignSelf: 'flex-end', borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: '#F5B942', elevation: 12 },
});
