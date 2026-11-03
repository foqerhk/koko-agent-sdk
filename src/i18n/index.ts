import { runtimeEn, runtimeZh, type RuntimeMessageKey } from './runtimeMessages';
import { HostAppearanceStore } from '../provider/HostAppearanceStore';
import type { KokoLocale } from '../types';

export type MessageKey = RuntimeMessageKey
  | 'brand.defaultName'
  | 'brand.defaultTagline'
  | 'brand.defaultPlaceholder'
  | 'brand.defaultMark'
  | 'sheet.recentTasks'
  | 'sheet.timeline'
  | 'sheet.emptyTasks'
  | 'sheet.emptyNodesTitle'
  | 'sheet.emptyNodesHint'
  | 'sheet.send'
  | 'sheet.closeA11y'
  | 'sheet.stopA11y'
  | 'sheet.inputA11y'
  | 'sheet.deleteTaskTitle'
  | 'sheet.deleteTaskBody'
  | 'sheet.deleteTask'
  | 'status.running'
  | 'status.success'
  | 'status.failed'
  | 'status.cancelled'
  | 'kind.user'
  | 'kind.plan'
  | 'kind.dump'
  | 'kind.find'
  | 'kind.tap'
  | 'kind.swipe'
  | 'kind.type'
  | 'kind.confirm'
  | 'kind.info'
  | 'kind.error'
  | 'resume.note'
  | 'resume.verifyFirst'
  | 'progress.running'
  | 'progress.success'
  | 'progress.failed'
  | 'progress.cancelled'
  | 'progress.openA11y'
  | 'progress.stopA11y'
  | 'gate.check'
  | 'gate.checking'
  | 'gate.stillPrivate'
  | 'gate.unreadable'
  | 'gate.verifyResultFirst'
  | 'gate.replayStopped'
  | 'dialog.cancel'
  | 'dialog.confirm'
  | 'dialog.continue'
  | 'dialog.askTitle'
  | 'dialog.askPlaceholder'
  | 'confirm.preflightTitle'
  | 'confirm.preflightBody'
  | 'confirm.inlineTitle'
  | 'confirm.inlineBody';

const zh: Record<MessageKey, string> = {
  ...runtimeZh,
  'brand.defaultName': 'Koko',
  'brand.defaultTagline': '用自然语言操作当前 App',
  'brand.defaultPlaceholder': '跟 Koko 说你想做什么…',
  'brand.defaultMark': 'K',
  'sheet.recentTasks': '最近任务',
  'sheet.timeline': '执行记录',
  'sheet.emptyTasks': '还没有任务，在下方说一句开始',
  'sheet.emptyNodesTitle': '暂无步骤',
  'sheet.emptyNodesHint': '发送指令后，这里会显示每一步操作',
  'sheet.send': '发送',
  'sheet.closeA11y': '关闭会话',
  'sheet.stopA11y': '停止当前任务',
  'sheet.inputA11y': '自然语言指令',
  'sheet.deleteTaskTitle': '删除任务',
  'sheet.deleteTaskBody': '删除「{title}」？此操作不可撤销。',
  'sheet.deleteTask': '删除',
  'status.running': '进行中',
  'status.success': '完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'kind.user': '用户',
  'kind.plan': '规划',
  'kind.dump': '扫描',
  'kind.find': '定位',
  'kind.tap': '点击',
  'kind.swipe': '滑动',
  'kind.type': '输入',
  'kind.confirm': '确认',
  'kind.info': '信息',
  'kind.error': '错误',
  'resume.note': 'App 重载中断了上一次执行，已自动继续',
  'resume.verifyFirst':
    '注意：App 在上一次执行中途重载了，这个目标可能已经完成。请先观察当前界面判断目标是否已达成；如已达成，直接返回 done(success=true) 并说明依据，不要重复操作。另外，重载前学到的界面文案可能已失效，请以当前界面为准。',
  'progress.running': '执行中…',
  'progress.success': '成功',
  'progress.failed': '失败',
  'progress.cancelled': '已取消',
  'progress.openA11y': '打开会话',
  'progress.stopA11y': '停止当前任务',
  'gate.check': '检查状态',
  'gate.checking': '正在本机检查是否已离开隐私页面…',
  'gate.stillPrivate': '仍在隐私页面，请在宿主中点击下一步并完成操作；离开此页后自动继续',
  'gate.unreadable': '暂时无法确认页面状态，请在宿主中完成操作后再检查',
  'gate.verifyResultFirst': '已将进行中的操作交给用户处理。先核验这次操作的结果，继续剩余步骤；若失败或退回之前的入口/说明页，报告问题并停止，禁止从头重新创建、导入或提交。不能把返回入口当作尚未开始。',
  'gate.replayStopped': '检测到人工接管后再次进入已发起过的操作，已停止，避免重复创建或提交。请先确认上一次操作的结果。',
  'dialog.cancel': '取消',
  'dialog.confirm': '确认',
  'dialog.continue': '继续',
  'dialog.askTitle': '需要你的确认',
  'dialog.askPlaceholder': '输入补充信息',
  'confirm.preflightTitle': '确认执行此任务？',
  'confirm.preflightBody':
    '该操作可能涉及资金或敏感数据：\n「{label}」\n\n确认后将自动执行，过程中可点停止取消。',
  'confirm.inlineTitle': '需要你的确认',
  'confirm.inlineBody': '即将执行敏感操作：{label}',
};

const en: Record<MessageKey, string> = {
  ...runtimeEn,
  'brand.defaultName': 'Koko',
  'brand.defaultTagline': 'Control this app with natural language',
  'brand.defaultPlaceholder': 'Tell Koko what you want to do…',
  'brand.defaultMark': 'K',
  'sheet.recentTasks': 'Recent tasks',
  'sheet.timeline': 'Activity',
  'sheet.emptyTasks': 'No tasks yet — type a goal below',
  'sheet.emptyNodesTitle': 'No steps yet',
  'sheet.emptyNodesHint': 'After you send a goal, each step shows up here',
  'sheet.send': 'Send',
  'sheet.closeA11y': 'Close chat',
  'sheet.stopA11y': 'Stop current task',
  'sheet.inputA11y': 'Natural language command',
  'sheet.deleteTaskTitle': 'Delete task',
  'sheet.deleteTaskBody': 'Delete “{title}”? This cannot be undone.',
  'sheet.deleteTask': 'Delete',
  'status.running': 'Running',
  'status.success': 'Done',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'kind.user': 'User',
  'kind.plan': 'Plan',
  'kind.dump': 'Scan',
  'kind.find': 'Find',
  'kind.tap': 'Tap',
  'kind.swipe': 'Swipe',
  'kind.type': 'Type',
  'kind.confirm': 'Confirm',
  'kind.info': 'Info',
  'kind.error': 'Error',
  'resume.note': 'A reload interrupted the previous run; continuing it',
  'resume.verifyFirst':
    'Note: the App reloaded partway through the previous run, so this goal may already be complete. Inspect the current screen first and decide whether it is already satisfied; if it is, return done(success=true) with your evidence and change nothing. Labels learned before the reload may no longer exist — trust the current screen.',
  'progress.running': 'Working…',
  'progress.success': 'Done',
  'progress.failed': 'Failed',
  'progress.cancelled': 'Cancelled',
  'progress.openA11y': 'Open chat',
  'progress.stopA11y': 'Stop current task',
  'gate.check': 'Check status',
  'gate.checking': 'Checking locally whether you have left the private screen…',
  'gate.stillPrivate': 'Still on a private screen. Complete the next steps in the app; the assistant resumes after you leave it.',
  'gate.unreadable': 'Unable to confirm the screen. Complete the step in the app, then check again.',
  'gate.verifyResultFirst': 'An in-flight operation was handed to the user. Verify its result and continue remaining steps. If it failed or returned to a previous entry or instruction screen, report the issue and stop. Do not restart creation, import, or submission from the beginning.',
  'gate.replayStopped': 'Stopped a repeated operation after user handoff to avoid duplicate creation or submission. Check the previous operation result first.',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'Confirm',
  'dialog.continue': 'Continue',
  'dialog.askTitle': 'We need your input',
  'dialog.askPlaceholder': 'Type a reply',
  'confirm.preflightTitle': 'Run this task?',
  'confirm.preflightBody':
    'This may involve money or sensitive data:\n「{label}」\n\nAfter you confirm, it runs unattended — tap stop to cancel.',
  'confirm.inlineTitle': 'Confirmation needed',
  'confirm.inlineBody': 'About to run a sensitive action: {label}',
};

const catalogs: Record<KokoLocale, Record<MessageKey, string>> = { zh, en };

export function normalizeLocale(locale?: string | null): KokoLocale {
  if (!locale) return 'en';
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return 'en';
}

export function gatewayLocale(locale: KokoLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

export function t(
  locale: KokoLocale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = catalogs[locale] ?? catalogs.en;
  let out = table[key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v));
    }
  }
  return out;
}


export type MessageVars = Record<string, string | number>;
export type LocalizedMessage = {
  readonly kokoMessage: true;
  readonly key: MessageKey;
  readonly vars?: MessageVars;
  readonly fallbackLocale?: string;
};
export type LocalizedText = string | LocalizedMessage;

/** Resolve at use time so an in-flight task follows host language changes. */
export function currentLocale(fallbackLocale?: string | null): KokoLocale {
  return normalizeLocale(HostAppearanceStore.get().locale ?? fallbackLocale);
}
export function message(key: MessageKey, vars?: MessageVars, fallbackLocale?: string): LocalizedMessage {
  return { kokoMessage: true, key, vars, fallbackLocale };
}
export function resolveText(value: LocalizedText): string {
  return typeof value === 'string' ? value : t(currentLocale(value.fallbackLocale), value.key, value.vars);
}
export function runtimeText(key: MessageKey, vars?: MessageVars, fallbackLocale?: string | null): string {
  return t(currentLocale(fallbackLocale), key, vars);
}
