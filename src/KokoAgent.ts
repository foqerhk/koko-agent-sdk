import { Dimensions, Platform } from 'react-native';
import { CursorController } from './cursor/controller';
import { isSensitiveLabel, runConfirmationGate } from './confirmation/gate';
import { NativeBridge } from './native/NativeBridge';
import { executeAgentAction } from './protocol/actions';
import { centerOf, centerOfLabel, find, findAll, findBySoftLabel, findNodeById, flattenTree } from './selector/match';
import { sensitiveScreenKind } from './privacy/sensitiveScreen';
import { boundedScrollGesture, scrollViewports } from './native/scrollViewport';
import { canRunHostActionForNode, HostActionsStore, runHostAction } from './host/HostActions';
import { screenSnapshotLine } from './privacy/screenModel';
import { TaskStore, type TaskStoreImpl } from './task/TaskStore';
import { AgentSession, type AgentSessionOptions } from './client/AgentSession';
import { RunCheckpoint } from './client/RunCheckpoint';
import { ActionOutcomeUnknownError, ActionValidationError } from './client/ActionOutcomeUnknownError';
import { ExplorationGraph } from './explore/ExplorationGraph';
import { DialogBus } from './ui/KokoDialogHost';
import { pointsOverlapProgressChrome } from './ui/progressChrome';
import { UsageBus } from './commercial/UsageBus';
import { AccountStore } from './commercial/AccountStore';
import { ExecutionGuard } from './commercial/ExecutionGuard';
import { AgentDebug } from './commercial/AgentDebug';
import { gatewayLocale, currentLocale, t, runtimeText, message, type MessageKey, type MessageVars, type LocalizedText } from './i18n';
import { findOcrTextHit, ocrHitInFrames, visibleWebViewFrames } from './assist/ocrTarget';
import type {
  AgentAction,
  AgentActionResult,
  DumpOptions,
  KokoAgentConfig,
  PinchOptions,
  Point,
  Selector,
  SensitiveConfirmContext,
  SwipeOptions,
  TapOptions,
  TypeOptions,
  ViewNode,
} from './types';

export type TapTarget = {
  selector?: Selector;
  nodeId?: string;
  point?: Point;
  options?: TapOptions;
  /** Used by confirmation gate + subtitle. */
  label?: string;
  /** Internal: preserve input-field targeting while focusing a type action. */
  inputTarget?: boolean;
};

export type TypeTarget = {
  selector?: Selector;
  nodeId?: string;
  options?: TypeOptions;
  label?: string;
};

/**
 * Koko Agent SDK runtime — dump / find / tap / swipe / pinch / type + cursor + confirm gate + task log.
 */
export class KokoAgent {
  private config: KokoAgentConfig;
  private lastTree: ViewNode | null = null;
  private planningTree: ViewNode | null = null;
  // OCR ids are local references to observed text, never caller-supplied points.
  private readonly ocrTargets = new Map<string, { text: string; webview: boolean }>();
  private nextOcrTargetId = 0;
  /** Labels already confirmed in the current runGoal — avoid repeat dialogs on retry. */
  private confirmedSensitive = new Set<string>();
  /** Last tap used a host `run` callback (tab/CTA) — skip false tap_noop. */
  lastTapViaHost: { kind?: string; label?: string } | null = null;
  /** Current NL goal; direct SDK callers may opt into visible scroll search. */
  activeGoal?: string;

  constructor(config: KokoAgentConfig = {}) {
    this.config = {
      dumpMaxDepth: 80,
      dumpSkipInvisible: true,
      cursorDurationMs: 480,
      observer: true,
      ...config,
      confirmation: {
        requireUserConfirm: true,
        mode: 'preflight',
        ...config.confirmation,
      },
    };
    if (!this.config.onConfirmSensitive) {
      this.config.onConfirmSensitive = async (ctx) => {
        const locale = currentLocale(this.config.locale);
        const label = ctx.label ?? ctx.action;
        return DialogBus.requestConfirm(
          ctx.action === 'preflight'
            ? t(locale, 'confirm.preflightTitle')
            : t(locale, 'confirm.inlineTitle'),
          ctx.action === 'preflight'
            ? t(locale, 'confirm.preflightBody', { label })
            : t(locale, 'confirm.inlineBody', { label }),
        );
      };
    }
  }

  configure(patch: Partial<KokoAgentConfig>) {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): KokoAgentConfig {
    return this.config;
  }

  private message(key: MessageKey, vars?: MessageVars) {
    return message(key, vars, this.config.locale);
  }

  private text(key: MessageKey, vars?: MessageVars) {
    return runtimeText(key, vars, this.config.locale);
  }

  isNativeReady(): boolean {
    return NativeBridge.isAvailable();
  }

  /** Start a user-facing task (shows subtitle + appears in panel). */
  startTask(title: string) {
    this.confirmedSensitive.clear();
    this.ocrTargets.clear();
    this.planningTree = null;
    const task = TaskStore.startTask(title);
    UsageBus.emit({
      type: 'task_started',
      taskId: task.id,
      goal: title,
      at: Date.now(),
    });
    return task;
  }

  finishTask(
    status: 'success' | 'failed' | 'cancelled' = 'success',
    summary?: LocalizedText,
  ) {
    this.confirmedSensitive.clear();
    CursorController.hide();
    const snap = TaskStore.snapshot();
    const active = snap.tasks.find((t) => t.id === snap.activeTaskId);
    TaskStore.finishTask(status, undefined, summary);
    UsageBus.emit({
      type: 'task_finished',
      taskId: active?.id,
      status,
      steps: active?.nodes?.length,
      at: Date.now(),
    });
  }

  /** Manually append an observer log node (for cloud agent narration). */
  log(
    kind: Parameters<typeof TaskStore.appendNode>[0]['kind'],
    title: LocalizedText,
    detail?: string,
  ) {
    if (this.config.observer === false) return null;
    return TaskStore.appendNode({ kind, title, detail, status: 'done' });
  }

  /** Open a cloud-backed agent session (official gateway; LLM vendor is server-side). */
  createSession(opts: AgentSessionOptions): AgentSession {
    return new AgentSession(this, {
      ...opts,
      onAskUser: opts.onAskUser ?? ((q) => DialogBus.requestAsk(q)),
    });
  }

  /**
   * One-shot: talk to official gateway → local dump/find/tap until done.
   * Users never supply model API keys. Token comes from opts or KokoProvider config.gateway.
   */
  private activeSession: AgentSession | null = null;
  private executionEpoch = 0;
  private claimingCheckpoint = false;

  /** @internal Sessions created through createSession share runGoal's owner. */
  acquireSession(session: AgentSession): boolean {
    if ((this.activeSession && this.activeSession !== session) || this.claimingCheckpoint) {
      throw new Error(runtimeText('runtime.alreadyRunning', undefined, this.config?.locale));
    }
    const acquired = !this.activeSession;
    this.activeSession = session;
    return acquired;
  }

  /** @internal Release only an owner acquired by a direct session.run(). */
  releaseSession(session: AgentSession) {
    if (this.activeSession === session) this.activeSession = null;
  }

  /** @internal Invalidates gestures already waiting on confirmation/animation. */
  cancelPendingActions() {
    this.executionEpoch++;
    CursorController.hide();
  }

  private assertExecutionCurrent(epoch: number) {
    if (epoch !== this.executionEpoch) throw new Error('KokoAgent: task cancelled');
  }

  async runGoal(
    goal: string,
    opts?: Partial<AgentSessionOptions> & { resumes?: number },
  ) {
    if (this.activeSession || this.claimingCheckpoint) {
      throw new Error(runtimeText('runtime.alreadyRunning', undefined, this.config?.locale));
    }
    const gateway = {
      token: opts?.token ?? this.config.gateway?.token,
      tokenProvider: opts?.tokenProvider ?? this.config.gateway?.tokenProvider,
      appId: opts?.appId ?? this.config.gateway?.appId,
    };
    if (!gateway.token && !gateway.tokenProvider) {
      throw new Error(
        this.text('runtime.missingToken'),
      );
    }
    const baseUrl = opts?.baseUrl ?? this.config.gateway?.baseUrl;
    const locale = gatewayLocale(
      currentLocale(opts?.locale ?? this.config.locale),
    );
    void AccountStore.refresh({ ...gateway, baseUrl });
    const session = this.createSession({
      locale,
      resumedFromReload: (opts?.resumes ?? 0) > 0,
      localRetries: opts?.localRetries,
      userGateTimeoutMs: opts?.userGateTimeoutMs,
      onAskUser: opts?.onAskUser,
      onNarration: opts?.onNarration,
      baseUrl,
      ...gateway,
    });
    this.activeSession = session;
    // An action can take down the context running it (locale/theme/RTL change,
    // feature-flag remount). Persist the goal so the next init can resume it;
    // see RunCheckpoint. Never let storage trouble block a run.
    try {
      await RunCheckpoint.begin(goal, opts?.resumes ?? 0).catch(() => {});
      return await session.run(goal);
    } finally {
      // Keep ownership until cleanup settles; stop() must not let a second run
      // overlap an outstanding gateway response or pending native gesture.
      await RunCheckpoint.clear().catch(() => {});
      if (this.activeSession === session) this.activeSession = null;
      void AccountStore.refresh({ ...gateway, baseUrl });
    }
  }

  /**
   * Pick up a run that a JS-context restart interrupted, if any.
   *
   * Called once per init by KokoProvider. Resolves to the resumed goal, or null
   * when there was nothing fresh to resume. The planner decides what is left to
   * do from the screen the App came back on — if the goal already happened, it
   * answers `done` without touching anything.
   */
  async resumeInterruptedRun(): Promise<string | null> {
    if (this.activeSession || this.claimingCheckpoint) return null;
    this.claimingCheckpoint = true;
    const epoch = this.executionEpoch;
    let pending;
    try {
      pending = await RunCheckpoint.claimResumable().catch(() => null);
    } finally {
      this.claimingCheckpoint = false;
    }
    if (!pending || epoch !== this.executionEpoch) return null;
    try {
      await this.runGoal(pending.goal, { resumes: pending.resumes + 1 });
    } catch {
      // A resume is best-effort; a failure here must not break host startup.
    }
    return pending.goal;
  }

  /**
   * On-device exploration crawl — builds a local screen/transition graph
   * without a host feature tree. Safe-ish (skips sensitive labels). Call
   * after SDK init / on a debug build; then runGoal can reuse the graph.
   */
  async bootstrapExplore(
    opts?: import('./explore/bootstrapExplore').BootstrapExploreOptions,
  ) {
    const { bootstrapExplore } = await import('./explore/bootstrapExplore');
    return bootstrapExplore(this, opts);
  }

  /** Snapshot of the on-device exploration graph (nodes/edges). */
  getExplorationGraph() {
    return ExplorationGraph.snapshot();
  }

  clearExplorationGraph() {
    ExplorationGraph.clear();
  }

  /** Refresh plan / quota / entitlements from gateway. */
  async refreshAccount() {
    const gateway = this.config.gateway;
    if (!gateway?.token && !gateway?.tokenProvider) return null;
    return AccountStore.refresh({
      ...gateway,
    });
  }

  getAccount() {
    return AccountStore.get();
  }

  /** Stop the in-flight runGoal / session, if any. */
  stop() {
    if (this.activeSession) this.activeSession.stop();
    else this.cancelPendingActions();
  }

  /** Open chat sheet (history + NL input) from host UI. */
  openChat(taskId?: string | null) {
    TaskStore.openSheet(taskId);
  }

  closeChat() {
    TaskStore.closeSheet();
  }

  getTaskStore(): TaskStoreImpl {
    return TaskStore;
  }

  async dump(options?: DumpOptions): Promise<ViewNode> {
    ExecutionGuard.assert('dump');
    // Sheet Modal lives in another window and blocks host; close before scan.
    if (TaskStore.snapshot().ui.sheetOpen) {
      TaskStore.closeSheet();
      // Host apps (OneKey) freezeOnBlur — need a beat to remount Empty states.
      await sleep(480);
    }
    const silent = options?.silent === true;
    const node = silent ? { id: '' } : this.track('dump', this.message('runtime.scan'));
    try {
      const tree = await NativeBridge.dump({
        maxDepth: options?.maxDepth ?? this.config.dumpMaxDepth,
        skipInvisible: options?.skipInvisible ?? this.config.dumpSkipInvisible,
      });
      this.lastTree = tree;
      this.warnIfDepthCapped(
        tree,
        options?.maxDepth ?? this.config.dumpMaxDepth ?? 0,
      );
      if (!silent) this.done(node, this.message('runtime.scanned'));
      return tree;
    } catch (e) {
      if (!silent) this.fail(node, e);
      throw e;
    }
  }

  /**
   * Screenshot the host app. By default hides Koko overlay layers
   * (progress / cursor / sheet) so the image matches what dump sees.
   */
  async screenshot(options?: { hideOverlays?: boolean }) {
    ExecutionGuard.assert('screenshot');
    return NativeBridge.screenshot({
      hideOverlays: options?.hideOverlays ?? true,
    });
  }

  getLastTree(): ViewNode | null {
    return this.lastTree;
  }

  /** @internal Return a locally observed OCR label for validating a planned action. */
  observedOcrLabel(nodeId: string | undefined): string | undefined {
    return nodeId ? this.ocrTargets.get(nodeId)?.text : undefined;
  }

  /** @internal Pin the screen whose node ids the planner is about to see. */
  setPlanningTree(tree: ViewNode | null) {
    this.planningTree = tree;
  }

  async find(selector: Selector, tree?: ViewNode): Promise<ViewNode | null> {
    const wantedLabel = selectorLabel(selector);
    const label = wantedLabel ?? this.text('runtime.element');
    const node = this.track('find', this.message('runtime.find', { label }));
    try {
      const root = tree ?? (await this.dump({ silent: true }));
      if (sensitiveScreenKind(root)) throw new ActionValidationError(this.message('runtime.privateStep'));
      let hit = find(root, selector);
      // OCR can confirm only a unique visible text label. It cannot prove an
      // index, nearby context, element type, or actual clickability.
      const ocrEligible = selector.match.length === 1 &&
        (('text' in selector.match[0]!) || ('accessibilityLabel' in selector.match[0]!)) &&
        (selector.index === undefined || selector.index === 0);
      if (!hit && !!wantedLabel && ocrEligible && NativeBridge.isAvailable()) {
        try {
          const ocr = await NativeBridge.recognizeScreenText({
            maxTokens: 32,
            hideOverlays: true,
          });
          const directHit = findOcrTextHit(ocr.texts || [], label);
          const textHit = directHit || findOcrTextHit(ocr.texts || [], label, {
            translatedWebRegions: visibleWebViewFrames(root),
          });
          if (textHit?.frame) {
            const f = textHit.frame;
            // The id carries no coordinates. A later tap must recognize this
            // text again and use its current frame rather than this snapshot.
            const id = `ocr:local-${++this.nextOcrTargetId}`;
            this.ocrTargets.set(id, { text: textHit.text, webview: !directHit });
            if (this.ocrTargets.size > 32) this.ocrTargets.delete(this.ocrTargets.keys().next().value!);
            hit = {
              id,
              type: 'KokoOcrText',
              frame: f,
              // Only return the requested label, not arbitrary OCR screen text.
              // Raw OCR remains on-device even if a webpage contains secrets.
              text: label,
              clickable: true,
              enabled: true,
              visible: true,
              children: [],
            };
          }
        } catch {
          // OCR is optional; a normal miss remains a normal miss.
        }
      }
      if (!hit && !tree && this.activeGoal) {
        hit = await this.revealVisibleTarget(selector, wantedLabel || undefined);
      }
      this.done(node, this.message(hit ? 'runtime.found' : 'runtime.notFound', { label }), hit ? hit.id : undefined);
      return hit;
    } catch (e) {
      this.fail(node, e);
      throw e;
    }
  }

  async findAll(selector: Selector, tree?: ViewNode): Promise<ViewNode[]> {
    const root = tree ?? this.lastTree ?? (await this.dump({ silent: true }));
    return findAll(root, selector);
  }

  async tap(target: TapTarget): Promise<void> {
    const epoch = this.executionEpoch;
    const assertCurrent = () => this.assertExecutionCurrent(epoch);
    ExecutionGuard.assert('tap');
    if (sensitiveScreenKind(await NativeBridge.dump())) {
      throw new ActionValidationError(this.message('runtime.privateStep'));
    }
    assertCurrent();
    this.lastTapViaHost = null;
    let label = target.label ?? selectorLabel(target.selector) ?? this.text('runtime.target');
    let hostHit = target.nodeId || target.point ? undefined : HostActionsStore.findForTap({
      label,
      text: selectorLabel(target.selector),
      testID: selectorTestID(target.selector),
    });
    // Planner often taps dump nodeId of a native tab label; resolve copy then
    // match host run (geometric hit-test on UITabBar is unreliable).
    let preresolved: ViewNode | null = null;
    if (!hostHit?.run) {
      try {
        preresolved = await this.resolveNode(target);
        const nodeLabel = (
          preresolved?.text ||
          preresolved?.accessibilityLabel ||
          ''
        ).trim();
        if (nodeLabel) {
          const byNode = HostActionsStore.findForTap({
            label: nodeLabel,
            text: nodeLabel,
            testID: preresolved?.testID,
          });
          if (byNode?.run) {
            hostHit = byNode;
            label = nodeLabel;
          }
        }
      } catch {
        // Geometric path will surface the same resolve error.
      }
    }
    assertCurrent();
    // Host callbacks use the same visibility and confirmation guards as taps.
    if (hostHit?.run) {
      assertCurrent();
      // A host callback is not permission to activate a mounted but hidden row.
      const visible = preresolved ?? (target.options?.revealIfNeeded === false
        ? find(await this.dump({ silent: true }),
          target.selector || { match: [{ text: hostHit.text || hostHit.label }] }, tapFindOptions(target))
        : await this.revealVisibleTarget(
        target.selector || { match: [{ text: hostHit.text || hostHit.label }] },
        hostHit.text || hostHit.label,
        tapFindOptions(target).preferNonInput,
      ));
      if (visible) preresolved = visible;
      if (!visible || !canRunHostActionForNode(hostHit, visible, this.lastTree)) hostHit = undefined;
    }
    if (hostHit?.run) {
      const node = this.track('tap', this.message('runtime.tap', { label }));
      try {
        const confirmKey = `tap:${label}`;
        if (!this.confirmedSensitive.has(confirmKey)) {
          const allowed = await runConfirmationGate(
            { action: 'tap', label, selector: target.selector },
            this.config.confirmation,
            this.config.onConfirmSensitive,
          );
          assertCurrent();
          if (!allowed) {
            TaskStore.updateNode(node.id, {
              status: 'failed',
              title: this.message('runtime.confirmBlocked', { label }),
            });
            throw new ActionValidationError(
              this.message('runtime.confirmationRequired'),
            );
          }
          if (isSensitiveLabel(label, this.config.confirmation)) {
            this.confirmedSensitive.add(confirmKey);
          }
        }
        const silent = target.options?.silent;
        const beforeSnap = await this.snapshotLine(true);
        const duration =
          target.options?.cursorDurationMs ?? this.config.cursorDurationMs ?? 320;
        const spot = await this.hostActionPoint(target, preresolved);
        if (!silent) {
          if (spot) {
            assertCurrent();
            await CursorController.moveTo(spot.x, spot.y, duration);
            assertCurrent();
            CursorController.setPressing(true);
            await sleep(40);
          } else {
            CursorController.hide();
          }
        }
        try {
          if (!spot) throw new ActionValidationError(this.message('runtime.hostTargetMissing'));
          await this.assertTapTargetCurrent(target, spot, preresolved);
          assertCurrent();
          if (!(await runHostAction(hostHit.run))) {
            throw new ActionOutcomeUnknownError(`host action for ${label} did not settle`);
          }
        } finally {
          if (!silent) {
            await sleep(120);
            CursorController.setPressing(false);
          }
        }
        // One-shot CTAs: drop so the next screen is not poisoned.
        // Tabs / persistent chrome keep `oneshot: false`.
        if (hostHit.oneshot !== false) {
          HostActionsStore.unregisterAction(hostHit.id);
        }
        // Navigation / root reset needs a beat before dump.
        await sleep(hostHit.kind === 'tab' ? 700 : 900);
        assertCurrent();
        // Observe the result, but never turn an uncertain callback into a
        // second coordinate tap: async work may already have committed.
        if (beforeSnap && (await this.snapshotLine()) === beforeSnap) {
          this.lastTapViaHost = null;
          // A resolved callback may already have submitted async work. An
          // unchanged screen does not prove it is safe to perform it again.
          throw new ActionOutcomeUnknownError(`host action for ${label} is unverified; not replayed`);
        } else {
          this.lastTapViaHost = { kind: hostHit.kind, label };
          // Settings / modal hosts stack above progress — remount chrome on top.
          TaskStore.liftChrome();
          this.done(node, this.message('runtime.tapped', { label }));
          return;
        }
      } catch (e) {
        this.fail(node, e);
        throw e;
      }
    }

    assertCurrent();
    let controlNode = preresolved ?? (await this.resolveNode(target));
    let point: Point;
    try {
      point = await this.resolvePoint(target);
    } catch (e) {
      // No target evidence means no decorative tap at a guessed position.
      throw e;
    }
    // Refresh control metadata from the same visible tree used for the point.
    ({ point, node: controlNode } = await this.ensureSafeTapPoint(
      target,
      point,
      controlNode,
    ));
    assertCurrent();
    const isToggle = Boolean(controlNode?.toggle);
    const adjustableKind = controlNode ? classifyAdjustable(controlNode) : null;
    const node = this.track(
      'tap',
      isToggle
        ? this.message('runtime.toggle', { label })
        : adjustableKind
          ? this.message('runtime.adjust', { label })
          : this.message('runtime.tap', { label }),
    );

    try {
      const confirmKey = `tap:${label}`;
      if (!this.confirmedSensitive.has(confirmKey)) {
        const allowed = await runConfirmationGate(
          { action: 'tap', label, selector: target.selector },
          this.config.confirmation,
          this.config.onConfirmSensitive,
        );
        assertCurrent();
        if (!allowed) {
          TaskStore.updateNode(node.id, {
            status: 'failed',
            title: this.message('runtime.confirmBlocked', { label }),
          });
          throw new ActionValidationError(this.message('runtime.confirmationRequired'));
        }
        if (isSensitiveLabel(label, this.config.confirmation)) {
          this.confirmedSensitive.add(confirmKey);
        }
      }

      const silent = target.options?.silent;
      const duration = target.options?.cursorDurationMs ?? this.config.cursorDurationMs ?? 320;

      // Switches / toggles: prefer a real tap — native UISwitch handling is reliable.
      // (A JS→swipe path used to miss UISwitch in dispatchSwipe.)
      if (controlNode?.toggle && controlNode.frame) {
        const targetPoint = centerOf(controlNode);
        if (!silent) {
          assertCurrent();
          await CursorController.moveTo(targetPoint.x, targetPoint.y, duration);
          assertCurrent();
          CursorController.setPressing(true);
          await sleep(40);
        }
        try {
          await withChromeClearance([targetPoint], async () => {
            await this.assertTapTargetCurrent(target, point, controlNode);
            assertCurrent(); return NativeBridge.tap(targetPoint);
          });
        } finally {
          if (!silent && epoch === this.executionEpoch) {
            CursorController.showAt(targetPoint.x, targetPoint.y, 0);
            await sleep(120);
            CursorController.setPressing(false);
          }
        }
        this.done(node, this.message('runtime.toggled', { label }));
        return;
      }

      // Slider / picker: route to swipe. Stepper / segment: plain tap (native handles ± / index).
      if (controlNode?.frame && adjustableKind && (adjustableKind === 'slider' || adjustableKind === 'picker' || adjustableKind === 'other')) {
        const gesture = adjustableGesture(controlNode, adjustableKind, point);
        if (gesture) {
          if (!silent) {
            assertCurrent();
            await CursorController.moveTo(gesture.from.x, gesture.from.y, duration);
            assertCurrent();
            CursorController.setPressing(true);
            await sleep(40);
          }
          try {
            await withChromeClearance([gesture.from, gesture.to], async () =>
              { await this.assertTapTargetCurrent(target, point, controlNode);
                assertCurrent(); return NativeBridge.swipe(gesture.from, gesture.to, gesture.durationMs); },
            );
          } finally {
            if (!silent && epoch === this.executionEpoch) {
              CursorController.showAt(gesture.to.x, gesture.to.y, 0);
              await sleep(120);
              CursorController.setPressing(false);
            }
          }
          this.done(node, this.message('runtime.adjusted', { label }));
          return;
        }
      }

      // System Alert / ActionSheet buttons: invoke handler by title (hit-testing is unreliable).
      if (controlNode && isAlertActionNode(controlNode)) {
        const title =
          (controlNode.text || controlNode.accessibilityLabel || label || '').trim();
        if (!silent) {
          assertCurrent();
          await CursorController.moveTo(point.x, point.y, duration);
          assertCurrent();
          CursorController.setPressing(true);
          await sleep(40);
        }
        try {
          await this.assertTapTargetCurrent(target, point, controlNode);
          assertCurrent();
          const invoked = title ? await NativeBridge.invokeAlertAction(title) : false;
          if (!invoked) {
            await withChromeClearance([point], async () => {
            await this.assertTapTargetCurrent(target, point, controlNode);
            assertCurrent(); return NativeBridge.tap(point);
          });
          }
        } finally {
          if (!silent) {
            await sleep(120);
            CursorController.setPressing(false);
          }
        }
        this.done(node, this.message('runtime.confirmed', { label: title || label }));
        return;
      }

      if (!silent) {
        assertCurrent();
        await CursorController.moveTo(point.x, point.y, duration);
        assertCurrent();
        CursorController.setPressing(true);
        await sleep(40);
      }

      try {
        await this.assertTapTargetCurrent(target, point, controlNode);
        assertCurrent();
        if (!silent && epoch === this.executionEpoch) {
          CursorController.showAt(point.x, point.y, 0);
        }
        // If an alert is up, prefer title invoke even for generic sheet taps.
        let didAlert = false;
        if (controlNode?.sheet && controlNode.clickable) {
          const title = (controlNode.text || controlNode.accessibilityLabel || label || '').trim();
          if (title) {
            assertCurrent();
            didAlert = await NativeBridge.invokeAlertAction(title);
          }
        }
        if (!didAlert) {
          await withChromeClearance([point], async () => {
            await this.assertTapTargetCurrent(target, point, controlNode);
            assertCurrent(); return NativeBridge.tap(point);
          });
        }
      } finally {
        if (!silent) {
          await sleep(160);
          CursorController.setPressing(false);
        }
      }

      this.done(node, this.message('runtime.tapped', { label }));
    } catch (e) {
      this.fail(node, e);
      throw e;
    }
  }

  /** Animation and confirmations may outlive the layout that was planned. */
  private async assertTapTargetCurrent(target: TapTarget, point: Point, expected: ViewNode | null): Promise<void> {
    const currentPoint = await this.resolvePoint({
      ...target, options: { ...target.options, revealIfNeeded: false },
    });
    if (Math.hypot(currentPoint.x - point.x, currentPoint.y - point.y) > 16) {
      throw new ActionValidationError(this.message('runtime.positionChanged'));
    }
    if (expected && !expected.id.startsWith('ocr:')) {
      const current = this.lastTree ? findNodeById(this.lastTree, expected.id) : null;
      if (!current || current.enabled === false || current.visible === false ||
          current.type !== expected.type || current.text !== expected.text ||
          current.accessibilityLabel !== expected.accessibilityLabel || current.testID !== expected.testID) {
        throw new ActionValidationError(this.message('runtime.contentChanged'));
      }
    }
  }

  /** Refresh node metadata after scroll-based target resolution. */
  private async ensureSafeTapPoint(
    target: TapTarget,
    point: Point,
    controlNode: ViewNode | null,
  ): Promise<{ point: Point; node: ViewNode | null }> {
    const tree = this.lastTree;
    const current = tree ? (target.selector ? find(tree, target.selector, tapFindOptions(target)) :
      target.nodeId ? findNodeById(tree, target.nodeId) : controlNode) : controlNode;
    return { point, node: current?.visible === false ? null : current };
  }

  /** Reveal by visible swipes, only inside a natively confirmed scrollable list. */
  private async revealVisibleTarget(selector: Selector, label?: string, preferNonInput = false): Promise<ViewNode | null> {
    const epoch = this.executionEpoch;
    const seen = new Set<string>();
    for (const direction of [1, -1]) {
      for (let page = 0; page < 8; page++) {
        const tree = await this.dump({ silent: true });
        if (sensitiveScreenKind(tree)) throw new ActionValidationError(this.message('runtime.privateStep'));
        const hit = find(tree, selector, { preferNonInput }) ||
          (label && allowsSoftLabelFallback(selector) ? findBySoftLabel(tree, label, { preferNonInput }) : null);
        if (hit) return hit;
        const viewport = scrollViewports(tree)
          .filter(({ frame }) => frame.height >= 140 && frame.width >= tree.frame.width * 0.45)
          .sort((a, b) => b.frame.width * b.frame.height - a.frame.width * a.frame.height)[0];
        if (!viewport) return null;
        // Use the list itself, not the first few screen affordances: sticky
        // headers can stay unchanged while later rows are still moving.
        const fingerprint = `${direction}:${JSON.stringify(flattenTree(viewport.node).map(n =>
          [n.id, n.text || n.accessibilityLabel || '', Math.round(n.frame.y)]))}`;
        if (seen.has(fingerprint)) break;
        seen.add(fingerprint);
        this.log('info', this.message('runtime.reveal'));
        const f = viewport.frame;
        const x = f.x + f.width / 2;
        const upper = f.y + f.height * 0.25;
        const lower = f.y + f.height * 0.75;
        this.assertExecutionCurrent(epoch);
        await this.swipe({ x, y: direction > 0 ? lower : upper },
          { x, y: direction > 0 ? upper : lower }, { durationMs: 420 });
        await sleep(250);
      }
    }
    return null;
  }

  async swipe(from: Point, to: Point, options?: SwipeOptions): Promise<void> {
    const epoch = this.executionEpoch;
    const assertCurrent = () => this.assertExecutionCurrent(epoch);
    ExecutionGuard.assert('swipe');
    const tree = await this.dump({ silent: true });
    if (sensitiveScreenKind(tree)) throw new ActionValidationError(this.message('runtime.privateStep'));
    const viewport = scrollViewports(tree)
      .filter(({ frame: f }) => from.x >= f.x && from.x <= f.x + f.width &&
        from.y >= f.y && from.y <= f.y + f.height)
      .sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
    if (viewport) ({ from, to } = boundedScrollGesture(viewport.frame, from, to));
    const silent = options?.silent;
    const node = silent ? { id: '' } : this.track('swipe', this.message('runtime.swipe'));
    const durationMs = options?.durationMs ?? 280;
    try {
      if (!silent) {
        assertCurrent();
        await CursorController.moveTo(from.x, from.y, this.config.cursorDurationMs ?? 320);
        assertCurrent();
        CursorController.setPressing(true);
      }
      try {
        await withChromeClearance([from, to], () =>
          { assertCurrent(); return NativeBridge.swipe(from, to, durationMs); },
        );
      } finally {
        if (!silent && epoch === this.executionEpoch) {
          CursorController.showAt(to.x, to.y);
          CursorController.setPressing(false);
        }
      }
      this.done(node, this.message('runtime.swiped'));
    } catch (e) {
      this.fail(node, e);
      throw e;
    }
  }

  /**
   * Two-finger pinch at center. scale>1 zoom in, scale<1 zoom out.
   */
  async pinch(center: Point, scale: number, options?: PinchOptions): Promise<void> {
    const epoch = this.executionEpoch;
    const assertCurrent = () => this.assertExecutionCurrent(epoch);
    ExecutionGuard.assert('pinch');
    const silent = options?.silent;
    const zoomIn = scale >= 1;
    const node = silent
      ? { id: '' }
      : this.track('swipe', zoomIn ? this.message('runtime.zoomIn') : this.message('runtime.zoomOut'));
    const durationMs = options?.durationMs ?? 280;
    try {
      if (!silent) {
        assertCurrent();
        await CursorController.moveTo(center.x, center.y, this.config.cursorDurationMs ?? 320);
        assertCurrent();
        CursorController.setPressing(true);
      }
      try {
        await withChromeClearance([center], () =>
          { assertCurrent(); return NativeBridge.pinch(center, scale, durationMs); },
        );
      } finally {
        if (!silent && epoch === this.executionEpoch) {
          CursorController.showAt(center.x, center.y);
          CursorController.setPressing(false);
        }
      }
      this.done(node, zoomIn ? this.message('runtime.zoomedIn') : this.message('runtime.zoomedOut'));
    } catch (e) {
      this.fail(node, e);
      throw e;
    }
  }

  async type(text: string, target: TypeTarget = {}): Promise<void> {
    const epoch = this.executionEpoch;
    const assertCurrent = () => this.assertExecutionCurrent(epoch);
    ExecutionGuard.assert('type');
    if (sensitiveScreenKind(await NativeBridge.dump())) throw new ActionValidationError(this.message('runtime.privateStep'));
    assertCurrent();
    const preview = text.length > 18 ? `${text.slice(0, 18)}…` : text;
    const node = this.track('type', this.message('runtime.input', { text: preview }));
    try {
      // Ensure a field is focused: tap selector / node, or first text field on screen.
      // Native tap must becomeFirstResponder (keyboard); synthetic UIControl events alone do not.
      let focusPoint: Point | null = null;
      if (target.selector || target.nodeId) {
        focusPoint = await this.resolvePoint({
          selector: target.selector,
          nodeId: target.nodeId,
          inputTarget: true,
        });
        assertCurrent();
        await this.tap({
          selector: target.selector,
          nodeId: target.nodeId,
          options: { silent: target.options?.silent },
          label: target.label ?? this.text('runtime.field'),
          inputTarget: true,
        });
      } else {
        const root = this.lastTree ?? (await this.dump({ silent: true }));
        const field = findFirstTextField(root);
        if (field) {
          focusPoint = await this.resolvePoint({ nodeId: field.id });
          assertCurrent();
          await this.tap({
            nodeId: field.id,
            options: { silent: target.options?.silent },
            label: target.label ?? field.accessibilityLabel ?? field.text ?? this.text('runtime.field'),
          });
        }
      }
      await sleep(160);
      if (focusPoint) {
        try {
          assertCurrent();
          await NativeBridge.focusAt(focusPoint);
        } catch {
          try {
            assertCurrent();
            await NativeBridge.focusNode(target.nodeId ?? '');
          } catch {
            // typeText will try becomeFirstResponder again
          }
        }
      } else {
        try {
          assertCurrent();
          await NativeBridge.focusNode(target.nodeId ?? '');
        } catch {
          // optional
        }
      }
      await sleep(80);
      assertCurrent();
      await NativeBridge.typeText(text, target.options?.clear ?? false);
      this.done(node, this.message('runtime.typed', { text: preview }));
    } catch (e) {
      this.fail(node, e);
      throw e;
    }
  }

  async requestConfirm(ctx: SensitiveConfirmContext): Promise<boolean> {
    const label = ctx.label ?? ctx.action;
    const node = this.track('confirm', this.message('runtime.confirm', { label }));
    const ok = await runConfirmationGate(ctx, this.config.confirmation, this.config.onConfirmSensitive);
    TaskStore.updateNode(node.id, {
      status: ok ? 'done' : 'failed',
      title: this.message(ok ? 'runtime.userConfirmed' : 'runtime.userDeclined', { label }),
    });
    return ok;
  }

  hideCursor() {
    CursorController.hide();
  }

  /** Run one agent protocol tool call. */
  async runAction(action: AgentAction): Promise<AgentActionResult> {
    return executeAgentAction(this, action);
  }

  private track(
    kind: Parameters<typeof TaskStore.appendNode>[0]['kind'],
    title: LocalizedText,
  ) {
    if (this.config.observer === false) {
      return { id: '' };
    }
    return TaskStore.appendNode({ kind, title, status: 'running' });
  }

  private done(node: { id: string }, title: LocalizedText, detail?: string) {
    if (!node.id || this.config.observer === false) return;
    TaskStore.updateNode(node.id, { status: 'done', title, detail });
  }

  private fail(node: { id: string }, e: unknown) {
    if (!node.id || this.config.observer === false) return;
    const copy = e instanceof ActionValidationError ? e.localizedMessage : this.message('runtime.operationFailed');
    TaskStore.updateNode(node.id, { status: 'failed', title: copy });
  }

  private async resolvePoint(target: TapTarget): Promise<Point> {
    // A labelled cloud coordinate is a hint, not evidence that a row is visible.
    // Prefer a fresh selector/label and scroll lookup before dispatching a touch.
    if (target.point && !target.selector && !target.nodeId) {
      if (!this.activeGoal) return this.pointWithinWindow(target.point);
      const label = target.label?.match(/[「“"]([^」”"]+)[」”"]/)?.[1] ||
        target.label?.replace(/^(点击|轻点|打开)\s*/, '').replace(/按钮$/, '');
      if (!label) throw new ActionValidationError(this.message('runtime.missingTarget'));
      return this.resolvePoint({ selector: { match: [{ text: label }] }, label, options: target.options });
    }

    const root = await this.dump({ silent: true });
    if (sensitiveScreenKind(root)) throw new ActionValidationError(this.message('runtime.privateStep'));

    // An explicit selector is target evidence; a node path is only a hint.
    // In particular do not replace a selector with a stale recycled row id.
    if (target.selector) {
      let node = find(root, target.selector, tapFindOptions(target));
      const soft = selectorLabel(target.selector);
      const allowSoft = allowsSoftLabelFallback(target.selector);
      if (!node && soft && allowSoft) node = findBySoftLabel(root, soft, tapFindOptions(target));
      if (!node && soft && allowSoft && NativeBridge.isAvailable()) {
        const point = await this.currentOcrPoint(soft);
        if (point) return point;
      }
      if (!node && target.options?.revealIfNeeded !== false) {
        node = await this.revealVisibleTarget(target.selector, soft || undefined, tapFindOptions(target).preferNonInput);
      }
      if (!node || node.visible === false || node.enabled === false) {
        throw new ActionValidationError(this.message('runtime.missingTarget'));
      }
      return this.pointWithinWindow(centerOfLabel(node, soft));
    }

    if (target.nodeId) {
      if (target.nodeId.startsWith('ocr:')) {
        const observed = this.ocrTargets.get(target.nodeId);
        if (!observed) throw new ActionValidationError(this.message('runtime.ocrUnobserved'));
        const point = await this.currentOcrPoint(observed.text, observed.webview ? root : undefined);
        if (point) return point;
        throw new ActionValidationError(this.message('runtime.ocrMissing'));
      }
      // host:… is a catalog id, not a dump node — remap to visible text.
      if (target.nodeId.startsWith('host:')) {
        const host = HostActionsStore.getById(target.nodeId);
        const soft = host?.text || host?.label;
        if (soft) {
          const hit = target.options?.revealIfNeeded === false
            ? findBySoftLabel(root, soft)
            : await this.revealVisibleTarget({ match: [{ text: soft }] }, soft);
          if (hit && hit.visible !== false && hit.enabled !== false) return this.pointWithinWindow(centerOfLabel(hit, soft));
        }
        throw new ActionValidationError(this.message('runtime.hostNotVisible', { id: target.nodeId }));
      }
      const node = this.validatedNativeNode(root, target.nodeId);
      // label is narration, in any language. It must not override a real
      // current node or become an invented selector such as “Click Back”.
      return this.pointWithinWindow(centerOfLabel(node));
    }

    throw new ActionValidationError(this.message('runtime.invalidTarget'));
  }

  private validatedNativeNode(root: ViewNode, nodeId: string): ViewNode {
    const node = findNodeById(root, nodeId);
    if (!node || node.visible === false || node.enabled === false) {
      throw new ActionValidationError(this.message('runtime.nodeUnavailable'));
    }
    if (this.activeGoal) {
      const observed = this.planningTree ? findNodeById(this.planningTree, nodeId) : null;
      const identity = (item: ViewNode) => JSON.stringify([
        item.type, item.text || '', item.accessibilityLabel || '', item.testID || '',
      ]);
      if (!observed || identity(observed) !== identity(node)) {
        throw new ActionValidationError(this.message('runtime.nodeChanged'));
      }
    }
    return node;
  }

  private async currentOcrPoint(text: string, webviewRoot?: ViewNode): Promise<Point | null> {
    if (!NativeBridge.isAvailable()) return null;
    try {
      const ocr = await NativeBridge.recognizeScreenText({ maxTokens: 32, hideOverlays: true });
      const hit = findOcrTextHit(ocr.texts || [], text);
      const frame = hit?.frame;
      if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) return null;
      if (webviewRoot && (!hit || !ocrHitInFrames(hit, visibleWebViewFrames(webviewRoot)))) return null;
      return await this.pointWithinWindow({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
    } catch {
      // No current positioned evidence means no touch, even if an older OCR
      // read found the same text at a plausible location.
      return null;
    }
  }

  /**
   * A coordinate tap has no node to sanity-check it against, so an invented
   * point would dispatch into nowhere and only surface later as tap_noop.
   * Fail loudly instead.
   */
  /**
   * A tree that bottoms out exactly at the cap was almost certainly cut short,
   * and the part that gets cut is the page body — the agent is then left with
   * the shallow chrome and reports the control as missing. Surface it rather
   * than letting it read as an empty screen.
   */
  private warnIfDepthCapped(tree: ViewNode, cap: number): void {
    if (!cap) return;
    let deepest = 0;
    const walk = (n: ViewNode, d: number) => {
      if (d > deepest) deepest = d;
      for (const c of n.children ?? []) walk(c, d + 1);
    };
    walk(tree, 0);
    if (deepest >= cap) {
      AgentDebug.dumpTruncated(this.config, cap);
    }
  }

  /**
   * Cheap screen fingerprint used to tell real navigation from a dead action.
   * The "before" side can reuse the tree the session just dumped for this step:
   * an extra full walk per tap is work the JS thread does not have to spare
   * while a task is running.
   */
  private async snapshotLine(reuseLastTree = false): Promise<string> {
    try {
      const tree = reuseLastTree
        ? (this.lastTree ?? (await this.dump({ silent: true })))
        : await this.dump({ silent: true });
      return tree ? screenSnapshotLine(tree) : '';
    } catch {
      return '';
    }
  }

  private async pointWithinWindow(point: Point): Promise<Point> {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0
    ) {
      throw new ActionValidationError(this.message('runtime.invalidPoint', { x: point.x, y: point.y }));
    }
    const root = this.lastTree ?? (await this.dump({ silent: true }));
    const w = root?.frame?.width ?? 0;
    const h = root?.frame?.height ?? 0;
    if (w > 0 && h > 0 && (point.x > w || point.y > h)) {
      throw new ActionValidationError(
        this.message('runtime.outsideWindow'),
      );
    }
    return point;
  }

  /** Resolve the view node for a tap target (for toggle/adjustable routing). */
  /**
   * Where to point while a host action runs.
   *
   * Best effort by design: the whole reason this path exists is that the dump
   * sometimes cannot see the control, so a miss here is normal and must not
   * turn a working host action into a failed step.
   */
  private async hostActionPoint(
    target: TapTarget,
    preresolved: ViewNode | null,
  ): Promise<Point | null> {
    if (preresolved?.frame) return centerOfLabel(preresolved, target.label ?? selectorLabel(target.selector));
    try {
      return await this.resolvePoint(target);
    } catch {
      return null;
    }
  }

  private async resolveNode(target: TapTarget): Promise<ViewNode | null> {
    if (target.point && !target.selector && !target.nodeId) return null;
    const root = await this.dump({ silent: true });
    if (sensitiveScreenKind(root)) throw new ActionValidationError(this.message('runtime.privateStep'));
    let node: ViewNode | null = null;
    if (target.selector) {
      node = find(root, target.selector, tapFindOptions(target));
      if (!node) {
        const soft = selectorLabel(target.selector);
        if (soft && allowsSoftLabelFallback(target.selector)) node = findBySoftLabel(root, soft, tapFindOptions(target));
      }
    } else if (target.nodeId) {
      if (target.nodeId.startsWith('ocr:')) return null;
      if (target.nodeId.startsWith('host:')) {
        const host = HostActionsStore.getById(target.nodeId);
        const soft = host?.text || host?.label;
        if (soft) node = findBySoftLabel(root, soft);
      } else {
        node = this.validatedNativeNode(root, target.nodeId);
      }
    }
    if (!node || node.visible === false || node.enabled === false) return null;
    if (node.toggle || node.adjustable) return node;
    // Label may resolve to a wrapper; prefer a toggle / adjustable descendant.
    const nested = findControlDescendant(node);
    return nested ?? node;
  }
}

function tapFindOptions(target: TapTarget): { preferNonInput: boolean } {
  const inputIntent = /(?:search|input|text)\s*(?:box|field|input)|输入框|搜索框/i.test(target.label || '');
  return { preferNonInput: !target.inputTarget && !inputIntent };
}

/** A fallback must never discard context, identity, location, or an index. */
function allowsSoftLabelFallback(selector: Selector): boolean {
  return selector.index === undefined && selector.match.every(rule =>
    'text' in rule || 'accessibilityLabel' in rule || ('clickable' in rule && rule.clickable === true));
}

function findControlDescendant(node: ViewNode): ViewNode | null {
  if (node.toggle || node.adjustable) return node;
  for (const c of node.children) {
    const hit = findControlDescendant(c);
    if (hit) return hit;
  }
  return null;
}

function isAlertActionNode(node: ViewNode): boolean {
  if (node.type === 'UIAlertAction' || node.id.startsWith('alert/action/')) return true;
  if (!node.sheet || !node.clickable) return false;
  const t = (node.text || node.accessibilityLabel || '').trim();
  return /^(取消|清空|删除|好|确定|确认|允许|不允许|OK|Cancel|Delete|Yes|No|Discard)$/i.test(t);
}

function selectorLabel(selector?: Selector): string | undefined {
  if (!selector) return undefined;
  for (const rule of selector.match) {
    if ('text' in rule) return rule.text;
    if ('nearText' in rule) return rule.nearText;
    if ('accessibilityLabel' in rule) return rule.accessibilityLabel;
  }
  return undefined;
}

function selectorTestID(selector?: Selector): string | undefined {
  if (!selector) return undefined;
  for (const rule of selector.match) {
    if ('testID' in rule) return rule.testID;
  }
  return undefined;
}

type AdjustableKind = 'slider' | 'stepper' | 'picker' | 'segment' | 'other';

function classifyAdjustable(node: ViewNode): AdjustableKind | null {
  const t = node.type.toLowerCase();
  if (/slider|seekbar|rating/i.test(t)) return 'slider';
  if (/stepper/i.test(t)) return 'stepper';
  if (/segment/i.test(t)) return 'segment';
  if (/picker|datepicker|spinner|numberpicker/i.test(t)) return 'picker';
  if (node.adjustable) {
    // Trait-only adjustable: prefer horizontal if wide, else vertical.
    if (node.frame.width >= node.frame.height * 1.4) return 'slider';
    return 'picker';
  }
  return null;
}

/**
 * Map tap intent on an adjustable into a swipe that nudges value.
 * Uses tap X/Y relative to the control when available.
 */
function adjustableGesture(
  node: ViewNode,
  kind: AdjustableKind,
  tap: Point,
): { from: Point; to: Point; durationMs: number } | null {
  const f = node.frame;
  const midX = f.x + f.width / 2;
  const midY = f.y + f.height / 2;
  const insetX = Math.max(8, f.width * 0.12);
  const insetY = Math.max(8, f.height * 0.18);

  if (kind === 'slider') {
    // Drag from current thumb (if value known) toward the tap X.
    // Near-center taps used to nudge +28% of track → often slammed to max (e.g. 1.6×).
    const min = typeof node.min === 'number' ? node.min : 0;
    const max = typeof node.max === 'number' ? node.max : 1;
    const span = Math.max(1e-6, max - min);
    const cur =
      typeof node.value === 'number' && Number.isFinite(node.value)
        ? node.value
        : min + span * 0.5;
    const thumbRatio = Math.max(0, Math.min(1, (cur - min) / span));
    const trackLeft = f.x + insetX;
    const trackRight = f.x + f.width - insetX;
    const trackW = Math.max(1, trackRight - trackLeft);
    const fromX = trackLeft + thumbRatio * trackW;

    let toX = tap.x;
    if (Math.abs(toX - midX) < f.width * 0.1) {
      // Ambiguous center tap: one small step toward + (~12% of range).
      toX = fromX + trackW * 0.12;
    }
    toX = Math.max(trackLeft, Math.min(trackRight, toX));
    return {
      from: { x: fromX, y: midY },
      to: { x: toX, y: midY },
      durationMs: 200,
    };
  }

  if (kind === 'stepper') {
    // Right half → +, left half → − (short horizontal nudge).
    const goPlus = tap.x >= midX;
    const from = { x: midX, y: midY };
    const to = {
      x: goPlus ? f.x + f.width - insetX : f.x + insetX,
      y: midY,
    };
    return { from, to, durationMs: 160 };
  }

  if (kind === 'picker') {
    // Vertical wheel: tap above mid → scroll up (earlier values), below → down.
    const goUp = tap.y < midY;
    const from = { x: midX, y: midY };
    const to = {
      x: midX,
      y: goUp ? f.y + insetY : f.y + f.height - insetY,
    };
    return { from, to, durationMs: 260 };
  }

  return null;
}

function findFirstTextField(root: ViewNode): ViewNode | null {
  let best: ViewNode | null = null;
  const walk = (n: ViewNode) => {
    const t = n.type.toLowerCase();
    if (
      n.visible &&
      (/textfield|textinput|edittext|uitextfield/i.test(t) || n.secure === true)
    ) {
      best = n;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return best;
}

/**
 * Before an agent gesture: dismiss chat sheet, and if the tap/swipe lands in
 * the bottom-right progress/tab dock, hide chrome → wait for RN unmount →
 * gesture → show chrome again.
 */
async function withChromeClearance(
  points: Point[],
  action: () => Promise<void>,
): Promise<void> {
  if (TaskStore.snapshot().ui.sheetOpen) {
    TaskStore.closeSheet();
    await sleep(480);
  }
  try {
    // iOS dispatch temporarily disables overlay hit-testing natively. Keep
    // the progress host mounted, including when touching beneath the pill.
    if (Platform.OS === 'ios' || !pointsOverlapProgressChrome(points)) {
      await action();
      return;
    }
    TaskStore.suppressChrome();
    // React must commit unmount before native hit-testing; 50ms was too short.
    await sleep(160);
    await action();
  } finally {
    TaskStore.restoreChrome();
    // Host Settings/sheet Modals stack above our progress Modal — remount
    // so stop / pill stay tappable.
    TaskStore.liftChrome();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let shared: KokoAgent | null = null;

export function getKokoAgent(): KokoAgent {
  if (!shared) shared = new KokoAgent();
  return shared;
}

export function initKokoAgent(config?: KokoAgentConfig): KokoAgent {
  shared = new KokoAgent(config);
  return shared;
}
