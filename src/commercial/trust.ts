/**
 * Gateway host policy + entitlement trust.
 *
 * Customers always use official Intent Computing hosts in release apps.
 * Localhost is allowed only in Metro debug clients (so we can dogfood the
 * in-repo gateway) — that is NOT a supported "self-host your own AI" mode.
 */

// `agent.intentcomputing.net` is a different Intent Computing service and must
// not be trusted as a gateway.
const OFFICIAL_HOST_SUFFIXES = [
  'sdk.intentcomputing.cn',
  'sdk.intentcomputing.net',
];

export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '10.0.2.2' ||
    host === '0.0.0.0'
  );
}

export function isOfficialGatewayHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return OFFICIAL_HOST_SUFFIXES.some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
}

/** Hosts whose /v1/me branding claims we trust. */
export function isTrustedEntitlementHost(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    return isOfficialGatewayHost(u.hostname) || isLocalDevHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * @param allowLocalLab when true (Metro debug client only), localhost/LAN OK.
 */
export function isAllowedGatewayUrl(
  baseUrl: string,
  allowLocalLab: boolean,
): { ok: true } | { ok: false; reason: string } {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    if (isOfficialGatewayHost(u.hostname)) return { ok: true };
    if (allowLocalLab && isLocalDevHost(u.hostname)) return { ok: true };
    if (allowLocalLab) {
      const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname);
      if (ipv4) return { ok: true };
    }
    return {
      ok: false,
      reason: allowLocalLab
        ? `unsupported gateway host: ${u.hostname}`
        : `unsupported gateway host: ${u.hostname}`,
    };
  } catch {
    return { ok: false, reason: 'invalid gateway.baseUrl' };
  }
}
