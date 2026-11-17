import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useKokoUi } from '../provider/KokoUiContext';
import { KokoOverlayLayer } from './KokoOverlayLayer';

export type ConfirmRequest = {
  id: string;
  title: string;
  message: string;
  resolve: (ok: boolean) => void;
};

export type AskRequest = {
  id: string;
  question: string;
  resolve: (answer: string | null) => void;
};

type Listener = (state: { confirm: ConfirmRequest | null; ask: AskRequest | null }) => void;

class DialogBusImpl {
  confirm: ConfirmRequest | null = null;
  ask: AskRequest | null = null;
  private listeners = new Set<Listener>();

  subscribe(l: Listener) {
    this.listeners.add(l);
    l({ confirm: this.confirm, ask: this.ask });
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit() {
    for (const l of this.listeners) l({ confirm: this.confirm, ask: this.ask });
  }

  requestConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirm = {
        id: `c_${Date.now()}`,
        title,
        message,
        resolve: (ok) => {
          this.confirm = null;
          this.emit();
          resolve(ok);
        },
      };
      this.emit();
    });
  }

  requestAsk(question: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.ask = {
        id: `a_${Date.now()}`,
        question,
        resolve: (answer) => {
          this.ask = null;
          this.emit();
          resolve(answer);
        },
      };
      this.emit();
    });
  }
}

export const DialogBus = new DialogBusImpl();

/**
 * Built-in confirm + ask-user modal. Mounted by KokoProvider.
 */
export function KokoDialogHost() {
  const { t, branding, colors } = useKokoUi();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [ask, setAsk] = useState<AskRequest | null>(null);
  const [answer, setAnswer] = useState('');

  useEffect(
    () =>
      DialogBus.subscribe((s) => {
        setConfirm(s.confirm);
        setAsk(s.ask);
        if (!s.ask) setAnswer('');
      }),
    [],
  );

  const onConfirm = useCallback((ok: boolean) => {
    confirm?.resolve(ok);
  }, [confirm]);

  const onAskSubmit = useCallback(() => {
    ask?.resolve(answer.trim() || null);
  }, [ask, answer]);

  const onAskCancel = useCallback(() => {
    ask?.resolve(null);
  }, [ask]);

  const visible = Boolean(confirm || ask);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {
      if (confirm) onConfirm(false);
      else onAskCancel();
    }}>
      <KokoOverlayLayer
        pointerEvents="auto"
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.dialogBg, borderColor: colors.border },
          ]}
        >
          {confirm ? (
            <>
              <Text style={[styles.title, { color: colors.text }]}>{confirm.title}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {confirm.message}
              </Text>
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => onConfirm(false)}>
                  <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>
                    {t('dialog.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, { backgroundColor: branding.primaryColor }]}
                  onPress={() => onConfirm(true)}
                >
                  <Text style={styles.btnPrimaryText}>{t('dialog.confirm')}</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {ask ? (
            <>
              <Text style={[styles.title, { color: colors.text }]}>{t('dialog.askTitle')}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{ask.question}</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    backgroundColor: colors.inputBg,
                    borderColor: colors.border,
                  },
                ]}
                value={answer}
                onChangeText={setAnswer}
                placeholder={t('dialog.askPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={onAskCancel}>
                  <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>
                    {t('dialog.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, { backgroundColor: branding.primaryColor }]}
                  onPress={onAskSubmit}
                >
                  <Text style={styles.btnPrimaryText}>{t('dialog.continue')}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </KokoOverlayLayer>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    padding: 20,
  },
  title: {
    color: '#F5F5F7',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  btnGhostText: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: '#0A84FF',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
});
