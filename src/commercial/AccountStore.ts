import { GatewayClient, type GatewayConfig } from '../client/GatewayClient';
import type { KokoAccountSnapshot, KokoEntitlements, KokoPlanId } from '../types';
import { DEFAULT_ENTITLEMENTS, emptyAccount } from './branding';
import { isTrustedEntitlementHost } from './trust';
import { resolveGatewayBaseUrl } from '../client/GatewayClient';

type Listener = (account: KokoAccountSnapshot | null) => void;

function stripUntrustedBranding(
  account: KokoAccountSnapshot,
  baseUrl: string,
): KokoAccountSnapshot {
  if (isTrustedEntitlementHost(baseUrl)) return account;
  return {
    ...account,
    entitlements: {
      ...account.entitlements,
      custom_branding: false,
    },
  };
}

class AccountStoreImpl {
  private account: KokoAccountSnapshot | null = null;
  private listeners = new Set<Listener>();
  private inflight: Promise<KokoAccountSnapshot | null> | null = null;

  get(): KokoAccountSnapshot | null {
    return this.account;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.account);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const l of this.listeners) l(this.account);
  }

  async refresh(gateway: GatewayConfig): Promise<KokoAccountSnapshot | null> {
    if (this.inflight) return this.inflight;
    let baseUrl: string;
    try {
      baseUrl = resolveGatewayBaseUrl(gateway);
    } catch {
      if (!this.account) {
        this.account = emptyAccount();
        this.emit();
      }
      return this.account;
    }
    this.inflight = (async () => {
      try {
        const client = new GatewayClient(gateway);
        const me = await client.me();
        this.account = stripUntrustedBranding(me, baseUrl);
        this.emit();
        return this.account;
      } catch {
        if (!this.account) {
          this.account = emptyAccount();
          this.emit();
        }
        return this.account;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  entitlements(): KokoEntitlements {
    return this.account?.entitlements ?? { ...DEFAULT_ENTITLEMENTS };
  }

  plan(): KokoPlanId {
    return this.account?.plan ?? 'free';
  }
}

export const AccountStore = new AccountStoreImpl();
