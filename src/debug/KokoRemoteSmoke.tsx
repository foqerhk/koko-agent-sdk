import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useKokoAgent } from '../provider/KokoProvider';
import { TaskStore } from '../task/TaskStore';
import { screenModelText } from '../privacy/screenModel';
import { viewTreeOutline, redactViewTreeClient } from '../privacy/redact';
import { sensitiveScreenKind, SensitiveScreenError } from '../privacy/sensitiveScreen';
import { NativeBridge } from '../native/NativeBridge';
import { buildOnDeviceAssist } from '../assist/OnDeviceAssist';
import { getProgressChromeFrame } from '../ui/progressChrome';
import { CursorController } from '../cursor/controller';
import { KokoAgent } from '../KokoAgent';
import { detectAppUserGate } from '../privacy/userGate';
import { safePlannerModel } from '../client/GatewayClient';
import { HostAppearanceStore } from '../provider/HostAppearanceStore';
import { visibleWebViewFrames } from '../assist/ocrTarget';
import { isMetroDevBuild } from '../commercial/devMode';

/**
 * Why the progress chrome did or did not render, sampled on every store
 * change. Polling from the Mac cannot see this: the queue is starved while a
 * task runs, so the interesting states are over before a reply gets through.
 */
type ChromeSample = {
  t: number;
  running: boolean;
  sheetOpen: boolean;
  suppressed: boolean;
  epoch: number;
  frame: string;
};

const chromeTrace: ChromeSample[] = [];
let chromeTraceStarted = 0;

function recordChromeSample() {
  const s = TaskStore.snapshot();
  const active = s.tasks.find((t) => t.id === s.activeTaskId);
  const f = getProgressChromeFrame();
  if (!chromeTraceStarted) chromeTraceStarted = Date.now();
  if (chromeTrace.length > 400) chromeTrace.shift();
  chromeTrace.push({
    t: Date.now() - chromeTraceStarted,
    running: active?.status === 'running',
    sheetOpen: Boolean(s.ui.sheetOpen),
    suppressed: Boolean(s.ui.chromeSuppressed),
    epoch: s.ui.chromeEpoch ?? 0,
    frame: f ? `${Math.round(f.x)},${Math.round(f.y)} ${Math.round(f.width)}x${Math.round(f.height)}` : 'null',
  });
}

export type KokoRemoteSmokeCmd =
  | { id: string; type: 'ping' }
  | { id: string; type: 'openChat'; taskId?: string | null }
  | { id: string; type: 'closeChat' }
  | { id: string; type: 'stop' }
  | { id: string; type: 'snapshot' }
  | { id: string; type: 'verifyLocalWebText'; text: string; goal: string; cursorAtTarget?: boolean }
  | { id: string; type: 'inspectWalletChoices' }
  | { id: string; type: 'inspectWebWalletProvider' }
  | { id: string; type: 'inspectWebState' }
  | { id: string; type: 'chromeTrace'; clear?: boolean }
  | { id: string; type: 'dump'; includeTree?: boolean }
  | {
      id: string;
      type: 'tap';
      point?: { x: number; y: number };
      text?: string;
      nodeId?: string;
    }
  | { id: string; type: 'runGoal'; goal: string }
  | {
      id: string;
      type: 'recognizeScreenText';
      maxTokens?: number;
      languages?: string[];
    }
  | { id: string; type: 'alertAction'; title: string }
  | { id: string; type: 'cursorAt'; x: number; y: number; holdMs?: number }
  | { id: string; type: 'onDeviceAssist'; goal: string; skipOcr?: boolean }
  | {
      id: string;
      type: 'explore';
      maxSteps?: number;
      maxScreens?: number;
      mode?: 'full' | 'quick';
      appKey?: string;
    }
  | { id: string; type: 'exploreGraph' }
  | { id: string; type: 'clearExploreGraph' };

type SmokeResult = {
  id: string;
  ok: boolean;
  type: string;
  at: number;
  error?: string;
  data?: unknown;
};

async function fetchJson(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const timeoutMs = init?.timeoutMs ?? 4000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DEV-only remote driver: poll a host HTTP queue and run SDK ops.
 * Host-agnostic — any app can enable via KokoProvider `remoteSmokePort`.
 * Simulator reaches Mac localhost as 127.0.0.1.
 */
export function KokoRemoteSmoke({
  port = 9877,
  enabled = true,
}: {
  port?: number;
  enabled?: boolean;
}) {
  const koko = useKokoAgent();
  const busy = useRef(false);
  const kokoRef = useRef(koko);
  kokoRef.current = koko;
  const active = enabled && isMetroDevBuild();

  useEffect(() => {
    if (!active) return;
    recordChromeSample();
    return TaskStore.subscribe(recordChromeSample);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (Platform.OS === 'web') return;

    const base = `http://127.0.0.1:${port}`;
    let cancelled = false;

    const post = async (path: string, body: unknown) => {
      await fetchJson(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 4000,
      });
    };

    const handle = async (cmd: KokoRemoteSmokeCmd): Promise<SmokeResult> => {
      const at = Date.now();
      const agent = kokoRef.current;
      try {
        if (['tap', 'recognizeScreenText', 'type', 'screenshot', 'alertAction'].includes(cmd.type) &&
            sensitiveScreenKind(await NativeBridge.dump())) throw new SensitiveScreenError();
        switch (cmd.type) {
          case 'ping':
            return {
              id: cmd.id,
              ok: true,
              type: cmd.type,
              at,
              data: { appState: AppState.currentState },
            };
          case 'verifyLocalWebText': {
            // Read-only integration diagnostic. No recognized page text or
            // screenshots are returned; the label is supplied by the caller.
            const tree = await NativeBridge.dump();
            if (detectAppUserGate(tree) || sensitiveScreenKind(tree)) throw new SensitiveScreenError();
            const local = new KokoAgent({ observer: false });
            const found = await local.find({ match: [{ text: cmd.text }] }, tree);
            const assist = await buildOnDeviceAssist(cmd.goal, tree);
            const model = safePlannerModel(redactViewTreeClient(tree), cmd.goal, assist.goalOcrLabels, assist.walletChoices);
            // Exercise the same fresh OCR revalidation used immediately before
            // a tap, without dispatching a touch or exporting recognized text.
            const internal = local as unknown as {
              lastTree: typeof tree;
              ocrTargets: Map<string, { text: string; webview: boolean }>;
              currentOcrPoint: (text: string, root?: typeof tree) => Promise<unknown>;
            };
            internal.lastTree = tree;
            const observed = found ? internal.ocrTargets.get(found.id) : undefined;
            let revalidated = false;
            let cursorCheckStarted = false;
            if (cmd.cursorAtTarget && found?.frame) {
              if (TaskStore.snapshot().activeTaskId) throw new Error('task already running');
              TaskStore.startTask('Local read-only cursor visibility check');
              cursorCheckStarted = true;
              CursorController.showAt(found.frame.x + found.frame.width / 2, found.frame.y + found.frame.height / 2);
              await new Promise<void>((resolve) => setTimeout(resolve, 350));
            }
            try {
              revalidated = observed
                ? Boolean(await internal.currentOcrPoint(observed.text, observed.webview ? tree : undefined))
                : false;
            } finally {
              if (cursorCheckStarted) {
                CursorController.hide();
                TaskStore.finishTask('cancelled');
              }
            }
            return { id: cmd.id, ok: true, type: cmd.type, at, data: {
              found: Boolean(found), viaOcr: found?.type === 'KokoOcrText',
              usesRequestedLabel: found?.text === cmd.text,
              plannerHasLocalEvidence: model.includes('[local-ocr]'),
              plannerHasWalletChoices: model.includes('[local-wallet-choices]'),
              revalidated,
            } };
          }
          case 'inspectWalletChoices': {
            const tree = await NativeBridge.dump();
            if (detectAppUserGate(tree) || sensitiveScreenKind(tree)) throw new SensitiveScreenError();
            const ocr = await NativeBridge.recognizeScreenText({ maxTokens: 64, hideOverlays: true });
            const patterns: Array<[string, RegExp]> = [
              ['MetaMask', /metamask/i], ['WalletConnect', /wallet\s*connect/i],
              ['Coinbase Wallet', /coinbase/i], ['OneKey', /one\s*key/i],
              ['UKey', /u\s*key/i], ['Uniswap Wallet', /uniswap\s*wallet/i],
              ['Trust Wallet', /trust\s*wallet/i], ['Phantom', /phantom/i],
              ['OKX Wallet', /okx/i], ['More', /^(more|更多)(\s|$)/i],
              ['Browser wallet', /browser\s*wallet|浏览器钱包/i],
              ['Other wallets', /other\s*wallets|其他钱包/i],
              ['Installed', /installed|已安装/i],
            ];
            return { id: cmd.id, ok: true, type: cmd.type, at, data: {
              choices: patterns.filter(([, re]) => ocr.texts.some((hit) => re.test(hit.text)))
                .map(([label]) => label),
              positions: patterns.flatMap(([label, re]) => ocr.texts
                .filter((hit) => re.test(hit.text) && hit.frame)
                .map((hit) => ({ label, frame: hit.frame }))),
            } };
          }
          case 'inspectWebState': {
            const tree = await NativeBridge.dump();
            if (detectAppUserGate(tree) || sensitiveScreenKind(tree)) throw new SensitiveScreenError();
            const ocr = await NativeBridge.recognizeScreenText({ maxTokens: 64, hideOverlays: true });
            const patterns: Record<string, RegExp> = {
              private: /password|passcode|mnemonic|recovery phrase|seed phrase|private key|密码|账户恢复凭证|私密认证数据|私钥/i,
              accountAddress: /0x[a-f0-9]{4,}|0x[a-f0-9]{2,}…/i,
              connect: /connect|连接|連接/i, wallet: /wallet|钱包|錢包/i,
              provider: /metamask|walletconnect|coinbase|onekey|ukey/i,
              loading: /loading|connecting|加载|連接中|连接中|请稍候/i,
              error: /error|failed|failure|错误|失敗|失败/i,
              approval: /approve|authorize|confirm|allow|批准|授权|確認|确认|同意/i,
              qr: /qr code|二维码|二維碼/i, uniswap: /uniswap/i,
            };
            return { id: cmd.id, ok: true, type: cmd.type, at, data: {
              flags: Object.fromEntries(Object.entries(patterns).map(([key, re]) => [key, ocr.texts.some(hit => re.test(hit.text))])),
            } };
          }
          case 'inspectWebWalletProvider': {
            const tree = await NativeBridge.dump();
            if (detectAppUserGate(tree) || sensitiveScreenKind(tree)) throw new SensitiveScreenError();
            const frame = visibleWebViewFrames(tree)[0];
            if (!frame) return { id: cmd.id, ok: false, type: cmd.type, at, error: 'webview not visible' };
            const flags = await NativeBridge.inspectWebWalletProvider({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
            return { id: cmd.id, ok: Boolean(flags), type: cmd.type, at, data: { flags } };
          }
          case 'openChat':
            agent.openChat(cmd.taskId);
            return { id: cmd.id, ok: true, type: cmd.type, at };
          case 'closeChat':
            agent.closeChat();
            return { id: cmd.id, ok: true, type: cmd.type, at };
          case 'stop':
            agent.stop();
            return { id: cmd.id, ok: true, type: cmd.type, at };
          case 'chromeTrace': {
            const rows = chromeTrace.slice();
            if (cmd.clear) {
              chromeTrace.length = 0;
              chromeTraceStarted = 0;
            }
            return { id: cmd.id, ok: true, type: cmd.type, at, data: { rows } };
          }
          case 'snapshot': {
            const snap = TaskStore.snapshot();
            return {
              id: cmd.id,
              ok: true,
              type: cmd.type,
              at,
              data: {
                appState: AppState.currentState,
                appearance: HostAppearanceStore.get(),
                ui: snap.ui,
                activeTaskId: snap.activeTaskId,
                tasks: snap.tasks.map((t) => ({
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  nodeCount: t.nodes.length,
                  findDiagnostics: t.nodes.filter((n) => n.kind === 'find').map((n) => ({
                    title: n.title,
                    status: n.status,
                    targetKind: n.detail?.startsWith('ocr:') ? 'ocr' : n.detail ? 'native' : 'none',
                  })),
                  firstNodes: t.nodes.slice(0, 8).map((n) => ({
                    kind: n.kind,
                    title: n.title,
                    status: n.status,
                  })),
                  lastNodes: t.nodes.slice(-6).map((n) => ({
                    kind: n.kind,
                    title: n.title,
                    status: n.status,
                  })),
                })),
              },
            };
          }
          case 'dump': {
            // Native dump — no active goal required (agent.dump() is gated).
            const tree = await NativeBridge.dump();
            const outline = viewTreeOutline(tree).slice(0, 4000);
            const model = screenModelText(tree).slice(0, 4000);
            return {
              id: cmd.id,
              ok: true,
              type: cmd.type,
              at,
              // `includeTree` ships a redacted tree so scripts/capture_dump_fixture.py
              // can save it as an offline regression fixture. Off by default: a
              // dense host tree is megabytes.
              data: { outline, model, tree: cmd.includeTree ? redactViewTreeClient(tree) : undefined },
            };
          }
          case 'tap': {
            // Raw synthetic touch, bypassing selector + ExecutionGuard, so a
            // failing task can be narrowed to "the touch never lands" vs
            // "the planner aimed at the wrong node".
            const before = screenModelText(await NativeBridge.dump()).slice(0, 2000);
            const point =
              cmd.point ??
              (() => {
                throw new Error('tap requires point');
              })();
            await NativeBridge.tap(point);
            await new Promise((r) => setTimeout(r, 1200));
            const after = screenModelText(await NativeBridge.dump()).slice(0, 2000);
            return {
              id: cmd.id,
              ok: true,
              type: cmd.type,
              at,
              data: { point, changed: before !== after, before, after },
            };
          }
          case 'recognizeScreenText': {
            const ocr = await NativeBridge.recognizeScreenText({
              maxTokens: cmd.maxTokens ?? 24,
              languages: cmd.languages,
              hideOverlays: true,
            });
            return {
              id: cmd.id,
              ok: ocr.backend === 'vision' || ocr.tokens.length > 0,
              type: cmd.type,
              at,
              data: {
                backend: ocr.backend,
                tokenCount: ocr.tokens.length,
                tokens: ocr.tokens.slice(0, 32),
                texts: ocr.texts.slice(0, 16),
                nativeAvailable: NativeBridge.isAvailable(),
              },
            };
          }
          case 'cursorAt': {
            // Isolates pointer rendering from the planner: the chrome only
            // shows while a task runs, so claim one for the hold.
            const taskId = TaskStore.startTask('cursorAt').id;
            CursorController.showAt(cmd.x, cmd.y, 0);
            await new Promise((r) => setTimeout(r, cmd.holdMs ?? 4000));
            const state = CursorController.getState();
            CursorController.hide();
            TaskStore.finishTask('success', taskId);
            return { id: cmd.id, ok: true, type: cmd.type, at, data: { state } };
          }
          case 'alertAction': {
            const before = screenModelText(await NativeBridge.dump());
            const invoked = await NativeBridge.invokeAlertAction(cmd.title);
            await new Promise((r) => setTimeout(r, 800));
            const after = screenModelText(await NativeBridge.dump());
            return {
              id: cmd.id,
              ok: invoked,
              type: cmd.type,
              at,
              data: { invoked, changed: after !== before, after: after.slice(0, 600) },
            };
          }
          case 'onDeviceAssist': {
            const tree = await NativeBridge.dump();
            const assist = await buildOnDeviceAssist(cmd.goal, tree, {
              skipOcr: cmd.skipOcr,
            });
            return {
              id: cmd.id,
              ok: Boolean(assist.modelText || assist.ranked.length),
              type: cmd.type,
              at,
              data: {
                intent: assist.intent,
                confidence: assist.confidence,
                backend: assist.backend,
                tokens: assist.tokens,
                ocrTokens: assist.ocrTokens,
                ranked: assist.ranked.slice(0, 8),
                modelText: assist.modelText.slice(0, 2000),
              },
            };
          }
          case 'runGoal': {
            const out = await agent.runGoal(cmd.goal);
            const snap = TaskStore.snapshot();
            const active = snap.tasks.find((t) => t.id === snap.activeTaskId);
            return {
              id: cmd.id,
              ok: Boolean(out?.success),
              type: cmd.type,
              at,
              data: {
                result: out,
                task: active
                  ? {
                      id: active.id,
                      title: active.title,
                      status: active.status,
                      nodes: active.nodes.map((n) => ({
                        kind: n.kind,
                        title: n.title,
                        status: n.status,
                      })),
                    }
                  : null,
              },
            };
          }
          case 'explore': {
            const out = await agent.bootstrapExplore({
              mode: cmd.mode ?? 'full',
              maxSteps: cmd.maxSteps ?? (cmd.mode === 'quick' ? 24 : 80),
              maxScreens: cmd.maxScreens,
              appKey: cmd.appKey,
            });
            return {
              id: cmd.id,
              ok: Boolean(out?.success),
              type: cmd.type,
              at,
              data: {
                summary: out.summary,
                steps: out.steps,
                stats: {
                  nodes: out.graph.nodes.length,
                  edges: out.graph.edges.length,
                },
                sampleEdges: out.graph.edges.slice(0, 20).map((e) => ({
                  label: e.label,
                  count: e.count,
                })),
                sampleNodeLabels: out.graph.nodes
                  .slice(0, 12)
                  .map((n) => n.labels.slice(0, 6)),
              },
            };
          }
          case 'exploreGraph': {
            const g = agent.getExplorationGraph();
            return {
              id: cmd.id,
              ok: true,
              type: cmd.type,
              at,
              data: {
                stats: { nodes: g.nodes.length, edges: g.edges.length },
                nodes: g.nodes.slice(0, 20).map((n) => ({
                  id: n.id,
                  labels: n.labels.slice(0, 8),
                  visitCount: n.visitCount,
                })),
                edges: g.edges.slice(0, 30).map((e) => ({
                  label: e.label,
                  count: e.count,
                  fromId: e.fromId,
                  toId: e.toId,
                })),
              },
            };
          }
          case 'clearExploreGraph': {
            agent.clearExplorationGraph();
            return { id: cmd.id, ok: true, type: cmd.type, at };
          }
          default:
            return {
              id: (cmd as { id: string }).id,
              ok: false,
              type: 'unknown',
              at,
              error: 'unknown command',
            };
        }
      } catch (e) {
        return {
          id: cmd.id,
          ok: false,
          type: cmd.type,
          at,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    };

    const tick = async () => {
      if (cancelled || busy.current) return;
      if (AppState.currentState !== 'active') return;
      busy.current = true;
      try {
        const res = await fetchJson(`${base}/cmd`, { method: 'GET', timeoutMs: 3500 });
        const cmd = res.json as KokoRemoteSmokeCmd | null;
        if (!cmd || !cmd.id) return;
        // Ack early so the host knows we accepted work (avoids silent drops).
        await post('/ack', { id: cmd.id, type: cmd.type, at: Date.now() });
        const result = await handle(cmd);
        await post('/result', result);
      } catch {
        // ignore — next tick retries
      } finally {
        busy.current = false;
      }
    };

    void post('/hello', { at: Date.now(), platform: Platform.OS });
    const timer = setInterval(() => {
      void tick();
    }, 600);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [active, port]);

  return null;
}
