import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { CursorOverlay } from '../cursor/CursorOverlay';
import { getKokoAgent, initKokoAgent, type KokoAgent } from '../KokoAgent';
import type { KokoAgentConfig } from '../types';
import { KokoDialogHost } from '../ui/KokoDialogHost';
import { KokoObserver } from '../ui/KokoObserver';
import { KokoRemoteSmoke } from '../debug/KokoRemoteSmoke';
import { KokoUiProvider } from './KokoUiContext';
import { scheduleReloadResume } from './scheduleReloadResume';

const KokoContext = createContext<KokoAgent | null>(null);

export type KokoProviderProps = {
  children: ReactNode;
  config?: KokoAgentConfig;
  /** Show cursor overlay (default true). */
  cursor?: boolean;
  /**
   * Progress pill (running only) + chat sheet host (default true).
   * Idle = nothing visible; open via openKokoChat() from host UI.
   */
  observer?: boolean;
  /**
   * @deprecated Prefer `config.branding.placeholder` (paid entitlement) or locale defaults.
   */
  composerPlaceholder?: string;
  /** Built-in confirm / ask-user dialogs (default true). */
  dialogs?: boolean;
  /**
   * DEV remote smoke driver port (poll `127.0.0.1:<port>/cmd`).
   * Host-agnostic; omit / 0 to disable.
   */
  remoteSmokePort?: number;
  /**
   * Resume a goal that a JS-context restart interrupted (default true).
   *
   * Actions like changing locale or theme can remount the RN root, which kills
   * the run performing them. When that happens the SDK picks the goal back up
   * on the next init and lets the planner finish it from the current screen.
   *
   * This means the agent can act shortly after launch without a fresh user
   * request. Set false if a host would rather drop interrupted runs.
   */
  resumeAfterReload?: boolean;
};

export function KokoProvider({
  children,
  config,
  cursor = true,
  observer,
  composerPlaceholder,
  dialogs = true,
  remoteSmokePort,
  resumeAfterReload = true,
}: KokoProviderProps) {
  const mergedConfig = useMemo<KokoAgentConfig | undefined>(() => {
    if (!config && !composerPlaceholder) return config;
    return {
      ...config,
      branding: {
        ...config?.branding,
        placeholder: config?.branding?.placeholder ?? composerPlaceholder,
      },
    };
  }, [config, composerPlaceholder]);

  const agent = useMemo(() => {
    if (mergedConfig) return initKokoAgent(mergedConfig);
    return getKokoAgent();
  }, [mergedConfig]);

  const showObserver = observer ?? mergedConfig?.observer !== false;
  const smokePort = remoteSmokePort ?? 0;

  const resumeTried = useRef(false);
  useEffect(() => {
    if (!resumeAfterReload) return;
    return scheduleReloadResume(agent, resumeTried);
  }, [agent, resumeAfterReload]);

  return (
    <KokoContext.Provider value={agent}>
      <KokoUiProvider config={mergedConfig}>
        <View style={styles.root}>
          {children}
          {/* Cursor lives inside KokoObserver's single overlay Modal when observer is on. */}
          {cursor && !showObserver ? <CursorOverlay /> : null}
          {showObserver ? <KokoObserver cursor={cursor} /> : null}
          {dialogs ? <KokoDialogHost /> : null}
          {smokePort > 0 ? <KokoRemoteSmoke port={smokePort} /> : null}
        </View>
      </KokoUiProvider>
    </KokoContext.Provider>
  );
}

export function useKokoAgent(): KokoAgent {
  const ctx = useContext(KokoContext);
  return ctx ?? getKokoAgent();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
