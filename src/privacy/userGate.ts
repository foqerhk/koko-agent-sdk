import { message, resolveText, type MessageKey } from '../i18n';
import type { ViewNode } from '../types';
import { sensitiveScreenKind } from './sensitiveScreen';
import { isPrivateInput, isSdkChrome, isSystemSheet, nodeLabels, PRIVATE_INPUT_PROMPT_RE, staticScreenLabels } from './screenEvidence';

/**
 * Sensitive steps the agent must NOT automate:
 * user completes them in the App (or system UI), then the run resumes.
 */
export type AppUserGateKind =
  | 'recovery_phrase'
  | 'private_key'
  | 'password'
  | 'pin'
  | 'otp'
  | 'secure_input'
  /** OAuth / social login / hardware pairing / dApp connect — user must authorize. */
  | 'authorization'
  /** Face ID / Touch ID / fingerprint. */
  | 'biometric'
  /** System permission sheets (camera, Bluetooth, photos, …). */
  | 'permission'
  /** Explicit consent / legal / seed reveal confirmation the user must do. */
  | 'consent';

export type AppUserGate = {
  kind: AppUserGateKind;
  label: string;
  nodeId: string;
};

const PASSWORD_RE =
  /密码|支付密码|交易密码|登录密码|安全码|设置密码|确认密码|创建密码|输入密码|passcode|password|passwd|\bpin\b|\bcvv\b|\botp\b|验证码|短信验证|set\s*passcode|confirm\s*passcode/i;

const AUTH_RE =
  /继续使用\s*(google|apple|github)|sign\s*in\s*with|oauth|授权登录|授权连接|连接硬件|配对|pair\s*device|connect\s*wallet|walletconnect|批准|approve\s*(request|connection)|允许此|允许访问/i;

const BIO_RE =
  /面容|指纹|触控\s*id|face\s*id|touch\s*id|biometric|生物识别|解锁以/i;

const PERMISSION_RE =
  /(?:想|希望|请求|需要).{0,16}(?:访问|使用|发送通知|获取|拍摄|录音)|是否允许|允许.{0,24}(?:访问|使用|拍摄|录音|定位|相机|蓝牙|麦克风|照片)|(?:would\s+like|wants?|requests?)\s+to\s+(?:access|use|send|record)|allow\s+(?:access\s+to|use\s+of)/i;

const CONSENT_RE =
  /我已备份|我明白风险|同意并继续|接受条款|i\s+(?:have\s+backed\s+up|understand\s+the\s+risks)|agree\s+and\s+continue|accept\s+(?:the\s+)?terms/i;

function labelOf(n: ViewNode): string {
  return nodeLabels(n).join(' ');
}

function classifyByLabel(label: string, secure: boolean): AppUserGateKind {
  if (/验证码|otp|sms/i.test(label)) return 'otp';
  if (/\bpin\b|passcode|安全码/i.test(label)) return 'pin';
  if (secure || /密码|password|passwd/i.test(label)) return 'password';
  if (BIO_RE.test(label)) return 'biometric';
  if (PERMISSION_RE.test(label)) return 'permission';
  if (CONSENT_RE.test(label)) return 'consent';
  if (AUTH_RE.test(label)) return 'authorization';
  if (PASSWORD_RE.test(label)) return 'secure_input';
  return 'secure_input';
}

type Listener = (gate: AppUserGate | null) => void;

/**
 * Host-declared sensitive gate (passcode / OAuth / permissions…).
 * Preferred when Fabric dump misses the real controls.
 */
class AppUserGateStoreImpl {
  private hostGate: AppUserGate | null = null;
  /** User tapped「已完成」— clears until host sets a new gate. */
  private manualResumeAt = 0;
  private listeners = new Set<Listener>();

  setHostGate(gate: AppUserGate | null) {
    this.hostGate = gate
      ? {
          kind: gate.kind,
          label: String(gate.label || '需要你完成').slice(0, 80),
          nodeId: String(gate.nodeId || 'host:gate').slice(0, 80),
        }
      : null;
    if (gate) this.manualResumeAt = 0;
    this.emit();
  }

  /** User confirms they finished the sensitive App / system step. */
  signalDone() {
    this.hostGate = null;
    this.manualResumeAt = Date.now();
    this.emit();
  }

  /** Recheck only: the UI must not clear a host-declared private step. */
  requestCheck() {
    this.manualResumeAt = Date.now();
    this.emit();
  }

  getHostGate(): AppUserGate | null {
    return this.hostGate;
  }

  wasManuallyResumedSince(sinceMs: number): boolean {
    return this.manualResumeAt > 0 && this.manualResumeAt >= sinceMs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.hostGate);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l(this.hostGate);
  }
}

export const AppUserGateStore = new AppUserGateStoreImpl();

/** Host: current screen needs the user to finish a sensitive step. */
export function setAppUserGate(
  gate: Omit<AppUserGate, 'nodeId'> & { nodeId?: string },
) {
  AppUserGateStore.setHostGate({
    kind: gate.kind,
    label: gate.label,
    nodeId: gate.nodeId ?? `host:gate:${gate.kind}`,
  });
}

export function clearAppUserGate() {
  AppUserGateStore.setHostGate(null);
}

export function signalAppUserGateDone() {
  AppUserGateStore.signalDone();
}

export function signalAppUserGateCheck() {
  AppUserGateStore.requestCheck();
}

/**
 * Detect App / system steps the user must complete themselves.
 * Merges host registration with dump heuristics.
 */
export function detectAppUserGate(
  root: ViewNode | null | undefined,
): AppUserGate | null {
  const host = AppUserGateStore.getHostGate();
  if (host) return host;
  if (!root) return null;

  const sensitive = sensitiveScreenKind(root);
  if (sensitive) {
    return { kind: sensitive, label: '请在 App 内完成隐私步骤', nodeId: 'local-private-screen' };
  }

  let hit: AppUserGate | null = null;
  // All permission evidence must belong to this modal, never its background.
  const sheetPermission = (sheet: ViewNode): boolean => {
    const labels: string[] = [];
    const collect = (n: ViewNode) => {
      if (n.visible === false || isSdkChrome(n)) return;
      labels.push(...nodeLabels(n));
      for (const child of n.children) collect(child);
    };
    collect(sheet);
    return /相机|蓝牙|麦克风|相册|通知|定位|权限|camera|bluetooth|microphone|photos|notifications|location|permission/i.test(labels.join(' ')) &&
      labels.some(label => /^(?:允许|始终允许|使用期间允许|仅本次允许|allow(?:\s+access)?|while using(?: the app)?|only this time)$/i.test(label)) &&
      labels.some(label => /^(?:不允许|拒绝|稍后|don.t allow|deny|not now)$/i.test(label));
  };
  const walk = (n: ViewNode) => {
    if (hit || isSdkChrome(n) || n.visible === false) return;
    if (isSystemSheet(n) && sheetPermission(n)) {
      hit = { kind: 'permission', label: 'System permission request', nodeId: n.id };
      return;
    }
    const label = labelOf(n);
    const secure = n.secure === true;
    if (isPrivateInput(n)) {
      hit = {
        kind: classifyByLabel(label, secure),
        label: '请在 App 内完成安全输入',
        nodeId: n.id,
      };
      return;
    }

    // Affirmative legal/risk consent is a real user decision even as a button.
    if (n.clickable && nodeLabels(n).some(text => text.length <= 80 && CONSENT_RE.test(text))) {
      hit = { kind: 'consent', label: '请在 App 内确认风险或条款', nodeId: n.id };
      return;
    }
    for (const c of n.children) walk(c);
  };

  walk(root);
  if (hit) return hit;
  // A short menu is still a menu. Only static requests, actual inputs, modal
  // evidence or explicit host declarations can establish a waiting gate.
  for (const { node, label } of staticScreenLabels(root)) {
    if (label.length > 160) continue;
    const password = PRIVATE_INPUT_PROMPT_RE.test(label);
    const biometric = BIO_RE.test(label) && /请|验证|认证|解锁|verify|authenticate|unlock|use .+ to/i.test(label);
    const authorization = AUTH_RE.test(label) && /请|等待|批准|授权|sign\s*in\s*with|approve|authorize|confirm|pair\s*device/i.test(label);
    if (password || PERMISSION_RE.test(label) || CONSENT_RE.test(label) || biometric || authorization) {
      return { kind: classifyByLabel(label, false), label, nodeId: node.id };
    }
  }
  return hit;
}

export function gateMessageValue(gate: AppUserGate, fallbackLocale?: string) {
  const keys: Partial<Record<AppUserGateKind, MessageKey>> = {
    recovery_phrase: 'runtime.recoveryPhrase', private_key: 'runtime.privateKey',
    password: 'runtime.password', pin: 'runtime.pin', otp: 'runtime.otp',
    authorization: 'runtime.authorization', biometric: 'runtime.biometric',
    permission: 'runtime.permission', consent: 'runtime.consent',
  };
  return message(keys[gate.kind] ?? 'runtime.sensitiveStep', undefined, fallbackLocale);
}

export function gateMessage(gate: AppUserGate): string {
  return resolveText(gateMessageValue(gate));
}

/** Planner hint — never type secrets or fake authorizations. */
export function userGateModelText(gate: AppUserGate | null): string {
  if (!gate) return '';
  return `- [gate:${gate.kind}] 「${gate.label}」— 等待用户在 App/系统内完成，禁止 type / 禁止代填密钥密码 / 禁止伪造授权`;
}
