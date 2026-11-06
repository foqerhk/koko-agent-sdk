import { Platform } from 'react-native';
import type { KokoAgent } from '../KokoAgent';
import { runPreflightConfirm } from '../confirmation/gate';
import { viewTreeOutline } from '../privacy/redact';
import { sensitiveScreenKind, SensitiveScreenError } from '../privacy/sensitiveScreen';
import { screenModelText, screenSnapshotLine, extractAffordances } from '../privacy/screenModel';
import {
  HostActionsStore,
  filterVisibleHostActions,
  hostActionsModelText,
} from '../host/HostActions';
import {
  AppUserGateStore,
  detectAppUserGate,
  gateMessageValue,
  userGateModelText,
} from '../privacy/userGate';
import type { Selector, ViewNode } from '../types';
import {
  GatewayClient,
  GatewayError,
  GatewayUpgradeRequiredError,
  type AgentHistoryItem,
  type GatewayAction,
  type GatewayConfig,
} from './GatewayClient';
import { UsageBus } from '../commercial/UsageBus';
import { AccountStore } from '../commercial/AccountStore';
import { ExecutionGuard } from '../commercial/ExecutionGuard';
import { AgentDebug } from '../commercial/AgentDebug';
import { scrollPosition } from '../native/scrollViewport';
import { TaskStore } from '../task/TaskStore';
import { isLooping } from './loopDetect';
import {
  ExplorationGraph,
  exploreHintsModelText,
  goalExploreQuery,
} from '../explore/ExplorationGraph';
import { RunCheckpoint } from './RunCheckpoint';
import { ActionOutcomeUnknownError, ActionValidationError } from './ActionOutcomeUnknownError';
import { OperationReplayGuard } from './OperationReplayGuard';
import { recentSearchAction } from './recentSearch';
import { webResultCategory } from './webResultCategory';
import { wrongHostWalletChoice } from './walletChoiceGuard';
import { currentLocale, gatewayLocale, runtimeText, message, resolveText, type MessageKey, type MessageVars } from '../i18n';

import { buildOnDeviceAssist } from '../assist/OnDeviceAssist';
import { NativeBridge } from '../native/NativeBridge';
import { webVisualChanged, webVisualLabels } from '../assist/webVisualChange';
import { ocrHitInFrames, visibleWebViewFrames } from '../assist/ocrTarget';

/** Soft ETA-style start; extend while progressing. Absolute safety wall only. */
const SOFT_MAX_STEPS = 40;
const HARD_MAX_STEPS = 200;

function affordanceLabels(tree: ViewNode | null | undefined): string[] {
  if (!tree) return [];
  return extractAffordances(tree, 40).map((a) => a.label);
}

export type AskUserHandler = (question: string) => Promise<string | null>;

export type AgentSessionOptions = GatewayConfig & {
  locale?: string;
  localRetries?: number;
  onAskUser?: AskUserHandler;
  onNarration?: (text: string) => void;
  userGateTimeoutMs?: number;
  /** Picked up after a JS-context restart killed the original run. */
  resumedFromReload?: boolean;
};

export type AgentRunResult = {
  success: boolean;
  summary: string;
  steps: number;
  sessionId: string;
};

/**
 * Cursor-like session with:
 * - Preflight risk confirm (before loop)
 * - Unattended execution (stop only)
 * - Pause when App shows password/PIN/OTP until user finishes
 */
export class AgentSession {
  private readonly agent: KokoAgent;
  private readonly gateway: GatewayClient;
  private readonly opts: AgentSessionOptions;
  private sessionId: string | undefined;
  private history: AgentHistoryItem[] = [];
  private stopped = false;
  private running = false;
  private readonly operationReplayGuard = new OperationReplayGuard();

  constructor(agent: KokoAgent, opts: AgentSessionOptions) {
    this.agent = agent;
    this.gateway = new GatewayClient({
      token: opts.token,
      tokenProvider: opts.tokenProvider,
      baseUrl: opts.baseUrl,
      appId: opts.appId,
    });
    this.opts = opts;
  }

  stop() {
    this.stopped = true;
    this.agent.cancelPendingActions();
  }

  private uiLocale() {
    return currentLocale(this.opts.locale ?? this.agent.getConfig().locale);
  }

  private text(key: MessageKey, vars?: MessageVars) {
    return runtimeText(key, vars, this.opts.locale ?? this.agent.getConfig().locale);
  }

  private message(key: MessageKey, vars?: MessageVars) {
    return message(key, vars, this.opts.locale ?? this.agent.getConfig().locale);
  }

  private assertRunning() {
    if (this.stopped) throw new Error('KokoAgent: task cancelled');
  }

  async run(goal: string): Promise<AgentRunResult> {
    if (this.running) throw new Error(this.text('runtime.alreadyRunning'));
    const acquired = this.agent.acquireSession(this);
    this.running = true;
    try {
      return await this.runInternal(goal);
    } finally {
      this.running = false;
      if (acquired) this.agent.releaseSession(this);
    }
  }

  private async runInternal(goal: string): Promise<AgentRunResult> {
    // A stop issued while runGoal persists its checkpoint must remain effective.
    this.operationReplayGuard.reset();
    this.history = [];
    this.sessionId = undefined;
    // Mark running immediately so host freezeOnBlur stays off across sheet→run gap.
    this.agent.startTask(goal);
    const cfg = this.agent.getConfig();
    AgentDebug.runStart(cfg, goal);
    // Only after startTask: appendNode with no active task invents a task of
    // its own that nothing ever finishes.
    if (this.opts.resumedFromReload) {
      this.agent.log('info', this.message('resume.note'));
    }
    // A resumed run starts blind: the action that reloaded the App probably
    // already achieved the goal, and labels learned before the reload may be
    // gone (a locale change renames every one of them). Without this the
    // planner starts over, fails to re-find its entry point and reports a
    // false failure for work that in fact succeeded. Planner-only — the task
    // title and every goal heuristic keep the user's original wording.
    const plannerGoal = () => this.opts.resumedFromReload
      ? `${goal}\n\n${this.text('resume.verifyFirst')}`
      : goal;
    if (this.stopped) {
      this.agent.finishTask('cancelled', this.message('runtime.cancelled'));
      return { success: false, summary: this.text('runtime.cancelled'), steps: 0, sessionId: '' };
    }
    const preflightOk = await runPreflightConfirm(
      goal,
      cfg.confirmation,
      cfg.onConfirmSensitive,
    );
    if (!preflightOk || this.stopped) {
      const summary = this.stopped ? this.text('runtime.cancelled') : this.text('runtime.confirmationCancelled');
      this.agent.finishTask('cancelled', summary);
      return { success: false, summary, steps: 0, sessionId: '' };
    }

    // Soft budget extends while making progress; only HARD + isLooping stop a run.
    let stepBudget = SOFT_MAX_STEPS;
    let userReply: string | undefined;
    let awaitingObservationVerdict = false;
    this.agent.activeGoal = goal;

    try {
      // Session + permit before first dump (production soft gate).
      this.assertRunning();
      const began = await this.gateway.beginSession();
      this.assertRunning();
      this.sessionId = began.session_id;
      ExecutionGuard.setPermit(began.execution_permit, began.session_id);

      const initialGate = await this.waitForAppUserGateIfNeeded();
      if (initialGate === 'stopped' || initialGate === 'timeout') {
        const summary = initialGate === 'stopped' ? this.text('runtime.cancelled') : this.text('runtime.gateTimeout');
        this.agent.finishTask(initialGate === 'stopped' ? 'cancelled' : 'failed', summary);
        return { success: false, summary, steps: 0, sessionId: this.sessionId || '' };
      }

      await ExplorationGraph.ensureLoaded();
      this.assertRunning();
      const exploreQuery = goalExploreQuery(goal);

      // Learned paths are suggestions in the screen model. Every action still
      // goes through the planner, current-screen guards and result observation.

      for (let step = 0; step < HARD_MAX_STEPS; step++) {
        // Age of the checkpoint gates resume, so it has to track liveness
        // rather than when the run began.
        void RunCheckpoint.touch().catch(() => {});
        if (this.stopped) {
          this.agent.finishTask('cancelled', this.message('runtime.cancelled'));
          return {
            success: false,
            summary: this.text('runtime.cancelled'),
            steps: this.history.length,
            sessionId: this.sessionId || '',
          };
        }

        // Still progressing → extend soft budget (KokoAgent-style).
        if (
          step >= stepBudget &&
          stepBudget < HARD_MAX_STEPS &&
          !isLooping(this.history)
        ) {
          stepBudget = Math.min(HARD_MAX_STEPS, stepBudget + 8);
          this.agent.log(
            'info',
            this.message('runtime.progressBudget', { steps: stepBudget }),
          );
        }

        // App-owned auth: wait for user, do not open Koko Q&A.
        const gateWait = await this.waitForAppUserGateIfNeeded();
        if (gateWait === 'stopped') {
          this.agent.finishTask('cancelled', this.message('runtime.cancelled'));
          return {
            success: false,
            summary: this.text('runtime.cancelled'),
            steps: this.history.length,
            sessionId: this.sessionId || '',
          };
        }
        if (gateWait === 'timeout') {
          this.agent.finishTask('failed', this.message('runtime.gateTimeout'));
          return {
            success: false,
            summary: this.text('runtime.gateTimeout'),
            steps: this.history.length,
            sessionId: this.sessionId || '',
          };
        }

        const tree = await this.safeDump();
        this.assertRunning();
        // The screen can change between the gate poll and this dump. Do not
        // run OCR or construct a cloud request for a newly presented gate.
        if (detectAppUserGate(tree)) {
          step--;
          continue;
        }
        this.agent.setPlanningTree(tree);
        const outline = tree ? viewTreeOutline(tree) : undefined;
        const gate = detectAppUserGate(tree);
        const visibleHosts = filterVisibleHostActions(
          HostActionsStore.getActions(),
          tree,
        );
        const exploreHints = tree
          ? ExplorationGraph.hintLabelsTowardGoal(
              affordanceLabels(tree),
              exploreQuery.targetTokens,
              6,
            )
          : [];
        // On-device assist (JS intent/rank + iOS Vision/Core ML OCR) enriches
        // the planner model; cloud LLM still owns action planning.
        const assist = await buildOnDeviceAssist(goal, tree);
        this.assertRunning();
        let hostWalletAliases = cfg.webWalletAliases || [];
        if (assist.walletChoices?.length && hostWalletAliases.length && tree) {
          const frame = visibleWebViewFrames(tree)[0];
          if (frame) {
            try {
              const flags = await NativeBridge.inspectWebWalletProvider({
                x: frame.x + frame.width / 2, y: frame.y + frame.height / 2,
              });
              if (flags && (!flags.present || !flags.hasRequest)) hostWalletAliases = [];
              else if (flags && !flags.isMetaMask) hostWalletAliases = hostWalletAliases.filter(alias => alias !== 'MetaMask');
            } catch {
              // A failed provider inspection is not evidence of an injected wallet.
              hostWalletAliases = [];
            }
            this.assertRunning();
          }
        }
        const hostModel = [
          hostActionsModelText(visibleHosts),
          exploreHintsModelText(exploreHints),
          userGateModelText(gate),
          assist.modelText,
        ]
          .filter(Boolean)
          .join('\n');
        const model = tree
          ? screenModelText(tree, 40, hostModel || undefined)
          : hostModel || undefined;
        if (assist.modelText && AgentDebug.enabled(cfg)) {
          // eslint-disable-next-line no-console
          console.log(
            `[koko] on-device assist: intent=${assist.intent} backend=${assist.backend} ranked=${assist.ranked.length} ocr=${assist.ocrTokens.length}`,
          );
        }
        // Debug: what raw texts did native dump actually return?
        if (tree && AgentDebug.enabled(cfg)) {
          const texts: string[] = [];
          const walk = (n: ViewNode) => {
            const t = (n.text || n.accessibilityLabel || '').trim();
            if (t && t.length <= 40) texts.push(t);
            if (n.testID) texts.push(`#${n.testID}`);
            for (const c of n.children) walk(c);
          };
          walk(tree);
          const uniq = [...new Set(texts)].slice(0, 40);
          // eslint-disable-next-line no-console
          console.log(
            `[koko] dump texts (${uniq.length}): ${uniq.join(' · ').slice(0, 500)}`,
          );
        }
        AgentDebug.screenCapabilities(cfg, tree);

        const planningLocale = gatewayLocale(this.uiLocale());
        let next: Awaited<ReturnType<GatewayClient['next']>>;
        try {
          next = await this.nextWithRetry({
          session_id: this.sessionId,
          goal: this.operationReplayGuard.hasHandoff
            ? `${plannerGoal()}\n\n${this.text('gate.verifyResultFirst')}`
            : plannerGoal(),
          ui_tree: tree || undefined,
          ui_outline: outline,
          ui_screen_model: model,
          local_ocr_goal_labels: assist.goalOcrLabels,
          local_ocr_wallet_choices: assist.walletChoices,
          local_web_wallet_aliases: hostWalletAliases,
          history: this.history,
          locale: planningLocale,
          user_reply: userReply,
          platform:
            Platform.OS === 'ios'
              ? 'ios'
              : Platform.OS === 'android'
                ? 'android'
                : 'unknown',
          });
        } catch (error) {
          if (error instanceof SensitiveScreenError) {
            this.operationReplayGuard.markHandoff();
            this.history = [];
            step--;
            continue;
          }
          throw error;
        }
        this.assertRunning();
        userReply = undefined;
        this.sessionId = next.session_id;
        ExecutionGuard.setPermit(next.execution_permit, next.session_id);
        // A response planned in the previous language must not put stale
        // narration/questions/results back into the live progress UI.
        if (planningLocale !== gatewayLocale(this.uiLocale())) {
          this.pushHistory({ tool: 'dump', args: {} }, this.text('runtime.localeChanged'), false);
          step--;
          continue;
        }

        UsageBus.emit({
          type: 'agent_step',
          sessionId: next.session_id,
          step: next.step,
          tool: next.action.tool,
          at: Date.now(),
        });
        AgentDebug.appAction(
          cfg,
          next.step,
          next.action.tool,
          actionDetail(next.action),
        );

        // After repeated read-only observations, the gateway may only return a
        // final evidence-based verdict. Never turn this review into another act.
        if (awaitingObservationVerdict && next.action.tool !== 'done') {
          this.agent.finishTask('failed', this.message('runtime.loopStopped'));
          return { success: false, summary: this.text('runtime.loopStopped'),
            steps: this.history.length, sessionId: this.sessionId || '' };
        }

        let recentAction = recentSearchAction(next.action, tree, goal) ||
          (!awaitingObservationVerdict ? webResultCategory(next.action, tree, goal, this.history) : null);
        let hostWalletChoice = false;
        if (!recentAction && !awaitingObservationVerdict && next.action.tool === 'dump' && tree && assist.walletChoices?.length) {
          const aliases = hostWalletAliases.filter(alias => assist.walletChoices!.includes(alias));
          const alias = aliases.length === 1 ? aliases[0] : undefined;
          const attempted = alias && this.history.some(item => item.tool === 'tap' &&
            String(item.args?.label || '').toLocaleLowerCase().includes(alias.toLocaleLowerCase()));
          if (alias && !attempted) {
            const target = await this.agent.find({ match: [{ text: alias, exact: true }] }, tree);
            this.assertRunning();
            if (target && ocrHitInFrames({ text: alias, confidence: 1, frame: target.frame }, visibleWebViewFrames(tree))) {
              recentAction = { tool: 'tap', args: { nodeId: target.id, label: alias } };
              hostWalletChoice = true;
            }
          }
        }
        if (recentAction) {
          this.agent.log('info', gatewayLocale(this.uiLocale()) === 'zh'
            ? (hostWalletChoice ? '选择宿主钱包入口。' : next.action.tool === 'type' ? '使用匹配的最近搜索。' : '选择相关应用分类。')
            : (hostWalletChoice ? 'Selecting the host wallet.' : next.action.tool === 'type' ? 'Using the matching recent search.' : 'Selecting the relevant app category.'));
        } else if (next.narration) {
          this.opts.onNarration?.(next.narration);
          this.agent.log('info', next.narration);
        }

        const action = recentAction || next.action;
        if (wrongHostWalletChoice(goal, action, assist.walletChoices || [], hostWalletAliases,
          action.tool === 'tap' ? this.agent.observedOcrLabel(action.args.nodeId) : undefined)) {
          this.pushHistory(action, 'Host wallet does not match this option; select the configured host wallet or try another browser mode.', false);
          if (isLooping(this.history)) {
            this.agent.finishTask('failed', this.message('runtime.loopStopped'));
            return { success: false, summary: this.text('runtime.loopStopped'), steps: this.history.length, sessionId: this.sessionId || '' };
          }
          continue;
        }
        if (action.tool === 'done') {
          this.pushHistory(action, action.args.summary, action.args.success);
          this.agent.finishTask(
            action.args.success ? 'success' : 'failed',
            action.args.summary,
          );
          AgentDebug.runEnd(cfg, action.args.summary, action.args.success);
          return {
            success: action.args.success,
            summary: action.args.summary,
            steps: this.history.length,
            sessionId: this.sessionId,
          };
        }

        if (action.tool === 'ask_user') {
          this.agent.log(
            'info',
            this.message('runtime.waitForApp', { request: action.args.question }),
          );
          this.opts.onNarration?.(
            this.text('runtime.waitForApp', { request: action.args.question }),
          );
          const w = await this.waitForAppUserGateIfNeeded({
            forceMessage: action.args.question,
            minWaitMs: 1500,
          });
          this.pushHistory(
            action,
            w === 'cleared'
              ? this.text('runtime.userContinued')
              : w === 'timeout'
                ? this.text('runtime.userTimeout')
                : this.text('runtime.cancelled'),
            w === 'cleared',
          );
          if (w === 'stopped' || w === 'timeout') {
            const summary = w === 'stopped' ? this.text('runtime.cancelled') : this.text('runtime.userTimeout');
            this.agent.finishTask(w === 'stopped' ? 'cancelled' : 'failed', summary);
            return {
              success: false,
              summary,
              steps: this.history.length,
              sessionId: this.sessionId,
            };
          }
          if (isLooping(this.history)) {
            this.agent.finishTask('failed', this.message('runtime.loopStopped'));
            return {
              success: false,
              summary: this.text('runtime.loopStopped'),
              steps: this.history.length,
              sessionId: this.sessionId,
            };
          }
          userReply = this.text('runtime.userContinued');
          continue;
        }

        const beforeSnap = tree ? screenSnapshotLine(tree) : '';
        const webTap = action.tool === 'tap' && Boolean(action.args.nodeId?.startsWith('ocr:'));
        const beforeWeb = webTap ? await this.webVisualLabels(tree) : null;
        this.assertRunning();
        const beforeLabels = affordanceLabels(tree);
        if (this.operationReplayGuard.blocks(action, tree)) {
          const summary = this.text('gate.replayStopped');
          this.agent.log('info', summary);
          this.agent.finishTask('failed', summary);
          return { success: false, summary, steps: this.history.length, sessionId: this.sessionId || '' };
        }
        const exec = await this.executeWithRetry(action);
        this.assertRunning();
        if (exec.ok) this.operationReplayGuard.record(action, tree);
        // Let host animations / navigation commit before noop detection.
        if (action.tool === 'tap' || action.tool === 'swipe' || action.tool === 'type') {
          await sleep(280);
        }
        let after = await this.safeDump();
        this.assertRunning();
        let snap = after ? screenSnapshotLine(after) : '';
        // Dump raced navigation / host async work — give UI one more beat.
        if (
          action.tool === 'tap' &&
          exec.ok &&
          beforeSnap &&
          snap &&
          beforeSnap === snap
        ) {
          await sleep(550);
          after = await this.safeDump();
          this.assertRunning();
          snap = after ? screenSnapshotLine(after) : '';
        }
        // Window subviews stack in the order they were added, so a host sheet
        // that animates in after the action lands above our chrome and buries
        // the progress pill and its stop button. Re-front once the screen has
        // settled, which is the first moment that sheet actually exists.
        TaskStore.liftChrome();
        // Grow on-device exploration graph from successful taps.
        if (action.tool === 'tap' && exec.ok && !sensitiveScreenKind(after)) {
          const tapLabel = String(
            action.args.label ||
              this.agent.lastTapViaHost?.label ||
              '',
          ).trim();
          if (tapLabel) {
            ExplorationGraph.recordTransition(
              beforeLabels,
              tapLabel,
              affordanceLabels(after),
            );
          }
        }
        let ok = exec.ok;
        if (action.tool === 'swipe' && exec.ok && tree && after && !sensitiveScreenKind(after)) {
          const beforePosition = scrollPosition(tree, action.args.from);
          const afterPosition = scrollPosition(after, action.args.from);
          if (beforePosition && afterPosition) {
            snap += ` scroll_position=${afterPosition}`;
            if (beforePosition === afterPosition) {
              ok = false;
              exec.result = this.text('runtime.scrollNoop');
            } else {
              exec.result = this.text('runtime.scrollChanged');
            }
          }
        }
        let resultWithObs = snap ? `${exec.result} || ${snap}` : exec.result;
        const changedWeb = webTap && exec.ok ? webVisualChanged(beforeWeb, await this.webVisualLabels(after)) : false;
        this.assertRunning();
        if (changedWeb) resultWithObs = `${exec.result} (web content changed; verify the new state) || ${snap}`;
        // `lastTapViaHost` is only set once the agent has confirmed the host
        // action moved the screen, so it annotates the trace but no longer
        // exempts the step from noop detection.
        const viaHost = Boolean(this.agent.lastTapViaHost);
        if (viaHost && action.tool === 'tap' && exec.ok) {
          resultWithObs = snap
            ? `${exec.result} (host run) || ${snap}`
            : `${exec.result} (host run)`;
        }
        if (
          // Tap claimed success but UI fingerprint unchanged → treat as noop so
          // loop detection / planner can escape instead of empty dumping.
          // Skip when both sides are empty — that is dump failure, not a dead tap.
          action.tool === 'tap' &&
          exec.ok &&
          !changedWeb &&
          beforeSnap &&
          snap &&
          beforeSnap === snap &&
          snap !== 'screen: (empty)'
        ) {
          ok = false;
          resultWithObs = `tap_noop (screen unchanged) || ${snap}`;
        }
        if (assist.walletChoices?.length) {
          // Only allowlisted public names are kept; no raw OCR or account data.
          resultWithObs += ` || visible wallet options: ${assist.walletChoices.join(', ')}`;
        }
        this.pushHistory(action, resultWithObs, ok);

        if (isLooping(this.history)) {
          const lastThree = this.history.slice(-3);
          if (!awaitingObservationVerdict && lastThree.length === 3 && lastThree.every(h => h.tool === 'dump')) {
            // The last observation may already prove the goal. Ask for one
            // read-only verdict instead of treating a stall as evidence of failure.
            awaitingObservationVerdict = true;
            continue;
          }
          this.agent.finishTask('failed', this.message('runtime.loopStopped'));
          AgentDebug.runEnd(cfg, this.text('runtime.loopStopped'), false);
          return {
            success: false,
            summary: this.text('runtime.loopStopped'),
            steps: this.history.length,
            sessionId: this.sessionId || '',
          };
        }

        await this.waitForAppUserGateIfNeeded();
      }

      this.agent.finishTask('failed', this.message('runtime.stepLimit'));
      return {
        success: false,
        summary: this.text('runtime.stepLimit'),
        steps: this.history.length,
        sessionId: this.sessionId || '',
      };
    } catch (e) {
      if (this.stopped) {
        this.agent.finishTask('cancelled', this.message('runtime.cancelled'));
        return { success: false, summary: this.text('runtime.cancelled'), steps: this.history.length, sessionId: this.sessionId || '' };
      }
      const diagnostic = e instanceof Error ? e.message : String(e);
      const copy = e instanceof GatewayUpgradeRequiredError
        ? this.message('runtime.sdkTooOld')
        : e instanceof ActionOutcomeUnknownError || e instanceof ActionValidationError
          ? e.localizedMessage : this.message('runtime.operationFailed');
      const failureMessage = resolveText(copy);
      if (e instanceof GatewayError && e.code === 'quota_exceeded') {
        UsageBus.emit({
          type: 'quota_exceeded',
          message: failureMessage,
          quota: e.quota,
          at: Date.now(),
        });
        if (this.opts.token) {
          void AccountStore.refresh({
            token: this.opts.token,
            baseUrl: this.opts.baseUrl,
          });
        }
      }
      AgentDebug.runIssue(cfg, diagnostic);
      this.agent.log('error', copy);
      this.agent.finishTask('failed', copy);
      return {
        success: false,
        summary: failureMessage,
        steps: this.history.length,
        sessionId: this.sessionId || '',
      };
    } finally {
      this.agent.activeGoal = undefined;
      ExecutionGuard.clear();
    }
  }

  private pushHistory(action: GatewayAction, result: string, ok?: boolean) {
    this.history.push({
      tool: action.tool,
      args: 'args' in action ? (action.args as Record<string, unknown>) : undefined,
      result,
      ok,
    });
  }

  /** Retry transient upstream / network failures so a completed UI goal is not
   * marked failed just because the next planning round could not reach the LLM. */
  private async nextWithRetry(
    body: Parameters<GatewayClient['next']>[0],
  ): Promise<Awaited<ReturnType<GatewayClient['next']>>> {
    const maxAttempts = 3;
    let last: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      this.assertRunning();
      try {
        const result = await this.gateway.next(body);
        this.assertRunning();
        return result;
      } catch (e) {
        this.assertRunning();
        last = e;
        const msg = e instanceof Error ? e.message : String(e);
        const status = e instanceof GatewayError ? e.status : 0;
        const retryable =
          status === 502 ||
          status === 503 ||
          status === 504 ||
          /fetch failed|network request failed|ECONNRESET|ETIMEDOUT|upstream_failed|socket/i.test(
            msg,
          );
        if (!retryable || i === maxAttempts - 1) throw e;
        AgentDebug.runIssue(
          this.agent.getConfig(),
          this.text('runtime.gatewayRetry', { attempt: i + 1, total: maxAttempts - 1 }),
        );
        await sleep(500 * (i + 1));
      }
    }
    throw last;
  }

  private async safeDump(): Promise<ViewNode | null> {
    try {
      let tree = await this.agent.dump({ silent: true });
      if (sensitiveScreenKind(tree)) return tree;
      // Loading / transition settle: empty screens often need a beat.
      for (let i = 0; i < 3; i++) {
        const items = tree ? extractAffordances(tree, 8) : [];
        if (items.length > 0) break;
        await sleep(350);
        if (this.stopped) break;
        tree = await this.agent.dump({ silent: true });
      }
      return tree;
    } catch {
      return null;
    }
  }

  private async webVisualLabels(tree: ViewNode | null): Promise<Set<string> | null> {
    if (!tree || sensitiveScreenKind(tree) || !NativeBridge.isAvailable()) return null;
    try {
      const ocr = await NativeBridge.recognizeScreenText({ maxTokens: 64, hideOverlays: true });
      return webVisualLabels(tree, ocr.texts || []);
    } catch {
      return null;
    }
  }

  /**
   * When the App presents credentials or recovery material, wait locally.
   * Koko does not collect secrets — user types in the App UI.
   */
  private async waitForAppUserGateIfNeeded(opts?: {
    forceMessage?: string;
    minWaitMs?: number;
  }): Promise<'cleared' | 'timeout' | 'stopped' | 'none'> {
    const tree = await this.safeDump();
    const gate = tree ? detectAppUserGate(tree) : detectAppUserGate(null);
    if (!gate && !opts?.forceMessage) return 'none';
    if (sensitiveScreenKind(tree)) {
      this.operationReplayGuard.markHandoff();
      this.history = [];
    }

    const msg = gate
      ? gateMessageValue(gate, this.opts.locale ?? this.agent.getConfig().locale)
      : opts?.forceMessage
        ? this.message('runtime.waitForApp', { request: opts.forceMessage })
        : this.message('runtime.inputInApp');

    this.agent.log('info', msg);
    this.opts.onNarration?.(resolveText(msg));
    TaskStore.setUserGateWaiting(msg);
    const waitNode = TaskStore.appendNode({
      kind: 'confirm',
      title: msg,
      status: 'running',
    });

    const timeout = this.opts.userGateTimeoutMs ?? 300_000;
    const pollMs = 700;
    const started = Date.now();
    const minWait = opts?.minWaitMs ?? 0;
    let checkedResumeAt = started;
    let fingerprint = gate
      ? `${gate.kind}:${gate.nodeId}:${gate.label}`
      : `force:${opts?.forceMessage ?? ''}`;

    try {
      while (Date.now() - started < timeout) {
        if (this.stopped) return 'stopped';
        await sleep(pollMs);
        if (this.stopped) return 'stopped';

        // A status check is not permission to bypass a still-private page.
        if (AppUserGateStore.wasManuallyResumedSince(checkedResumeAt)) {
          checkedResumeAt = Date.now() + 1;
          const current = await this.safeDump();
          if (current && !sensitiveScreenKind(current) && !AppUserGateStore.getHostGate()) {
            TaskStore.updateNode(waitNode.id, {
              status: 'done',
              title: this.message('runtime.gateConfirmed'),
            });
            return 'cleared';
          }
          const feedback = this.message(current ? 'gate.stillPrivate' : 'gate.unreadable');
          TaskStore.setUserGateWaiting(feedback);
          TaskStore.updateNode(waitNode.id, { title: feedback });
          continue;
        }

        const now = await this.safeDump();
        if (!now) continue;
        const g2 = detectAppUserGate(now);
        if (!g2) {
          if (Date.now() - started >= minWait) {
            TaskStore.updateNode(waitNode.id, {
              status: 'done',
              title: this.message('runtime.gateCompleted'),
            });
            return 'cleared';
          }
          continue;
        }
        const fp2 = `${g2.kind}:${g2.nodeId}:${g2.label}`;
        if (fp2 !== fingerprint) {
          fingerprint = fp2;
          const nextMsg = gateMessageValue(g2, this.opts.locale ?? this.agent.getConfig().locale);
          this.opts.onNarration?.(resolveText(nextMsg));
          TaskStore.setUserGateWaiting(nextMsg);
          TaskStore.updateNode(waitNode.id, { title: nextMsg });
        }
      }
      TaskStore.updateNode(waitNode.id, {
        status: 'failed',
        title: this.message('runtime.gateInputTimeout'),
      });
      return 'timeout';
    } finally {
      TaskStore.setUserGateWaiting(null);
    }
  }

  private async executeWithRetry(
    action: GatewayAction,
  ): Promise<{ ok: boolean; result: string }> {
    // Only observations are safe to repeat after an exception. A rejected
    // native promise or timed-out host callback can follow a committed action.
    const readOnly = action.tool === 'dump' || action.tool === 'find';
    const configured = this.opts.localRetries ?? 3;
    const retries = readOnly && Number.isFinite(configured)
      ? Math.max(0, Math.min(3, Math.floor(configured))) : 0;
    let last = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.assertRunning();
      try {
        const result = await this.executeOnce(action);
        this.assertRunning();
        return { ok: true, result };
      } catch (e) {
        this.assertRunning();
        last = e instanceof Error ? e.message : String(e);
        if (e instanceof ActionValidationError || e instanceof SensitiveScreenError) {
          // The action was rejected before dispatch; let the planner observe
          // and choose a different target without replaying a real touch.
          return { ok: false, result: `pre_dispatch: ${last}` };
        }
        if (!readOnly) throw e instanceof ActionOutcomeUnknownError ? e : new ActionOutcomeUnknownError(last);
        if (attempt < retries) await sleep(200);
      }
    }
    return { ok: false, result: last || 'failed' };
  }

  private async executeOnce(action: GatewayAction): Promise<string> {
    switch (action.tool) {
      case 'dump': {
        const tree = await this.agent.dump();
        return `dumped || ${screenSnapshotLine(tree)}`;
      }
      case 'find': {
        const selector = {
          match: action.args.match as Selector['match'],
          index: action.args.index,
        };
        // A model lookup observes the current page; it must not secretly turn
        // into a scroll search before the planner considers visible navigation.
        const currentTree = await this.safeDump();
        if (!currentTree) throw new Error(this.text('runtime.unreadable'));
        const node = await this.agent.find(selector, currentTree);
        if (!node) return 'null';
        return JSON.stringify({
          id: node.id,
          text: node.text,
          accessibilityLabel: node.accessibilityLabel,
          clickable: node.clickable,
          selected: node.selected,
          enabled: node.enabled,
          visible: node.visible,
          secure: node.secure,
          frame: node.frame,
        });
      }
      case 'tap': {
        await this.agent.tap({
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          point: action.args.point,
          label: action.args.label,
          options: { revealIfNeeded: false },
        });
        return `tapped ${action.args.label || action.args.nodeId || 'target'}`;
      }
      case 'swipe': {
        await this.agent.swipe(action.args.from, action.args.to);
        return 'swiped';
      }
      case 'pinch': {
        await this.agent.pinch(action.args.center, action.args.scale);
        return `pinched scale=${action.args.scale}`;
      }
      case 'type': {
        // Never type into secure fields — wait for user instead.
        const root = await this.safeDump();
        this.assertRunning();
        if (root && detectAppUserGate(root)) {
          await this.waitForAppUserGateIfNeeded();
          return 'skipped type: waited for user secure input';
        }
        await this.agent.type(action.args.text, {
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          options: { clear: action.args.clear },
          label: action.args.label,
        });
        return `typed ${action.args.text.slice(0, 40)}`;
      }
      default:
        return 'noop';
    }
  }
}

function actionDetail(action: GatewayAction): string | undefined {
  switch (action.tool) {
    case 'tap':
      return action.args.label;
    case 'type':
      return action.args.label || action.args.text?.slice(0, 24);
    case 'swipe':
      return action.args.label;
    case 'pinch':
      return action.args.label || `×${action.args.scale}`;
    case 'find': {
      const first = action.args.match?.[0] as { text?: string } | undefined;
      return first?.text;
    }
    case 'ask_user':
      return action.args.question?.slice(0, 60);
    case 'done':
      return action.args.summary?.slice(0, 80);
    default:
      return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
