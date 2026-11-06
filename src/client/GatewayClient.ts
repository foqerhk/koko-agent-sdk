import { AppUserGateStore } from '../privacy/userGate';
import type { AgentAction, Point, Selector } from '../types';
import type { KokoAccountSnapshot, KokoEntitlements, KokoPlanId } from '../types';
import { isAllowedGatewayUrl } from '../commercial/trust';
import { allowLocalGatewayForDebugClient } from '../commercial/devMode';
import { NativeBridge } from '../native/NativeBridge';
import { sensitiveScreenKind, SensitiveScreenError } from '../privacy/sensitiveScreen';
import { redactOutbound, redactViewTreeClient, viewTreeOutline } from '../privacy/redact';
import { extractAffordances, screenModelText } from '../privacy/screenModel';
import { buildOnDeviceAssistSync } from '../assist/OnDeviceAssist';
import { HostActionsStore, filterVisibleHostActions, hostActionsModelText } from '../host/HostActions';
import { ExplorationGraph, exploreHintsModelText, goalExploreQuery } from '../explore/ExplorationGraph';
import { findNodeById } from '../selector/match';
import { goalOcrCandidates, visibleWebViewFrames, PUBLIC_WALLET_CHOICES, walletConnectionAllowed } from '../assist/ocrTarget';
import type { ViewNode } from '../types';
import {
  kokoProtocolHeaders,
  type KokoGatewayCapabilities,
} from '../protocol';

export type GatewayConfig = {
  /**
   * Official gateway origin. Defaults to https://sdk.intentcomputing.net
   * Localhost only in Metro debug clients (lab dogfood), not customer self-host.
   */
  baseUrl?: string;
  /**
   * App / member token from your product backend or dashboard.
   * Never an LLM API key — users never see model keys.
   */
  /**
   * Legacy static app token. Suitable for local development and migration,
   * but production apps should use `tokenProvider` so no long-lived secret is
   * shipped in the mobile bundle.
   */
  token?: string;
  /**
   * Supplies a short-lived access token obtained from the host backend.
   * The SDK caches it until shortly before expiry and retries once on 401.
   */
  tokenProvider?: KokoTokenProvider;
  /**
   * Host App ID (iOS bundle id / Android package name).
   * Defaults to the native module's hostAppId. Must match the App ID bound to the token.
   */
  appId?: string;
};

export type KokoTokenResult =
  | string
  | {
      accessToken: string;
      /** Unix time in milliseconds. Omit when the token contains a JWT `exp`. */
      expiresAt?: number;
    };

export type KokoTokenProvider = () => Promise<KokoTokenResult>;

const DEFAULT_GATEWAY = 'https://sdk.intentcomputing.net';

export function resolveGatewayBaseUrl(cfg: GatewayConfig): string {
  const raw = (cfg.baseUrl?.trim() || DEFAULT_GATEWAY).replace(/\/$/, '');
  const check = isAllowedGatewayUrl(raw, allowLocalGatewayForDebugClient());
  if (!check.ok) {
    throw new Error(`KokoAgent: ${check.reason}`);
  }
  return raw;
}

export type AgentHistoryItem = {
  tool: string;
  args?: Record<string, unknown>;
  result: string;
  ok?: boolean;
};

export type GatewayNextRequest = {
  session_id?: string;
  goal: string;
  ui_tree?: unknown;
  ui_outline?: string;
  ui_screen_model?: string;
  /** Local-only evidence; gateway serializes only labels derived from goal. */
  local_ocr_goal_labels?: string[];
  local_ocr_wallet_choices?: string[];
  local_web_wallet_aliases?: string[];
  history: AgentHistoryItem[];
  locale?: string;
  user_reply?: string;
  platform?: 'ios' | 'android' | 'unknown';
};

/** Build hints from the same redacted tree that crosses the upload boundary. */
export function safePlannerModel(tree: ViewNode, goal: string, localOcrGoalLabels: string[] = [], localWalletChoices: string[] = [], hostWalletAliases: string[] = []): string {
  const affordances = extractAffordances(tree, 80);
  const labels = affordances.map(a => a.label);
  const hosts = filterVisibleHostActions(HostActionsStore.getActions(), tree).flatMap(action => {
    const visible = affordances.find(a => {
      if (action.testID) return findNodeById(tree, a.nodeId)?.testID === action.testID;
      return [action.label, action.text, ...(action.aliases || [])].some(label => label === a.label);
    });
    if (!visible) return [];
    const kind = ['button', 'tab', 'nav', 'field', 'sheet', 'other'].includes(action.kind || '') ? action.kind : 'button';
    return [{ ...action, kind, label: visible.label, text: visible.label, testID: findNodeById(tree, visible.nodeId)?.testID, aliases: [] }];
  });
  const possibleHints = ExplorationGraph.hintLabelsTowardGoal(labels, goalExploreQuery(goal).targetTokens, 6);
  // Historical pages may contain data no longer visible. Only the current
  // screen's exact public labels may be carried into the request.
  const hints = possibleHints.filter(hint => labels.includes(hint));
  const assist = buildOnDeviceAssistSync(goal, tree);
  const allowedLabels = new Set(goalOcrCandidates(goal));
  const verified = visibleWebViewFrames(tree).length && Array.isArray(localOcrGoalLabels)
    ? [...new Set(localOcrGoalLabels)].filter(label => typeof label === 'string' && allowedLabels.has(label)).slice(0, 6) : [];
  const ocrHints = verified.map(label =>
    `- [local-ocr] A visible web text matched the goal-derived label 「${label}」 on this device. ` +
    'Use find with one text rule to confirm it. When the user requested an action, its returned nodeId can be used to tap. No raw OCR text is included.',
  ).join('\n');
  const allowedChoices = new Set<string>(PUBLIC_WALLET_CHOICES);
  const choices = visibleWebViewFrames(tree).length && walletConnectionAllowed(goal) && Array.isArray(localWalletChoices)
    ? [...new Set(localWalletChoices)].filter(label => allowedChoices.has(label)).slice(0, 8) : [];
  const choiceHint = choices.length >= 2
    ? `- [local-wallet-choices] Visible public wallet options verified on-device: ${choices.join(', ')}. Use find with the exact option label; actual authorization stays with the user.`
    : '';
  const aliases = Array.isArray(hostWalletAliases) ? hostWalletAliases.filter(label => choices.includes(label)) : [];
  const aliasHint = aliases.length ? `- [host-wallet-alias] Host confirms its injected wallet appears as: ${aliases.join(', ')}. Select that visible option for the host wallet.` : '';
  const unavailableHint = choices.length >= 2 && hostWalletAliases.length && !aliases.length
    ? '- [host-wallet-unavailable] None of the visible options matches the host wallet. Do not select a different wallet. If the host browser offers a desktop-site mode, try it and recheck the wallet chooser; otherwise report the unavailable option.' : '';
  const extras = [hostActionsModelText(hosts), exploreHintsModelText(hints), assist.modelText, ocrHints, choiceHint, aliasHint, unavailableHint].filter(Boolean).join('\n');
  return screenModelText(tree, 40, extras || undefined);
}

export type GatewayAction =
  | { tool: 'dump'; args?: { reason?: string } }
  | { tool: 'find'; args: { match: Array<Record<string, unknown>>; index?: number } }
  | {
      tool: 'tap';
      args: {
        selector?: Selector;
        nodeId?: string;
        /** Last-resort window point when the control is visible but not in the tree. */
        point?: Point;
        label?: string;
      };
    }
  | {
      tool: 'swipe';
      args: { from: Point; to: Point; label?: string };
    }
  | {
      tool: 'pinch';
      args: { center: Point; scale: number; label?: string };
    }
  | {
      tool: 'type';
      args: {
        text: string;
        selector?: Selector;
        nodeId?: string;
        clear?: boolean;
        label?: string;
      };
    }
  | { tool: 'ask_user'; args: { question: string } }
  | { tool: 'done'; args: { success: boolean; summary: string } };

export type GatewayNextResponse = {
  ok: true;
  session_id: string;
  narration: string | null;
  action: GatewayAction;
  provider: string;
  model: string;
  step: number;
  region: string;
  execution_permit: string;
};

export type GatewaySessionResponse = {
  ok: true;
  session_id: string;
  execution_permit: string;
};

export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  readonly quota?: KokoAccountSnapshot['quota'];
  readonly plan?: KokoPlanId;

  constructor(
    message: string,
    opts: {
      code: string;
      status: number;
      quota?: KokoAccountSnapshot['quota'];
      plan?: KokoPlanId;
    },
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = opts.code;
    this.status = opts.status;
    this.quota = opts.quota;
    this.plan = opts.plan;
  }
}

export type GatewayUpgradeReason =
  | 'minimum_version'
  | 'emergency_patch'
  | 'unsupported_protocol'
  | 'unversioned_client';

export class GatewayUpgradeRequiredError extends GatewayError {
  readonly currentSdkVersion?: string;
  readonly minimumSdkVersion: string;
  readonly recommendedSdkVersion: string;
  readonly supportedProtocols: number[];
  readonly reason: GatewayUpgradeReason;
  readonly contactDeveloper: boolean;

  constructor(opts: {
    message: string;
    currentSdkVersion?: string;
    minimumSdkVersion?: string;
    recommendedSdkVersion?: string;
    supportedProtocols?: number[];
    reason?: GatewayUpgradeReason;
    contactDeveloper?: boolean;
  }) {
    super(opts.message, { code: 'sdk_upgrade_required', status: 426 });
    this.name = 'GatewayUpgradeRequiredError';
    this.currentSdkVersion = opts.currentSdkVersion;
    this.minimumSdkVersion = opts.minimumSdkVersion || 'unknown';
    this.recommendedSdkVersion = opts.recommendedSdkVersion || this.minimumSdkVersion;
    this.supportedProtocols = opts.supportedProtocols || [];
    this.reason = opts.reason || 'minimum_version';
    this.contactDeveloper = opts.contactDeveloper !== false;
  }
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly tokenProvider?: KokoTokenProvider;
  private readonly appId: string;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private tokenInflight: Promise<string> | null = null;

  constructor(cfg: GatewayConfig) {
    this.baseUrl = resolveGatewayBaseUrl(cfg);
    this.token = cfg.token;
    this.tokenProvider = cfg.tokenProvider;
    this.appId = (cfg.appId?.trim() || NativeBridge.hostAppId() || '').trim();
    if (!this.token && !this.tokenProvider) {
      throw new Error('KokoAgent: gateway.tokenProvider or gateway.token is required');
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getAppId(): string {
    return this.appId;
  }

  private jwtExpiry(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
      const raw = globalThis.atob
        ? globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/') + pad)
        : Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
      const exp = (JSON.parse(raw) as { exp?: unknown }).exp;
      return typeof exp === 'number' ? exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    if (!this.tokenProvider) return this.token || '';
    const now = Date.now();
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt - 30_000 > now) {
      return this.cachedToken.value;
    }
    if (!forceRefresh && this.tokenInflight) return this.tokenInflight;
    const request = (async () => {
      const supplied = await this.tokenProvider!();
      const value = typeof supplied === 'string' ? supplied : supplied.accessToken;
      if (!value?.trim()) throw new Error('KokoAgent: tokenProvider returned an empty access token');
      const explicit = typeof supplied === 'string' ? undefined : supplied.expiresAt;
      const expiresAt = explicit ?? this.jwtExpiry(value) ?? now + 60_000;
      this.cachedToken = { value: value.trim(), expiresAt };
      return value.trim();
    })();
    this.tokenInflight = request;
    try {
      return await request;
    } finally {
      if (this.tokenInflight === request) this.tokenInflight = null;
    }
  }

  private async authHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const token = await this.accessToken(forceRefresh);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...kokoProtocolHeaders(),
    };
    if (this.appId) headers['X-Koko-App-Id'] = this.appId;
    return headers;
  }

  private async authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const send = async (forceRefresh: boolean) => fetch(url, {
      ...init,
      headers: { ...init.headers, ...(await this.authHeaders(forceRefresh)) },
    });
    let res = await send(false);
    if (res.status === 401 && this.tokenProvider) {
      this.cachedToken = null;
      res = await send(true);
    }
    return res;
  }

  private async parseError(res: Response, fallback: string): Promise<never> {
    let json: {
      error?: string;
      message?: string;
      quota?: KokoAccountSnapshot['quota'];
      plan?: KokoPlanId;
      current_sdk_version?: string;
      minimum_sdk_version?: string;
      recommended_sdk_version?: string;
      supported_protocols?: number[];
      reason?: GatewayUpgradeReason;
      contact_developer?: boolean;
    } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      // ignore
    }
    this.throwGatewayError(res.status, json, fallback);
  }

  private throwGatewayError(
    status: number,
    json: {
      error?: string;
      message?: string;
      quota?: KokoAccountSnapshot['quota'];
      plan?: KokoPlanId;
      current_sdk_version?: string;
      minimum_sdk_version?: string;
      recommended_sdk_version?: string;
      supported_protocols?: number[];
      reason?: GatewayUpgradeReason;
      contact_developer?: boolean;
    },
    fallback: string,
  ): never {
    if (status === 426 || json.error === 'sdk_upgrade_required') {
      throw new GatewayUpgradeRequiredError({
        message: json.message || 'SDK upgrade required',
        currentSdkVersion: json.current_sdk_version,
        minimumSdkVersion: json.minimum_sdk_version,
        recommendedSdkVersion: json.recommended_sdk_version,
        supportedProtocols: json.supported_protocols,
        reason: json.reason,
        contactDeveloper: json.contact_developer,
      });
    }
    throw new GatewayError(json.message || json.error || fallback, {
      code: json.error || 'error',
      status,
      quota: json.quota,
      plan: json.plan,
    });
  }

  async health(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/v1/health`, {
      headers: kokoProtocolHeaders(),
    });
    if (!res.ok) await this.parseError(res, `health ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async capabilities(): Promise<KokoGatewayCapabilities> {
    const res = await fetch(`${this.baseUrl}/v1/capabilities`, {
      headers: kokoProtocolHeaders(),
    });
    if (!res.ok) await this.parseError(res, `capabilities ${res.status}`);
    return (await res.json()) as KokoGatewayCapabilities;
  }

  /** Open session + initial execution permit (before first dump). */
  async beginSession(sessionId?: string): Promise<GatewaySessionResponse> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/v1/agent/session`, {
      method: 'POST',
      body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
    });
    if (!res.ok) await this.parseError(res, `session ${res.status}`);
    const json = (await res.json()) as GatewaySessionResponse;
    if (!json.session_id || !json.execution_permit) {
      throw new GatewayError('invalid session response', {
        code: 'invalid_response',
        status: res.status,
      });
    }
    return {
      ok: true,
      session_id: json.session_id,
      execution_permit: json.execution_permit,
    };
  }

  async me(): Promise<KokoAccountSnapshot> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/v1/me`);
    const json = (await res.json()) as {
      ok?: boolean;
      plan?: KokoPlanId;
      region?: string;
      provider?: string;
      entitlements?: Partial<KokoEntitlements>;
      quota?: KokoAccountSnapshot['quota'];
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      this.throwGatewayError(res.status, json, `me ${res.status}`);
    }
    const plan = json.plan || 'free';
    const entitlements: KokoEntitlements = {
      custom_branding: json.entitlements?.custom_branding === true,
      locale: json.entitlements?.locale !== false,
    };
    const daily = json.quota?.daily ?? 0;
    const used = json.quota?.used_today ?? 0;
    return {
      plan,
      region: json.region,
      provider: json.provider,
      entitlements,
      quota: {
        daily,
        used_today: used,
        remaining: json.quota?.remaining ?? Math.max(0, daily - used),
      },
    };
  }

  async usage(limit = 50): Promise<{
    quota: KokoAccountSnapshot['quota'];
    plan: KokoPlanId;
    events: unknown[];
  }> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/v1/usage?limit=${limit}`);
    const json = (await res.json()) as {
      ok?: boolean;
      plan?: KokoPlanId;
      quota?: KokoAccountSnapshot['quota'];
      events?: unknown[];
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      this.throwGatewayError(res.status, json, `usage ${res.status}`);
    }
    return {
      plan: json.plan || 'free',
      quota: json.quota || { daily: 0, used_today: 0, remaining: 0 },
      events: json.events || [],
    };
  }

  async next(body: GatewayNextRequest): Promise<GatewayNextResponse> {
    const supplied = body.ui_tree as ViewNode | undefined;
    let live: ViewNode | undefined;
    if (NativeBridge.isAvailable()) {
      // Fail closed if the current screen cannot be checked. Never send a
      // cached safe screen while a newly presented secret page is visible.
      live = await NativeBridge.dump({ maxDepth: 100 });
    }
    const gate = AppUserGateStore.getHostGate();
    if ((gate && ['recovery_phrase', 'private_key', 'password', 'pin', 'otp', 'secure_input'].includes(gate.kind)) ||
        sensitiveScreenKind(live) || sensitiveScreenKind(supplied)) throw new SensitiveScreenError();
    const safeTree = supplied ? redactViewTreeClient(supplied) : undefined;
    const safeBody = redactOutbound({
      session_id: body.session_id,
      goal: body.goal,
      history: body.history,
      locale: body.locale,
      user_reply: body.user_reply,
      platform: body.platform,
      ui_tree: safeTree,
      // Build every visual hint from the redacted tree, never caller-provided
      // model strings, unverified OCR text or historical off-screen labels.
      ui_outline: safeTree ? viewTreeOutline(safeTree) : undefined,
      ui_screen_model: safeTree ? safePlannerModel(safeTree, body.goal, body.local_ocr_goal_labels, body.local_ocr_wallet_choices, body.local_web_wallet_aliases) : undefined,
    }, [live, supplied]);
    const res = await this.authenticatedFetch(`${this.baseUrl}/v1/agent/next`, {
      method: 'POST',
      body: JSON.stringify(safeBody),
    });
    const json = (await res.json()) as
      | GatewayNextResponse
      | {
          ok: false;
          error: string;
          message?: string;
          quota?: KokoAccountSnapshot['quota'];
          plan?: KokoPlanId;
        };
    if (!res.ok || !('ok' in json) || json.ok !== true) {
      const err = json as {
        error?: string;
        message?: string;
        quota?: KokoAccountSnapshot['quota'];
        plan?: KokoPlanId;
      };
      this.throwGatewayError(res.status, err, `gateway ${res.status}`);
    }
    if (!json.execution_permit) {
      throw new GatewayError('invalid agent response', {
        code: 'invalid_response',
        status: res.status,
      });
    }
    return json;
  }
}

export function toLocalAgentAction(action: GatewayAction): AgentAction | null {
  switch (action.tool) {
    case 'dump':
      return { tool: 'dump' };
    case 'find':
      return {
        tool: 'find',
        args: {
          selector: {
            match: action.args.match as Selector['match'],
            index: action.args.index,
          },
        },
      };
    case 'tap':
      return {
        tool: 'tap',
        args: {
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          point: action.args.point,
          options: undefined,
        },
      };
    case 'swipe':
      return {
        tool: 'swipe',
        args: { from: action.args.from, to: action.args.to },
      };
    case 'pinch':
      return {
        tool: 'pinch',
        args: { center: action.args.center, scale: action.args.scale },
      };
    case 'type':
      return {
        tool: 'type',
        args: {
          text: action.args.text,
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          options: { clear: action.args.clear },
        },
      };
    default:
      return null;
  }
}
