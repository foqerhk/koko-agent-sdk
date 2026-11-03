/** Capture the current public screen as local exploration metadata. */
import type { KokoAgent } from '../KokoAgent';
import { extractAffordances } from '../privacy/screenModel';
import { redactOutbound } from '../privacy/redact';
import { detectAppUserGate } from '../privacy/userGate';
import { findNodeById } from '../selector/match';
import type { ViewNode } from '../types';
import { ExplorationGraph, normalizeExploreLabel, type ExplorationGraphSnapshot } from './ExplorationGraph';

export type BootstrapExploreOptions = {
  /** @deprecated Exploration only observes the current screen; no crawling. */
  mode?: 'full' | 'quick';
  /** @deprecated No actions are executed. */
  maxSteps?: number;
  /** @deprecated Only the current screen is observed. */
  maxScreens?: number;
  /** @deprecated There are no candidate actions to prioritize. */
  priorityPatterns?: RegExp[];
  /** @deprecated There are no candidate actions to skip. */
  skipPatterns?: RegExp[];
  /** @deprecated No action progress events are emitted. */
  onProgress?: (info: {
    step: number;
    label: string;
    nodes: number;
    edges: number;
    depth: number;
  }) => void;
  /** App key for local graph persistence (bundle id / flavor). */
  appKey?: string;
};

export type BootstrapExploreResult = {
  success: boolean;
  /** Always zero: observation never moves or operates the host. */
  steps: number;
  summary: string;
  graph: ExplorationGraphSnapshot;
};

/**
 * Compatibility entry point for read-only observation. Uses the caller's
 * existing dump permission; never mints a permit, starts a task, navigates,
 * changes LogBox settings or invokes host callbacks. Graphs are soft hints,
 * and never constitute permission to execute a historical transition.
 */
export async function bootstrapExplore(
  agent: KokoAgent,
  opts: BootstrapExploreOptions = {},
): Promise<BootstrapExploreResult> {
  const failure = (summary: string): BootstrapExploreResult => ({
    success: false, steps: 0, summary, graph: ExplorationGraph.snapshot(),
  });
  try {
    // dump() enforces the current execution permission. A failed read must not
    // be turned into a blind dismiss, a synthetic tap or a local permit.
    const tree = await agent.dump({ silent: true });
    if (detectAppUserGate(tree)) return failure('Current screen requires user input; no exploration data was recorded.');
    // Field values and read-only body copy do not belong in persistent maps.
    const hasIndependentInputOrAction = (node: ViewNode): boolean => node.children.some(child =>
      child.clickable || /textfield|textinput|edittext|textview|textarea/i.test(child.type) ||
      hasIndependentInputOrAction(child));
    const labels = [...new Set(extractAffordances(tree, 80)
      .filter(action => action.kind !== 'field')
      .filter(action => {
        const target = findNodeById(tree, action.nodeId);
        // Aggregate keyboard-dismiss/root wrappers can contain a field's
        // current value; they are not standalone public control labels.
        return target && !(target === tree && target.children.length) && !hasIndependentInputOrAction(target);
      })
      .map(action => normalizeExploreLabel(redactOutbound(action.label, tree)))
      .filter(Boolean))];
    if (!labels.length) return failure('No public controls were identified on the current screen.');
    if (opts.appKey) ExplorationGraph.setAppKey(opts.appKey);
    await ExplorationGraph.ensureLoaded();
    ExplorationGraph.observeScreen(labels);
    await ExplorationGraph.persist();
    return {
      success: true,
      steps: 0,
      summary: 'Observed the current public screen without performing any actions.',
      graph: ExplorationGraph.snapshot(),
    };
  } catch {
    // Native / host errors may contain field values. Do not copy them into a
    // returned graph, task history or progress message.
    return failure('Unable to read the current screen with the existing execution permission.');
  }
}
