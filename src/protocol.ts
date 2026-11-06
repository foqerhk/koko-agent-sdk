/** Public SDK release version. Keep in sync with package.json. */
export const KOKO_SDK_VERSION = '1.2.0';

/** HTTP contract major. Breaking changes require a new /vN namespace. */
export const KOKO_PROTOCOL_VERSION = 1;

/** Capabilities this SDK can safely consume. */
export const KOKO_SDK_CAPABILITIES = [
  'short-lived-token',
  'execution-permit-v1',
  'upgrade-required-v1',
] as const;

export type KokoSdkCapability = (typeof KOKO_SDK_CAPABILITIES)[number];

export type KokoProtocolInfo = {
  current: number;
  supported: number[];
};

export type KokoSdkCompatibilityInfo = {
  minimum: string;
  recommended: string;
  force_update_below?: string;
};

export type KokoGatewayCapabilities = {
  ok: true;
  protocol: KokoProtocolInfo;
  sdk: KokoSdkCompatibilityInfo;
  capabilities: string[];
};

export function kokoProtocolHeaders(): Record<string, string> {
  return {
    'X-Koko-SDK-Version': KOKO_SDK_VERSION,
    'X-Koko-Protocol-Version': String(KOKO_PROTOCOL_VERSION),
    'X-Koko-Capabilities': KOKO_SDK_CAPABILITIES.join(','),
  };
}
