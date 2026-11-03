import {
  clearAppUserGate,
  detectAppUserGate,
  setAppUserGate,
  signalAppUserGateDone,
  userGateModelText,
} from '../userGate';
import type { ViewNode } from '../../types';

function node(
  partial: Partial<ViewNode> & Pick<ViewNode, 'id' | 'type' | 'frame'>,
): ViewNode {
  return {
    clickable: false,
    enabled: true,
    visible: true,
    children: [],
    ...partial,
  };
}

describe('detectAppUserGate', () => {
  afterEach(() => {
    clearAppUserGate();
  });

  it('detects secure password field', () => {
    const tree = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'UITextField',
          secure: true,
          accessibilityLabel: '支付密码',
          frame: { x: 40, y: 300, width: 300, height: 44 },
        }),
      ],
    });
    const g = detectAppUserGate(tree);
    expect(g?.kind).toBe('password');
    expect(g?.nodeId).toBe('local-private-screen');
  });

  it('detects passcode heading without secure field', () => {
    const tree = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTText',
          text: '设置密码',
          frame: { x: 20, y: 80, width: 200, height: 32 },
        }),
      ],
    });
    expect(detectAppUserGate(tree)?.kind).toBe('password');
  });

  it('prefers host-registered gate when dump is empty', () => {
    setAppUserGate({ kind: 'pin', label: '设置密码' });
    expect(detectAppUserGate(null)?.label).toBe('设置密码');
    signalAppUserGateDone();
    expect(detectAppUserGate(null)).toBeNull();
  });

  it('detects authorization copy', () => {
    const tree = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTText',
          text: 'Sign in with Google',
          frame: { x: 20, y: 80, width: 200, height: 32 },
        }),
      ],
    });
    expect(detectAppUserGate(tree)?.kind).toBe('authorization');
  });

  it('emits planner hint line', () => {
    const text = userGateModelText({
      kind: 'pin',
      label: '设置密码',
      nodeId: 'host:gate',
    });
    expect(text).toContain('gate:pin');
    expect(text).toContain('禁止 type');
  });

  it('returns null on normal todo screen', () => {
    const tree = node({
      id: '0',
      type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({
          id: '0/1',
          type: 'RCTUITextField',
          text: 'What do you need to do?',
          frame: { x: 20, y: 100, width: 200, height: 40 },
        }),
      ],
    });
    expect(detectAppUserGate(tree)).toBeNull();
  });

  it.each([
    '如果忘记密码，可使用它来恢复您的钱包',
    '任何持有账户恢复凭证的人，都可能访问您的账户。',
    'If you forget your password, use your recovery phrase to restore your wallet.',
  ])('does not treat onboarding education as a password prompt: %s', (text) => {
    const tree = node({
      id: '0', type: 'RCTView',
      frame: { x: 0, y: 0, width: 390, height: 800 },
      children: [
        node({ id: 'copy', type: 'RCTText', text, frame: { x: 20, y: 300, width: 350, height: 80 } }),
        node({ id: 'next', type: 'RCTView', text: '我已知晓', clickable: true, frame: { x: 20, y: 700, width: 350, height: 44 } }),
      ],
    });
    expect(detectAppUserGate(tree)).toBeNull();
  });

  it.each(['请输入6位密码', '确认您的密码', 'Enter your password', 'Please enter your 6-digit PIN', '验证码'])('keeps explicit input prompts gated: %s', (text) => {
    expect(detectAppUserGate(node({
      id: 'prompt', type: 'RCTText', text, accessibilityLabel: text, testID: 'generic-prompt-title',
      frame: { x: 20, y: 80, width: 350, height: 44 },
    }))).not.toBeNull();
  });

  it.each([
    ['privacy-sensitive-mnemonic', 'recovery_phrase'],
    ['privacy-sensitive-private-key', 'private_key'],
  ])('keeps private screens gated regardless of education copy: %s', (testID, kind) => {
    expect(detectAppUserGate(node({
      id: 'secret', type: 'RCTView', testID,
      text: '如果忘记密码，可使用它来恢复您的钱包',
      frame: { x: 20, y: 80, width: 350, height: 44 },
    }))?.kind).toBe(kind);
  });
});

// Observed on a live host: the goal was "change the language to English", the
// agent wandered into a settings grid whose rows include "连接硬件钱包", and the
// auth gate fired on that row and blocked the task for its full 5 minute budget.
describe('offered vs demanded authorization', () => {
  const row = (id: string, text: string): ViewNode => ({
    id,
    type: 'RCTViewComponentView',
    frame: { x: 0, y: 100, width: 440, height: 48 },
    text,
    clickable: true,
    enabled: true,
    visible: true,
    children: [],
  });

  const screen = (labels: string[]): ViewNode => ({
    id: '0',
    type: 'UIWindow',
    frame: { x: 0, y: 0, width: 440, height: 956 },
    clickable: false,
    enabled: true,
    visible: true,
    children: labels.map((l, i) => row(`0/${i}`, l)),
  });

  it('ignores a connect row inside a settings grid', () => {
    expect(
      detectAppUserGate(
        screen([
          '连接硬件钱包',
          '设置',
          '扫描二维码',
          '立即锁定',
          '备份',
          '地址簿',
          '网络',
          '偏好设置',
          '安全',
        ]),
      ),
    ).toBeNull();
  });

  it('still gates an actual pairing request rather than a connection menu entry', () => {
    const tree = screen(['取消']);
    tree.children.unshift({ ...row('0/title', '请在设备上确认配对'), clickable: false });
    const gate = detectAppUserGate(tree);
    expect(gate?.kind).toBe('authorization');
  });

  it('still gates a secure field however busy the screen is', () => {
    const busy = screen(['连接硬件钱包', '设置', '备份', '网络', '安全', '更多', '帮助']);
    busy.children.push({
      id: '0/pw',
      type: 'RCTUITextField',
      frame: { x: 0, y: 400, width: 440, height: 44 },
      secure: true,
      clickable: true,
      enabled: true,
      visible: true,
      children: [],
    });
    expect(detectAppUserGate(busy)).not.toBeNull();
  });

  // A gate is recomputed from the screen, so a gate raised by a label that
  // never goes away traps the run on that screen until the timeout. These are
  // the screens a goal merely passes through.
  it('ignores a password-shaped tool button on a dev / tools screen', () => {
    expect(
      detectAppUserGate(
        screen([
          '清空缓存密码',
          'Gallery',
          'DevHome Page',
          'Signature Records',
          'Clear Recent Recipients',
          'IP_TABLE_TEST',
          'SNI Request QA',
          'Async Import Test',
        ]),
      ),
    ).toBeNull();
  });

  it('ignores permission-shaped rows in a settings list', () => {
    expect(
      detectAppUserGate(
        screen([
          '通知',
          '蓝牙',
          '相机',
          '语言',
          '主题',
          '货币单位',
          '关于',
          '帮助',
        ]),
      ),
    ).toBeNull();
  });

  it('ignores a consent-shaped row in a long backup menu', () => {
    expect(
      detectAppUserGate(
        screen([
          '查看账户恢复凭证',
          '备份到 iCloud',
          '更多备份选项',
          '地址簿',
          '网络',
          '安全',
          '偏好设置',
        ]),
      ),
    ).toBeNull();
  });

  it('still gates a focused password screen with no field in the dump', () => {
    const tree = screen(['忘记密码', '取消']);
    tree.children.unshift({ ...row('0/title', '输入密码'), clickable: false });
    const gate = detectAppUserGate(tree);
    expect(gate?.kind).toBe('password');
  });

  it('still gates a focused permission sheet', () => {
    const tree = screen(['允许访问相机', '不允许']);
    tree.children.unshift({ ...row('0/title', '请允许访问相机'), clickable: false });
    tree.type = 'UIAlertController';
    const gate = detectAppUserGate(tree);
    expect(gate?.kind).toBe('permission');
  });

  it.each([
    ['复制地址', '导出私钥', '导出公钥', '7702权限管理'],
    ['Copy address', 'Export private key', 'Export public key', 'Permissions'],
    ['通知'], ['相机', '蓝牙'], ['Location permissions', 'Camera'],
  ])('does not mistake a short feature menu for an authorization request: %j', (...labels) => {
    expect(detectAppUserGate(screen(labels as string[]))).toBeNull();
  });

  it('does not treat text descendants of an export menu row as a private key page', () => {
    const tree = screen(['导出私钥', '取消']);
    tree.text = '导出私钥'; // Native ancestor aggregation is not a page heading.
    tree.children[0].children.push({ ...row('0/0/0', '导出私钥'), clickable: false });
    expect(detectAppUserGate(tree)).toBeNull();
  });

  it('keeps native permission sheets protected when only title and choices are exposed', () => {
    const tree = screen(['Camera', 'Allow', "Don't Allow"]);
    tree.type = 'UIAlertController';
    expect(detectAppUserGate(tree)?.kind).toBe('permission');
  });

  it('still protects a real static private-key heading', () => {
    const tree = screen(['取消']);
    tree.children.unshift({ ...row('0/title', '导出私钥'), clickable: false });
    expect(detectAppUserGate(tree)?.kind).toBe('private_key');
  });
});
