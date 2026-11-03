import type {
  KokoAccountSnapshot,
  KokoBrandingConfig,
  KokoEntitlements,
  KokoLocale,
  KokoUsageEvent,
} from '../types';
import { t } from '../i18n';

export const DEFAULT_ENTITLEMENTS: KokoEntitlements = {
  custom_branding: false,
  locale: true,
};

export type ResolvedBranding = {
  name: string;
  /** Letter shown when no image icon. */
  mark: string;
  /** Image source when host provided a require()/uri icon and entitlement allows. */
  iconSource: number | { uri: string } | null;
  tagline: string;
  placeholder: string;
  primaryColor: string;
  /** True when host asked for custom branding but plan denied it. */
  downgraded: boolean;
};

const DEFAULT_PRIMARY = '#0A84FF';

function wantsCustomBranding(branding?: KokoBrandingConfig): boolean {
  if (!branding) return false;
  return Boolean(
    (branding.name && branding.name.trim() && branding.name.trim() !== 'Koko') ||
      branding.icon != null ||
      (branding.tagline && branding.tagline.trim()) ||
      (branding.placeholder && branding.placeholder.trim()) ||
      (branding.primaryColor && branding.primaryColor.trim()),
  );
}

/**
 * Resolve what the **built-in** chat UI may show.
 * This is a soft client gate for honest hosts + official gateway.
 * Forked SDKs / custom chrome can always draw their own brand — that is outside
 * this product surface. Usage metering remains server-authoritative.
 */
export function resolveBranding(
  locale: KokoLocale,
  branding: KokoBrandingConfig | undefined,
  entitlements: KokoEntitlements | undefined,
): ResolvedBranding {
  const allowed = entitlements?.custom_branding === true;
  const custom = wantsCustomBranding(branding);
  const downgraded = custom && !allowed;
  const useCustom = custom && allowed;

  let iconSource: number | { uri: string } | null = null;
  let mark = t(locale, 'brand.defaultMark');
  if (useCustom && branding?.icon != null) {
    if (typeof branding.icon === 'string') {
      if (/^https?:\/\//i.test(branding.icon) || branding.icon.startsWith('data:')) {
        iconSource = { uri: branding.icon };
      } else {
        mark = branding.icon.slice(0, 2);
      }
    } else {
      iconSource = branding.icon;
    }
  }

  return {
    name: useCustom && branding?.name?.trim() ? branding.name.trim() : t(locale, 'brand.defaultName'),
    mark,
    iconSource,
    tagline:
      useCustom && branding?.tagline?.trim()
        ? branding.tagline.trim()
        : t(locale, 'brand.defaultTagline'),
    placeholder:
      useCustom && branding?.placeholder?.trim()
        ? branding.placeholder.trim()
        : t(locale, 'brand.defaultPlaceholder'),
    primaryColor:
      useCustom && branding?.primaryColor?.trim()
        ? branding.primaryColor.trim()
        : DEFAULT_PRIMARY,
    downgraded,
  };
}

export function emptyAccount(): KokoAccountSnapshot {
  return {
    plan: 'free',
    entitlements: { ...DEFAULT_ENTITLEMENTS },
    quota: { daily: 30, used_today: 0, remaining: 30 },
  };
}
