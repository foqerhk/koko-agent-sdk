import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useSyncExternalStore } from 'react';
import type {
  KokoAccountSnapshot,
  KokoAgentConfig,
  KokoBrandingConfig,
  KokoLocale,
  KokoTheme,
} from '../types';
import { AccountStore } from '../commercial/AccountStore';
import {
  resolveBranding,
  type ResolvedBranding,
} from '../commercial/branding';
import { UsageBus } from '../commercial/UsageBus';
import { normalizeLocale, t, type MessageKey } from '../i18n';
import {
  HostAppearanceStore,
  invertTheme,
  resolveThemeColors,
  type KokoThemeColors,
} from './HostAppearanceStore';

export type KokoUiContextValue = {
  locale: KokoLocale;
  /** Theme Koko chrome paints in — the inverse of `appTheme`. */
  theme: KokoTheme;
  /** What the host App itself is running, as reported by the host. */
  appTheme: KokoTheme;
  colors: KokoThemeColors;
  branding: ResolvedBranding;
  account: KokoAccountSnapshot | null;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const KokoUiContext = createContext<KokoUiContextValue | null>(null);

function subscribeAccount(cb: () => void) {
  return AccountStore.subscribe(() => cb());
}

function getAccountSnapshot() {
  return AccountStore.get();
}

function subscribeAppearance(cb: () => void) {
  return HostAppearanceStore.subscribe(cb);
}

function getAppearanceSnapshot() {
  return HostAppearanceStore.get();
}

export function KokoUiProvider({
  config,
  children,
}: {
  config?: KokoAgentConfig;
  children: ReactNode;
}) {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceSnapshot,
  );
  const locale = normalizeLocale(appearance.locale ?? config?.locale);
  // `theme` names the host App's theme; chrome takes the other one so it stays
  // readable against the App behind it. Absent a report, assume a light App —
  // that keeps chrome dark, as it has always been.
  const appTheme: KokoTheme = appearance.theme ?? config?.theme ?? 'light';
  const theme = invertTheme(appTheme);
  const colors = useMemo(() => resolveThemeColors(theme), [theme]);
  const account = useSyncExternalStore(
    subscribeAccount,
    getAccountSnapshot,
    getAccountSnapshot,
  );
  const downgradeEmitted = useRef(false);

  useEffect(() => {
    const unsub = config?.onUsageEvent
      ? UsageBus.subscribe(config.onUsageEvent)
      : undefined;
    return () => {
      unsub?.();
    };
  }, [config?.onUsageEvent]);

  useEffect(() => {
    const gateway = config?.gateway;
    if (!gateway?.token && !gateway?.tokenProvider) return;
    void AccountStore.refresh({
      ...gateway,
    });
  }, [config?.gateway?.token, config?.gateway?.tokenProvider, config?.gateway?.baseUrl, config?.gateway?.appId]);

  const branding = useMemo(
    () =>
      resolveBranding(
        locale,
        config?.branding as KokoBrandingConfig | undefined,
        account?.entitlements,
      ),
    [locale, config?.branding, account?.entitlements],
  );

  useEffect(() => {
    if (branding.downgraded && !downgradeEmitted.current) {
      downgradeEmitted.current = true;
      UsageBus.emit({
        type: 'branding_downgraded',
        reason: 'missing_entitlement',
        at: Date.now(),
      });
    }
    if (!branding.downgraded) downgradeEmitted.current = false;
  }, [branding.downgraded]);

  const value = useMemo<KokoUiContextValue>(
    () => ({
      locale,
      theme,
      appTheme,
      colors,
      branding,
      account,
      t: (key, vars) => t(locale, key, vars),
    }),
    [locale, theme, appTheme, colors, branding, account],
  );

  return (
    <KokoUiContext.Provider value={value}>{children}</KokoUiContext.Provider>
  );
}

export function useKokoUi(): KokoUiContextValue {
  const ctx = useContext(KokoUiContext);
  if (!ctx) {
    const locale: KokoLocale = 'en';
    const appTheme: KokoTheme = 'light';
    const theme = invertTheme(appTheme);
    return {
      locale,
      theme,
      appTheme,
      colors: resolveThemeColors(theme),
      branding: resolveBranding(locale, undefined, undefined),
      account: null,
      t: (key, vars) => t(locale, key, vars),
    };
  }
  return ctx;
}
