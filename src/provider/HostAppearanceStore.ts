import type { KokoLocale } from '../types';

export type KokoTheme = 'light' | 'dark';

export type KokoAppearance = {
  locale?: string | null;
  /**
   * The **host App's** theme, not the SDK's.
   *
   * Koko chrome floats on top of the host UI, so it renders in the opposite
   * theme: a pill in the App's own colors disappears into the screen behind
   * it. Report what the App is using and the SDK picks the contrasting side.
   */
  theme?: KokoTheme | null;
};

type Listener = () => void;

/**
 * Runtime host appearance (locale / theme). Prefer this over static
 * `config.locale` / `config.theme` so the host can follow its own settings.
 */
class HostAppearanceStoreImpl {
  private state: KokoAppearance = {};
  private listeners = new Set<Listener>();

  get(): KokoAppearance {
    return this.state;
  }

  set(partial: KokoAppearance) {
    const next: KokoAppearance = {
      locale:
        partial.locale !== undefined ? partial.locale : this.state.locale,
      theme: partial.theme !== undefined ? partial.theme : this.state.theme,
    };
    if (next.locale === this.state.locale && next.theme === this.state.theme) {
      return;
    }
    this.state = next;
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const HostAppearanceStore = new HostAppearanceStoreImpl();

/** Imperative API for hosts (OneKey / shop / etc.). */
export function setKokoAppearance(partial: KokoAppearance) {
  HostAppearanceStore.set(partial);
}

export function getKokoAppearance(): KokoAppearance {
  return HostAppearanceStore.get();
}

export type KokoThemeColors = {
  mode: KokoTheme;
  sheetBg: string;
  overlay: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  inputBg: string;
  chipBg: string;
  userBubble: string;
  handle: string;
  progressBg: string;
  progressText: string;
  dialogBg: string;
  statusBar: 'light-content' | 'dark-content';
};

const DARK: KokoThemeColors = {
  mode: 'dark',
  sheetBg: '#121316',
  overlay: 'rgba(8, 10, 14, 0.58)',
  text: '#F5F5F7',
  textSecondary: 'rgba(255,255,255,0.72)',
  textMuted: 'rgba(255,255,255,0.45)',
  border: 'rgba(255,255,255,0.1)',
  inputBg: 'rgba(255,255,255,0.06)',
  chipBg: 'rgba(255,255,255,0.05)',
  userBubble: 'rgba(10,132,255,0.18)',
  handle: 'rgba(255,255,255,0.22)',
  progressBg: 'rgba(20,20,22,0.94)',
  progressText: '#fff',
  dialogBg: '#1C1C1E',
  statusBar: 'light-content',
};

const LIGHT: KokoThemeColors = {
  mode: 'light',
  sheetBg: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.48)',
  text: '#111827',
  textSecondary: 'rgba(17,24,39,0.72)',
  textMuted: 'rgba(17,24,39,0.45)',
  border: 'rgba(17,24,39,0.1)',
  inputBg: 'rgba(17,24,39,0.05)',
  chipBg: 'rgba(17,24,39,0.04)',
  userBubble: 'rgba(10,132,255,0.12)',
  handle: 'rgba(17,24,39,0.18)',
  progressBg: 'rgba(255,255,255,0.96)',
  progressText: '#111827',
  dialogBg: '#FFFFFF',
  statusBar: 'dark-content',
};

export function resolveThemeColors(theme?: KokoTheme | null): KokoThemeColors {
  return theme === 'light' ? LIGHT : DARK;
}

/**
 * Theme for Koko chrome, given the host App's theme.
 *
 * Inverted on purpose: the progress pill, chat sheet and dialogs sit above the
 * host UI as a distinct surface. Matching the App makes them blend into
 * whatever is behind them; opposing it keeps the boundary obvious.
 *
 * A host that reports nothing is assumed light, which keeps chrome dark — the
 * SDK's long-standing default.
 */
export function invertTheme(appTheme?: KokoTheme | null): KokoTheme {
  return appTheme === 'dark' ? 'light' : 'dark';
}

/** Chrome colors for a host App running `appTheme`. */
export function resolveChromeColors(
  appTheme?: KokoTheme | null,
): KokoThemeColors {
  return resolveThemeColors(invertTheme(appTheme));
}

/** Resolve effective locale: host appearance → config → en. */
export function resolveEffectiveLocale(
  hostLocale: string | null | undefined,
  configLocale: KokoLocale | string | null | undefined,
): string | null | undefined {
  return hostLocale ?? configLocale;
}
