import { AccessibilityInfo, PermissionsAndroid, Platform, Vibration } from 'react-native';

let lastEpisode: string | null = null;

/** One notification per wait episode, including across chrome remounts. */
export function notifyUserHandoff(taskId: string, episode: number, announcement: string): void {
  const key = `${taskId}:${episode}`;
  if (lastEpisode === key) return;
  lastEpisode = key;
  // A host/device can omit haptics or disable them in system settings. Neither
  // that nor an unavailable accessibility service may interrupt local waiting.
  const vibrate = () => {
    if (lastEpisode !== key) return;
    try { Vibration?.vibrate?.(120, false); } catch { /* keep the visible notice */ }
  };
  if (Platform?.OS === 'android') {
    // A JS-only update can run over an older native package without VIBRATE.
    // Avoid sending a native call that could throw on the bridge thread.
    try {
      void PermissionsAndroid?.check?.('android.permission.VIBRATE' as Parameters<typeof PermissionsAndroid.check>[0])
        .then(granted => { if (granted) vibrate(); }).catch(() => {});
    } catch { /* optional host permission service */ }
  } else {
    vibrate();
  }
  try { AccessibilityInfo?.announceForAccessibility?.(announcement); } catch { /* optional service */ }
}
