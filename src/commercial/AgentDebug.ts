import { resolveDebugLogging } from './devMode';
import type { KokoAgentConfig } from '../types';
import type { Affordance } from '../privacy/screenModel';
import { extractAffordances } from '../privacy/screenModel';
import { HostActionsStore } from '../host/HostActions';
import type { ViewNode } from '../types';

type Cfg = Pick<KokoAgentConfig, 'debug' | 'devMode'> | undefined;

/**
 * Developer-facing logs: what the SDK observed in the host App
 * (controls / fields / actions). Never logs security policy internals.
 */
export const AgentDebug = {
  enabled(config?: Cfg): boolean {
    return resolveDebugLogging(config);
  },

  /** High-level run lifecycle (goal only, no policy). */
  runStart(config: Cfg, goal: string) {
    if (!resolveDebugLogging(config)) return;
    // eslint-disable-next-line no-console
    console.log('[koko] 开始任务:', goal.slice(0, 120));
  },

  runEnd(config: Cfg, summary: string, ok: boolean) {
    if (!resolveDebugLogging(config)) return;
    // eslint-disable-next-line no-console
    console.log(ok ? '[koko] 任务完成:' : '[koko] 任务结束:', summary.slice(0, 160));
  },

  /** The dump stopped at its depth cap, so the page body never reached us. */
  dumpTruncated(config: Cfg, cap: number) {
    if (!resolveDebugLogging(config)) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[koko] 视图树在 maxDepth=${cap} 处被截断，页面正文可能完全缺失（只剩外层导航）。` +
        '请调大 dumpMaxDepth。',
    );
  },

  /** Capabilities discovered on the current screen. */
  screenCapabilities(config: Cfg, tree: ViewNode | null | undefined) {
    if (!resolveDebugLogging(config)) return;
    const items = tree ? extractAffordances(tree, 24) : [];
    const host = HostActionsStore.getActions();
    if (!items.length && !host.length) {
      // eslint-disable-next-line no-console
      console.log('[koko] 当前界面: 未识别到可操作控件');
      return;
    }
    const lines = [
      ...items.map(formatAffordance),
      ...host.map(
        (a) => `宿主声明「${a.label}」${a.testID ? `(testID=${a.testID})` : ''}`,
      ),
    ];
    // eslint-disable-next-line no-console
    console.log(`[koko] 当前界面可用能力 (${lines.length}):\n  - ${lines.join('\n  - ')}`);
  },

  /** What the agent is about to do in the App (user-visible action). */
  appAction(
    config: Cfg,
    step: number,
    tool: string,
    detail?: string,
  ) {
    if (!resolveDebugLogging(config)) return;
    const label = actionLabel(tool, detail);
    // eslint-disable-next-line no-console
    console.log(`[koko] 步骤 ${step}: ${label}`);
  },

  /** Soft failure for developers — generic, no rule leakage. */
  runIssue(config: Cfg, message: string) {
    if (!resolveDebugLogging(config)) return;
    const safe = sanitizeDevMessage(message);
    // eslint-disable-next-line no-console
    console.warn('[koko] 任务遇到问题:', safe);
  },
};

function formatAffordance(a: Affordance): string {
  const kind =
    a.kind === 'button'
      ? '按钮'
      : a.kind === 'field'
        ? '输入框'
        : a.kind === 'row'
          ? '列表项'
          : a.kind === 'link'
            ? '链接'
            : a.kind === 'sheet'
              ? '弹层按钮'
              : a.kind === 'toggle'
                ? '开关'
                : a.kind === 'adjustable'
                  ? '调节控件'
                  : '控件';
  const near = a.near ? `（附近: ${a.near.slice(0, 40)}）` : '';
  return `${kind}「${a.label || '(无文案)'}」${near}`;
}

function actionLabel(tool: string, detail?: string): string {
  const d = detail?.trim();
  switch (tool) {
    case 'dump':
      return '扫描当前界面';
    case 'find':
      return d ? `定位「${d}」` : '定位控件';
    case 'tap':
      return d ? `点击「${d}」` : '点击';
    case 'swipe':
      return d ? `滑动（${d}）` : '滑动';
    case 'pinch':
      return d ? `双指缩放（${d}）` : '双指缩放';
    case 'type':
      return d ? `输入「${d}」` : '输入文字';
    case 'ask_user':
      return '等待你在 App 内操作';
    case 'done':
      return d ? `结束：${d}` : '结束';
    default:
      return d ? `${tool}: ${d}` : tool;
  }
}

/** Strip security/policy jargon from messages shown in debug console. */
export function sanitizeDevMessage(message: string): string {
  const lower = message.toLowerCase();
  if (
    /execution_permit|execution permit|permit expired|gateway host|allowlist|devmode|custom_branding|entitlement/i.test(
      message,
    )
  ) {
    if (/quota|429/.test(lower)) return '今日用量已用尽，请稍后再试或联系服务商扩容';
    if (/unauthorized|401/.test(lower)) return '鉴权失败，请检查 gateway.token';
    return '暂时无法继续操作，请稍后重试或检查网络与账号配置';
  }
  return message.slice(0, 200);
}
