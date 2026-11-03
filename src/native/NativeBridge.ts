import { NativeModules, Platform } from 'react-native';
import type { DumpOptions, Point, ViewNode } from '../types';
import { pruneOffscreen } from './pruneOffscreen';
import { normalizeViewTree } from './normalizeViewTree';

export type ScreenshotOptions = {
  /** Hide koko-agent-overlay layers before capture (default true). */
  hideOverlays?: boolean;
};

export type ScreenshotResult = {
  pngBase64: string;
  width: number;
  height: number;
  scale?: number;
};

export type RecognizeScreenTextOptions = {
  /** Hide koko-agent-overlay layers before capture (default true). */
  hideOverlays?: boolean;
  /** Max distinct tokens to return (default 24). */
  maxTokens?: number;
  /** BCP-47 language hints for Vision OCR (iOS). */
  languages?: string[];
};

export type RecognizeScreenTextResult = {
  tokens: string[];
  texts: Array<{
    text: string;
    confidence: number;
    /** Window-absolute logical coordinates when the backend can provide them. */
    frame?: { x: number; y: number; width: number; height: number };
  }>;
  /** e.g. vision | stub | unavailable */
  backend: string;
};

type NativeModuleShape = {
  dumpViewTree(options: DumpOptions): Promise<ViewNode>;
  dispatchTap(x: number, y: number): Promise<void>;
  inspectWebWalletProvider?(x: number, y: number): Promise<{ present: boolean; hasRequest?: boolean; isMetaMask?: boolean; isUKey?: boolean }>;
  dispatchSwipe(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<void>;
  dispatchPinch?(x: number, y: number, scale: number, durationMs: number): Promise<void>;
  invokeAlertAction?(title: string): Promise<void>;
  typeText(text: string, clear: boolean): Promise<void>;
  focusNode(nodeId: string): Promise<void>;
  focusAt(x: number, y: number): Promise<void>;
  dismissKeyboard?(): Promise<void>;
  scrollIntoView?(x: number, y: number): Promise<void>;
  captureScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult>;
  /** On-device OCR (Vision on iOS, optional ML Kit in Android hosts). */
  recognizeScreenText?(
    options: RecognizeScreenTextOptions,
  ): Promise<RecognizeScreenTextResult>;
  /** Host bundle id / package name — used to bind API keys and stop cross-app reuse. */
  hostAppId?: string;
};

const LINKING_ERROR =
  `KokoAgentSdk native module is not linked. ` +
  `Rebuild the host app after adding @intentcomputing/koko-agent-sdk ` +
  `(iOS: pod install; Android: gradle sync). Platform=${Platform.OS}`;

const Native: NativeModuleShape | undefined = NativeModules.KokoAgentSdk;

function getNative(): NativeModuleShape {
  if (!Native) {
    throw new Error(LINKING_ERROR);
  }
  return Native;
}

export const NativeBridge = {
  isAvailable(): boolean {
    return !!Native;
  },

  /** iOS bundle identifier / Android applicationId. Empty when native module is missing. */
  hostAppId(): string {
    const raw = (Native as NativeModuleShape | undefined)?.hostAppId;
    return typeof raw === "string" ? raw.trim() : "";
  },

  async dump(options: DumpOptions = {}): Promise<ViewNode> {
    const raw = await getNative().dumpViewTree({
      maxDepth: options.maxDepth ?? 60,
      skipInvisible: options.skipInvisible ?? true,
    });
    const root = normalizeViewTree(raw);
    // Every consumer — ranking, selectors, the user gate — reads the tree from
    // here, so offscreen nodes have to go before any of them see it.
    return options.skipInvisible === false ? root : pruneOffscreen(root);
  },

  tap(point: Point): Promise<void> {
    return getNative().dispatchTap(point.x, point.y);
  },

  /** Public capability flags only; never requests account data. */
  async inspectWebWalletProvider(point: Point) {
    const native = getNative();
    if (typeof native.inspectWebWalletProvider !== 'function') return null;
    return native.inspectWebWalletProvider(point.x, point.y);
  },

  swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    return getNative().dispatchSwipe(from.x, from.y, to.x, to.y, durationMs);
  },

  /**
   * Two-finger pinch at center. scale>1 zoom in, scale<1 zoom out.
   * Falls back to error if native build lacks dispatchPinch.
   */
  pinch(center: Point, scale: number, durationMs: number): Promise<void> {
    const n = getNative();
    if (typeof n.dispatchPinch !== 'function') {
      throw new Error(
        'KokoAgentSdk: dispatchPinch unavailable — rebuild the host app with the latest native module',
      );
    }
    return n.dispatchPinch(center.x, center.y, scale, durationMs);
  },

  /** Invoke a presented system alert action by button title. */
  async invokeAlertAction(title: string): Promise<boolean> {
    const n = getNative();
    if (typeof n.invokeAlertAction !== 'function') return false;
    await n.invokeAlertAction(title);
    return true;
  },

  typeText(text: string, clear: boolean): Promise<void> {
    return getNative().typeText(text, clear);
  },

  focusNode(nodeId: string): Promise<void> {
    return getNative().focusNode(nodeId);
  },

  /** Ensure software keyboard / first responder at a screen point (TextInput). */
  focusAt(point: Point): Promise<void> {
    return getNative().focusAt(point.x, point.y);
  },

  async dismissKeyboard(): Promise<void> {
    const n = getNative();
    if (typeof n.dismissKeyboard === 'function') {
      await n.dismissKeyboard();
    }
  },

  async scrollIntoView(_point: Point): Promise<void> {
    // No-op: auto scroll-into-view before tap scrolled page-level ScrollViews
    // (home / onboarding) and looked like a secret swipe. Callers that need
    // scrolling must use an explicit swipe gesture instead.
    return;
  },

  screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    return getNative().captureScreenshot({
      hideOverlays: options.hideOverlays ?? true,
    });
  },

  /**
   * On-device screen OCR via Vision (iOS) or an opted-in ML Kit host (Android).
   * Soft-fails to empty tokens when the native method is missing.
   */
  async recognizeScreenText(
    options: RecognizeScreenTextOptions = {},
  ): Promise<RecognizeScreenTextResult> {
    const n = getNative();
    if (typeof n.recognizeScreenText !== 'function') {
      return { tokens: [], texts: [], backend: 'unavailable' };
    }
    const raw = await n.recognizeScreenText({
      hideOverlays: options.hideOverlays ?? true,
      maxTokens: options.maxTokens ?? 24,
      languages: options.languages,
    });
    return {
      tokens: Array.isArray(raw?.tokens) ? raw.tokens.map(String) : [],
      texts: Array.isArray(raw?.texts)
        ? raw.texts.map((t) => {
            const f = t?.frame;
            const frame =
              f &&
              [f.x, f.y, f.width, f.height].every((v) => Number.isFinite(Number(v)))
                ? {
                    x: Number(f.x),
                    y: Number(f.y),
                    width: Number(f.width),
                    height: Number(f.height),
                  }
                : undefined;
            return {
              text: String(t?.text ?? ''),
              confidence: Number(t?.confidence ?? 0),
              frame,
            };
          })
        : [],
      backend: String(raw?.backend || 'vision'),
    };
  },
};
