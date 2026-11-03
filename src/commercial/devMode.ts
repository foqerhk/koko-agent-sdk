import type { KokoAgentConfig } from '../types';

/** True only in Metro debug clients (never in store release binaries). */
export function isMetroDevBuild(): boolean {
  try {
    // eslint-disable-next-line no-undef
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
  } catch {
    return false;
  }
}

/**
 * Verbose SDK / agent execution logs for developers.
 * Does NOT relax security (permits, gateway allowlist).
 *
 * On when:
 * - `config.debug === true`, or
 * - Metro `__DEV__` and `config.debug !== false`
 *
 * Release builds: only if host explicitly sets `debug: true`
 * (logs only — still cannot use localhost gateway or skip permits).
 */
export function resolveDebugLogging(
  config?: Pick<KokoAgentConfig, 'debug' | 'devMode'>,
): boolean {
  if (config?.debug === true || config?.devMode === true) return true;
  if (config?.debug === false || config?.devMode === false) return false;
  return isMetroDevBuild();
}

/**
 * @deprecated Use resolveDebugLogging. Kept for call-site migration.
 * Previously also meant "relax security" — that behavior is removed.
 */
export function resolveDevMode(
  config?: Pick<KokoAgentConfig, 'debug' | 'devMode'>,
): boolean {
  return resolveDebugLogging(config);
}

/**
 * Localhost / LAN gateway is only for Intent Computing debugging the
 * in-repo gateway against a Metro debug app — not a customer "self-host" mode.
 */
export function allowLocalGatewayForDebugClient(): boolean {
  return isMetroDevBuild();
}
