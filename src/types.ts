/** Frame in window / screen coordinates (density-independent points). */
export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** One node in the dumped native view tree. */
export type ViewNode = {
  /** Stable-enough path for this dump snapshot (e.g. "0/2/1"). */
  id: string;
  /** Native class name (UIView / android.view.View subclass). */
  type: string;
  frame: Frame;
  /** Visible text aggregated from this node and text descendants. */
  text?: string;
  accessibilityLabel?: string;
  testID?: string;
  /** True for secure/password text fields (user must type; agent waits). */
  secure?: boolean;
  /** Already-active tab / segment / option — re-tapping it does nothing. */
  selected?: boolean;
  /** System alert / action sheet / share / menu surface. */
  sheet?: boolean;
  /** UISwitch-like toggle. */
  toggle?: boolean;
  on?: boolean;
  /** Picker / slider / stepper / adjustable control. */
  adjustable?: boolean;
  /** Current numeric value when known (slider / stepper / segment index). */
  value?: number;
  min?: number;
  max?: number;
  clickable: boolean;
  enabled: boolean;
  visible: boolean;
  /** Whether this view can scroll vertically; supplied by the native host. */
  scrollable?: boolean;
  /** Descendants are clipped to this view's window-relative bounds. */
  clipsChildren?: boolean;
  children: ViewNode[];
};

/** Single match rule inside a multi-factor selector. */
export type MatchRule =
  | { text: string; exact?: boolean }
  | { nearText: string; exact?: boolean }
  | { clickable: boolean }
  | { type: string }
  | { testID: string }
  | { accessibilityLabel: string; exact?: boolean }
  | { region: 'top' | 'bottom' | 'left' | 'right' | 'center'; ratio?: number };

/**
 * Multi-factor selector (DOM-like).
 * All `match` rules must pass; `index` picks the N-th among matches.
 */
export type Selector = {
  match: MatchRule[];
  index?: number;
};

export type Point = { x: number; y: number };

export type TapOptions = {
  /** Search by scrolling when absent. Planners disable this and choose navigation explicitly. */
  revealIfNeeded?: boolean;
  /** Skip cursor animation. */
  silent?: boolean;
  /** Cursor move duration ms. */
  cursorDurationMs?: number;
};

export type SwipeOptions = {
  durationMs?: number;
  silent?: boolean;
};

export type PinchOptions = {
  /** Finger travel duration ms (default 280). */
  durationMs?: number;
  silent?: boolean;
};

export type TypeOptions = {
  clear?: boolean;
  silent?: boolean;
};

/** Sensitive-action confirmation policy. */
export type ConfirmationPolicy = {
  /**
   * When true (default), high-risk goals need a human OK.
   * Combined with `mode` (default `preflight`).
   */
  requireUserConfirm: boolean;
  /**
   * - `preflight` (default): ask once before the run; execution is unattended
   * - `inline`: legacy per-tap confirm (not recommended)
   * - `off`: never ask
   */
  mode?: 'preflight' | 'inline' | 'off';
  /** Keywords / patterns that trigger the gate (matched against goal / labels). */
  sensitivePatterns?: RegExp[];
};

/** UI language for built-in chrome (chat sheet, dialogs, progress). */
export type KokoLocale = 'zh' | 'en';

/**
 * A light or dark color scheme.
 *
 * Where it names the host App's theme (`config.theme`, `setKokoAppearance`),
 * Koko chrome renders in the opposite one for contrast.
 */
export type KokoTheme = 'light' | 'dark';

/**
 * Host branding for the built-in chat sheet.
 * Custom name / icon / tagline / placeholder require plan entitlement `custom_branding`.
 * Without entitlement, SDK falls back to default Koko branding.
 */
export type KokoBrandingConfig = {
  /** Display name (paid). Default: Koko */
  name?: string;
  /**
   * Brand mark — image URI / require() source, or a short letter shown in the badge.
   * Custom image/letter beyond default "K" requires `custom_branding`.
   */
  icon?: number | { uri: string } | string;
  /** Tagline under the name (paid). */
  tagline?: string;
  /** Composer placeholder (paid when customized). */
  placeholder?: string;
  /** Accent color for badge / send button (paid with branding). */
  primaryColor?: string;
};

/** Plan entitlements returned by gateway `/v1/me`. */
export type KokoEntitlements = {
  custom_branding: boolean;
  locale: boolean;
};

export type KokoPlanId = 'free' | 'pro' | 'enterprise';

export type KokoAccountSnapshot = {
  plan: KokoPlanId;
  region?: string;
  provider?: string;
  entitlements: KokoEntitlements;
  quota: {
    daily: number;
    used_today: number;
    remaining: number;
    /** Present when gateway bills LLM tokens via the account service. */
    meter?: 'llm_tokens' | 'agent_step';
    free_monthly?: number;
    free_used?: number;
    free_remaining?: number;
    prepaid_balance?: number;
  };
};

/**
 * Side-channel usage notifications for host analytics / UX.
 * Does NOT affect task execution or billing (server is authoritative).
 */
export type KokoUsageEvent =
  | {
      type: 'task_started';
      taskId?: string;
      goal: string;
      at: number;
    }
  | {
      type: 'task_finished';
      taskId?: string;
      status: 'success' | 'failed' | 'cancelled';
      steps?: number;
      at: number;
    }
  | {
      type: 'agent_step';
      sessionId?: string;
      step?: number;
      tool?: string;
      at: number;
    }
  | {
      type: 'quota_exceeded';
      message?: string;
      quota?: KokoAccountSnapshot['quota'];
      at: number;
    }
  | {
      type: 'sheet_opened' | 'sheet_closed';
      at: number;
    }
  | {
      type: 'branding_downgraded';
      reason: 'missing_entitlement';
      at: number;
    };

export type KokoAgentConfig = {
  /** Public chooser labels that the host confirms refer to its own injected wallet provider. */
  webWalletAliases?: string[];
  /** Called when a sensitive step needs a human confirm. Return true to proceed. */
  onConfirmSensitive?: (ctx: SensitiveConfirmContext) => Promise<boolean>;
  confirmation?: ConfirmationPolicy;
  /**
   * Max depth when dumping (performance). Must clear the host's real nesting:
   * RN plus a component library spends 25-35 levels on navigators, safe-area,
   * gesture and style wrappers before reaching the first button, so a tight cap
   * silently truncates the page body and leaves the agent only the shallow
   * chrome around it.
   */
  dumpMaxDepth?: number;
  /** Drop non-visible nodes from dump. */
  dumpSkipInvisible?: boolean;
  /** Default cursor animation duration. */
  cursorDurationMs?: number;
  /**
   * Show task subtitle + history panel (default true).
   * Set false to disable observer chrome / auto logging.
   */
  observer?: boolean;
  /**
   * Official gateway. Defaults applied in runGoal if omitted:
   * baseUrl https://sdk.intentcomputing.net — LLM vendor is server-side only.
   */
  gateway?: {
    baseUrl?: string;
    /** Legacy static app token. Prefer `tokenProvider` in production. */
    token?: string;
    /** Fetch a short-lived token from the host backend. Never embed its client secret. */
    tokenProvider?: () => Promise<
      | string
      | { accessToken: string; /** Unix milliseconds. */ expiresAt?: number }
    >;
    /**
     * Host App ID (bundle id / package name). Bound to the API key on the server.
     * Defaults to the native host App ID when omitted.
     */
    appId?: string;
  };
  /**
   * Verbose developer logs: App capabilities / steps the SDK sees.
   * Does not print security policy details.
   * Default: on in Metro `__DEV__`; set `false` to silence.
   * @deprecated `devMode` is an alias for `debug`. Prefer `debug`.
   */
  debug?: boolean;
  /** @deprecated Use `debug`. Same meaning: verbose capability logs only. */
  devMode?: boolean;
  /**
   * Built-in UI language. Default `en` (pass `zh` for Chinese).
   * Prefer `setKokoAppearance({ locale })` so the host can follow its own setting.
   */
  locale?: KokoLocale;
  /**
   * The **host App's** theme — not the SDK's. Default `light`.
   *
   * Koko chrome paints in the opposite theme so it reads as a separate
   * surface floating over the App: report `dark` and the pill, chat sheet
   * and dialogs go light, and vice versa.
   *
   * Prefer `setKokoAppearance({ theme })` so chrome follows the host when the
   * user changes it at runtime.
   */
  theme?: KokoTheme;
  /**
   * Branding for chat sheet header / placeholder.
   * Requires lifetime branding license (`custom_branding` from official `/v1/me`).
   * Soft-enforced in built-in UI only; usage billing is separate (server-side).
   */
  branding?: KokoBrandingConfig;
  /**
   * Optional host analytics. Never blocks or changes agent execution.
   */
  onUsageEvent?: (event: KokoUsageEvent) => void;
};

export type SensitiveConfirmContext = {
  action: string;
  label?: string;
  selector?: Selector;
  node?: ViewNode;
};

export type DumpOptions = {
  maxDepth?: number;
  skipInvisible?: boolean;
  /**
   * Internal observation dump — do not write task log / subtitle.
   * Use for per-step UI refresh; keep false for explicit agent `dump` tool.
   */
  silent?: boolean;
};

/** Agent ↔ SDK JSON tool-call protocol (cloud agent side). */
export type AgentAction =
  | { tool: 'dump'; args?: DumpOptions }
  | { tool: 'find'; args: { selector: Selector } }
  | { tool: 'findAll'; args: { selector: Selector } }
  | { tool: 'tap'; args: { selector?: Selector; nodeId?: string; point?: Point; options?: TapOptions } }
  | { tool: 'swipe'; args: { from: Point; to: Point; options?: SwipeOptions } }
  | { tool: 'pinch'; args: { center: Point; scale: number; options?: PinchOptions } }
  | { tool: 'type'; args: { text: string; selector?: Selector; nodeId?: string; options?: TypeOptions } }
  | { tool: 'confirm'; args: { label?: string; action?: string } };

export type AgentActionResult =
  | { ok: true; tool: 'dump'; tree: ViewNode }
  | { ok: true; tool: 'find'; node: ViewNode | null }
  | { ok: true; tool: 'findAll'; nodes: ViewNode[] }
  | { ok: true; tool: 'tap' }
  | { ok: true; tool: 'swipe' }
  | { ok: true; tool: 'pinch' }
  | { ok: true; tool: 'type' }
  | { ok: true; tool: 'confirm'; confirmed: boolean }
  | { ok: false; tool: AgentAction['tool']; error: string };
