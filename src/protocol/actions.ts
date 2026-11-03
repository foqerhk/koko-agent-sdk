import type { KokoAgent } from '../KokoAgent';
import type { AgentAction, AgentActionResult } from '../types';

/**
 * Execute one cloud-agent tool call against the local SDK.
 */
export async function executeAgentAction(
  agent: KokoAgent,
  action: AgentAction,
): Promise<AgentActionResult> {
  try {
    switch (action.tool) {
      case 'dump': {
        const tree = await agent.dump(action.args);
        return { ok: true, tool: 'dump', tree };
      }
      case 'find': {
        const node = await agent.find(action.args.selector);
        return { ok: true, tool: 'find', node };
      }
      case 'findAll': {
        const nodes = await agent.findAll(action.args.selector);
        return { ok: true, tool: 'findAll', nodes };
      }
      case 'tap': {
        await agent.tap({
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          point: action.args.point,
          options: action.args.options,
        });
        return { ok: true, tool: 'tap' };
      }
      case 'swipe': {
        await agent.swipe(action.args.from, action.args.to, action.args.options);
        return { ok: true, tool: 'swipe' };
      }
      case 'pinch': {
        await agent.pinch(action.args.center, action.args.scale, action.args.options);
        return { ok: true, tool: 'pinch' };
      }
      case 'type': {
        await agent.type(action.args.text, {
          selector: action.args.selector,
          nodeId: action.args.nodeId,
          options: action.args.options,
        });
        return { ok: true, tool: 'type' };
      }
      case 'confirm': {
        const confirmed = await agent.requestConfirm({
          action: action.args.action ?? 'confirm',
          label: action.args.label,
        });
        return { ok: true, tool: 'confirm', confirmed };
      }
      default: {
        const _exhaustive: never = action;
        return { ok: false, tool: 'dump', error: `Unknown tool: ${JSON.stringify(_exhaustive)}` };
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, tool: action.tool, error: message };
  }
}
